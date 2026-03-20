const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { ensureTeacherProjectionForUser } = require("../utils/teacher-projection");
const { getTeacherIdentityByUser, listTeacherClassroomIds } = require("../utils/teacher-scope");
const { runTimetableEngineIntegration } = require("../services/timetable-engine-integration");
const { ensureBoard } = require("../services/classroom-manual-timetable");

const router = express.Router();

const VIEW_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher"];
const MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];
const MANUAL_BOARD_VIEW_ROLES = [...VIEW_ROLES, "parent", "student"];

const DAY_NAME_MAP = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const periodListQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
});

const createPeriodSchema = z.object({
  academic_year_id: z.string().uuid(),
  period_number: z.coerce.number().int().min(1).max(20),
  label: z.string().trim().min(1).max(80),
  starts_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  ends_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  is_break: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

const updatePeriodSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    period_number: z.coerce.number().int().min(1).max(20).optional(),
    starts_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    ends_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    is_break: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const pathPeriodSchema = z.object({
  periodId: z.string().uuid(),
});

const generateSlotsSchema = z.object({
  academic_year_id: z.string().uuid(),
  weekdays: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .default([1, 2, 3, 4, 5]),
});

const generateViaEngineSchema = z.object({
  academic_year_id: z.string().uuid().optional(),
});

const wizardSnapshotQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
});

const listSlotsQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(1).max(7).optional(),
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
});

const createEntrySchema = z.object({
  classroom_id: z.string().uuid(),
  slot_id: z.string().uuid(),
  subject_id: z.string().uuid().optional(),
  teacher_id: z.string().uuid().optional(),
  entry_type: z.enum(["teaching", "activity", "study_hall", "break"]).default("teaching"),
  room_number: z.string().trim().min(1).max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const updateEntrySchema = z
  .object({
    slot_id: z.string().uuid().optional(),
    subject_id: z.string().uuid().nullable().optional(),
    teacher_id: z.string().uuid().nullable().optional(),
    entry_type: z.enum(["teaching", "activity", "study_hall", "break"]).optional(),
    room_number: z.string().trim().min(1).max(40).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const entryPathSchema = z.object({
  entryId: z.string().uuid(),
});

const classroomPathSchema = z.object({
  classroomId: z.string().uuid(),
});

const classroomTimetableQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(1).max(7).optional(),
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
});

const teacherPathSchema = z.object({
  teacherId: z.string().uuid(),
});

const teacherLookupQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(100),
});

const teacherTimetableQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  day_of_week: z.coerce.number().int().min(1).max(7).optional(),
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
});

const createSubstitutionSchema = z.object({
  timetable_entry_id: z.string().uuid(),
  substitution_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  substitute_teacher_id: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
});

const substitutionPathSchema = z.object({
  substitutionId: z.string().uuid(),
});

const listSubstitutionsQuerySchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  classroom_id: z.string().uuid().optional(),
  teacher_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      message,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        issue: issue.message,
      }))
    );
  }
  return parsed.data;
}

function hasRole(auth, role) {
  return Array.isArray(auth?.roles) && auth.roles.includes(role);
}

function isLeadership(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "super_admin")
  );
}

function parsePgErrorAsAppError(error) {
  if (!error?.code) return error;
  if (error.code === "23505") {
    return new AppError(409, "CONFLICT", "Duplicate timetable record conflicts with existing schedule");
  }
  if (error.code === "23503") {
    return new AppError(422, "VALIDATION_ERROR", "Referenced timetable relation does not belong to this school");
  }
  if (error.code === "23514") {
    return new AppError(422, "VALIDATION_ERROR", "Timetable value violates a data integrity rule");
  }
  return error;
}

function isoWeekdayFromDate(isoDate) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  const weekday = value.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function dayLabel(dayOfWeek) {
  return DAY_NAME_MAP[dayOfWeek] || "Unknown";
}

const WIZARD_COLOR_PALETTE = [
  '#ef4444',
  '#a855f7',
  '#10b981',
  '#f97316',
  '#0ea5e9',
  '#14b8a6',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#84a29f',
];

function pickWizardColor(index) {
  return WIZARD_COLOR_PALETTE[index % WIZARD_COLOR_PALETTE.length];
}

function inferSubjectCategory(subjectName = '') {
  const value = subjectName.toLowerCase();
  if (value.includes('physical') || value.includes('sports') || value === 'pe') return 'Activity';
  if (value.includes('business') || value.includes('computer')) return 'Elective';
  return 'Core';
}

function inferPreferredRoomType(subjectName = '') {
  const value = subjectName.toLowerCase();
  if (value.includes('computer')) return 'Computer Lab';
  if (value.includes('physics') || value.includes('chemistry') || value.includes('biology')) return 'Laboratory';
  if (value.includes('physical') || value.includes('sports') || value === 'pe') return 'Sports Hall';
  return 'Classroom';
}

function deriveTeacherPlanningCaps(weeklyLoad) {
  if (weeklyLoad >= 16) return { maxDay: 6, maxWeek: 28 };
  if (weeklyLoad >= 12) return { maxDay: 6, maxWeek: 25 };
  return { maxDay: 5, maxWeek: 22 };
}

async function listHeadmistressSectionIds(schoolId, userId) {
  if (!schoolId || !userId) return [];

  const result = await pool.query(
    `
      SELECT DISTINCT ss.id
      FROM school_sections ss
      LEFT JOIN staff_profiles sp
        ON sp.school_id = ss.school_id
       AND sp.user_id = $2
       AND sp.primary_section_id = ss.id
      WHERE ss.school_id = $1
        AND (
          ss.head_user_id = $2
          OR ss.coordinator_user_id = $2
          OR sp.id IS NOT NULL
        )
    `,
    [schoolId, userId]
  );

  return result.rows.map((row) => row.id);
}

async function resolveCurrentAcademicYearId(schoolId) {
  const row = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
      ORDER BY is_current DESC, starts_on DESC, created_at DESC
      LIMIT 1
    `,
    [schoolId]
  );
  if (!row.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "No academic year is configured for this school");
  }
  return row.rows[0].id;
}

async function resolveAcademicYearId(schoolId, academicYearId) {
  if (!academicYearId) {
    return resolveCurrentAcademicYearId(schoolId);
  }
  const row = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, academicYearId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "academic_year_id must belong to this school");
  }
  return row.rows[0].id;
}

async function resolveTeacherForUser(schoolId, userId) {
  const projection = await ensureTeacherProjectionForUser({
    schoolId,
    userId,
    roles: ["teacher"],
  });

  if (!projection?.id) return null;

  const teacherIdentity = await getTeacherIdentityByUser({
    schoolId,
    userId,
  });

  if (!teacherIdentity?.teacherId || !teacherIdentity.isActive) {
    return null;
  }

  return projection;
}

async function ensureTeacherInSchool(schoolId, teacherId) {
  if (!teacherId) return null;
  const row = await pool.query(
    `
      SELECT
        t.id,
        t.user_id,
        u.is_active AS user_is_active,
        sp.id AS staff_profile_id,
        sp.staff_type,
        sp.employment_status AS staff_employment_status,
        u.first_name,
        u.last_name,
        u.email
      FROM teachers t
      JOIN users u
        ON u.id = t.user_id
       AND u.school_id = t.school_id
      LEFT JOIN staff_profiles sp
        ON sp.school_id = t.school_id
       AND sp.user_id = t.user_id
      WHERE t.school_id = $1
        AND t.id = $2
      LIMIT 1
    `,
    [schoolId, teacherId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "teacher_id must belong to this school");
  }
  const teacher = row.rows[0];
  if (teacher.user_is_active !== true) {
    throw new AppError(422, "VALIDATION_ERROR", "teacher_id must map to an active user");
  }
  if (
    teacher.staff_profile_id &&
    (teacher.staff_type !== "teacher" || teacher.staff_employment_status !== "active")
  ) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "teacher_id must map to an active teacher staff profile"
    );
  }
  return teacher;
}

async function ensureClassroomInSchool(schoolId, classroomId) {
  const row = await pool.query(
    `
      SELECT
        c.id,
        c.school_id,
        c.academic_year_id,
        c.section_id,
        c.grade_label,
        c.section_label,
        c.room_number
      FROM classrooms c
      WHERE c.school_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );
  if (!row.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Classroom not found in this school");
  }
  return row.rows[0];
}

async function ensureSlotInSchool(schoolId, slotId) {
  const row = await pool.query(
    `
      SELECT
        ts.id,
        ts.school_id,
        ts.academic_year_id,
        ts.period_id,
        ts.day_of_week,
        ts.is_active,
        tp.period_number,
        tp.label AS period_label,
        tp.starts_at,
        tp.ends_at,
        tp.is_break
      FROM timetable_slots ts
      JOIN timetable_periods tp
        ON tp.id = ts.period_id
       AND tp.school_id = ts.school_id
       AND tp.academic_year_id = ts.academic_year_id
      WHERE ts.school_id = $1
        AND ts.id = $2
      LIMIT 1
    `,
    [schoolId, slotId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "slot_id must belong to this school");
  }
  return row.rows[0];
}

async function ensureSubjectInSchool(schoolId, subjectId) {
  if (!subjectId) return null;
  const row = await pool.query(
    `
      SELECT id, code, name
      FROM subjects
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, subjectId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "subject_id must belong to this school");
  }
  return row.rows[0];
}

async function assertTeacherSubjectAssignment({
  schoolId,
  classroomId,
  subjectId,
  teacherId,
}) {
  if (!subjectId || !teacherId) return;

  const row = await pool.query(
    `
      SELECT id
      FROM classroom_subjects
      WHERE school_id = $1
        AND classroom_id = $2
        AND subject_id = $3
        AND teacher_id = $4
      LIMIT 1
    `,
    [schoolId, classroomId, subjectId, teacherId]
  );

  if (!row.rows[0]) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Teacher is not assigned to this classroom subject combination"
    );
  }
}

async function ensureClassroomVisibleToRole({ auth, classroom }) {
  if (isLeadership(auth)) return;

  if (hasRole(auth, "headmistress")) {
    const visible = await pool.query(
      `
        SELECT c.id
        FROM classrooms c
        WHERE c.school_id = $1
          AND c.id = $2
          AND (
            c.section_id IN (
              SELECT ss.id
              FROM school_sections ss
              WHERE ss.school_id = c.school_id
                AND (
                  ss.head_user_id = $3
                  OR ss.coordinator_user_id = $3
                  OR EXISTS (
                    SELECT 1
                    FROM staff_profiles sp
                    WHERE sp.school_id = ss.school_id
                      AND sp.user_id = $3
                      AND sp.primary_section_id = ss.id
                  )
                )
            )
          )
        LIMIT 1
      `,
      [auth.schoolId, classroom.id, auth.userId]
    );
    if (!visible.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Headmistress scope does not include this classroom");
    }
    return;
  }

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
    if (!teacherClassroomIds.includes(classroom.id)) {
      throw new AppError(403, "FORBIDDEN", "Teacher scope does not include this classroom");
    }
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No timetable classroom visibility for this role");
}

async function ensureTeacherVisibleToRole({ auth, teacherId }) {
  if (isLeadership(auth)) return;

  if (hasRole(auth, "headmistress")) {
    const sectionIds = await listHeadmistressSectionIds(auth.schoolId, auth.userId);
    if (sectionIds.length === 0) {
      throw new AppError(403, "FORBIDDEN", "Headmistress scope does not include this teacher");
    }

    const visible = await pool.query(
      `
        SELECT t.id
        FROM teachers t
        LEFT JOIN staff_profiles sp
          ON sp.school_id = t.school_id
         AND sp.user_id = t.user_id
        WHERE t.school_id = $1
          AND t.id = $2
          AND (
            (
              sp.id IS NOT NULL
              AND (
                sp.primary_section_id = ANY($3::uuid[])
                OR EXISTS (
                  SELECT 1
                  FROM staff_classroom_assignments sca
                  JOIN classrooms c
                    ON c.id = sca.classroom_id
                   AND c.school_id = sca.school_id
                  WHERE sca.school_id = t.school_id
                    AND sca.staff_profile_id = sp.id
                    AND sca.is_active = TRUE
                    AND sca.starts_on <= CURRENT_DATE
                    AND (sca.ends_on IS NULL OR sca.ends_on >= CURRENT_DATE)
                    AND c.section_id = ANY($3::uuid[])
                )
              )
            )
            OR
            EXISTS (
              SELECT 1
              FROM classrooms c
              WHERE c.school_id = t.school_id
                AND c.section_id = ANY($3::uuid[])
                AND (
                  c.homeroom_teacher_id = t.id
                  OR EXISTS (
                    SELECT 1
                    FROM classroom_subjects cs
                    WHERE cs.school_id = c.school_id
                      AND cs.classroom_id = c.id
                      AND cs.teacher_id = t.id
                  )
                )
            )
          )
        LIMIT 1
      `,
      [auth.schoolId, teacherId, sectionIds]
    );
    if (!visible.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Headmistress scope does not include this teacher");
    }
    return;
  }

  if (hasRole(auth, "teacher")) {
    const ownTeacher = await resolveTeacherForUser(auth.schoolId, auth.userId);
    if (!ownTeacher || ownTeacher.id !== teacherId) {
      throw new AppError(403, "FORBIDDEN", "Teachers can view only their own timetable");
    }
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No timetable teacher visibility for this role");
}

async function ensureManualBoardVisibleToViewer({ auth, classroom }) {
  if (isLeadership(auth) || hasRole(auth, "headmistress") || hasRole(auth, "teacher")) {
    await ensureClassroomVisibleToRole({ auth, classroom });
    return;
  }

  if (hasRole(auth, "student")) {
    const studentResult = await pool.query(
      `
        SELECT se.student_id
        FROM student_user_accounts sua
        JOIN student_enrollments se
          ON se.student_id = sua.student_id
         AND se.school_id = $1
         AND se.classroom_id = $2
         AND se.academic_year_id = $3
         AND se.status = 'active'
        WHERE sua.user_id = $4
        LIMIT 1
      `,
      [auth.schoolId, classroom.id, classroom.academic_year_id, auth.userId]
    );
    if (!studentResult.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Student scope does not include this classroom timetable");
    }
    return;
  }

  if (hasRole(auth, "parent")) {
    const parentResult = await pool.query(
      `
        SELECT se.student_id
        FROM parents p
        JOIN parent_students ps
          ON ps.parent_id = p.id
        JOIN student_enrollments se
          ON se.student_id = ps.student_id
         AND se.school_id = p.school_id
         AND se.classroom_id = $2
         AND se.academic_year_id = $3
         AND se.status = 'active'
        WHERE p.school_id = $1
          AND p.user_id = $4
        LIMIT 1
      `,
      [auth.schoolId, classroom.id, classroom.academic_year_id, auth.userId]
    );
    if (!parentResult.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Parent scope does not include this classroom timetable");
    }
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No timetable board visibility for this role");
}


async function assertNoEntryConflicts({
  schoolId,
  slotId,
  classroomId,
  teacherId,
  roomNumber,
  excludeEntryId = null,
}) {
  const classConflictParams = [schoolId, slotId, classroomId];
  let classConflictSql = `
    SELECT id
    FROM timetable_entries
    WHERE school_id = $1
      AND slot_id = $2
      AND classroom_id = $3
      AND is_active = TRUE
  `;
  if (excludeEntryId) {
    classConflictParams.push(excludeEntryId);
    classConflictSql += ` AND id <> $${classConflictParams.length}`;
  }
  classConflictSql += " LIMIT 1";

  const classConflict = await pool.query(classConflictSql, classConflictParams);
  if (classConflict.rows[0]) {
    throw new AppError(409, "TIMETABLE_CONFLICT", "Classroom already has a timetable entry in this slot");
  }

  if (teacherId) {
    const teacherConflictParams = [schoolId, slotId, teacherId];
    let teacherConflictSql = `
      SELECT id
      FROM timetable_entries
      WHERE school_id = $1
        AND slot_id = $2
        AND teacher_id = $3
        AND is_active = TRUE
    `;
    if (excludeEntryId) {
      teacherConflictParams.push(excludeEntryId);
      teacherConflictSql += ` AND id <> $${teacherConflictParams.length}`;
    }
    teacherConflictSql += " LIMIT 1";
    const teacherConflict = await pool.query(teacherConflictSql, teacherConflictParams);
    if (teacherConflict.rows[0]) {
      throw new AppError(409, "TIMETABLE_CONFLICT", "Teacher already has another class in this slot");
    }
  }

  if (roomNumber) {
    const roomConflictParams = [schoolId, slotId, roomNumber.trim().toLowerCase()];
    let roomConflictSql = `
      SELECT id
      FROM timetable_entries
      WHERE school_id = $1
        AND slot_id = $2
        AND room_number IS NOT NULL
        AND LOWER(room_number) = $3
        AND is_active = TRUE
    `;
    if (excludeEntryId) {
      roomConflictParams.push(excludeEntryId);
      roomConflictSql += ` AND id <> $${roomConflictParams.length}`;
    }
    roomConflictSql += " LIMIT 1";
    const roomConflict = await pool.query(roomConflictSql, roomConflictParams);
    if (roomConflict.rows[0]) {
      throw new AppError(
        409,
        "TIMETABLE_CONFLICT",
        "Room is already occupied by another timetable entry in this slot"
      );
    }
  }
}

async function fetchTimetableEntryById(schoolId, entryId) {
  const row = await pool.query(
    `
      SELECT
        te.id,
        te.school_id,
        te.academic_year_id,
        te.classroom_id,
        te.slot_id,
        te.subject_id,
        te.teacher_id,
        te.entry_type,
        te.room_number,
        te.notes,
        te.is_active,
        te.created_at,
        te.updated_at,
        ts.day_of_week,
        tp.period_number,
        tp.label AS period_label,
        tp.starts_at,
        tp.ends_at,
        tp.is_break,
        c.grade_label,
        c.section_label,
        s.code AS subject_code,
        s.name AS subject_name,
        tu.first_name AS teacher_first_name,
        tu.last_name AS teacher_last_name
      FROM timetable_entries te
      JOIN timetable_slots ts
        ON ts.id = te.slot_id
       AND ts.school_id = te.school_id
       AND ts.academic_year_id = te.academic_year_id
      JOIN timetable_periods tp
        ON tp.id = ts.period_id
       AND tp.school_id = ts.school_id
       AND tp.academic_year_id = ts.academic_year_id
      JOIN classrooms c
        ON c.id = te.classroom_id
       AND c.school_id = te.school_id
       AND c.academic_year_id = te.academic_year_id
      LEFT JOIN subjects s
        ON s.id = te.subject_id
       AND s.school_id = te.school_id
      LEFT JOIN teachers t
        ON t.id = te.teacher_id
       AND t.school_id = te.school_id
      LEFT JOIN users tu
        ON tu.id = t.user_id
       AND tu.school_id = t.school_id
      WHERE te.school_id = $1
        AND te.id = $2
      LIMIT 1
    `,
    [schoolId, entryId]
  );
  return row.rows[0] || null;
}

async function assertSubstituteTeacherAvailable({
  schoolId,
  substituteTeacherId,
  substitutionDate,
  slotId,
  excludeSubstitutionId = null,
}) {
  const day = isoWeekdayFromDate(substitutionDate);

  const regularConflict = await pool.query(
    `
      SELECT te.id
      FROM timetable_entries te
      JOIN timetable_slots ts
        ON ts.id = te.slot_id
       AND ts.school_id = te.school_id
       AND ts.academic_year_id = te.academic_year_id
      WHERE te.school_id = $1
        AND te.slot_id = $2
        AND te.teacher_id = $3
        AND ts.day_of_week = $4
        AND te.is_active = TRUE
      LIMIT 1
    `,
    [schoolId, slotId, substituteTeacherId, day]
  );

  if (regularConflict.rows[0]) {
    throw new AppError(
      409,
      "TIMETABLE_CONFLICT",
      "Substitute teacher already has a scheduled class in this slot"
    );
  }

  const params = [schoolId, substitutionDate, substituteTeacherId, slotId];
  let sql = `
    SELECT tsb.id
    FROM timetable_substitutions tsb
    JOIN timetable_entries te
      ON te.id = tsb.timetable_entry_id
     AND te.school_id = tsb.school_id
    WHERE tsb.school_id = $1
      AND tsb.substitution_date = $2
      AND tsb.substitute_teacher_id = $3
      AND te.slot_id = $4
      AND tsb.is_active = TRUE
  `;
  if (excludeSubstitutionId) {
    params.push(excludeSubstitutionId);
    sql += ` AND tsb.id <> $${params.length}`;
  }
  sql += " LIMIT 1";

  const substitutionConflict = await pool.query(sql, params);
  if (substitutionConflict.rows[0]) {
    throw new AppError(
      409,
      "TIMETABLE_CONFLICT",
      "Substitute teacher already has another substitution in this slot and date"
    );
  }
}

async function appendSubstitutionScopeClause({ auth, params, where }) {
  if (isLeadership(auth)) {
    return;
  }

  if (hasRole(auth, "headmistress")) {
    params.push(auth.userId);
    where.push(`
      c.section_id IN (
        SELECT ss.id
        FROM school_sections ss
        WHERE ss.school_id = te.school_id
          AND (
            ss.head_user_id = $${params.length}
            OR ss.coordinator_user_id = $${params.length}
            OR EXISTS (
              SELECT 1
              FROM staff_profiles sp
              WHERE sp.school_id = ss.school_id
                AND sp.user_id = $${params.length}
                AND sp.primary_section_id = ss.id
            )
          )
      )
    `);
    return;
  }

  if (hasRole(auth, "teacher")) {
    const teacherIdentity = await getTeacherIdentityByUser({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
    if (!teacherIdentity?.teacherId || !teacherIdentity.isActive) {
      where.push("FALSE");
      return;
    }
    params.push(teacherIdentity.teacherId);
    where.push(`(te.teacher_id = $${params.length} OR tsb.substitute_teacher_id = $${params.length})`);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No substitution read permission for this role");
}

// ---------------------------------------------------------------------------
// Timetable periods
// ---------------------------------------------------------------------------
router.get(
  "/timetable/periods",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(periodListQuerySchema, req.query, "Invalid timetable periods query");
    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, query.academic_year_id);

    const params = [req.auth.schoolId, academicYearId];
    const where = ["tp.school_id = $1", "tp.academic_year_id = $2"];
    if (!query.include_inactive) {
      where.push("tp.is_active = TRUE");
    }

    const rows = await pool.query(
      `
        SELECT
          tp.id,
          tp.school_id,
          tp.academic_year_id,
          tp.period_number,
          tp.label,
          tp.starts_at,
          tp.ends_at,
          tp.is_break,
          tp.is_active,
          tp.created_at,
          tp.updated_at
        FROM timetable_periods tp
        WHERE ${where.join(" AND ")}
        ORDER BY tp.period_number ASC, tp.starts_at ASC
      `,
      params
    );

    return success(res, rows.rows, 200);
  })
);

router.post(
  "/timetable/periods",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createPeriodSchema, req.body, "Invalid timetable period payload");
    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, body.academic_year_id);

    let created;
    try {
      created = await pool.query(
        `
          INSERT INTO timetable_periods (
            school_id,
            academic_year_id,
            period_number,
            label,
            starts_at,
            ends_at,
            is_break,
            is_active,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
          RETURNING
            id,
            school_id,
            academic_year_id,
            period_number,
            label,
            starts_at,
            ends_at,
            is_break,
            is_active,
            created_at,
            updated_at
        `,
        [
          req.auth.schoolId,
          academicYearId,
          body.period_number,
          body.label,
          body.starts_at,
          body.ends_at,
          body.is_break,
          body.is_active,
          req.auth.userId,
        ]
      );
    } catch (error) {
      throw parsePgErrorAsAppError(error);
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_period.created",
      entityName: "timetable_periods",
      entityId: created.rows[0].id,
      metadata: {
        academic_year_id: academicYearId,
        period_number: body.period_number,
        label: body.label,
      },
    });

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/timetable/periods/:periodId",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(pathPeriodSchema, req.params, "Invalid period id");
    const body = parseSchema(updatePeriodSchema, req.body, "Invalid timetable period patch payload");

    const existing = await pool.query(
      `
        SELECT id, school_id, academic_year_id
        FROM timetable_periods
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.periodId]
    );
    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Timetable period not found");
    }

    const values = [];
    const setClauses = [];
    if (Object.prototype.hasOwnProperty.call(body, "period_number")) {
      values.push(body.period_number);
      setClauses.push(`period_number = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      values.push(body.label);
      setClauses.push(`label = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "starts_at")) {
      values.push(body.starts_at);
      setClauses.push(`starts_at = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "ends_at")) {
      values.push(body.ends_at);
      setClauses.push(`ends_at = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_break")) {
      values.push(body.is_break);
      setClauses.push(`is_break = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
      values.push(body.is_active);
      setClauses.push(`is_active = $${values.length}`);
    }

    values.push(req.auth.userId);
    setClauses.push(`updated_by_user_id = $${values.length}`);

    values.push(req.auth.schoolId, path.periodId);
    const queryText = `
      UPDATE timetable_periods
      SET ${setClauses.join(", ")}
      WHERE school_id = $${values.length - 1}
        AND id = $${values.length}
      RETURNING
        id,
        school_id,
        academic_year_id,
        period_number,
        label,
        starts_at,
        ends_at,
        is_break,
        is_active,
        created_at,
        updated_at
    `;

    let updated;
    try {
      updated = await pool.query(queryText, values);
    } catch (error) {
      throw parsePgErrorAsAppError(error);
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_period.updated",
      entityName: "timetable_periods",
      entityId: path.periodId,
      metadata: {
        updated_fields: Object.keys(body),
      },
    });

    return success(res, updated.rows[0], 200);
  })
);

// ---------------------------------------------------------------------------
// Timetable slots
// ---------------------------------------------------------------------------
router.post(
  "/timetable/slots/generate",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(generateSlotsSchema, req.body, "Invalid timetable slot generation payload");
    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, body.academic_year_id);
    const weekdays = [...new Set(body.weekdays)].sort((a, b) => a - b);

    const periods = await pool.query(
      `
        SELECT id, period_number, label
        FROM timetable_periods
        WHERE school_id = $1
          AND academic_year_id = $2
          AND is_active = TRUE
        ORDER BY period_number ASC
      `,
      [req.auth.schoolId, academicYearId]
    );

    if (periods.rows.length === 0) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Create timetable periods before generating timetable slots"
      );
    }

    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const dayOfWeek of weekdays) {
        for (const period of periods.rows) {
          const upsert = await client.query(
            `
              INSERT INTO timetable_slots (
                school_id,
                academic_year_id,
                period_id,
                day_of_week,
                is_active
              )
              VALUES ($1, $2, $3, $4, TRUE)
              ON CONFLICT (school_id, academic_year_id, day_of_week, period_id)
              DO UPDATE SET
                is_active = TRUE,
                updated_at = NOW()
              RETURNING id
            `,
            [req.auth.schoolId, academicYearId, period.id, dayOfWeek]
          );
          inserted += upsert.rowCount;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw parsePgErrorAsAppError(error);
    } finally {
      client.release();
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_slots.generated",
      entityName: "timetable_slots",
      metadata: {
        academic_year_id: academicYearId,
        weekdays,
        period_count: periods.rows.length,
      },
    });

    return success(
      res,
      {
        academic_year_id: academicYearId,
        weekdays,
        generated_slots: inserted,
      },
      201
    );
  })
);

router.get(
  "/timetable/slots",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listSlotsQuerySchema, req.query, "Invalid timetable slots query");
    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, query.academic_year_id);

    const params = [req.auth.schoolId, academicYearId];
    const where = ["ts.school_id = $1", "ts.academic_year_id = $2"];
    if (query.day_of_week) {
      params.push(query.day_of_week);
      where.push(`ts.day_of_week = $${params.length}`);
    }
    if (!query.include_inactive) {
      where.push("ts.is_active = TRUE", "tp.is_active = TRUE");
    }

    const rows = await pool.query(
      `
        SELECT
          ts.id,
          ts.school_id,
          ts.academic_year_id,
          ts.period_id,
          ts.day_of_week,
          ts.is_active,
          tp.period_number,
          tp.label AS period_label,
          tp.starts_at,
          tp.ends_at,
          tp.is_break
        FROM timetable_slots ts
        JOIN timetable_periods tp
          ON tp.id = ts.period_id
         AND tp.school_id = ts.school_id
         AND tp.academic_year_id = ts.academic_year_id
        WHERE ${where.join(" AND ")}
        ORDER BY ts.day_of_week ASC, tp.period_number ASC
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      ...row,
      day_name: dayLabel(row.day_of_week),
    }));

    return success(res, data, 200);
  })
);

router.post(
  "/timetable/integration/generate",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(
      generateViaEngineSchema,
      req.body || {},
      "Invalid timetable engine generation payload"
    );

    const data = await runTimetableEngineIntegration({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      academicYearId: body.academic_year_id || null,
    });

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_engine.generated",
      entityName: "timetable_entries",
      metadata: {
        academic_year_id: data.academic_year_id,
        external_project_id: data.project.id,
        external_run_id: data.generation.run_id,
        synced: data.synced,
        imported_count: data.import.imported_count,
      },
    });

    return success(res, data, 200);
  })
);

router.get(
  "/timetable/wizard-snapshot",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      wizardSnapshotQuerySchema,
      req.query,
      "Invalid timetable wizard snapshot query"
    );

    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, query.academic_year_id);

    const [schoolResult, periodResult, slotSummaryResult, subjectResult, classroomResult, teacherResult, lessonResult, entryCountResult, substitutionCountResult] = await Promise.all([
      pool.query(
        `
          SELECT
            s.id,
            s.name,
            s.branch_name,
            s.weekly_holidays,
            ay.name AS academic_year_name
          FROM schools s
          JOIN academic_years ay ON ay.id = $2 AND ay.school_id = s.id
          WHERE s.id = $1
          LIMIT 1
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          SELECT period_number, label, starts_at, ends_at, is_break
          FROM timetable_periods
          WHERE school_id = $1
            AND academic_year_id = $2
            AND is_active = TRUE
          ORDER BY period_number ASC
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          SELECT
            COUNT(*)::int AS slot_count,
            COUNT(DISTINCT day_of_week)::int AS working_days_per_week
          FROM timetable_slots
          WHERE school_id = $1
            AND academic_year_id = $2
            AND is_active = TRUE
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          SELECT id, name, code
          FROM subjects
          WHERE school_id = $1
          ORDER BY name ASC
        `,
        [req.auth.schoolId]
      ),
      pool.query(
        `
          SELECT
            c.id,
            c.grade_label,
            c.section_label,
            c.classroom_code,
            c.room_number,
            c.capacity,
            COUNT(se.id)::int AS active_student_count
          FROM classrooms c
          LEFT JOIN student_enrollments se
            ON se.school_id = c.school_id
           AND se.classroom_id = c.id
           AND se.status = 'active'
          WHERE c.school_id = $1
            AND c.academic_year_id = $2
            AND COALESCE(c.is_active, TRUE) = TRUE
          GROUP BY c.id, c.grade_label, c.section_label, c.classroom_code, c.room_number, c.capacity
          ORDER BY c.grade_label ASC, c.section_label ASC
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          WITH lesson_loads AS (
            SELECT teacher_id, COALESCE(SUM(periods_per_week), 0)::int AS weekly_load
            FROM classroom_subjects
            WHERE school_id = $1
            GROUP BY teacher_id
          )
          SELECT
            t.id,
            t.employee_code,
            t.designation,
            u.first_name,
            u.last_name,
            COALESCE(ll.weekly_load, 0) AS weekly_load
          FROM teachers t
          JOIN users u
            ON u.id = t.user_id
           AND u.school_id = t.school_id
          LEFT JOIN lesson_loads ll ON ll.teacher_id = t.id
          WHERE t.school_id = $1
          ORDER BY u.first_name ASC, u.last_name ASC NULLS LAST
        `,
        [req.auth.schoolId]
      ),
      pool.query(
        `
          SELECT
            cs.id,
            cs.periods_per_week,
            cs.lesson_duration,
            cs.lesson_priority,
            cs.is_timetable_locked,
            s.name AS subject_name,
            s.code AS subject_code,
            c.grade_label,
            c.section_label,
            COALESCE(c.classroom_code, CONCAT(c.grade_label, ' - ', c.section_label)) AS classroom_code,
            u.first_name AS teacher_first_name,
            u.last_name AS teacher_last_name,
            t.employee_code AS teacher_code,
            t.id AS teacher_id
          FROM classroom_subjects cs
          JOIN subjects s ON s.id = cs.subject_id
          JOIN classrooms c ON c.id = cs.classroom_id AND c.school_id = cs.school_id
          LEFT JOIN teachers t ON t.id = cs.teacher_id AND t.school_id = cs.school_id
          LEFT JOIN users u ON u.id = t.user_id AND u.school_id = cs.school_id
          WHERE cs.school_id = $1
            AND c.academic_year_id = $2
          ORDER BY c.grade_label ASC, c.section_label ASC, s.name ASC
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM timetable_entries te
          JOIN timetable_slots ts ON ts.id = te.slot_id
          WHERE te.school_id = $1
            AND ts.academic_year_id = $2
            AND te.is_active = TRUE
        `,
        [req.auth.schoolId, academicYearId]
      ),
      pool.query(
        `
          SELECT COUNT(*)::int AS total
          FROM timetable_substitutions tsb
          JOIN timetable_entries te ON te.id = tsb.timetable_entry_id
          JOIN timetable_slots ts ON ts.id = te.slot_id
          WHERE tsb.school_id = $1
            AND ts.academic_year_id = $2
            AND tsb.is_active = TRUE
        `,
        [req.auth.schoolId, academicYearId]
      ),
    ]);

    const school = schoolResult.rows[0];
    if (!school) {
      throw new AppError(404, "NOT_FOUND", "School profile not found for timetable wizard");
    }

    const periods = periodResult.rows;
    const slotSummary = slotSummaryResult.rows[0] || { slot_count: 0, working_days_per_week: 0 };
    const teachingPeriods = periods.filter((row) => !row.is_break);
    const breakPeriods = periods.filter((row) => row.is_break);

    const subjects = subjectResult.rows.map((row, index) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      category: inferSubjectCategory(row.name),
      color: pickWizardColor(index),
      max_per_day: inferSubjectCategory(row.name) === 'Activity' ? 1 : 2,
      double_allowed: ['Laboratory', 'Computer Lab'].includes(inferPreferredRoomType(row.name)) || /math/i.test(row.name),
      preferred_room_type: inferPreferredRoomType(row.name),
    }));

    const classes = classroomResult.rows.map((row, index) => ({
      id: row.id,
      name: `${row.grade_label} ${row.section_label}`,
      grade_label: row.grade_label,
      section_label: row.section_label,
      stream_label: row.section_label,
      code: row.classroom_code || `${row.grade_label}-${row.section_label}`,
      color: pickWizardColor(index + 2),
      strength: Number(row.active_student_count || 0),
    }));

    const classrooms = classroomResult.rows.map((row, index) => ({
      id: row.id,
      name: row.room_number || `${row.grade_label} ${row.section_label}`,
      code: row.classroom_code || row.room_number || `ROOM-${index + 1}`,
      room_type: /lab/i.test(row.room_number || '') ? 'Laboratory' : 'Classroom',
      capacity: row.capacity ? Number(row.capacity) : null,
      color: pickWizardColor(index + 3),
    }));

    const teachers = teacherResult.rows.map((row, index) => {
      const caps = deriveTeacherPlanningCaps(Number(row.weekly_load || 0));
      return {
        id: row.id,
        name: `${row.first_name} ${row.last_name || ''}`.trim(),
        code: row.employee_code,
        title: row.designation || ((row.first_name || '').toLowerCase().endswith('a') ? 'Ms.' : 'Mr.'),
        color: pickWizardColor(index + 4),
        max_periods_day: caps.maxDay,
        max_periods_week: caps.maxWeek,
      };
    });

    const lessons = lessonResult.rows.map((row) => ({
      id: row.id,
      teacher_name: `${row.teacher_first_name || 'Unassigned'} ${row.teacher_last_name || ''}`.trim(),
      teacher_code: row.teacher_code,
      subject_name: row.subject_name,
      subject_code: row.subject_code,
      classroom_name: `${row.grade_label} ${row.section_label}`,
      classroom_code: row.classroom_code,
      periods_per_week: Number(row.periods_per_week || 0),
      lesson_duration: Number(row.lesson_duration || 1),
      lesson_priority: Number(row.lesson_priority || 5),
      is_timetable_locked: Boolean(row.is_timetable_locked),
    }));

    const missingTeacherAssignments = lessons.filter((row) => !row.teacher_code).length;
    const missingPeriodLoads = lessons.filter((row) => Number(row.periods_per_week || 0) <= 0).length;
    const lockedLessons = lessons.filter((row) => row.is_timetable_locked).length;
    const warningMessages = [];
    if (missingTeacherAssignments > 0) warningMessages.push(`${missingTeacherAssignments} lesson assignments still need a teacher.`);
    if (missingPeriodLoads > 0) warningMessages.push(`${missingPeriodLoads} lesson assignments still need periods-per-week configured.`);
    if (Number(slotSummary.slot_count || 0) === 0) warningMessages.push('No timetable slots exist yet. Generate standard slots in the School step before running the engine.');

    return success(res, {
      school: {
        school_id: school.id,
        school_name: school.name,
        branch_name: school.branch_name || null,
        academic_year_id: academicYearId,
        academic_year_name: school.academic_year_name,
        working_days_per_week: Number(slotSummary.working_days_per_week || 0),
        periods_per_day: teachingPeriods.length,
        break_periods: breakPeriods.length,
        school_start_time: periods[0]?.starts_at ? String(periods[0].starts_at).slice(0, 5) : null,
        first_period_start_time: teachingPeriods[0]?.starts_at ? String(teachingPeriods[0].starts_at).slice(0, 5) : null,
        weekly_holidays: Array.isArray(school.weekly_holidays) ? school.weekly_holidays : [],
      },
      subjects,
      classes,
      classrooms,
      teachers,
      lessons,
      constraints: {
        slot_count: Number(slotSummary.slot_count || 0),
        active_entry_count: Number(entryCountResult.rows[0]?.total || 0),
        active_substitution_count: Number(substitutionCountResult.rows[0]?.total || 0),
        locked_lessons: lockedLessons,
        missing_teacher_assignments: missingTeacherAssignments,
        missing_period_loads: missingPeriodLoads,
        warning_messages: warningMessages,
      },
      demo_project: {
        available: true,
        source: 'current_seeded_school_data',
        summary: {
          subjects: subjects.length,
          classes: classes.length,
          classrooms: classrooms.length,
          teachers: teachers.length,
          lessons: lessons.length,
        },
      },
    }, 200);
  })
);

// ---------------------------------------------------------------------------
// Timetable entries
// ---------------------------------------------------------------------------
router.post(
  "/timetable/entries",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createEntrySchema, req.body, "Invalid timetable entry payload");

    const classroom = await ensureClassroomInSchool(req.auth.schoolId, body.classroom_id);
    const slot = await ensureSlotInSchool(req.auth.schoolId, body.slot_id);

    if (slot.academic_year_id !== classroom.academic_year_id) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "slot_id and classroom_id must belong to the same academic year"
      );
    }

    if (body.subject_id) {
      await ensureSubjectInSchool(req.auth.schoolId, body.subject_id);
    }
    if (body.teacher_id) {
      await ensureTeacherInSchool(req.auth.schoolId, body.teacher_id);
    }

    await assertTeacherSubjectAssignment({
      schoolId: req.auth.schoolId,
      classroomId: classroom.id,
      subjectId: body.subject_id || null,
      teacherId: body.teacher_id || null,
    });

    await assertNoEntryConflicts({
      schoolId: req.auth.schoolId,
      slotId: slot.id,
      classroomId: classroom.id,
      teacherId: body.teacher_id || null,
      roomNumber: body.room_number || null,
    });

    let created;
    try {
      created = await pool.query(
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
            created_by_user_id,
            updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
          RETURNING id
        `,
        [
          req.auth.schoolId,
          classroom.academic_year_id,
          classroom.id,
          slot.id,
          body.subject_id || null,
          body.teacher_id || null,
          body.entry_type,
          body.room_number || null,
          body.notes || null,
          req.auth.userId,
        ]
      );
    } catch (error) {
      throw parsePgErrorAsAppError(error);
    }

    const entry = await fetchTimetableEntryById(req.auth.schoolId, created.rows[0].id);

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_entry.created",
      entityName: "timetable_entries",
      entityId: created.rows[0].id,
      metadata: {
        classroom_id: classroom.id,
        slot_id: slot.id,
        subject_id: body.subject_id || null,
        teacher_id: body.teacher_id || null,
        room_number: body.room_number || null,
      },
    });

    return success(res, entry, 201);
  })
);

router.patch(
  "/timetable/entries/:entryId",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(entryPathSchema, req.params, "Invalid timetable entry id");
    const body = parseSchema(updateEntrySchema, req.body, "Invalid timetable entry patch payload");

    const existing = await fetchTimetableEntryById(req.auth.schoolId, path.entryId);
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Timetable entry not found");
    }

    const nextSlotId = Object.prototype.hasOwnProperty.call(body, "slot_id")
      ? body.slot_id
      : existing.slot_id;
    const nextTeacherId = Object.prototype.hasOwnProperty.call(body, "teacher_id")
      ? body.teacher_id
      : existing.teacher_id;
    const nextSubjectId = Object.prototype.hasOwnProperty.call(body, "subject_id")
      ? body.subject_id
      : existing.subject_id;
    const nextRoomNumber = Object.prototype.hasOwnProperty.call(body, "room_number")
      ? body.room_number
      : existing.room_number;

    const classroom = await ensureClassroomInSchool(req.auth.schoolId, existing.classroom_id);
    const slot = await ensureSlotInSchool(req.auth.schoolId, nextSlotId);
    if (slot.academic_year_id !== classroom.academic_year_id) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "slot_id and classroom_id must belong to the same academic year"
      );
    }

    if (nextSubjectId) {
      await ensureSubjectInSchool(req.auth.schoolId, nextSubjectId);
    }
    if (nextTeacherId) {
      await ensureTeacherInSchool(req.auth.schoolId, nextTeacherId);
    }

    await assertTeacherSubjectAssignment({
      schoolId: req.auth.schoolId,
      classroomId: classroom.id,
      subjectId: nextSubjectId,
      teacherId: nextTeacherId,
    });

    if (body.is_active !== false) {
      await assertNoEntryConflicts({
        schoolId: req.auth.schoolId,
        slotId: slot.id,
        classroomId: classroom.id,
        teacherId: nextTeacherId,
        roomNumber: nextRoomNumber,
        excludeEntryId: existing.id,
      });
    }

    const values = [];
    const setClauses = [];
    if (Object.prototype.hasOwnProperty.call(body, "slot_id")) {
      values.push(body.slot_id);
      setClauses.push(`slot_id = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "subject_id")) {
      values.push(body.subject_id || null);
      setClauses.push(`subject_id = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "teacher_id")) {
      values.push(body.teacher_id || null);
      setClauses.push(`teacher_id = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "entry_type")) {
      values.push(body.entry_type);
      setClauses.push(`entry_type = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "room_number")) {
      values.push(body.room_number || null);
      setClauses.push(`room_number = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "notes")) {
      values.push(body.notes || null);
      setClauses.push(`notes = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
      values.push(body.is_active);
      setClauses.push(`is_active = $${values.length}`);
    }

    values.push(req.auth.userId);
    setClauses.push(`updated_by_user_id = $${values.length}`);
    values.push(req.auth.schoolId, path.entryId);

    const queryText = `
      UPDATE timetable_entries
      SET ${setClauses.join(", ")}
      WHERE school_id = $${values.length - 1}
        AND id = $${values.length}
      RETURNING id
    `;

    try {
      await pool.query(queryText, values);
    } catch (error) {
      throw parsePgErrorAsAppError(error);
    }

    const updated = await fetchTimetableEntryById(req.auth.schoolId, path.entryId);

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: body.is_active === false
        ? "academics.timetable_entry.deactivated"
        : "academics.timetable_entry.updated",
      entityName: "timetable_entries",
      entityId: path.entryId,
      metadata: {
        updated_fields: Object.keys(body),
      },
    });

    return success(res, updated, 200);
  })
);

router.delete(
  "/timetable/entries/:entryId",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(entryPathSchema, req.params, "Invalid timetable entry id");

    const updated = await pool.query(
      `
        UPDATE timetable_entries
        SET
          is_active = FALSE,
          updated_by_user_id = $3,
          updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
          AND is_active = TRUE
        RETURNING id, is_active, updated_at
      `,
      [req.auth.schoolId, path.entryId, req.auth.userId]
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Timetable entry not found or already inactive");
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_entry.deactivated",
      entityName: "timetable_entries",
      entityId: path.entryId,
      metadata: {},
    });

    return success(res, updated.rows[0], 200);
  })
);

// ---------------------------------------------------------------------------
// Timetable views (classroom + teacher)
// ---------------------------------------------------------------------------
router.get(
  "/timetable/classrooms/:classroomId",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(classroomPathSchema, req.params, "Invalid classroom id");
    const query = parseSchema(
      classroomTimetableQuerySchema,
      req.query,
      "Invalid classroom timetable query"
    );

    const classroom = await ensureClassroomInSchool(req.auth.schoolId, path.classroomId);
    await ensureClassroomVisibleToRole({ auth: req.auth, classroom });

    const academicYearId = query.academic_year_id || classroom.academic_year_id;
    await resolveAcademicYearId(req.auth.schoolId, academicYearId);

    const slotParams = [req.auth.schoolId, academicYearId];
    const slotWhere = ["ts.school_id = $1", "ts.academic_year_id = $2"];
    if (query.day_of_week) {
      slotParams.push(query.day_of_week);
      slotWhere.push(`ts.day_of_week = $${slotParams.length}`);
    }
    if (!query.include_inactive) {
      slotWhere.push("ts.is_active = TRUE", "tp.is_active = TRUE");
    }

    const slots = await pool.query(
      `
        SELECT
          ts.id,
          ts.day_of_week,
          ts.period_id,
          ts.is_active,
          tp.period_number,
          tp.label AS period_label,
          tp.starts_at,
          tp.ends_at,
          tp.is_break
        FROM timetable_slots ts
        JOIN timetable_periods tp
          ON tp.id = ts.period_id
         AND tp.school_id = ts.school_id
         AND tp.academic_year_id = ts.academic_year_id
        WHERE ${slotWhere.join(" AND ")}
        ORDER BY ts.day_of_week ASC, tp.period_number ASC
      `,
      slotParams
    );

    const entryParams = [req.auth.schoolId, classroom.id, academicYearId];
    let entryDayFilter = "";
    if (query.day_of_week) {
      entryParams.push(query.day_of_week);
      entryDayFilter = ` AND ts.day_of_week = $${entryParams.length}`;
    }
    if (!query.include_inactive) {
      entryDayFilter += " AND te.is_active = TRUE";
    }

    const entries = await pool.query(
      `
        SELECT
          te.id,
          te.slot_id,
          te.classroom_id,
          te.subject_id,
          te.teacher_id,
          te.entry_type,
          te.room_number,
          te.notes,
          te.is_active,
          ts.day_of_week,
          tp.period_number,
          tp.label AS period_label,
          tp.starts_at,
          tp.ends_at,
          s.code AS subject_code,
          s.name AS subject_name,
          tu.first_name AS teacher_first_name,
          tu.last_name AS teacher_last_name
        FROM timetable_entries te
        JOIN timetable_slots ts
          ON ts.id = te.slot_id
         AND ts.school_id = te.school_id
         AND ts.academic_year_id = te.academic_year_id
        JOIN timetable_periods tp
          ON tp.id = ts.period_id
         AND tp.school_id = ts.school_id
         AND tp.academic_year_id = ts.academic_year_id
        LEFT JOIN subjects s
          ON s.id = te.subject_id
         AND s.school_id = te.school_id
        LEFT JOIN teachers t
          ON t.id = te.teacher_id
         AND t.school_id = te.school_id
        LEFT JOIN users tu
          ON tu.id = t.user_id
         AND tu.school_id = t.school_id
        WHERE te.school_id = $1
          AND te.classroom_id = $2
          AND te.academic_year_id = $3
          ${entryDayFilter}
        ORDER BY ts.day_of_week ASC, tp.period_number ASC
      `,
      entryParams
    );

    const substitutions = await pool.query(
      `
        SELECT
          tsb.id,
          tsb.timetable_entry_id,
          tsb.substitute_teacher_id,
          tsb.substitution_date,
          tsb.reason,
          tsb.is_active,
          te.slot_id,
          ts.day_of_week,
          tp.period_number,
          tu.first_name AS substitute_teacher_first_name,
          tu.last_name AS substitute_teacher_last_name
        FROM timetable_substitutions tsb
        JOIN timetable_entries te
          ON te.id = tsb.timetable_entry_id
         AND te.school_id = tsb.school_id
        JOIN timetable_slots ts
          ON ts.id = te.slot_id
         AND ts.school_id = te.school_id
         AND ts.academic_year_id = te.academic_year_id
        JOIN timetable_periods tp
          ON tp.id = ts.period_id
         AND tp.school_id = ts.school_id
         AND tp.academic_year_id = ts.academic_year_id
        JOIN teachers st
          ON st.id = tsb.substitute_teacher_id
         AND st.school_id = tsb.school_id
        JOIN users tu
          ON tu.id = st.user_id
         AND tu.school_id = st.school_id
        WHERE tsb.school_id = $1
          AND te.classroom_id = $2
          AND te.academic_year_id = $3
          AND tsb.is_active = TRUE
          AND tsb.substitution_date >= CURRENT_DATE
        ORDER BY tsb.substitution_date ASC, tp.period_number ASC
        LIMIT 100
      `,
      [req.auth.schoolId, classroom.id, academicYearId]
    );

    return success(
      res,
      {
        classroom: {
          id: classroom.id,
          grade_label: classroom.grade_label,
          section_label: classroom.section_label,
          room_number: classroom.room_number,
          label: `${classroom.grade_label} - ${classroom.section_label}`,
        },
        academic_year_id: academicYearId,
        slots: slots.rows.map((row) => ({
          ...row,
          day_name: dayLabel(row.day_of_week),
        })),
        entries: entries.rows.map((row) => ({
          ...row,
          day_name: dayLabel(row.day_of_week),
          teacher_name: [row.teacher_first_name, row.teacher_last_name].filter(Boolean).join(" ").trim(),
        })),
        substitutions: substitutions.rows.map((row) => ({
          ...row,
          day_name: dayLabel(row.day_of_week),
          substitute_teacher_name: [row.substitute_teacher_first_name, row.substitute_teacher_last_name]
            .filter(Boolean)
            .join(" ")
            .trim(),
        })),
      },
      200
    );
  })
);

router.get(
  "/timetable/classrooms/:classroomId/manual-board",
  requireAuth,
  requireRoles(...MANUAL_BOARD_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(classroomPathSchema, req.params, "Invalid classroom id");
    const classroom = await ensureClassroomInSchool(req.auth.schoolId, path.classroomId);
    await ensureManualBoardVisibleToViewer({ auth: req.auth, classroom });

    const board = await ensureBoard({
      schoolId: req.auth.schoolId,
      classroomId: classroom.id,
      actorUserId: req.auth.userId,
    });

    return success(res, board, 200);
  })
);


async function listTeacherTimetableData({
  schoolId,
  teacherId,
  academicYearId,
  dayOfWeek,
  includeInactive,
  hmScopedUserId = null,
}) {
  const params = [schoolId, teacherId, academicYearId];
  const where = [
    "te.school_id = $1",
    "te.teacher_id = $2",
    "te.academic_year_id = $3",
  ];
  if (dayOfWeek) {
    params.push(dayOfWeek);
    where.push(`ts.day_of_week = $${params.length}`);
  }
  if (!includeInactive) {
    where.push("te.is_active = TRUE", "ts.is_active = TRUE", "tp.is_active = TRUE");
  }
  if (hmScopedUserId) {
    params.push(hmScopedUserId);
    where.push(`
      c.section_id IN (
        SELECT ss.id
        FROM school_sections ss
        WHERE ss.school_id = te.school_id
          AND (
            ss.head_user_id = $${params.length}
            OR ss.coordinator_user_id = $${params.length}
            OR EXISTS (
              SELECT 1
              FROM staff_profiles sp
              WHERE sp.school_id = ss.school_id
                AND sp.user_id = $${params.length}
                AND sp.primary_section_id = ss.id
            )
          )
      )
    `);
  }

  const rows = await pool.query(
    `
      SELECT
        te.id,
        te.slot_id,
        te.classroom_id,
        te.subject_id,
        te.entry_type,
        te.room_number,
        te.notes,
        te.is_active,
        ts.day_of_week,
        tp.period_number,
        tp.label AS period_label,
        tp.starts_at,
        tp.ends_at,
        c.grade_label,
        c.section_label,
        s.code AS subject_code,
        s.name AS subject_name
      FROM timetable_entries te
      JOIN timetable_slots ts
        ON ts.id = te.slot_id
       AND ts.school_id = te.school_id
       AND ts.academic_year_id = te.academic_year_id
      JOIN timetable_periods tp
        ON tp.id = ts.period_id
       AND tp.school_id = ts.school_id
       AND tp.academic_year_id = ts.academic_year_id
      JOIN classrooms c
        ON c.id = te.classroom_id
       AND c.school_id = te.school_id
       AND c.academic_year_id = te.academic_year_id
      LEFT JOIN subjects s
        ON s.id = te.subject_id
       AND s.school_id = te.school_id
      WHERE ${where.join(" AND ")}
      ORDER BY ts.day_of_week ASC, tp.period_number ASC
    `,
    params
  );

  return rows.rows.map((row) => ({
    ...row,
    day_name: dayLabel(row.day_of_week),
    classroom_label: `${row.grade_label} - ${row.section_label}`,
  }));
}

router.get(
  "/timetable/teachers",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(teacherLookupQuerySchema, req.query, "Invalid teacher lookup query");
    const params = [req.auth.schoolId];
    const where = [
      "sp.school_id = $1",
      "sp.staff_type = 'teacher'",
      "sp.employment_status = 'active'",
      "u.is_active = TRUE",
    ];

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          u.first_name ILIKE $${params.length}
          OR COALESCE(u.last_name, '') ILIKE $${params.length}
          OR u.email ILIKE $${params.length}
          OR sp.staff_code ILIKE $${params.length}
          OR COALESCE(sp.designation, '') ILIKE $${params.length}
          OR COALESCE(t.employee_code, '') ILIKE $${params.length}
        )
      `);
    }

    if (hasRole(req.auth, "headmistress") && !isLeadership(req.auth)) {
      const sectionIds = await listHeadmistressSectionIds(req.auth.schoolId, req.auth.userId);
      if (sectionIds.length === 0) {
        where.push("FALSE");
      } else {
        params.push(sectionIds);
      where.push(`
        (
          sp.primary_section_id = ANY($${params.length}::uuid[])
          OR EXISTS (
            SELECT 1
            FROM staff_classroom_assignments sca
            JOIN classrooms c
              ON c.id = sca.classroom_id
             AND c.school_id = sca.school_id
            WHERE sca.school_id = sp.school_id
              AND sca.staff_profile_id = sp.id
              AND sca.is_active = TRUE
              AND sca.starts_on <= CURRENT_DATE
              AND (sca.ends_on IS NULL OR sca.ends_on >= CURRENT_DATE)
              AND c.section_id = ANY($${params.length}::uuid[])
          )
          OR EXISTS (
            SELECT 1
            FROM teachers lt
            JOIN classroom_subjects cs
              ON cs.teacher_id = lt.id
             AND cs.school_id = lt.school_id
            JOIN classrooms c
              ON c.id = cs.classroom_id
             AND c.school_id = cs.school_id
            LEFT JOIN school_sections ss
              ON ss.id = c.section_id
             AND ss.school_id = c.school_id
            WHERE lt.school_id = sp.school_id
              AND lt.user_id = sp.user_id
              AND ss.id = ANY($${params.length}::uuid[])
          )
          OR EXISTS (
            SELECT 1
            FROM teachers lt
            JOIN classrooms c
              ON c.homeroom_teacher_id = lt.id
             AND c.school_id = lt.school_id
            LEFT JOIN school_sections ss
              ON ss.id = c.section_id
             AND ss.school_id = c.school_id
            WHERE lt.school_id = sp.school_id
              AND lt.user_id = sp.user_id
              AND ss.id = ANY($${params.length}::uuid[])
          )
        )
      `);
      }
    }

    if (hasRole(req.auth, "teacher") && !isLeadership(req.auth)) {
      const teacherIdentity = await getTeacherIdentityByUser({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (!teacherIdentity?.isActive) {
        where.push("FALSE");
      } else {
        params.push(req.auth.userId);
        where.push(`sp.user_id = $${params.length}`);
      }
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM staff_profiles sp
        JOIN users u
          ON u.id = sp.user_id
         AND u.school_id = sp.school_id
        LEFT JOIN teachers t
          ON t.user_id = sp.user_id
         AND t.school_id = sp.school_id
        WHERE ${where.join(" AND ")}
      `,
      params
    );
    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          t.id AS teacher_id,
          sp.id AS staff_profile_id,
          sp.user_id,
          sp.staff_code,
          COALESCE(t.employee_code, sp.staff_code) AS employee_code,
          COALESCE(sp.designation, t.designation) AS designation,
          u.first_name,
          u.last_name,
          u.email
        FROM staff_profiles sp
        JOIN users u
          ON u.id = sp.user_id
         AND u.school_id = sp.school_id
        LEFT JOIN teachers t
          ON t.user_id = sp.user_id
         AND t.school_id = sp.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY u.first_name ASC, u.last_name ASC NULLS LAST
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const mappedTeachers = await Promise.all(
      rows.rows.map(async (row) => {
        let teacherId = row.teacher_id;
        if (!teacherId) {
          const projection = await ensureTeacherProjectionForUser({
            schoolId: req.auth.schoolId,
            userId: row.user_id,
            roles: ["teacher"],
          });
          teacherId = projection?.id || null;
        }

        if (!teacherId) return null;

        return {
          id: teacherId,
          user_id: row.user_id,
          staff_profile_id: row.staff_profile_id,
          staff_code: row.staff_code,
          employee_code: row.employee_code,
          designation: row.designation,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          label: `${row.first_name} ${row.last_name || ""}`.trim(),
        };
      })
    );

    return success(
      res,
      mappedTeachers.filter(Boolean),
      200,
      {
        pagination: {
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          total_pages: totalPages,
        },
      }
    );
  })
);

router.get(
  "/timetable/teachers/me",
  requireAuth,
  requireRoles("teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      teacherTimetableQuerySchema,
      req.query,
      "Invalid teacher timetable query"
    );

    const teacher = await resolveTeacherForUser(req.auth.schoolId, req.auth.userId);
    if (!teacher) {
      throw new AppError(404, "NOT_FOUND", "Teacher profile not found for this user");
    }

    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, query.academic_year_id);
    const entries = await listTeacherTimetableData({
      schoolId: req.auth.schoolId,
      teacherId: teacher.id,
      academicYearId,
      dayOfWeek: query.day_of_week || null,
      includeInactive: query.include_inactive,
    });

    return success(
      res,
      {
        teacher_id: teacher.id,
        academic_year_id: academicYearId,
        entries,
      },
      200
    );
  })
);

router.get(
  "/timetable/teachers/:teacherId",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(teacherPathSchema, req.params, "Invalid teacher id");
    const query = parseSchema(
      teacherTimetableQuerySchema,
      req.query,
      "Invalid teacher timetable query"
    );

    await ensureTeacherVisibleToRole({ auth: req.auth, teacherId: path.teacherId });
    const teacher = await ensureTeacherInSchool(req.auth.schoolId, path.teacherId);
    const academicYearId = await resolveAcademicYearId(req.auth.schoolId, query.academic_year_id);

    const entries = await listTeacherTimetableData({
      schoolId: req.auth.schoolId,
      teacherId: path.teacherId,
      academicYearId,
      dayOfWeek: query.day_of_week || null,
      includeInactive: query.include_inactive,
      hmScopedUserId: hasRole(req.auth, "headmistress") && !isLeadership(req.auth) ? req.auth.userId : null,
    });

    return success(
      res,
      {
        teacher: {
          id: teacher.id,
          user_id: teacher.user_id,
          first_name: teacher.first_name,
          last_name: teacher.last_name,
          email: teacher.email,
        },
        academic_year_id: academicYearId,
        entries,
      },
      200
    );
  })
);

// ---------------------------------------------------------------------------
// Timetable substitutions
// ---------------------------------------------------------------------------
router.get(
  "/timetable/substitutions",
  requireAuth,
  requireRoles(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      listSubstitutionsQuerySchema,
      req.query,
      "Invalid substitution list query"
    );

    const params = [req.auth.schoolId];
    const where = ["tsb.school_id = $1"];

    if (query.date_from) {
      params.push(query.date_from);
      where.push(`tsb.substitution_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`tsb.substitution_date <= $${params.length}`);
    }
    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`te.classroom_id = $${params.length}`);
    }
    if (query.teacher_id) {
      params.push(query.teacher_id);
      where.push(`(te.teacher_id = $${params.length} OR tsb.substitute_teacher_id = $${params.length})`);
    }

    await appendSubstitutionScopeClause({
      auth: req.auth,
      params,
      where,
    });

    const whereClause = where.join(" AND ");
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM timetable_substitutions tsb
        JOIN timetable_entries te
          ON te.id = tsb.timetable_entry_id
         AND te.school_id = tsb.school_id
        JOIN classrooms c
          ON c.id = te.classroom_id
         AND c.school_id = te.school_id
        WHERE ${whereClause}
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          tsb.id,
          tsb.timetable_entry_id,
          tsb.substitute_teacher_id,
          tsb.substitution_date,
          tsb.reason,
          tsb.is_active,
          tsb.created_at,
          tsb.revoked_at,
          te.classroom_id,
          te.teacher_id AS original_teacher_id,
          te.slot_id,
          c.grade_label,
          c.section_label,
          ts.day_of_week,
          tp.period_number,
          tp.label AS period_label,
          su.first_name AS substitute_first_name,
          su.last_name AS substitute_last_name,
          ou.first_name AS original_first_name,
          ou.last_name AS original_last_name
        FROM timetable_substitutions tsb
        JOIN timetable_entries te
          ON te.id = tsb.timetable_entry_id
         AND te.school_id = tsb.school_id
        JOIN classrooms c
          ON c.id = te.classroom_id
         AND c.school_id = te.school_id
        JOIN timetable_slots ts
          ON ts.id = te.slot_id
         AND ts.school_id = te.school_id
         AND ts.academic_year_id = te.academic_year_id
        JOIN timetable_periods tp
          ON tp.id = ts.period_id
         AND tp.school_id = ts.school_id
         AND tp.academic_year_id = ts.academic_year_id
        JOIN teachers st
          ON st.id = tsb.substitute_teacher_id
         AND st.school_id = tsb.school_id
        JOIN users su
          ON su.id = st.user_id
         AND su.school_id = st.school_id
        LEFT JOIN teachers ot
          ON ot.id = te.teacher_id
         AND ot.school_id = te.school_id
        LEFT JOIN users ou
          ON ou.id = ot.user_id
         AND ou.school_id = ot.school_id
        WHERE ${whereClause}
        ORDER BY tsb.substitution_date DESC, tp.period_number ASC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const data = rows.rows.map((row) => ({
      ...row,
      classroom_label: `${row.grade_label} - ${row.section_label}`,
      day_name: dayLabel(row.day_of_week),
      substitute_teacher_name: [row.substitute_first_name, row.substitute_last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      original_teacher_name: [row.original_first_name, row.original_last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
    }));

    return success(
      res,
      data,
      200,
      {
        pagination: {
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          total_pages: totalPages,
        },
      }
    );
  })
);

router.post(
  "/timetable/substitutions",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createSubstitutionSchema, req.body, "Invalid substitution payload");
    const substitutionDay = isoWeekdayFromDate(body.substitution_date);

    const entry = await fetchTimetableEntryById(req.auth.schoolId, body.timetable_entry_id);
    if (!entry || !entry.is_active) {
      throw new AppError(404, "NOT_FOUND", "Timetable entry not found or inactive");
    }
    if (!entry.teacher_id) {
      throw new AppError(422, "VALIDATION_ERROR", "Cannot assign substitution to an entry without an original teacher");
    }

    if (entry.day_of_week !== substitutionDay) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `substitution_date must match timetable day ${dayLabel(entry.day_of_week)}`
      );
    }

    if (body.substitute_teacher_id === entry.teacher_id) {
      throw new AppError(422, "VALIDATION_ERROR", "Substitute teacher must be different from original teacher");
    }

    await ensureTeacherInSchool(req.auth.schoolId, body.substitute_teacher_id);
    await assertSubstituteTeacherAvailable({
      schoolId: req.auth.schoolId,
      substituteTeacherId: body.substitute_teacher_id,
      substitutionDate: body.substitution_date,
      slotId: entry.slot_id,
    });

    let created;
    try {
      created = await pool.query(
        `
          INSERT INTO timetable_substitutions (
            school_id,
            timetable_entry_id,
            substitute_teacher_id,
            substitution_date,
            reason,
            created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING
            id,
            school_id,
            timetable_entry_id,
            substitute_teacher_id,
            substitution_date,
            reason,
            is_active,
            created_at,
            updated_at
        `,
        [
          req.auth.schoolId,
          body.timetable_entry_id,
          body.substitute_teacher_id,
          body.substitution_date,
          body.reason || null,
          req.auth.userId,
        ]
      );
    } catch (error) {
      throw parsePgErrorAsAppError(error);
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_substitution.created",
      entityName: "timetable_substitutions",
      entityId: created.rows[0].id,
      metadata: {
        timetable_entry_id: body.timetable_entry_id,
        substitution_date: body.substitution_date,
        substitute_teacher_id: body.substitute_teacher_id,
      },
    });

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/timetable/substitutions/:substitutionId/revoke",
  requireAuth,
  requireRoles(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(substitutionPathSchema, req.params, "Invalid substitution id");

    const updated = await pool.query(
      `
        UPDATE timetable_substitutions
        SET
          is_active = FALSE,
          revoked_by_user_id = $3,
          revoked_at = NOW(),
          updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
          AND is_active = TRUE
        RETURNING
          id,
          school_id,
          timetable_entry_id,
          substitute_teacher_id,
          substitution_date,
          reason,
          is_active,
          revoked_by_user_id,
          revoked_at,
          updated_at
      `,
      [req.auth.schoolId, path.substitutionId, req.auth.userId]
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Substitution not found or already revoked");
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "academics.timetable_substitution.revoked",
      entityName: "timetable_substitutions",
      entityId: path.substitutionId,
      metadata: {},
    });

    return success(res, updated.rows[0], 200);
  })
);

module.exports = router;
