const pool = require("../db");
const config = require("../config");
const AppError = require("../utils/app-error");

const DAY_INDEXES = [1, 2, 3, 4, 5, 6, 7];

function hashString(value) {
  let hash = 0;
  const normalized = String(value || "");
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function colorFromKey(key) {
  const palette = [
    "#7C3AED",
    "#2563EB",
    "#EC4899",
    "#F97316",
    "#14B8A6",
    "#22C55E",
    "#8B5CF6",
    "#E11D48",
  ];
  return palette[hashString(key) % palette.length];
}

function compact(value) {
  return String(value || "").trim();
}

function keyify(...parts) {
  return parts
    .map((part) => compact(part).toLowerCase())
    .filter(Boolean)
    .join("|");
}

function classroomDisplayName(classroom) {
  return [classroom.grade_label, classroom.section_label].filter(Boolean).join(" - ");
}

function normalizeRoomCode(value, fallback) {
  const raw = compact(value || fallback || "ROOM");
  return raw.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "ROOM";
}

function parseTimeParts(value) {
  const normalized = String(value || "00:00:00");
  const [hours, minutes] = normalized.split(":").map((part) => Number(part));
  return { hours: hours || 0, minutes: minutes || 0 };
}

function minutesBetween(startValue, endValue) {
  const start = parseTimeParts(startValue);
  const end = parseTimeParts(endValue);
  return Math.max(0, end.hours * 60 + end.minutes - (start.hours * 60 + start.minutes));
}

function parseResponseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeExternalError(body, fallback) {
  if (!body) return fallback;
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.message === "string") return body.message;
  if (typeof body.error === "string") return body.error;
  if (typeof body.raw === "string") return body.raw;
  return fallback;
}

function buildValidationDetails(validation) {
  const issues = [];
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  for (const message of errors.slice(0, 20)) {
    issues.push({ issue: String(message) });
  }
  const grouped = validation?.grouped_errors;
  if (grouped && typeof grouped === "object") {
    for (const [group, values] of Object.entries(grouped)) {
      if (!Array.isArray(values)) continue;
      for (const value of values.slice(0, 10)) {
        issues.push({ field: group, issue: String(value) });
      }
    }
  }
  return issues;
}

class TimetableEngineClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    this.email = options.email || "";
    this.password = options.password || "";
    this.timeoutMs = Number(options.timeoutMs || 30000);
    this.token = null;
  }

  ensureConfigured() {
    if (!this.baseUrl) {
      throw new AppError(503, "TIMETABLE_ENGINE_UNAVAILABLE", "Timetable engine base URL is not configured");
    }
    if (!this.email || !this.password) {
      throw new AppError(
        503,
        "TIMETABLE_ENGINE_UNAVAILABLE",
        "Timetable engine credentials are not configured"
      );
    }
  }

  async login() {
    this.ensureConfigured();
    if (this.token) return this.token;

    const response = await this.request("/api/auth/login", {
      method: "POST",
      token: false,
      body: {
        email: this.email,
        password: this.password,
      },
    });

    const accessToken = response?.access_token || response?.token;
    if (!accessToken) {
      throw new AppError(502, "TIMETABLE_ENGINE_ERROR", "Timetable engine login succeeded without token");
    }
    this.token = accessToken;
    return this.token;
  }

  async request(path, { method = "GET", body, token = true } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {};
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (token) {
        const bearer = await this.login();
        headers.Authorization = `Bearer ${bearer}`;
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = parseResponseBody(text);
      if (!response.ok) {
        throw new AppError(
          response.status >= 500 ? 502 : 422,
          "TIMETABLE_ENGINE_ERROR",
          normalizeExternalError(payload, `Timetable engine request failed for ${method} ${path}`),
          Array.isArray(payload?.detail)
            ? payload.detail.map((item) => ({ issue: typeof item === "string" ? item : JSON.stringify(item) }))
            : []
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.name === "AbortError") {
        throw new AppError(504, "TIMETABLE_ENGINE_TIMEOUT", "Timed out while waiting for timetable engine");
      }
      throw new AppError(502, "TIMETABLE_ENGINE_ERROR", error?.message || "Timetable engine request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  listProjects() { return this.request("/api/projects"); }
  createProject(payload) { return this.request("/api/projects", { method: "POST", body: payload }); }
  listSubjects(projectId) { return this.request(`/api/projects/${projectId}/subjects`); }
  createSubject(projectId, payload) { return this.request(`/api/projects/${projectId}/subjects`, { method: "POST", body: payload }); }
  updateSubject(projectId, subjectId, payload) { return this.request(`/api/projects/${projectId}/subjects/${subjectId}`, { method: "PATCH", body: payload }); }
  listTeachers(projectId) { return this.request(`/api/projects/${projectId}/teachers`); }
  createTeacher(projectId, payload) { return this.request(`/api/projects/${projectId}/teachers`, { method: "POST", body: payload }); }
  updateTeacher(projectId, teacherId, payload) { return this.request(`/api/projects/${projectId}/teachers/${teacherId}`, { method: "PATCH", body: payload }); }
  listRooms(projectId) { return this.request(`/api/projects/${projectId}/rooms`); }
  createRoom(projectId, payload) { return this.request(`/api/projects/${projectId}/rooms`, { method: "POST", body: payload }); }
  updateRoom(projectId, roomId, payload) { return this.request(`/api/projects/${projectId}/rooms/${roomId}`, { method: "PATCH", body: payload }); }
  listClasses(projectId) { return this.request(`/api/projects/${projectId}/classes`); }
  createClass(projectId, payload) { return this.request(`/api/projects/${projectId}/classes`, { method: "POST", body: payload }); }
  updateClass(projectId, classId, payload) { return this.request(`/api/projects/${projectId}/classes/${classId}`, { method: "PATCH", body: payload }); }
  listLessons(projectId) { return this.request(`/api/projects/${projectId}/lessons`); }
  createLesson(projectId, payload) { return this.request(`/api/projects/${projectId}/lessons`, { method: "POST", body: payload }); }
  deleteLesson(projectId, lessonId) { return this.request(`/api/projects/${projectId}/lessons/${lessonId}`, { method: "DELETE" }); }
  updateSchoolSettings(projectId, payload) { return this.request(`/api/projects/${projectId}/school-settings`, { method: "PUT", body: payload }); }
  validate(projectId) { return this.request(`/api/projects/${projectId}/generate/validate`, { method: "POST", body: {} }); }
  generate(projectId) { return this.request(`/api/projects/${projectId}/generate/generate`, { method: "POST", body: {} }); }
  getMaster(projectId) { return this.request(`/api/projects/${projectId}/review/master`); }
  getUnscheduledLessons(projectId) { return this.request(`/api/projects/${projectId}/generate/unscheduled-lessons`); }
}

async function resolveAcademicYear(schoolId, academicYearId = null) {
  const params = [schoolId];
  let query = `
    SELECT ay.id, ay.name, ay.starts_on, ay.ends_on, ay.is_current
    FROM academic_years ay
    WHERE ay.school_id = $1
  `;
  if (academicYearId) {
    params.push(academicYearId);
    query += ` AND ay.id = $2`;
  }
  query += ` ORDER BY ay.is_current DESC, ay.starts_on DESC, ay.created_at DESC LIMIT 1`;
  const result = await pool.query(query, params);
  if (!result.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Academic year not found for timetable generation");
  }
  return result.rows[0];
}

async function loadAgoraTimetableSnapshot({ schoolId, academicYearId = null }) {
  const year = await resolveAcademicYear(schoolId, academicYearId);

  const schoolResult = await pool.query(
    `
      SELECT s.id, s.name, s.branch_name, s.contact_email, s.contact_phone, s.late_arrival_cutoff
      FROM schools s
      WHERE s.id = $1
      LIMIT 1
    `,
    [schoolId]
  );
  const school = schoolResult.rows[0];
  if (!school) {
    throw new AppError(404, "NOT_FOUND", "School profile not found");
  }

  const periodsResult = await pool.query(
    `
      SELECT tp.id, tp.period_number, tp.label, tp.starts_at::text AS starts_at, tp.ends_at::text AS ends_at, tp.is_break
      FROM timetable_periods tp
      WHERE tp.school_id = $1
        AND tp.academic_year_id = $2
        AND tp.is_active = TRUE
      ORDER BY tp.period_number ASC, tp.starts_at ASC
    `,
    [schoolId, year.id]
  );
  const periods = periodsResult.rows;
  if (periods.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Create active timetable periods before using the timetable engine integration");
  }
  if (periods.some((row) => row.is_break)) {
    throw new AppError(422, "VALIDATION_ERROR", "Timetable engine integration currently supports teaching periods only. Remove active break periods first.");
  }

  const slotsResult = await pool.query(
    `
      SELECT ts.id, ts.day_of_week, tp.period_number
      FROM timetable_slots ts
      JOIN timetable_periods tp
        ON tp.id = ts.period_id
       AND tp.school_id = ts.school_id
       AND tp.academic_year_id = ts.academic_year_id
      WHERE ts.school_id = $1
        AND ts.academic_year_id = $2
        AND ts.is_active = TRUE
        AND tp.is_active = TRUE
      ORDER BY ts.day_of_week ASC, tp.period_number ASC
    `,
    [schoolId, year.id]
  );
  const slots = slotsResult.rows;
  if (slots.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Generate timetable slots before using the timetable engine integration");
  }

  const workingDays = [...new Set(slots.map((row) => Number(row.day_of_week)))].sort((a, b) => a - b);
  const periodNumbers = periods.map((row) => Number(row.period_number));
  const slotByDayPeriod = new Map();
  for (const slot of slots) {
    slotByDayPeriod.set(`${slot.day_of_week}:${slot.period_number}`, slot.id);
  }
  for (const day of workingDays) {
    for (const periodNumber of periodNumbers) {
      if (!slotByDayPeriod.has(`${day}:${periodNumber}`)) {
        throw new AppError(422, "VALIDATION_ERROR", `Timetable slots are incomplete for day ${day} period ${periodNumber}`);
      }
    }
  }

  const classroomsResult = await pool.query(
    `
      SELECT
        c.id,
        c.grade_label,
        c.section_label,
        COALESCE(c.classroom_code, CONCAT(c.grade_label, '-', c.section_label)) AS classroom_code,
        c.room_number,
        c.capacity,
        c.homeroom_teacher_id,
        COUNT(se.student_id) FILTER (WHERE se.status = 'active')::int AS strength
      FROM classrooms c
      LEFT JOIN student_enrollments se
        ON se.school_id = c.school_id
       AND se.classroom_id = c.id
       AND se.academic_year_id = c.academic_year_id
      WHERE c.school_id = $1
        AND c.academic_year_id = $2
        AND COALESCE(c.is_active, TRUE) = TRUE
      GROUP BY c.id
      ORDER BY c.grade_label ASC, c.section_label ASC
    `,
    [schoolId, year.id]
  );
  const classrooms = classroomsResult.rows;
  if (classrooms.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Create active classrooms before generating a timetable");
  }

  const assignmentsResult = await pool.query(
    `
      SELECT
        cs.id,
        cs.classroom_id,
        cs.subject_id,
        cs.teacher_id,
        cs.periods_per_week,
        cs.lesson_duration,
        cs.lesson_priority,
        cs.is_timetable_locked,
        s.code AS subject_code,
        s.name AS subject_name,
        c.grade_label,
        c.section_label,
        COALESCE(c.classroom_code, CONCAT(c.grade_label, '-', c.section_label)) AS classroom_code,
        c.room_number AS classroom_room_number,
        c.capacity AS classroom_capacity,
        t.employee_code,
        t.designation,
        u.first_name AS teacher_first_name,
        u.last_name AS teacher_last_name,
        u.email AS teacher_email
      FROM classroom_subjects cs
      JOIN classrooms c
        ON c.id = cs.classroom_id
       AND c.school_id = cs.school_id
       AND c.academic_year_id = $2
       AND COALESCE(c.is_active, TRUE) = TRUE
      JOIN subjects s
        ON s.id = cs.subject_id
       AND s.school_id = cs.school_id
      LEFT JOIN teachers t
        ON t.id = cs.teacher_id
       AND t.school_id = cs.school_id
      LEFT JOIN users u
        ON u.id = t.user_id
       AND u.school_id = t.school_id
      WHERE cs.school_id = $1
      ORDER BY c.grade_label ASC, c.section_label ASC, s.name ASC
    `,
    [schoolId, year.id]
  );

  const generationAssignments = [];
  const missingLoad = [];
  const missingTeacher = [];
  const subjectsMap = new Map();
  const teacherIds = new Set();

  for (const assignment of assignmentsResult.rows) {
    if (!subjectsMap.has(assignment.subject_id)) {
      subjectsMap.set(assignment.subject_id, {
        id: assignment.subject_id,
        code: assignment.subject_code,
        name: assignment.subject_name,
      });
    }

    const periodsPerWeek = Number(assignment.periods_per_week || 0);
    if (periodsPerWeek <= 0) {
      missingLoad.push(`${assignment.subject_name} in ${assignment.grade_label} - ${assignment.section_label}`);
      continue;
    }
    if (!assignment.teacher_id) {
      missingTeacher.push(`${assignment.subject_name} in ${assignment.grade_label} - ${assignment.section_label}`);
      continue;
    }

    teacherIds.add(assignment.teacher_id);
    generationAssignments.push({
      ...assignment,
      periods_per_week: periodsPerWeek,
      lesson_duration: Number(assignment.lesson_duration || 1),
      lesson_priority: Number(assignment.lesson_priority || 5),
      is_timetable_locked: Boolean(assignment.is_timetable_locked),
    });
  }

  if (missingLoad.length > 0) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Configure periods per week for every classroom-subject assignment before generating a timetable",
      missingLoad.slice(0, 20).map((issue) => ({ field: "periods_per_week", issue }))
    );
  }
  if (missingTeacher.length > 0) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Assign a teacher to every classroom-subject lesson before generating a timetable",
      missingTeacher.slice(0, 20).map((issue) => ({ field: "teacher_id", issue }))
    );
  }
  if (generationAssignments.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "No classroom-subject assignments are ready for timetable generation");
  }

  for (const id of classrooms.map((row) => row.homeroom_teacher_id).filter(Boolean)) {
    teacherIds.add(id);
  }

  const teacherIdList = [...teacherIds];
  const teachersResult = teacherIdList.length
    ? await pool.query(
        `
          SELECT t.id, t.employee_code, t.designation, u.first_name, u.last_name, u.email
          FROM teachers t
          JOIN users u
            ON u.id = t.user_id
           AND u.school_id = t.school_id
          WHERE t.school_id = $1
            AND t.id = ANY($2::uuid[])
        `,
        [schoolId, teacherIdList]
      )
    : { rows: [] };
  const teachers = teachersResult.rows;

  const roomDefinitions = new Map();
  const classroomRoomKey = new Map();
  for (const classroom of classrooms) {
    const displayName = classroomDisplayName(classroom);
    const roomKey = keyify(classroom.room_number || classroom.classroom_code || classroom.id);
    classroomRoomKey.set(classroom.id, roomKey);
    if (!roomDefinitions.has(roomKey)) {
      const roomName = compact(classroom.room_number) || `${displayName} Room`;
      roomDefinitions.set(roomKey, {
        local_key: roomKey,
        name: roomName,
        code: normalizeRoomCode(classroom.room_number, classroom.classroom_code || displayName),
        room_type: "Classroom",
        capacity: Number(classroom.capacity || classroom.strength || 40),
        source_classroom_id: classroom.id,
        room_number: compact(classroom.room_number) || roomName,
      });
    }
  }

  const periodDurationMinutes = periods.length > 0 ? Math.max(1, minutesBetween(periods[0].starts_at, periods[0].ends_at)) : 45;
  const workingDaysString = workingDays.join(",");
  const weekendDaysString = DAY_INDEXES.filter((day) => !workingDays.includes(day)).join(",");

  return {
    school,
    academicYear: year,
    periods,
    slots,
    slotByDayPeriod,
    workingDays,
    classrooms,
    subjects: [...subjectsMap.values()],
    teachers,
    rooms: [...roomDefinitions.values()],
    classroomRoomKey,
    generationAssignments,
    settings: {
      name: school.name,
      campus_name: school.branch_name || "",
      academic_year: year.name,
      days_per_week: workingDays.length,
      periods_per_day: periods.length,
      period_duration_minutes: periodDurationMinutes,
      weekend_days: weekendDaysString,
      working_days: workingDaysString,
      school_start_time: periods[0].starts_at.slice(0, 5),
      school_end_time: periods[periods.length - 1].ends_at.slice(0, 5),
      bell_schedule_json: JSON.stringify(
        periods.map((period) => ({
          period_number: Number(period.period_number),
          label: period.label,
          starts_at: period.starts_at.slice(0, 5),
          ends_at: period.ends_at.slice(0, 5),
        }))
      ),
      breaks_json: "[]",
    },
  };
}

function projectNameForSnapshot(snapshot) {
  return `${config.timetableEngine.projectPrefix} | ${snapshot.school.name} | ${snapshot.academicYear.name}`;
}

async function ensureProject(client, snapshot) {
  const desiredName = projectNameForSnapshot(snapshot);
  const projects = await client.listProjects();
  const existing = Array.isArray(projects)
    ? projects.find(
        (project) =>
          compact(project.name).toLowerCase() === desiredName.toLowerCase() &&
          compact(project.academic_year).toLowerCase() === snapshot.academicYear.name.toLowerCase()
      )
    : null;
  if (existing) return existing;
  return client.createProject({
    name: desiredName,
    academic_year: snapshot.academicYear.name,
  });
}

async function syncSubjects(client, projectId, snapshot) {
  const existing = await client.listSubjects(projectId);
  const existingMap = new Map();
  for (const row of existing) {
    existingMap.set(keyify(row.code || row.name), row);
  }
  const localToRemote = new Map();
  const remoteToLocal = new Map();
  for (const subject of snapshot.subjects) {
    const payload = {
      name: subject.name,
      code: compact(subject.code) || normalizeRoomCode(subject.name, "SUBJECT"),
      color: colorFromKey(subject.id),
      category: "Core",
      max_per_day: Math.min(2, snapshot.periods.length),
      double_allowed: snapshot.generationAssignments.some(
        (assignment) => assignment.subject_id === subject.id && assignment.lesson_duration > 1
      ),
      preferred_room_type: "",
    };
    const key = keyify(payload.code || payload.name);
    const current = existingMap.get(key);
    const synced = current
      ? await client.updateSubject(projectId, current.id, payload)
      : await client.createSubject(projectId, payload);
    localToRemote.set(subject.id, synced.id);
    remoteToLocal.set(synced.id, subject.id);
  }
  return { localToRemote, remoteToLocal };
}

async function syncTeachers(client, projectId, snapshot) {
  const existing = await client.listTeachers(projectId);
  const existingMap = new Map();
  for (const row of existing) {
    existingMap.set(keyify(row.code || row.email || `${row.first_name} ${row.last_name}`), row);
  }
  const localToRemote = new Map();
  const remoteToLocal = new Map();
  for (const teacher of snapshot.teachers) {
    const payload = {
      first_name: teacher.first_name || "Teacher",
      last_name: teacher.last_name || "",
      code: compact(teacher.employee_code) || normalizeRoomCode(teacher.email, teacher.id),
      title: teacher.designation || "Teacher",
      color: colorFromKey(teacher.id),
      max_periods_day: snapshot.periods.length,
      max_periods_week: snapshot.periods.length * snapshot.workingDays.length,
      email: teacher.email || "",
      whatsapp_number: "",
    };
    const key = keyify(payload.code || payload.email || `${payload.first_name} ${payload.last_name}`);
    const current = existingMap.get(key);
    const synced = current
      ? await client.updateTeacher(projectId, current.id, payload)
      : await client.createTeacher(projectId, payload);
    localToRemote.set(teacher.id, synced.id);
    remoteToLocal.set(synced.id, teacher.id);
  }
  return { localToRemote, remoteToLocal };
}

async function syncRooms(client, projectId, snapshot) {
  const existing = await client.listRooms(projectId);
  const existingMap = new Map();
  for (const row of existing) {
    existingMap.set(keyify(row.code || row.name), row);
  }
  const localToRemote = new Map();
  const remoteToLocal = new Map();
  for (const room of snapshot.rooms) {
    const payload = {
      name: room.name,
      code: room.code,
      room_type: room.room_type,
      capacity: room.capacity,
      color: colorFromKey(room.local_key),
    };
    const key = keyify(payload.code || payload.name);
    const current = existingMap.get(key);
    const synced = current
      ? await client.updateRoom(projectId, current.id, payload)
      : await client.createRoom(projectId, payload);
    localToRemote.set(room.local_key, synced.id);
    remoteToLocal.set(synced.id, room);
  }
  return { localToRemote, remoteToLocal };
}

async function syncClasses(client, projectId, snapshot, teacherMap, roomMap) {
  const existing = await client.listClasses(projectId);
  const existingMap = new Map();
  for (const row of existing) {
    existingMap.set(keyify(row.code || `${row.grade}|${row.section}|${row.stream}`), row);
  }
  const localToRemote = new Map();
  const remoteToLocal = new Map();
  for (const classroom of snapshot.classrooms) {
    const roomKey = snapshot.classroomRoomKey.get(classroom.id);
    const payload = {
      grade: classroom.grade_label,
      section: classroom.section_label,
      stream: "",
      name: classroomDisplayName(classroom),
      code: compact(classroom.classroom_code) || normalizeRoomCode(classroomDisplayName(classroom), classroom.id),
      color: colorFromKey(classroom.id),
      class_teacher_id: classroom.homeroom_teacher_id ? teacherMap.localToRemote.get(classroom.homeroom_teacher_id) || null : null,
      home_room_id: roomKey ? roomMap.localToRemote.get(roomKey) || null : null,
      strength: Number(classroom.strength || classroom.capacity || 30),
    };
    const key = keyify(payload.code || `${payload.grade}|${payload.section}|${payload.stream}`);
    const current = existingMap.get(key);
    const synced = current
      ? await client.updateClass(projectId, current.id, payload)
      : await client.createClass(projectId, payload);
    localToRemote.set(classroom.id, synced.id);
    remoteToLocal.set(synced.id, classroom.id);
  }
  return { localToRemote, remoteToLocal };
}

async function rebuildLessons(client, projectId, snapshot, maps) {
  const existing = await client.listLessons(projectId);
  for (const lesson of existing) {
    await client.deleteLesson(projectId, lesson.id);
  }

  for (const assignment of snapshot.generationAssignments) {
    const remoteClassId = maps.classes.localToRemote.get(assignment.classroom_id);
    const remoteTeacherId = maps.teachers.localToRemote.get(assignment.teacher_id);
    const remoteSubjectId = maps.subjects.localToRemote.get(assignment.subject_id);
    const roomKey = snapshot.classroomRoomKey.get(assignment.classroom_id);
    const remoteRoomId = roomKey ? maps.rooms.localToRemote.get(roomKey) || null : null;

    if (!remoteClassId || !remoteTeacherId || !remoteSubjectId) {
      throw new AppError(422, "VALIDATION_ERROR", "Failed to map Agora lesson assignments into timetable engine entities");
    }

    await client.createLesson(projectId, {
      teacher_id: remoteTeacherId,
      subject_id: remoteSubjectId,
      class_id: remoteClassId,
      periods_per_week: assignment.periods_per_week,
      duration: assignment.lesson_duration,
      priority: assignment.lesson_priority,
      locked: assignment.is_timetable_locked,
      preferred_room_id: remoteRoomId,
      notes: `Agora classroom_subject ${assignment.id}`,
      allowed_room_ids: remoteRoomId ? [remoteRoomId] : [],
    });
  }

  return { lessons_created: snapshot.generationAssignments.length };
}

async function importGeneratedEntries({ snapshot, mappings, actorUserId, remoteProjectId, remoteRunId, entries }) {
  const client = await pool.connect();
  let importedCount = 0;
  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE timetable_substitutions tsb
        SET
          is_active = FALSE,
          revoked_at = NOW(),
          revoked_by_user_id = $3,
          updated_at = NOW()
        WHERE tsb.school_id = $1
          AND tsb.is_active = TRUE
          AND EXISTS (
            SELECT 1
            FROM timetable_entries te
            WHERE te.id = tsb.timetable_entry_id
              AND te.school_id = tsb.school_id
              AND te.academic_year_id = $2
              AND te.is_active = TRUE
          )
      `,
      [snapshot.school.id, snapshot.academicYear.id, actorUserId]
    );

    await client.query(
      `
        UPDATE timetable_entries
        SET
          is_active = FALSE,
          updated_by_user_id = $3,
          updated_at = NOW()
        WHERE school_id = $1
          AND academic_year_id = $2
          AND is_active = TRUE
      `,
      [snapshot.school.id, snapshot.academicYear.id, actorUserId]
    );

    for (const entry of entries) {
      const localClassroomId = mappings.classes.remoteToLocal.get(entry.class_id);
      const localTeacherId = mappings.teachers.remoteToLocal.get(entry.teacher_id) || null;
      const localSubjectId = mappings.subjects.remoteToLocal.get(entry.subject_id) || null;
      const room = mappings.rooms.remoteToLocal.get(entry.room_id) || null;
      const dayOfWeek = snapshot.workingDays[Number(entry.day_index)];
      const period = snapshot.periods[Number(entry.period_index)];
      const slotId = dayOfWeek && period ? snapshot.slotByDayPeriod.get(`${dayOfWeek}:${period.period_number}`) : null;

      if (!localClassroomId || !slotId) {
        throw new AppError(422, "VALIDATION_ERROR", "Timetable engine returned an entry that could not be mapped back into Agora");
      }

      await client.query(
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
            is_active,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'teaching', $7, $8, TRUE, $9, $9)
        `,
        [
          snapshot.school.id,
          snapshot.academicYear.id,
          localClassroomId,
          slotId,
          localSubjectId,
          localTeacherId,
          room?.room_number || null,
          `Generated by timetable engine project ${remoteProjectId}, run ${remoteRunId}`,
          actorUserId,
        ]
      );
      importedCount += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { imported_count: importedCount };
}

async function runTimetableEngineIntegration({ schoolId, actorUserId, academicYearId = null }) {
  const snapshot = await loadAgoraTimetableSnapshot({ schoolId, academicYearId });
  const engineClient = new TimetableEngineClient(config.timetableEngine);

  const project = await ensureProject(engineClient, snapshot);
  await engineClient.updateSchoolSettings(project.id, snapshot.settings);

  const subjects = await syncSubjects(engineClient, project.id, snapshot);
  const teachers = await syncTeachers(engineClient, project.id, snapshot);
  const rooms = await syncRooms(engineClient, project.id, snapshot);
  const classes = await syncClasses(engineClient, project.id, snapshot, teachers, rooms);
  const lessons = await rebuildLessons(engineClient, project.id, snapshot, { subjects, teachers, rooms, classes });

  const validation = await engineClient.validate(project.id);
  if (!validation?.is_valid) {
    throw new AppError(
      422,
      "TIMETABLE_ENGINE_VALIDATION_FAILED",
      "Timetable engine validation failed",
      buildValidationDetails(validation)
    );
  }

  const generation = await engineClient.generate(project.id);
  if (!generation?.success) {
    throw new AppError(
      422,
      "TIMETABLE_ENGINE_GENERATION_FAILED",
      generation?.message || "Timetable engine could not generate a schedule"
    );
  }

  const master = await engineClient.getMaster(project.id);
  const masterEntries = Array.isArray(master?.entries) ? master.entries : [];
  const unscheduled = await engineClient.getUnscheduledLessons(project.id);

  const imported = await importGeneratedEntries({
    snapshot,
    mappings: { subjects, teachers, rooms, classes },
    actorUserId,
    remoteProjectId: project.id,
    remoteRunId: generation.run_id,
    entries: masterEntries,
  });

  return {
    academic_year_id: snapshot.academicYear.id,
    academic_year_name: snapshot.academicYear.name,
    project: {
      id: project.id,
      name: project.name,
      academic_year: project.academic_year,
    },
    synced: {
      subjects: snapshot.subjects.length,
      teachers: snapshot.teachers.length,
      rooms: snapshot.rooms.length,
      classes: snapshot.classrooms.length,
      lessons: lessons.lessons_created,
    },
    validation: {
      warnings: Array.isArray(validation?.warnings) ? validation.warnings : [],
      readiness_summary: validation?.readiness_summary || {},
    },
    generation: {
      run_id: generation.run_id || null,
      entries_count: Number(generation.entries_count || masterEntries.length || 0),
      message: generation.message || "",
    },
    import: imported,
    unscheduled_lessons: Array.isArray(unscheduled?.unscheduled_lessons) ? unscheduled.unscheduled_lessons : [],
  };
}

module.exports = {
  loadAgoraTimetableSnapshot,
  runTimetableEngineIntegration,
  TimetableEngineClient,
};
