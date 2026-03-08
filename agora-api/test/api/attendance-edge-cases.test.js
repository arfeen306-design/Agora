const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;

const SCHOOL_ID = "10000000-0000-0000-0000-000000000001";
const YEAR_ID = "50000000-0000-0000-0000-000000000001";
const CLASSROOM_1 = "60000000-0000-0000-0000-000000000001";
const CLASSROOM_2 = "6a000000-0000-0000-0000-000000000003";
const STUDENT_1 = "40000000-0000-0000-0000-000000000001";
const STUDENT_2 = "40000000-0000-0000-0000-000000000002";
const STUDENT_3 = "40000000-0000-0000-0000-000000000003";

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = { raw: text };
  }

  return {
    status: response.status,
    body: data,
  };
}

async function login(email, password) {
  const result = await jsonRequest("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_code: "agora_demo",
      email,
      password,
    }),
  });
  assert.equal(result.status, 200, `Login failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.access_token;
}

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
}

async function seedAttendanceFixtures() {
  await pool.query(
    `
      INSERT INTO classrooms (
        id,
        school_id,
        academic_year_id,
        grade_label,
        section_label,
        capacity,
        section_id,
        classroom_code,
        room_number,
        is_active
      )
      VALUES (
        $1,
        $2,
        $3,
        'Grade 8',
        'B',
        35,
        'a0000000-0000-0000-0000-000000000003',
        'G8-B',
        '208',
        TRUE
      )
      ON CONFLICT (id)
      DO UPDATE SET
        academic_year_id = EXCLUDED.academic_year_id,
        section_id = EXCLUDED.section_id,
        classroom_code = EXCLUDED.classroom_code,
        room_number = EXCLUDED.room_number,
        is_active = TRUE,
        updated_at = NOW()
    `,
    [CLASSROOM_2, SCHOOL_ID, YEAR_ID]
  );

  await pool.query(
    `
      INSERT INTO student_enrollments (
        school_id,
        student_id,
        classroom_id,
        academic_year_id,
        roll_no,
        status,
        joined_on
      )
      VALUES
        ($1, $2, $3, $4, 1, 'active', '2025-08-01'),
        ($1, $5, $6, $4, 2, 'active', '2025-08-01')
      ON CONFLICT (school_id, student_id, academic_year_id)
      DO UPDATE SET
        classroom_id = EXCLUDED.classroom_id,
        status = EXCLUDED.status,
        joined_on = EXCLUDED.joined_on,
        updated_at = NOW()
    `,
    [SCHOOL_ID, STUDENT_1, CLASSROOM_1, YEAR_ID, STUDENT_2, CLASSROOM_2]
  );

  await pool.query(
    `
      INSERT INTO students (
        id,
        school_id,
        student_code,
        first_name,
        last_name,
        admission_date,
        status
      )
      VALUES (
        $1,
        $2,
        'CI-STU-003',
        'Scope',
        'Student',
        CURRENT_DATE,
        'active'
      )
      ON CONFLICT (id)
      DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
    [STUDENT_3, SCHOOL_ID]
  );

  await pool.query(
    `
      INSERT INTO attendance_records (
        school_id,
        student_id,
        classroom_id,
        attendance_date,
        status,
        source,
        note,
        recorded_by_user_id
      )
      VALUES
        ($1, $2, $3, CURRENT_DATE, 'present', 'manual', 'Seed parent scope 1', '20000000-0000-0000-0000-000000000001'),
        ($1, $4, $3, CURRENT_DATE, 'absent', 'manual', 'Seed parent scope 2', '20000000-0000-0000-0000-000000000001')
      ON CONFLICT (school_id, student_id, attendance_date)
      DO UPDATE SET
        classroom_id = EXCLUDED.classroom_id,
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        note = EXCLUDED.note,
        updated_at = NOW()
    `,
    [SCHOOL_ID, STUDENT_1, CLASSROOM_1, STUDENT_3]
  );
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await seedAttendanceFixtures();

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("attendance bulk rejects students not actively enrolled in target classroom", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const attendanceDate = new Date().toISOString().slice(0, 10);

  const response = await jsonRequest("/api/v1/attendance/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_1,
      attendance_date: attendanceDate,
      entries: [
        { student_id: STUDENT_1, status: "present" },
        { student_id: STUDENT_2, status: "absent" },
      ],
    }),
  });

  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body?.error?.code, "VALIDATION_ERROR");
  assert.ok(
    Array.isArray(response.body?.error?.details) &&
      response.body.error.details.some((row) => String(row.issue || "").includes(STUDENT_2)),
    "Expected not_enrolled detail for student outside classroom enrollment"
  );
});

test("attendance role guard and parent scope are enforced", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const adminToken = await login("admin@agora.com", "admin123");
  const parentToken = await login("parent1@agora.com", "pass123");

  const principalDenied = await jsonRequest("/api/v1/attendance?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalDenied.status, 403, JSON.stringify(principalDenied.body));

  const adminAllowed = await jsonRequest("/api/v1/attendance?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(adminAllowed.status, 200, JSON.stringify(adminAllowed.body));

  const parentScoped = await jsonRequest("/api/v1/attendance?page=1&page_size=50", {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentScoped.status, 200, JSON.stringify(parentScoped.body));
  assert.ok(Array.isArray(parentScoped.body?.data));
  assert.equal(
    parentScoped.body.data.every((row) => row.student_id === STUDENT_1 || row.student_id === STUDENT_2),
    true,
    "Parent attendance list leaked records for an unlinked student"
  );
});
