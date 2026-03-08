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
const CLASSROOM_2_SEED_ID = "60000000-0000-0000-0000-000000000002";
const SUBJECT_ID = "70000000-0000-0000-0000-000000000001";
const TEACHER_1 = "30000000-0000-0000-0000-000000000002";
const SLOT_DAY = 1; // Monday

let slotId = "";
let entryId = "";
let teacher2Id = "";
let classroom2Id = CLASSROOM_2_SEED_ID;

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
    headers: response.headers,
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

async function seedTimetableFixtures() {
  const userRow = await pool.query(
    `
      INSERT INTO users (
        school_id,
        email,
        phone,
        password_hash,
        first_name,
        last_name,
        is_active
      )
      VALUES (
        $1,
        'teacher2@agora.com',
        '+920000009992',
        'teach123',
        'Hira',
        'Noman',
        TRUE
      )
      ON CONFLICT (school_id, email)
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = EXCLUDED.is_active
      RETURNING id
    `,
    [SCHOOL_ID]
  );

  const teacher2UserId = userRow.rows[0].id;
  await pool.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, r.id
      FROM roles r
      WHERE r.code = 'teacher'
      ON CONFLICT DO NOTHING
    `,
    [teacher2UserId]
  );

  const teacherRow = await pool.query(
    `
      INSERT INTO teachers (
        school_id,
        user_id,
        employee_code,
        designation,
        joined_on
      )
      VALUES ($1, $2, 'T-002', 'Science Teacher', '2025-08-01')
      ON CONFLICT (user_id)
      DO UPDATE SET
        designation = EXCLUDED.designation
      RETURNING id
    `,
    [SCHOOL_ID, teacher2UserId]
  );
  teacher2Id = teacherRow.rows[0].id;

  const classroomRow = await pool.query(
    `
      INSERT INTO classrooms (
        id,
        school_id,
        academic_year_id,
        grade_label,
        section_label,
        homeroom_teacher_id,
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
        'Grade 7',
        'B',
        $4,
        38,
        'a0000000-0000-0000-0000-000000000003',
        'G7-B',
        '202',
        TRUE
      )
      ON CONFLICT (school_id, academic_year_id, grade_label, section_label)
      DO UPDATE SET
        section_id = EXCLUDED.section_id,
        classroom_code = EXCLUDED.classroom_code,
        capacity = EXCLUDED.capacity,
        is_active = EXCLUDED.is_active,
        homeroom_teacher_id = EXCLUDED.homeroom_teacher_id,
        room_number = EXCLUDED.room_number
      RETURNING id
    `,
    [CLASSROOM_2_SEED_ID, SCHOOL_ID, YEAR_ID, teacher2Id]
  );
  classroom2Id = classroomRow.rows[0].id;

  await pool.query(
    `
      INSERT INTO classroom_subjects (
        school_id,
        classroom_id,
        subject_id,
        teacher_id
      )
      VALUES
        ($1, $2, $3, $4),
        ($1, $5, $3, $4)
      ON CONFLICT (school_id, classroom_id, subject_id)
      DO UPDATE SET teacher_id = EXCLUDED.teacher_id
    `,
    [SCHOOL_ID, CLASSROOM_1, SUBJECT_ID, TEACHER_1, classroom2Id]
  );
}

async function resetTimetableFixtures() {
  await pool.query(
    `
      DELETE FROM timetable_substitutions
      WHERE school_id = $1
    `,
    [SCHOOL_ID]
  );
  await pool.query(
    `
      DELETE FROM timetable_entries
      WHERE school_id = $1
    `,
    [SCHOOL_ID]
  );
  await pool.query(
    `
      DELETE FROM timetable_slots
      WHERE school_id = $1
        AND academic_year_id = $2
    `,
    [SCHOOL_ID, YEAR_ID]
  );
  await pool.query(
    `
      DELETE FROM timetable_periods
      WHERE school_id = $1
        AND academic_year_id = $2
    `,
    [SCHOOL_ID, YEAR_ID]
  );
}

function nextIsoDateForWeekday(targetDay) {
  const today = new Date();
  const currentDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  const target = new Date(today);
  target.setUTCDate(today.getUTCDate() + diff);
  return target.toISOString().slice(0, 10);
}

async function waitForAuditAction(action, entityId, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await pool.query(
      `
        SELECT id
        FROM audit_logs
        WHERE school_id = $1
          AND action = $2
          AND entity_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [SCHOOL_ID, action, entityId]
    );
    if (row.rows[0]) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_timetable_foundation.sql");
  await resetTimetableFixtures();
  await seedTimetableFixtures();

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

test("school admin can create periods, generate slots, create timetable entry, and view classroom grid", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const periodOne = await jsonRequest("/api/v1/timetable/periods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      academic_year_id: YEAR_ID,
      period_number: 1,
      label: "Period 1",
      starts_at: "08:00:00",
      ends_at: "08:45:00",
      is_break: false,
      is_active: true,
    }),
  });
  assert.equal(periodOne.status, 201, JSON.stringify(periodOne.body));

  const periodTwo = await jsonRequest("/api/v1/timetable/periods", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      academic_year_id: YEAR_ID,
      period_number: 2,
      label: "Period 2",
      starts_at: "08:50:00",
      ends_at: "09:35:00",
      is_break: false,
      is_active: true,
    }),
  });
  assert.equal(periodTwo.status, 201, JSON.stringify(periodTwo.body));

  const generated = await jsonRequest("/api/v1/timetable/slots/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      academic_year_id: YEAR_ID,
      weekdays: [1, 2, 3, 4, 5],
    }),
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  assert.ok(generated.body?.data?.generated_slots >= 10);

  const slots = await jsonRequest(`/api/v1/timetable/slots?academic_year_id=${YEAR_ID}&day_of_week=${SLOT_DAY}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(slots.status, 200, JSON.stringify(slots.body));
  assert.ok(Array.isArray(slots.body?.data));
  assert.ok(slots.body.data.length >= 2);
  slotId = slots.body.data[0].id;

  const entry = await jsonRequest("/api/v1/timetable/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_1,
      slot_id: slotId,
      subject_id: SUBJECT_ID,
      teacher_id: TEACHER_1,
      entry_type: "teaching",
      room_number: "201",
      notes: "Algebra unit",
    }),
  });
  assert.equal(entry.status, 201, JSON.stringify(entry.body));
  entryId = entry.body.data.id;

  const classroomGrid = await jsonRequest(
    `/api/v1/timetable/classrooms/${CLASSROOM_1}?academic_year_id=${YEAR_ID}&day_of_week=${SLOT_DAY}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  assert.equal(classroomGrid.status, 200, JSON.stringify(classroomGrid.body));
  assert.equal(classroomGrid.body?.data?.classroom?.id, CLASSROOM_1);
  assert.ok(Array.isArray(classroomGrid.body?.data?.entries));
  assert.ok(classroomGrid.body.data.entries.some((row) => row.id === entryId));
  assert.equal(await waitForAuditAction("academics.timetable_entry.created", entryId), true);
});

test("teacher can view own timetable but cannot manage entries", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const meTimetable = await jsonRequest(`/api/v1/timetable/teachers/me?academic_year_id=${YEAR_ID}`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(meTimetable.status, 200, JSON.stringify(meTimetable.body));
  assert.ok(Array.isArray(meTimetable.body?.data?.entries));

  const createDenied = await jsonRequest("/api/v1/timetable/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_1,
      slot_id: slotId,
      subject_id: SUBJECT_ID,
      teacher_id: TEACHER_1,
      entry_type: "teaching",
    }),
  });
  assert.equal(createDenied.status, 403, JSON.stringify(createDenied.body));
});

test("teacher lookup response includes nested pagination metadata", async () => {
  const principalToken = await login("principal@agora.com", "principal123");

  const list = await jsonRequest("/api/v1/timetable/teachers?page=1&page_size=1", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });

  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(Array.isArray(list.body?.data));
  assert.equal(list.body?.meta?.pagination?.page, 1);
  assert.equal(list.body?.meta?.pagination?.page_size, 1);
  assert.equal(typeof list.body?.meta?.pagination?.total_items, "number");
  assert.equal(typeof list.body?.meta?.pagination?.total_pages, "number");
});

test("conflict checks block teacher overlap in the same slot", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const conflict = await jsonRequest("/api/v1/timetable/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      classroom_id: classroom2Id,
      slot_id: slotId,
      subject_id: SUBJECT_ID,
      teacher_id: TEACHER_1,
      entry_type: "teaching",
      room_number: "202",
      notes: "This should conflict",
    }),
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  assert.equal(conflict.body?.error?.code, "TIMETABLE_CONFLICT");
});

test("substitution create and revoke are allowed for leadership and audited", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const substitutionDate = nextIsoDateForWeekday(SLOT_DAY);

  const create = await jsonRequest("/api/v1/timetable/substitutions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      timetable_entry_id: entryId,
      substitution_date: substitutionDate,
      substitute_teacher_id: teacher2Id,
      reason: "Teacher on leave",
    }),
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const substitutionId = create.body.data.id;

  const list = await jsonRequest(
    `/api/v1/timetable/substitutions?date_from=${substitutionDate}&date_to=${substitutionDate}`,
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(Array.isArray(list.body?.data));
  assert.ok(list.body.data.some((row) => row.id === substitutionId));

  const revoke = await jsonRequest(`/api/v1/timetable/substitutions/${substitutionId}/revoke`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${principalToken}`,
    },
  });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
  assert.equal(revoke.body?.data?.is_active, false);
  assert.equal(await waitForAuditAction("academics.timetable_substitution.created", substitutionId), true);
  assert.equal(await waitForAuditAction("academics.timetable_substitution.revoked", substitutionId), true);
});
