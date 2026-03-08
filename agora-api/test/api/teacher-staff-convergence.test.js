const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;

const SCHOOL_ID = "10000000-0000-0000-0000-000000000001";
const CLASSROOM_ID = "60000000-0000-0000-0000-000000000001";
const SUBJECT_ID = "70000000-0000-0000-0000-000000000001";
const STUDENT_ID = "40000000-0000-0000-0000-000000000001";

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

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
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

async function ensureTeacherRoleId() {
  const role = await pool.query("SELECT id FROM roles WHERE code = 'teacher' LIMIT 1");
  return role.rows[0].id;
}

async function seedTeacherWithStaffAssignment({ email, inactive = false }) {
  const userId = crypto.randomUUID();
  const staffProfileId = crypto.randomUUID();
  const teacherRoleId = await ensureTeacherRoleId();
  const password = "teach123";
  const phoneSuffix = String(Date.now()).slice(-6);
  const staffCodeSuffix = userId.replace(/-/g, "").slice(0, 10).toUpperCase();

  await pool.query(
    `
      INSERT INTO users (
        id,
        school_id,
        email,
        phone,
        password_hash,
        first_name,
        last_name,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, 'Converge', 'Teacher', TRUE)
    `,
    [userId, SCHOOL_ID, email, `+92009${phoneSuffix}`, password]
  );

  await pool.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, teacherRoleId]
  );

  await pool.query(
    `
      INSERT INTO staff_profiles (
        id,
        school_id,
        user_id,
        staff_code,
        staff_type,
        designation,
        employment_status,
        joining_date
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'teacher',
        'Teacher',
        $5,
        CURRENT_DATE
      )
    `,
    [staffProfileId, SCHOOL_ID, userId, `EMP-CNV-${staffCodeSuffix}`, inactive ? "inactive" : "active"]
  );

  await pool.query(
    `
      INSERT INTO staff_classroom_assignments (
        school_id,
        staff_profile_id,
        classroom_id,
        subject_id,
        assignment_role,
        starts_on,
        is_active
      )
      VALUES ($1, $2, $3, $4, 'subject_teacher', CURRENT_DATE, TRUE)
      ON CONFLICT DO NOTHING
    `,
    [SCHOOL_ID, staffProfileId, CLASSROOM_ID, SUBJECT_ID]
  );

  // Ensure we validate convergence path where legacy teacher row is absent.
  await pool.query(
    `
      DELETE FROM teachers
      WHERE school_id = $1
        AND user_id = $2
    `,
    [SCHOOL_ID, userId]
  );

  return { userId, email, password };
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_discipline_foundation.sql");
  await runSqlFile("database/migrations/20260308_timetable_foundation.sql");

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

test("teacher with active staff assignment can manage homework without pre-existing teachers row", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const account = await seedTeacherWithStaffAssignment({
    email: `converge.active.${suffix}@agora.com`,
  });
  const token = await login(account.email, account.password);

  const response = await jsonRequest("/api/v1/homework", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      subject_id: SUBJECT_ID,
      title: `Convergence Homework ${suffix}`,
      description: "Created by teacher/staff convergence test",
      is_published: true,
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body?.success, true);
  assert.ok(response.body?.data?.id);
});

test("inactive teacher staff profile is blocked from teacher-scoped attendance writes", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const account = await seedTeacherWithStaffAssignment({
    email: `converge.inactive.${suffix}@agora.com`,
    inactive: true,
  });
  const token = await login(account.email, account.password);
  const attendanceDate = new Date().toISOString().slice(0, 10);

  const response = await jsonRequest("/api/v1/attendance/bulk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      attendance_date: attendanceDate,
      entries: [{ student_id: STUDENT_ID, status: "present" }],
    }),
  });

  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.equal(response.body?.error?.code, "FORBIDDEN");
});

test("teacher with active staff assignment can read scoped students and parents without legacy teacher row", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const account = await seedTeacherWithStaffAssignment({
    email: `converge.people.${suffix}@agora.com`,
  });
  const token = await login(account.email, account.password);

  const studentsResponse = await jsonRequest("/api/v1/people/students?page=1&page_size=20", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.equal(studentsResponse.status, 200, JSON.stringify(studentsResponse.body));
  assert.equal(studentsResponse.body?.success, true);
  assert.ok(
    Array.isArray(studentsResponse.body?.data) &&
      studentsResponse.body.data.some((student) => student.id === STUDENT_ID),
    "Expected in-scope student to appear in teacher list"
  );

  const parentsResponse = await jsonRequest("/api/v1/people/parents?page=1&page_size=20", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.equal(parentsResponse.status, 200, JSON.stringify(parentsResponse.body));
  assert.equal(parentsResponse.body?.success, true);
  assert.ok(
    Array.isArray(parentsResponse.body?.data) && parentsResponse.body.data.length > 0,
    "Expected at least one linked parent record in teacher scope"
  );
});

test("teacher with active staff assignment can report discipline incidents without legacy teacher row", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const account = await seedTeacherWithStaffAssignment({
    email: `converge.discipline.${suffix}@agora.com`,
  });
  const token = await login(account.email, account.password);
  const incidentDate = new Date().toISOString().slice(0, 10);

  const response = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_ID,
      incident_date: incidentDate,
      incident_type: "minor_infraction",
      description: "Convergence discipline reporting validation",
      severity: "low",
      status: "reported",
    }),
  });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body?.success, true);
  assert.ok(response.body?.data?.id);
});

test("teacher with active staff assignment can read institution/timetable scoped endpoints without legacy teacher row", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const account = await seedTeacherWithStaffAssignment({
    email: `converge.scope.${suffix}@agora.com`,
  });
  const token = await login(account.email, account.password);

  const classroomsResponse = await jsonRequest("/api/v1/institution/classrooms?page=1&page_size=20", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  assert.equal(classroomsResponse.status, 200, JSON.stringify(classroomsResponse.body));
  assert.equal(classroomsResponse.body?.success, true);
  assert.ok(
    Array.isArray(classroomsResponse.body?.data) &&
      classroomsResponse.body.data.some((classroom) => classroom.id === CLASSROOM_ID),
    "Expected assigned classroom to appear in institution classrooms scope"
  );

  const teachersResponse = await jsonRequest("/api/v1/timetable/teachers?page=1&page_size=20", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(teachersResponse.status, 200, JSON.stringify(teachersResponse.body));
  assert.equal(teachersResponse.body?.success, true);
  assert.ok(Array.isArray(teachersResponse.body?.data));
  assert.ok(
    teachersResponse.body.data.length >= 1,
    "Expected at least one teacher row in scoped timetable lookup"
  );

  const substitutionsResponse = await jsonRequest("/api/v1/timetable/substitutions?page=1&page_size=20", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(substitutionsResponse.status, 200, JSON.stringify(substitutionsResponse.body));
  assert.equal(substitutionsResponse.body?.success, true);
  assert.ok(Array.isArray(substitutionsResponse.body?.data));
});
