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
const SECTION_MIDDLE = "a0000000-0000-0000-0000-000000000003";
const CLASSROOM_1 = "60000000-0000-0000-0000-000000000001";
const CLASSROOM_2 = "6f000000-0000-0000-0000-000000000002";
const STUDENT_1 = "40000000-0000-0000-0000-000000000001";
const STUDENT_OUT_SCOPE = "4f000000-0000-0000-0000-000000000099";
const SUBJECT_ID = "70000000-0000-0000-0000-000000000001";
const HASH_TEACH123 = "$2a$10$8npSDRlRr6QwW.lDp4pF.uHz9iZ/txmp/0fuMP88F/zGu7fTZjDEm";

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

async function waitForAuditAction(action, entityId, attempts = 14) {
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
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

async function seedDisciplineFixtures() {
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
        'teacher.discipline2@agora.com',
        '+920000009994',
        $2,
        'Sadia',
        'Farooq',
        TRUE
      )
      ON CONFLICT (school_id, email)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        is_active = EXCLUDED.is_active
      RETURNING id
    `,
    [SCHOOL_ID, HASH_TEACH123]
  );
  const teacherTwoUserId = userRow.rows[0].id;

  await pool.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, r.id
      FROM roles r
      WHERE r.code = 'teacher'
      ON CONFLICT DO NOTHING
    `,
    [teacherTwoUserId]
  );

  const teacherTwo = await pool.query(
    `
      INSERT INTO teachers (
        school_id,
        user_id,
        employee_code,
        designation,
        joined_on
      )
      VALUES ($1, $2, 'T-DIS-002', 'Science Teacher', '2025-08-01')
      ON CONFLICT (user_id)
      DO UPDATE SET
        designation = EXCLUDED.designation,
        joined_on = EXCLUDED.joined_on,
        updated_at = NOW()
      RETURNING id
    `,
    [SCHOOL_ID, teacherTwoUserId]
  );

  const classroomTwo = await pool.query(
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
        32,
        $5,
        'G7-B',
        '202',
        TRUE
      )
      ON CONFLICT (school_id, academic_year_id, grade_label, section_label)
      DO UPDATE SET
        homeroom_teacher_id = EXCLUDED.homeroom_teacher_id,
        section_id = EXCLUDED.section_id,
        classroom_code = EXCLUDED.classroom_code,
        room_number = EXCLUDED.room_number,
        updated_at = NOW()
      RETURNING id
    `,
    [CLASSROOM_2, SCHOOL_ID, YEAR_ID, teacherTwo.rows[0].id, SECTION_MIDDLE]
  );
  const classroom2Id = classroomTwo.rows[0].id;

  await pool.query(
    `
      INSERT INTO classroom_subjects (
        school_id,
        classroom_id,
        subject_id,
        teacher_id
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (school_id, classroom_id, subject_id)
      DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id
    `,
    [SCHOOL_ID, classroom2Id, SUBJECT_ID, teacherTwo.rows[0].id]
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
        status,
        admission_status
      )
      VALUES (
        $1,
        $2,
        'STD-DIS-099',
        'Out',
        'Scope',
        '2025-08-01',
        'active',
        'admitted'
      )
      ON CONFLICT (id)
      DO UPDATE SET
        status = EXCLUDED.status,
        admission_status = EXCLUDED.admission_status,
        updated_at = NOW()
    `,
    [STUDENT_OUT_SCOPE, SCHOOL_ID]
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
      VALUES ($1, $2, $3, $4, 77, 'active', '2025-08-01')
      ON CONFLICT (school_id, student_id, academic_year_id)
      DO UPDATE SET
        classroom_id = EXCLUDED.classroom_id,
        status = EXCLUDED.status,
        joined_on = EXCLUDED.joined_on,
        updated_at = NOW()
    `,
    [SCHOOL_ID, STUDENT_OUT_SCOPE, classroom2Id, YEAR_ID]
  );

  await pool.query(
    `
      UPDATE student_enrollments
      SET classroom_id = $3,
          status = 'active',
          updated_at = NOW()
      WHERE school_id = $1
        AND student_id = $2
        AND academic_year_id = $4
    `,
    [SCHOOL_ID, STUDENT_1, CLASSROOM_1, YEAR_ID]
  );
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_timetable_foundation.sql");
  await runSqlFile("database/migrations/20260308_discipline_foundation.sql");
  await seedDisciplineFixtures();

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

test("teacher can report incidents for own class and principal can resolve + add consequence", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const principalToken = await login("principal@agora.com", "principal123");

  const incidentDate = new Date().toISOString().slice(0, 10);

  const created = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      incident_date: incidentDate,
      incident_type: "minor_infraction",
      description: "Late homework submission and repeated class disruption.",
      location: "Classroom 201",
      severity: "medium",
      status: "reported",
      is_sensitive: false,
    }),
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  const incidentId = created.body.data.id;
  assert.ok(incidentId);
  assert.equal(created.body.data.status, "reported");
  assert.equal(await waitForAuditAction("discipline.incident.reported", incidentId), true);

  const invalidResolve = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      status: "resolved",
    }),
  });
  assert.equal(invalidResolve.status, 422);

  const resolved = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      status: "resolved",
      resolution_notes: "Student counseled and apology submitted.",
      pastoral_notes: "Monitor behavior for the next 2 weeks.",
    }),
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.equal(resolved.body.data.status, "resolved");
  assert.equal(resolved.body.data.resolution_notes, "Student counseled and apology submitted.");
  assert.equal(await waitForAuditAction("discipline.incident.updated", incidentId), true);

  const invalidConsequence = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}/consequences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      consequence_type: "written_warning",
      description: "Backdated consequence should be rejected",
      starts_on: "2020-01-01",
      parent_notified: true,
    }),
  });
  assert.equal(invalidConsequence.status, 422);

  const consequence = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}/consequences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      consequence_type: "written_warning",
      description: "Written warning issued and parent informed.",
      starts_on: incidentDate,
      parent_notified: true,
    }),
  });
  assert.equal(consequence.status, 201, JSON.stringify(consequence.body));
  assert.equal(await waitForAuditAction("discipline.consequence.created", consequence.body.data.id), true);
});

test("teacher cannot report incidents for out-of-scope student", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const response = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_OUT_SCOPE,
      incident_date: new Date().toISOString().slice(0, 10),
      incident_type: "bullying",
      description: "Attempt out of scope.",
      severity: "high",
      status: "reported",
    }),
  });

  assert.equal(response.status, 403, JSON.stringify(response.body));
});

test("leadership scope works and parent summary hides sensitive incidents", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const hmToken = await login("hm.middle@agora.com", "hm123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const parentToken = await login("parent1@agora.com", "pass123");

  const incidentDate = new Date().toISOString().slice(0, 10);

  const normalIncident = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      incident_date: incidentDate,
      incident_type: "bullying",
      description: "Non-sensitive behavior alert.",
      witnesses: "Student A, Student B",
      severity: "high",
      status: "under_review",
      is_sensitive: false,
    }),
  });
  assert.equal(normalIncident.status, 201, JSON.stringify(normalIncident.body));

  const sensitiveIncident = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      incident_date: incidentDate,
      incident_type: "safety_concern",
      description: "Sensitive investigation in progress.",
      witnesses: "Internal witness list",
      severity: "critical",
      status: "escalated",
      is_sensitive: true,
      pastoral_notes: "Restricted note",
    }),
  });
  assert.equal(sensitiveIncident.status, 201, JSON.stringify(sensitiveIncident.body));

  const hmList = await jsonRequest(`/api/v1/discipline/incidents?student_id=${STUDENT_1}`, {
    headers: { Authorization: `Bearer ${hmToken}` },
  });
  assert.equal(hmList.status, 200, JSON.stringify(hmList.body));
  assert.ok(Array.isArray(hmList.body.data));
  assert.equal(hmList.body.data.some((row) => row.is_sensitive === true), false);

  const viceList = await jsonRequest(`/api/v1/discipline/incidents?student_id=${STUDENT_1}`, {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(viceList.status, 200, JSON.stringify(viceList.body));
  assert.equal(viceList.body.data.some((row) => row.is_sensitive === true), false);

  const parentSummary = await jsonRequest(`/api/v1/discipline/students/${STUDENT_1}/summary`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentSummary.status, 200, JSON.stringify(parentSummary.body));
  assert.ok(Array.isArray(parentSummary.body.data.incidents));
  assert.equal(parentSummary.body.data.incidents.some((row) => row.is_sensitive === true), false);
  assert.equal(parentSummary.body.data.incidents.every((row) => row.witnesses === null), true);
  assert.equal(parentSummary.body.data.incidents.every((row) => row.pastoral_notes === null), true);
});

test("headmistress review flow allows status updates only", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const hmToken = await login("hm.middle@agora.com", "hm123");

  const incidentDate = new Date().toISOString().slice(0, 10);
  const created = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      incident_date: incidentDate,
      incident_type: "major_infraction",
      description: "HM flow validation incident.",
      severity: "high",
      status: "reported",
      is_sensitive: false,
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const incidentId = created.body.data.id;

  const hmStatusUpdate = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hmToken}`,
    },
    body: JSON.stringify({
      status: "under_review",
    }),
  });
  assert.equal(hmStatusUpdate.status, 200, JSON.stringify(hmStatusUpdate.body));
  assert.equal(hmStatusUpdate.body.data.status, "under_review");

  const hmInvalidPatch = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hmToken}`,
    },
    body: JSON.stringify({
      status: "under_review",
      resolution_notes: "HM should not set internal notes",
    }),
  });
  assert.equal(hmInvalidPatch.status, 403, JSON.stringify(hmInvalidPatch.body));
});

test("parents and students cannot open incident detail endpoint but can use student summary", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const parentToken = await login("parent1@agora.com", "pass123");
  const studentToken = await login("student1@agora.com", "student123");

  const created = await jsonRequest("/api/v1/discipline/incidents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      incident_date: new Date().toISOString().slice(0, 10),
      incident_type: "minor_infraction",
      description: "Role access verification incident.",
      severity: "low",
      status: "reported",
      is_sensitive: false,
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const incidentId = created.body.data.id;

  const parentDeniedDetail = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentDeniedDetail.status, 403, JSON.stringify(parentDeniedDetail.body));

  const studentDeniedDetail = await jsonRequest(`/api/v1/discipline/incidents/${incidentId}`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentDeniedDetail.status, 403, JSON.stringify(studentDeniedDetail.body));

  const parentSummary = await jsonRequest(`/api/v1/discipline/students/${STUDENT_1}/summary`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentSummary.status, 200, JSON.stringify(parentSummary.body));

  const studentSummary = await jsonRequest(`/api/v1/discipline/students/${STUDENT_1}/summary`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentSummary.status, 200, JSON.stringify(studentSummary.body));
});
