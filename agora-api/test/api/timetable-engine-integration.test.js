const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const config = require("../../src/config");
const app = require("../../src/app");
const pool = require("../../src/db");

let apiServer;
let apiBaseUrl;
let engineServer;
let engineBaseUrl;
let originalEngineConfig;

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
  const response = await fetch(`${apiBaseUrl}${pathname}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
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
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data.access_token;
}

async function seedTimetableGenerationFixtures() {
  await pool.query(`DELETE FROM timetable_substitutions WHERE school_id = $1`, [SCHOOL_ID]);
  await pool.query(`DELETE FROM timetable_entries WHERE school_id = $1`, [SCHOOL_ID]);
  await pool.query(`DELETE FROM timetable_slots WHERE school_id = $1 AND academic_year_id = $2`, [SCHOOL_ID, YEAR_ID]);
  await pool.query(`DELETE FROM timetable_periods WHERE school_id = $1 AND academic_year_id = $2`, [SCHOOL_ID, YEAR_ID]);

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

  const weekdays = [1, 2, 3, 4, 5];
  for (const day of weekdays) {
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

  await pool.query(
    `
      UPDATE classroom_subjects cs
      SET
        teacher_id = COALESCE(cs.teacher_id, $3),
        periods_per_week = GREATEST(COALESCE(cs.periods_per_week, 0), 5),
        lesson_duration = GREATEST(COALESCE(cs.lesson_duration, 1), 1),
        lesson_priority = GREATEST(COALESCE(cs.lesson_priority, 5), 1)
      FROM classrooms c
      WHERE c.id = cs.classroom_id
        AND c.school_id = cs.school_id
        AND cs.school_id = $1
        AND c.academic_year_id = $2
    `,
    [SCHOOL_ID, YEAR_ID, TEACHER_ID]
  );
}

function createMockTimetableEngine() {
  const state = {
    projects: [],
    schoolSettings: new Map(),
    subjects: new Map(),
    teachers: new Map(),
    rooms: new Map(),
    classes: new Map(),
    lessons: new Map(),
    nextId: 1,
  };

  function nextId() {
    state.nextId += 1;
    return state.nextId;
  }

  function collectionFor(projectId, map) {
    if (!map.has(projectId)) map.set(projectId, []);
    return map.get(projectId);
  }

  async function readBody(req) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(req);
      if (body.email && body.password) {
        return send(200, {
          access_token: "mock-token",
          user: { id: 1, email: body.email, school_id: 1 },
        });
      }
      return send(401, { detail: "Invalid email or password" });
    }

    if (req.headers.authorization !== "Bearer mock-token") {
      return send(401, { detail: "Not authenticated" });
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      return send(200, state.projects);
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      const body = await readBody(req);
      const project = {
        id: nextId(),
        school_id: 1,
        name: body.name,
        academic_year: body.academic_year || "",
        archived: false,
      };
      state.projects.push(project);
      return send(200, project);
    }

    const match = url.pathname.match(/^\/api\/projects\/(\d+)\/(.+)$/);
    if (!match) {
      return send(404, { detail: "Not found" });
    }

    const projectId = Number(match[1]);
    const resource = match[2];

    if (resource === "school-settings" && req.method === "PUT") {
      const body = await readBody(req);
      state.schoolSettings.set(projectId, body);
      return send(200, { id: nextId(), project_id: projectId, ...body });
    }

    const makeCollectionHandler = async (map, reqKey) => {
      const items = collectionFor(projectId, map);
      const itemMatch = resource.match(new RegExp(`^${reqKey}\/(\\d+)$`));
      if (resource === reqKey && req.method === "GET") {
        send(200, items);
        return true;
      }
      if (resource === reqKey && req.method === "POST") {
        const body = await readBody(req);
        const item = { id: nextId(), project_id: projectId, ...body };
        items.push(item);
        send(200, item);
        return true;
      }
      if (itemMatch && req.method === "PATCH") {
        const body = await readBody(req);
        const item = items.find((row) => row.id === Number(itemMatch[1]));
        Object.assign(item, body);
        send(200, item);
        return true;
      }
      if (itemMatch && req.method === "DELETE") {
        const index = items.findIndex((row) => row.id === Number(itemMatch[1]));
        if (index >= 0) items.splice(index, 1);
        res.statusCode = 204;
        res.end("");
        return true;
      }
      return false;
    };

    if (await makeCollectionHandler(state.subjects, "subjects")) return;
    if (await makeCollectionHandler(state.teachers, "teachers")) return;
    if (await makeCollectionHandler(state.rooms, "rooms")) return;
    if (await makeCollectionHandler(state.classes, "classes")) return;
    if (await makeCollectionHandler(state.lessons, "lessons")) return;

    if (resource === "generate/validate" && req.method === "POST") {
      return send(200, {
        is_valid: true,
        errors: [],
        warnings: [],
        grouped_errors: {},
        readiness_summary: { errors_count: 0, warnings_count: 0 },
      });
    }

    if (resource === "generate/generate" && req.method === "POST") {
      const lessons = collectionFor(projectId, state.lessons);
      return send(200, {
        success: true,
        message: `Scheduled ${lessons.length} entries.`,
        run_id: 91,
        entries_count: lessons.length,
      });
    }

    if (resource === "review/master" && req.method === "GET") {
      const lessons = collectionFor(projectId, state.lessons);
      const firstLesson = lessons[0];
      const firstClass = collectionFor(projectId, state.classes)[0];
      const firstTeacher = collectionFor(projectId, state.teachers)[0];
      const firstSubject = collectionFor(projectId, state.subjects)[0];
      const firstRoom = collectionFor(projectId, state.rooms)[0];
      return send(200, {
        entries: firstLesson
          ? [
              {
                id: 1,
                lesson_id: firstLesson.id,
                day_index: 0,
                period_index: 0,
                room_id: firstRoom?.id || null,
                locked: false,
                teacher_id: firstTeacher?.id || null,
                subject_id: firstSubject?.id || null,
                class_id: firstClass?.id || null,
              },
            ]
          : [],
        grid: [],
        days: 5,
        periods: 2,
      });
    }

    if (resource === "generate/unscheduled-lessons" && req.method === "GET") {
      return send(200, { unscheduled_lessons: [] });
    }

    return send(404, { detail: "Not found" });
  });
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_timetable_foundation.sql");
  await runSqlFile("database/migrations/20260314_timetable_engine_integration_foundation.sql");
  await seedTimetableGenerationFixtures();

  originalEngineConfig = { ...config.timetableEngine };

  engineServer = createMockTimetableEngine();
  await new Promise((resolve) => engineServer.listen(0, "127.0.0.1", resolve));
  const engineAddress = engineServer.address();
  engineBaseUrl = `http://127.0.0.1:${engineAddress.port}`;
  config.timetableEngine.baseUrl = engineBaseUrl;
  config.timetableEngine.email = "admin@school.demo";
  config.timetableEngine.password = "demo123";
  config.timetableEngine.timeoutMs = 5000;

  apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiAddress = apiServer.address();
  apiBaseUrl = `http://127.0.0.1:${apiAddress.port}`;
});

test.after(async () => {
  config.timetableEngine = originalEngineConfig;
  if (apiServer) {
    await new Promise((resolve) => apiServer.close(resolve));
  }
  if (engineServer) {
    await new Promise((resolve) => engineServer.close(resolve));
  }
});

test("leadership can sync timetable data to external engine and import the generated schedule", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const response = await jsonRequest("/api/v1/timetable/integration/generate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      academic_year_id: YEAR_ID,
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body?.success, true);
  assert.equal(response.body?.data?.academic_year_id, YEAR_ID);
  assert.equal(Number(response.body?.data?.synced?.lessons || 0) >= 1, true);
  assert.equal(Number(response.body?.data?.generation?.entries_count || 0) >= 1, true);
  assert.equal(Number(response.body?.data?.import?.imported_count || 0) >= 1, true);

  const timetableEntries = await pool.query(
    `
      SELECT classroom_id, subject_id, teacher_id, notes
      FROM timetable_entries
      WHERE school_id = $1
        AND academic_year_id = $2
        AND is_active = TRUE
    `,
    [SCHOOL_ID, YEAR_ID]
  );

  assert.equal(timetableEntries.rows.length >= 1, true);
  assert.equal(timetableEntries.rows[0].classroom_id, CLASSROOM_ID);
  assert.equal(timetableEntries.rows[0].subject_id, SUBJECT_ID);
  assert.equal(timetableEntries.rows[0].teacher_id, TEACHER_ID);
  assert.match(timetableEntries.rows[0].notes || "", /Generated by timetable engine project/);

  const auditLog = await pool.query(
    `
      SELECT id
      FROM audit_logs
      WHERE school_id = $1
        AND action = 'academics.timetable_engine.generated'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [SCHOOL_ID]
  );
  assert.equal(Boolean(auditLog.rows[0]), true);
});
