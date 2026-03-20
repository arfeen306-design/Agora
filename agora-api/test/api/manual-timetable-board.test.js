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
const CLASSROOM_ID = "60000000-0000-0000-0000-000000000001";
const SUBJECT_ID = "70000000-0000-0000-0000-000000000001";
const TEACHER_ID = "30000000-0000-0000-0000-000000000002";
const PERIOD_1_ID = "91000000-0000-0000-0000-000000000001";
const PERIOD_2_ID = "91000000-0000-0000-0000-000000000002";

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = { raw: text };
  }

  return {
    status: response.status,
    body: data,
    headers: response.headers,
  };
}

async function login(email, password) {
  const response = await jsonRequest("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_code: "agora_demo",
      email,
      password,
    }),
  });

  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(response.body)}`);
  assert.equal(response.body?.success, true);
  return response.body.data.access_token;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function resetManualBoardFixtures() {
  await pool.query(
    `
      DELETE FROM classroom_weekly_timetable_cells
      WHERE board_id IN (
        SELECT id
        FROM classroom_weekly_timetable_boards
        WHERE school_id = $1
          AND classroom_id = $2
      )
    `,
    [SCHOOL_ID, CLASSROOM_ID]
  );
  await pool.query(
    `
      DELETE FROM classroom_weekly_timetable_rows
      WHERE board_id IN (
        SELECT id
        FROM classroom_weekly_timetable_boards
        WHERE school_id = $1
          AND classroom_id = $2
      )
    `,
    [SCHOOL_ID, CLASSROOM_ID]
  );
  await pool.query(
    `
      DELETE FROM classroom_weekly_timetable_columns
      WHERE board_id IN (
        SELECT id
        FROM classroom_weekly_timetable_boards
        WHERE school_id = $1
          AND classroom_id = $2
      )
    `,
    [SCHOOL_ID, CLASSROOM_ID]
  );
  await pool.query(
    `
      DELETE FROM classroom_weekly_timetable_boards
      WHERE school_id = $1
        AND classroom_id = $2
    `,
    [SCHOOL_ID, CLASSROOM_ID]
  );
}

async function resetTimetableSourceFixtures() {
  await pool.query(
    `
      DELETE FROM timetable_entries
      WHERE school_id = $1
        AND classroom_id = $2
        AND academic_year_id = $3
    `,
    [SCHOOL_ID, CLASSROOM_ID, YEAR_ID]
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

async function seedTimetableSourceFixtures() {
  await pool.query(
    `
      INSERT INTO timetable_periods (
        id,
        school_id,
        academic_year_id,
        period_number,
        label,
        starts_at,
        ends_at,
        is_break,
        is_active
      )
      VALUES
        ($1, $3, $4, 1, 'Period 1', '08:00:00', '08:45:00', FALSE, TRUE),
        ($2, $3, $4, 2, 'Period 2', '08:50:00', '09:35:00', FALSE, TRUE)
      ON CONFLICT (id) DO UPDATE SET
        label = EXCLUDED.label,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        is_active = TRUE
    `,
    [PERIOD_1_ID, PERIOD_2_ID, SCHOOL_ID, YEAR_ID]
  );

  for (const day of [1, 2, 3, 4, 5]) {
    await pool.query(
      `
        INSERT INTO timetable_slots (school_id, academic_year_id, period_id, day_of_week, is_active)
        VALUES
          ($1, $2, $3, $4, TRUE),
          ($1, $2, $5, $4, TRUE)
        ON CONFLICT (school_id, academic_year_id, day_of_week, period_id)
        DO UPDATE SET is_active = TRUE
      `,
      [SCHOOL_ID, YEAR_ID, PERIOD_1_ID, day, PERIOD_2_ID]
    );
  }

  await pool.query(
    `
      UPDATE classrooms
      SET
        classroom_code = COALESCE(classroom_code, 'G7-A'),
        room_number = COALESCE(room_number, '201'),
        is_active = TRUE
      WHERE school_id = $1
        AND id = $2
    `,
    [SCHOOL_ID, CLASSROOM_ID]
  );

  await pool.query(
    `
      INSERT INTO classroom_subjects (
        school_id,
        classroom_id,
        subject_id,
        teacher_id,
        periods_per_week,
        lesson_duration,
        lesson_priority,
        is_timetable_locked
      )
      VALUES ($1, $2, $3, $4, 5, 1, 5, FALSE)
      ON CONFLICT (school_id, classroom_id, subject_id)
      DO UPDATE SET
        teacher_id = EXCLUDED.teacher_id,
        periods_per_week = EXCLUDED.periods_per_week,
        lesson_duration = EXCLUDED.lesson_duration,
        lesson_priority = EXCLUDED.lesson_priority,
        is_timetable_locked = EXCLUDED.is_timetable_locked
    `,
    [SCHOOL_ID, CLASSROOM_ID, SUBJECT_ID, TEACHER_ID]
  );

  const mondayPeriod1Slot = await pool.query(
    `
      SELECT id
      FROM timetable_slots
      WHERE school_id = $1
        AND academic_year_id = $2
        AND day_of_week = 1
        AND period_id = $3
      LIMIT 1
    `,
    [SCHOOL_ID, YEAR_ID, PERIOD_1_ID]
  );
  assert.ok(mondayPeriod1Slot.rows[0]?.id, "Expected Monday period 1 slot to exist");

  await pool.query(
    `
      INSERT INTO timetable_entries (
        school_id,
        academic_year_id,
        classroom_id,
        slot_id,
        subject_id,
        teacher_id,
        entry_type,
        room_number,
        notes,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'teaching', '201', 'Seeded Algebra', TRUE)
    `,
    [SCHOOL_ID, YEAR_ID, CLASSROOM_ID, mondayPeriod1Slot.rows[0].id, SUBJECT_ID, TEACHER_ID]
  );
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_timetable_foundation.sql");
  await runSqlFile("database/migrations/20260314_timetable_engine_integration_foundation.sql");
  await runSqlFile("database/migrations/20260314_classroom_manual_timetable_board.sql");

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(async () => {
  await resetManualBoardFixtures();
  await resetTimetableSourceFixtures();
  await seedTimetableSourceFixtures();
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("teacher manual timetable board CRUD works through class-teacher routes", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const boardResponse = await jsonRequest("/api/v1/class-teacher/timetable", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });

  assert.equal(boardResponse.status, 200, JSON.stringify(boardResponse.body));
  assert.equal(boardResponse.body?.success, true);
  assert.equal(boardResponse.body?.data?.classroom?.id, CLASSROOM_ID);
  assert.equal(Array.isArray(boardResponse.body?.data?.rows), true);
  assert.equal(Array.isArray(boardResponse.body?.data?.columns), true);
  assert.equal(Array.isArray(boardResponse.body?.data?.cells), true);
  assert.equal(boardResponse.body.data.rows.length >= 5, true);
  assert.equal(boardResponse.body.data.columns.length >= 2, true);
  assert.equal(boardResponse.body.data.available_subjects.some((row) => row.id === SUBJECT_ID), true);

  const originalCell = boardResponse.body.data.cells.find((row) => row.subject_id === SUBJECT_ID);
  assert.ok(originalCell?.id, "Expected a seeded timetable cell");

  const addRowResponse = await jsonRequest("/api/v1/class-teacher/timetable/rows", {
    method: "POST",
    headers: authHeaders(teacherToken),
    body: JSON.stringify({
      label: "Assembly",
    }),
  });

  assert.equal(addRowResponse.status, 201, JSON.stringify(addRowResponse.body));
  assert.equal(addRowResponse.body?.success, true);
  assert.equal(addRowResponse.body.data.rows.some((row) => row.label === "Assembly"), true);

  const addColumnResponse = await jsonRequest("/api/v1/class-teacher/timetable/columns", {
    method: "POST",
    headers: authHeaders(teacherToken),
    body: JSON.stringify({
      label: "Period 8",
      starts_at: "14:20",
      ends_at: "15:00",
    }),
  });

  assert.equal(addColumnResponse.status, 201, JSON.stringify(addColumnResponse.body));
  assert.equal(addColumnResponse.body?.success, true);
  assert.equal(addColumnResponse.body.data.columns.some((column) => column.label === "Period 8"), true);

  const patchResponse = await jsonRequest(`/api/v1/class-teacher/timetable/cells/${originalCell.id}`, {
    method: "PATCH",
    headers: authHeaders(teacherToken),
    body: JSON.stringify({
      title: "MAT",
      subtitle: "Focused Practice",
      notes: "Manual board update",
      room_number: "Lab 1",
      color_hex: "#112233",
      subject_id: SUBJECT_ID,
      teacher_id: TEACHER_ID,
    }),
  });

  assert.equal(patchResponse.status, 200, JSON.stringify(patchResponse.body));
  assert.equal(patchResponse.body?.success, true);
  const updatedCell = patchResponse.body.data.cells.find((row) => row.id === originalCell.id);
  assert.ok(updatedCell);
  assert.equal(updatedCell.title, "MAT");
  assert.equal(updatedCell.subtitle, "Focused Practice");
  assert.equal(updatedCell.notes, "Manual board update");
  assert.equal(updatedCell.room_number, "Lab 1");
  assert.equal(updatedCell.color_hex, "#112233");
  assert.equal(updatedCell.subject_id, SUBJECT_ID);
  assert.equal(updatedCell.teacher_id, TEACHER_ID);

  const persistedCell = await pool.query(
    `
      SELECT title, subtitle, notes, room_number, color_hex, subject_id, teacher_id
      FROM classroom_weekly_timetable_cells
      WHERE id = $1
    `,
    [originalCell.id]
  );
  assert.equal(persistedCell.rows[0]?.title, "MAT");
  assert.equal(persistedCell.rows[0]?.subtitle, "Focused Practice");
  assert.equal(persistedCell.rows[0]?.notes, "Manual board update");
  assert.equal(persistedCell.rows[0]?.room_number, "Lab 1");
  assert.equal(persistedCell.rows[0]?.color_hex, "#112233");
  assert.equal(persistedCell.rows[0]?.subject_id, SUBJECT_ID);
  assert.equal(persistedCell.rows[0]?.teacher_id, TEACHER_ID);
});

test("leadership can read a classroom manual timetable board via timetable route", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const adminToken = await login("admin@agora.com", "admin123");

  const teacherBoard = await jsonRequest("/api/v1/class-teacher/timetable", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherBoard.status, 200, JSON.stringify(teacherBoard.body));

  const adminBoard = await jsonRequest(`/api/v1/timetable/classrooms/${CLASSROOM_ID}/manual-board`, {
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(adminBoard.status, 200, JSON.stringify(adminBoard.body));
  assert.equal(adminBoard.body?.success, true);
  assert.equal(adminBoard.body?.data?.classroom?.id, CLASSROOM_ID);
  assert.equal(adminBoard.body.data.rows.length, teacherBoard.body.data.rows.length);
  assert.equal(adminBoard.body.data.columns.length, teacherBoard.body.data.columns.length);
  assert.equal(adminBoard.body.data.cells.length, teacherBoard.body.data.cells.length);
});
