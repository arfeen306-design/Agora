const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { getTeacherIdentityByUser, listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const INCIDENT_TYPES = [
  "minor_infraction",
  "major_infraction",
  "positive_behavior",
  "bullying",
  "safety_concern",
];

const SEVERITIES = ["low", "medium", "high", "critical"];
const INCIDENT_STATUSES = ["reported", "under_review", "resolved", "escalated"];
const CONSEQUENCE_TYPES = [
  "verbal_warning",
  "written_warning",
  "detention",
  "suspension",
  "parent_meeting",
  "community_service",
  "other",
];

const LIST_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher"];
const CREATE_ROLES = ["school_admin", "principal", "teacher"];
const UPDATE_ROLES = ["school_admin", "principal", "headmistress"];
const CONSEQUENCE_ROLES = ["school_admin", "principal"];
const STUDENT_SUMMARY_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "parent",
  "student",
];

const listIncidentsQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  section_id: z.string().uuid().optional(),
  incident_type: z.enum(INCIDENT_TYPES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createIncidentSchema = z.object({
  student_id: z.string().uuid(),
  incident_date: z.string().date(),
  incident_type: z.enum(INCIDENT_TYPES),
  description: z.string().trim().min(1).max(5000),
  location: z.string().trim().max(240).optional(),
  witnesses: z.string().trim().max(2000).optional(),
  severity: z.enum(SEVERITIES),
  status: z.enum(["reported", "under_review", "escalated"]).default("reported"),
  resolution_notes: z.string().trim().max(5000).optional(),
  pastoral_notes: z.string().trim().max(5000).optional(),
  classroom_id: z.string().uuid().optional(),
  section_id: z.string().uuid().optional(),
  is_sensitive: z.boolean().default(false),
});

const incidentPathSchema = z.object({
  incidentId: z.string().uuid(),
});

const studentPathSchema = z.object({
  studentId: z.string().uuid(),
});

const updateIncidentSchema = z
  .object({
    incident_date: z.string().date().optional(),
    incident_type: z.enum(INCIDENT_TYPES).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    location: z.string().trim().max(240).nullable().optional(),
    witnesses: z.string().trim().max(2000).nullable().optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    resolution_notes: z.string().trim().max(5000).nullable().optional(),
    pastoral_notes: z.string().trim().max(5000).nullable().optional(),
    classroom_id: z.string().uuid().nullable().optional(),
    section_id: z.string().uuid().nullable().optional(),
    is_sensitive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const createConsequenceSchema = z
  .object({
    consequence_type: z.enum(CONSEQUENCE_TYPES),
    description: z.string().trim().max(3000).optional(),
    starts_on: z.string().date(),
    ends_on: z.string().date().optional(),
    parent_notified: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.ends_on && data.ends_on < data.starts_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ends_on must be on or after starts_on",
        path: ["ends_on"],
      });
    }
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

function hasAnyRole(auth, allowedRoles) {
  return allowedRoles.some((role) => hasRole(auth, role));
}

function assertRole(auth, allowedRoles, message) {
  if (!hasAnyRole(auth, allowedRoles)) {
    throw new AppError(403, "FORBIDDEN", message);
  }
}

function canViewSensitiveIncidents(auth) {
  return hasRole(auth, "school_admin") || hasRole(auth, "principal");
}

function canViewInvestigationNotes(auth) {
  return hasRole(auth, "school_admin") || hasRole(auth, "principal");
}

function isLeadershipRole(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "super_admin")
  );
}

function parseIsoDate(value, fieldName) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must be a valid date`);
  }
  return date;
}

function ensureDateNotFuture(value, fieldName) {
  const current = new Date();
  const today = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  const target = parseIsoDate(value, fieldName);
  if (target > today) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} cannot be in the future`);
  }
}

async function ensureStudentExistsInSchool(schoolId, studentId) {
  const result = await pool.query(
    `
      SELECT id
      FROM students
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, studentId]
  );
  if (!result.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Student not found");
  }
}

async function ensureClassroomInSchool(schoolId, classroomId, fieldName = "classroom_id") {
  if (!classroomId) return null;
  const result = await pool.query(
    `
      SELECT id, section_id
      FROM classrooms
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );
  if (!result.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
  return result.rows[0];
}

async function ensureSectionInSchool(schoolId, sectionId, fieldName = "section_id") {
  if (!sectionId) return null;
  const result = await pool.query(
    `
      SELECT id
      FROM school_sections
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, sectionId]
  );
  if (!result.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
  return result.rows[0];
}

async function resolveStudentEnrollmentContext(schoolId, studentId) {
  const result = await pool.query(
    `
      SELECT
        se.classroom_id,
        c.section_id
      FROM student_enrollments se
      JOIN classrooms c
        ON c.id = se.classroom_id
       AND c.school_id = se.school_id
      WHERE se.school_id = $1
        AND se.student_id = $2
        AND se.status = 'active'
      ORDER BY se.joined_on DESC NULLS LAST, se.created_at DESC
      LIMIT 1
    `,
    [schoolId, studentId]
  );
  return result.rows[0] || null;
}

async function resolveStudentScopeContext(auth, studentId) {
  const query = await pool.query(
    `
      SELECT
        EXISTS (
          SELECT 1
          FROM students s
          WHERE s.school_id = $1
            AND s.id = $2
        ) AS student_exists,
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          WHERE ps.school_id = $1
            AND ps.student_id = $2
            AND p.school_id = $1
            AND p.user_id = $3
        ) AS is_parent,
        EXISTS (
          SELECT 1
          FROM student_user_accounts sua
          WHERE sua.student_id = $2
            AND sua.user_id = $3
        ) AS is_student_self,
        EXISTS (
          SELECT 1
          FROM student_enrollments se
          JOIN classrooms c
            ON c.id = se.classroom_id
           AND c.school_id = se.school_id
          JOIN school_sections ss
            ON ss.id = c.section_id
           AND ss.school_id = c.school_id
          WHERE se.school_id = $1
            AND se.student_id = $2
            AND se.status = 'active'
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
        ) AS is_headmistress_scope
    `,
    [auth.schoolId, studentId, auth.userId]
  );

  const row = query.rows[0];
  if (!row?.student_exists) {
    throw new AppError(404, "NOT_FOUND", "Student not found");
  }

  let isHomeroomTeacher = false;
  let isSubjectTeacher = false;

  if (hasRole(auth, "teacher") && !isLeadershipRole(auth)) {
    const teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });

    if (teacherClassroomIds.length > 0) {
      const teacherScopeResult = await pool.query(
        `
          SELECT
            EXISTS (
              SELECT 1
              FROM student_enrollments se
              WHERE se.school_id = $1
                AND se.student_id = $2
                AND se.status = 'active'
                AND se.classroom_id = ANY($3::uuid[])
            ) AS is_teacher_scope
        `,
        [auth.schoolId, studentId, teacherClassroomIds]
      );

      const inTeacherScope = Boolean(teacherScopeResult.rows[0]?.is_teacher_scope);

      if (inTeacherScope) {
        const teacherIdentity = await getTeacherIdentityByUser({
          schoolId: auth.schoolId,
          userId: auth.userId,
        });

        if (teacherIdentity.teacherId) {
          const homeroomResult = await pool.query(
            `
              SELECT EXISTS (
                SELECT 1
                FROM student_enrollments se
                JOIN classrooms c
                  ON c.id = se.classroom_id
                 AND c.school_id = se.school_id
                WHERE se.school_id = $1
                  AND se.student_id = $2
                  AND se.status = 'active'
                  AND c.homeroom_teacher_id = $3
              ) AS is_homeroom_teacher
            `,
            [auth.schoolId, studentId, teacherIdentity.teacherId]
          );
          isHomeroomTeacher = Boolean(homeroomResult.rows[0]?.is_homeroom_teacher);
        }

        isSubjectTeacher = !isHomeroomTeacher;
      }
    }
  }

  row.is_homeroom_teacher = isHomeroomTeacher;
  row.is_subject_teacher = isSubjectTeacher;

  return row;
}

function assertIncidentScopeByStudentContext(auth, context) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "principal") || hasRole(auth, "super_admin")) {
    return;
  }
  if (hasRole(auth, "vice_principal")) {
    return;
  }
  if (hasRole(auth, "headmistress") && context.is_headmistress_scope) {
    return;
  }
  if (hasRole(auth, "teacher") && (context.is_homeroom_teacher || context.is_subject_teacher)) {
    return;
  }
  if (hasRole(auth, "parent") && context.is_parent) {
    return;
  }
  if (hasRole(auth, "student") && context.is_student_self) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No access to this student discipline data");
}

async function appendIncidentScope({ auth, params, where, alias = "di", allowParent = false, allowStudent = false }) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "principal") || hasRole(auth, "super_admin")) {
    return;
  }

  if (hasRole(auth, "vice_principal")) {
    where.push(`${alias}.is_sensitive = FALSE`);
    return;
  }

  if (hasRole(auth, "headmistress")) {
    params.push(auth.userId);
    const userIndex = params.length;
    where.push(`${alias}.is_sensitive = FALSE`);
    where.push(`
      EXISTS (
        SELECT 1
        FROM school_sections ss
        WHERE ss.school_id = ${alias}.school_id
          AND ss.id = COALESCE(
            ${alias}.section_id,
            (
              SELECT c.section_id
              FROM student_enrollments se
              JOIN classrooms c
                ON c.id = se.classroom_id
               AND c.school_id = se.school_id
              WHERE se.school_id = ${alias}.school_id
                AND se.student_id = ${alias}.student_id
                AND se.status = 'active'
              ORDER BY se.joined_on DESC NULLS LAST, se.created_at DESC
              LIMIT 1
            )
          )
          AND (
            ss.head_user_id = $${userIndex}
            OR ss.coordinator_user_id = $${userIndex}
            OR EXISTS (
              SELECT 1
              FROM staff_profiles sp
              WHERE sp.school_id = ss.school_id
                AND sp.user_id = $${userIndex}
                AND sp.primary_section_id = ss.id
            )
          )
      )
    `);
    return;
  }

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });

    where.push(`${alias}.is_sensitive = FALSE`);

    if (teacherClassroomIds.length === 0) {
      where.push("1 = 0");
      return;
    }

    params.push(teacherClassroomIds);
    const classroomScopeIndex = params.length;
    where.push(`
      EXISTS (
        SELECT 1
        FROM student_enrollments se
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        WHERE se.school_id = ${alias}.school_id
          AND se.student_id = ${alias}.student_id
          AND se.status = 'active'
          AND se.classroom_id = ANY($${classroomScopeIndex}::uuid[])
      )
    `);
    return;
  }

  if (allowParent && hasRole(auth, "parent")) {
    params.push(auth.userId);
    const userIndex = params.length;
    where.push(`${alias}.is_sensitive = FALSE`);
    where.push(`
      EXISTS (
        SELECT 1
        FROM parent_students ps
        JOIN parents p
          ON p.id = ps.parent_id
         AND p.school_id = ps.school_id
        WHERE ps.school_id = ${alias}.school_id
          AND ps.student_id = ${alias}.student_id
          AND p.user_id = $${userIndex}
      )
    `);
    return;
  }

  if (allowStudent && hasRole(auth, "student")) {
    params.push(auth.userId);
    const userIndex = params.length;
    where.push(`${alias}.is_sensitive = FALSE`);
    where.push(`
      EXISTS (
        SELECT 1
        FROM student_user_accounts sua
        WHERE sua.student_id = ${alias}.student_id
          AND sua.user_id = $${userIndex}
      )
    `);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No discipline access for this role");
}

function sanitizeIncident(incident, auth, { parentSafe = false } = {}) {
  const showInvestigationNotes = canViewInvestigationNotes(auth);
  const isParentOrStudent = hasRole(auth, "parent") || hasRole(auth, "student") || parentSafe;

  const safe = {
    ...incident,
    resolution_notes: showInvestigationNotes ? incident.resolution_notes : null,
    pastoral_notes: showInvestigationNotes ? incident.pastoral_notes : null,
    witnesses: isParentOrStudent ? null : incident.witnesses,
  };

  if (Array.isArray(incident.consequences)) {
    safe.consequences = incident.consequences.map((consequence) => ({
      ...consequence,
      description: isParentOrStudent ? consequence.description : consequence.description,
    }));
  }

  return safe;
}

function parsePgErrorAsAppError(error) {
  if (!error?.code) return error;

  if (error.code === "23503") {
    return new AppError(422, "VALIDATION_ERROR", "Referenced relation does not belong to this school");
  }
  if (error.code === "23505") {
    return new AppError(409, "CONFLICT", "Duplicate discipline record conflicts with existing data");
  }
  if (error.code === "23514") {
    return new AppError(422, "VALIDATION_ERROR", "Discipline payload violates a data integrity rule");
  }

  return error;
}

async function fetchIncidentByIdForScope({ auth, incidentId, allowParent = false, allowStudent = false }) {
  const params = [auth.schoolId, incidentId];
  const where = ["di.school_id = $1", "di.id = $2"];
  await appendIncidentScope({ auth, params, where, alias: "di", allowParent, allowStudent });

  const result = await pool.query(
    `
      SELECT
        di.id,
        di.school_id,
        di.student_id,
        di.classroom_id,
        di.section_id,
        di.reported_by_user_id,
        di.incident_date,
        di.incident_type,
        di.description,
        di.location,
        di.witnesses,
        di.severity,
        di.status,
        di.resolution_notes,
        di.pastoral_notes,
        di.resolved_by_user_id,
        di.resolved_at,
        di.is_sensitive,
        di.created_at,
        di.updated_at,
        s.student_code,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name,
        c.grade_label,
        c.section_label,
        c.classroom_code,
        c.room_number,
        ss.name AS section_name,
        ss.code AS section_code,
        reporter.first_name AS reported_by_first_name,
        reporter.last_name AS reported_by_last_name,
        resolver.first_name AS resolved_by_first_name,
        resolver.last_name AS resolved_by_last_name
      FROM discipline_incidents di
      JOIN students s
        ON s.id = di.student_id
       AND s.school_id = di.school_id
      LEFT JOIN classrooms c
        ON c.id = di.classroom_id
       AND c.school_id = di.school_id
      LEFT JOIN school_sections ss
        ON ss.id = di.section_id
       AND ss.school_id = di.school_id
      LEFT JOIN users reporter
        ON reporter.id = di.reported_by_user_id
      LEFT JOIN users resolver
        ON resolver.id = di.resolved_by_user_id
      WHERE ${where.join(" AND ")}
      LIMIT 1
    `,
    params
  );

  return result.rows[0] || null;
}

async function fetchIncidentConsequences(schoolId, incidentId) {
  const result = await pool.query(
    `
      SELECT
        dc.id,
        dc.incident_id,
        dc.consequence_type,
        dc.description,
        dc.starts_on,
        dc.ends_on,
        dc.parent_notified,
        dc.parent_notified_at,
        dc.administered_by_user_id,
        dc.created_at,
        u.first_name AS administered_by_first_name,
        u.last_name AS administered_by_last_name
      FROM discipline_consequences dc
      LEFT JOIN users u
        ON u.id = dc.administered_by_user_id
      WHERE dc.school_id = $1
        AND dc.incident_id = $2
      ORDER BY dc.starts_on DESC, dc.created_at DESC
    `,
    [schoolId, incidentId]
  );

  return result.rows;
}

router.get(
  "/discipline/incidents",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, LIST_ROLES, "No discipline incident visibility for this role");

    const query = parseSchema(listIncidentsQuerySchema, req.query, "Invalid discipline incident query");

    const params = [req.auth.schoolId];
    const where = ["di.school_id = $1"];

    if (query.student_id) {
      params.push(query.student_id);
      where.push(`di.student_id = $${params.length}`);
    }

    if (query.classroom_id) {
      await ensureClassroomInSchool(req.auth.schoolId, query.classroom_id, "classroom_id");
      params.push(query.classroom_id);
      where.push(`di.classroom_id = $${params.length}`);
    }

    if (query.section_id) {
      await ensureSectionInSchool(req.auth.schoolId, query.section_id, "section_id");
      params.push(query.section_id);
      where.push(`di.section_id = $${params.length}`);
    }

    if (query.incident_type) {
      params.push(query.incident_type);
      where.push(`di.incident_type = $${params.length}`);
    }

    if (query.severity) {
      params.push(query.severity);
      where.push(`di.severity = $${params.length}`);
    }

    if (query.status) {
      params.push(query.status);
      where.push(`di.status = $${params.length}`);
    }

    if (query.date_from) {
      params.push(query.date_from);
      where.push(`di.incident_date >= $${params.length}`);
    }

    if (query.date_to) {
      params.push(query.date_to);
      where.push(`di.incident_date <= $${params.length}`);
    }

    await appendIncidentScope({ auth: req.auth, params, where, alias: "di" });

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM discipline_incidents di
        WHERE ${whereClause}
      `,
      params
    );

    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const listResult = await pool.query(
      `
        SELECT
          di.id,
          di.student_id,
          di.classroom_id,
          di.section_id,
          di.reported_by_user_id,
          di.incident_date,
          di.incident_type,
          di.description,
          di.location,
          di.witnesses,
          di.severity,
          di.status,
          di.resolution_notes,
          di.pastoral_notes,
          di.resolved_by_user_id,
          di.resolved_at,
          di.is_sensitive,
          di.created_at,
          di.updated_at,
          s.student_code,
          s.first_name AS student_first_name,
          s.last_name AS student_last_name,
          c.grade_label,
          c.section_label,
          c.classroom_code,
          ss.name AS section_name,
          ss.code AS section_code,
          reporter.first_name AS reported_by_first_name,
          reporter.last_name AS reported_by_last_name,
          (
            SELECT COUNT(*)::int
            FROM discipline_consequences dc
            WHERE dc.school_id = di.school_id
              AND dc.incident_id = di.id
          ) AS consequences_count
        FROM discipline_incidents di
        JOIN students s
          ON s.id = di.student_id
         AND s.school_id = di.school_id
        LEFT JOIN classrooms c
          ON c.id = di.classroom_id
         AND c.school_id = di.school_id
        LEFT JOIN school_sections ss
          ON ss.id = di.section_id
         AND ss.school_id = di.school_id
        LEFT JOIN users reporter
          ON reporter.id = di.reported_by_user_id
        WHERE ${whereClause}
        ORDER BY di.incident_date DESC, di.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const rows = listResult.rows.map((row) => sanitizeIncident(row, req.auth));

    return success(
      res,
      rows,
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
  "/discipline/incidents",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, CREATE_ROLES, "No discipline incident create permission for this role");

    const body = parseSchema(createIncidentSchema, req.body, "Invalid discipline incident payload");
    ensureDateNotFuture(body.incident_date, "incident_date");

    await ensureStudentExistsInSchool(req.auth.schoolId, body.student_id);

    const scope = await resolveStudentScopeContext(req.auth, body.student_id);

    if (hasRole(req.auth, "teacher") && !(scope.is_homeroom_teacher || scope.is_subject_teacher)) {
      throw new AppError(403, "FORBIDDEN", "Teachers can report incidents only for students in assigned classrooms");
    }

    if (hasRole(req.auth, "teacher") && body.is_sensitive) {
      throw new AppError(403, "FORBIDDEN", "Teachers cannot mark incidents as sensitive");
    }

    let classroomId = body.classroom_id || null;
    let sectionId = body.section_id || null;

    const suppliedClassroom = await ensureClassroomInSchool(req.auth.schoolId, classroomId, "classroom_id");
    await ensureSectionInSchool(req.auth.schoolId, sectionId, "section_id");

    if (suppliedClassroom && !sectionId) {
      sectionId = suppliedClassroom.section_id || null;
    }

    if (!classroomId || !sectionId) {
      const enrollment = await resolveStudentEnrollmentContext(req.auth.schoolId, body.student_id);
      if (enrollment) {
        classroomId = classroomId || enrollment.classroom_id || null;
        sectionId = sectionId || enrollment.section_id || null;
      }
    }

    if (suppliedClassroom && sectionId && suppliedClassroom.section_id && suppliedClassroom.section_id !== sectionId) {
      throw new AppError(422, "VALIDATION_ERROR", "section_id must match the selected classroom section");
    }

    if (body.status === "resolved" && !body.resolution_notes) {
      throw new AppError(422, "VALIDATION_ERROR", "resolution_notes are required when status is resolved");
    }

    const incidentInsert = await pool.query(
      `
        INSERT INTO discipline_incidents (
          school_id,
          student_id,
          classroom_id,
          section_id,
          reported_by_user_id,
          incident_date,
          incident_type,
          description,
          location,
          witnesses,
          severity,
          status,
          resolution_notes,
          pastoral_notes,
          resolved_by_user_id,
          resolved_at,
          is_sensitive
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17
        )
        RETURNING id
      `,
      [
        req.auth.schoolId,
        body.student_id,
        classroomId,
        sectionId,
        req.auth.userId,
        body.incident_date,
        body.incident_type,
        body.description,
        body.location || null,
        body.witnesses || null,
        body.severity,
        body.status,
        body.resolution_notes || null,
        canViewInvestigationNotes(req.auth) ? body.pastoral_notes || null : null,
        body.status === "resolved" ? req.auth.userId : null,
        body.status === "resolved" ? new Date().toISOString() : null,
        body.is_sensitive,
      ]
    );

    const incidentId = incidentInsert.rows[0].id;
    const incident = await fetchIncidentByIdForScope({ auth: req.auth, incidentId });

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "discipline.incident.reported",
      entityName: "discipline_incidents",
      entityId: incidentId,
      metadata: {
        student_id: body.student_id,
        incident_type: body.incident_type,
        severity: body.severity,
        status: body.status,
        is_sensitive: body.is_sensitive,
      },
    });

    return success(res, sanitizeIncident(incident, req.auth), 201);
  })
);

router.get(
  "/discipline/incidents/:incidentId",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, LIST_ROLES, "No discipline incident detail permission for this role");

    const path = parseSchema(incidentPathSchema, req.params, "Invalid incident id");

    const incident = await fetchIncidentByIdForScope({
      auth: req.auth,
      incidentId: path.incidentId,
      allowParent: false,
      allowStudent: false,
    });
    if (!incident) {
      throw new AppError(404, "NOT_FOUND", "Discipline incident not found");
    }

    const consequences = await fetchIncidentConsequences(req.auth.schoolId, incident.id);

    const safe = sanitizeIncident(
      {
        ...incident,
        consequences,
      },
      req.auth,
      { parentSafe: hasRole(req.auth, "parent") || hasRole(req.auth, "student") }
    );

    return success(res, safe, 200);
  })
);

router.patch(
  "/discipline/incidents/:incidentId",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, UPDATE_ROLES, "No discipline incident update permission for this role");

    const path = parseSchema(incidentPathSchema, req.params, "Invalid incident id");
    const body = parseSchema(updateIncidentSchema, req.body, "Invalid discipline incident patch payload");

    const current = await fetchIncidentByIdForScope({
      auth: req.auth,
      incidentId: path.incidentId,
      allowParent: false,
      allowStudent: false,
    });
    if (!current) {
      throw new AppError(404, "NOT_FOUND", "Discipline incident not found");
    }

    const isHeadmistressReviewer = hasRole(req.auth, "headmistress") && !isLeadershipRole(req.auth);
    if (isHeadmistressReviewer) {
      const changedFields = Object.keys(body);
      const disallowedFields = changedFields.filter((field) => field !== "status");
      if (disallowedFields.length > 0) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Headmistress can only update incident status to under_review or escalated"
        );
      }
      if (!body.status || !["under_review", "escalated"].includes(body.status)) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Headmistress can update status only to under_review or escalated"
        );
      }
    }

    if (body.incident_date) {
      ensureDateNotFuture(body.incident_date, "incident_date");
    }

    if (Object.prototype.hasOwnProperty.call(body, "classroom_id") && body.classroom_id) {
      await ensureClassroomInSchool(req.auth.schoolId, body.classroom_id, "classroom_id");
    }
    if (Object.prototype.hasOwnProperty.call(body, "section_id") && body.section_id) {
      await ensureSectionInSchool(req.auth.schoolId, body.section_id, "section_id");
    }

    const finalStatus = body.status || current.status;
    const finalResolutionNotes = Object.prototype.hasOwnProperty.call(body, "resolution_notes")
      ? body.resolution_notes
      : current.resolution_notes;

    if (finalStatus === "resolved" && (!finalResolutionNotes || finalResolutionNotes.trim().length === 0)) {
      throw new AppError(422, "VALIDATION_ERROR", "resolution_notes are required when status is resolved");
    }

    const setClauses = [];
    const values = [req.auth.schoolId, path.incidentId];
    const pushField = (column, value) => {
      values.push(value);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (Object.prototype.hasOwnProperty.call(body, "incident_date")) pushField("incident_date", body.incident_date);
    if (Object.prototype.hasOwnProperty.call(body, "incident_type")) pushField("incident_type", body.incident_type);
    if (Object.prototype.hasOwnProperty.call(body, "description")) pushField("description", body.description);
    if (Object.prototype.hasOwnProperty.call(body, "location")) pushField("location", body.location);
    if (Object.prototype.hasOwnProperty.call(body, "witnesses")) pushField("witnesses", body.witnesses);
    if (Object.prototype.hasOwnProperty.call(body, "severity")) pushField("severity", body.severity);
    if (Object.prototype.hasOwnProperty.call(body, "status")) pushField("status", body.status);
    if (Object.prototype.hasOwnProperty.call(body, "resolution_notes")) pushField("resolution_notes", body.resolution_notes);
    if (Object.prototype.hasOwnProperty.call(body, "pastoral_notes")) pushField("pastoral_notes", body.pastoral_notes);
    if (Object.prototype.hasOwnProperty.call(body, "classroom_id")) pushField("classroom_id", body.classroom_id);
    if (Object.prototype.hasOwnProperty.call(body, "section_id")) pushField("section_id", body.section_id);
    if (Object.prototype.hasOwnProperty.call(body, "is_sensitive")) pushField("is_sensitive", body.is_sensitive);

    if (finalStatus === "resolved") {
      pushField("resolved_by_user_id", req.auth.userId);
      pushField("resolved_at", new Date().toISOString());
    } else if (Object.prototype.hasOwnProperty.call(body, "status") && body.status !== "resolved") {
      pushField("resolved_by_user_id", null);
      pushField("resolved_at", null);
    }

    pushField("updated_at", new Date().toISOString());

    const updateResult = await pool.query(
      `
        UPDATE discipline_incidents
        SET ${setClauses.join(", ")}
        WHERE school_id = $1
          AND id = $2
        RETURNING id
      `,
      values
    );

    if (!updateResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Discipline incident not found");
    }

    const updated = await fetchIncidentByIdForScope({ auth: req.auth, incidentId: path.incidentId });
    const consequences = await fetchIncidentConsequences(req.auth.schoolId, path.incidentId);

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "discipline.incident.updated",
      entityName: "discipline_incidents",
      entityId: path.incidentId,
      metadata: {
        changed_fields: Object.keys(body),
        previous_status: current.status,
        new_status: finalStatus,
      },
    });

    return success(
      res,
      sanitizeIncident(
        {
          ...updated,
          consequences,
        },
        req.auth
      ),
      200
    );
  })
);

router.post(
  "/discipline/incidents/:incidentId/consequences",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, CONSEQUENCE_ROLES, "No discipline consequence manage permission for this role");

    const path = parseSchema(incidentPathSchema, req.params, "Invalid incident id");
    const body = parseSchema(createConsequenceSchema, req.body, "Invalid consequence payload");

    const incidentResult = await pool.query(
      `
        SELECT id, student_id, incident_date, status, is_sensitive
        FROM discipline_incidents
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.incidentId]
    );

    const incident = incidentResult.rows[0];
    if (!incident) {
      throw new AppError(404, "NOT_FOUND", "Discipline incident not found");
    }

    const startsOn = parseIsoDate(body.starts_on, "starts_on");
    const incidentDateIso =
      incident.incident_date instanceof Date
        ? incident.incident_date.toISOString().slice(0, 10)
        : String(incident.incident_date).slice(0, 10);
    const incidentOn = parseIsoDate(incidentDateIso, "incident_date");

    if (startsOn < incidentOn) {
      throw new AppError(422, "VALIDATION_ERROR", "consequence starts_on must be on or after incident_date");
    }

    const inserted = await pool.query(
      `
        INSERT INTO discipline_consequences (
          school_id,
          incident_id,
          consequence_type,
          description,
          starts_on,
          ends_on,
          administered_by_user_id,
          parent_notified,
          parent_notified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          id,
          incident_id,
          consequence_type,
          description,
          starts_on,
          ends_on,
          parent_notified,
          parent_notified_at,
          administered_by_user_id,
          created_at
      `,
      [
        req.auth.schoolId,
        path.incidentId,
        body.consequence_type,
        body.description || null,
        body.starts_on,
        body.ends_on || null,
        req.auth.userId,
        body.parent_notified,
        body.parent_notified ? new Date().toISOString() : null,
      ]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "discipline.consequence.created",
      entityName: "discipline_consequences",
      entityId: inserted.rows[0].id,
      metadata: {
        incident_id: path.incidentId,
        student_id: incident.student_id,
        consequence_type: body.consequence_type,
        parent_notified: body.parent_notified,
      },
    });

    return success(res, inserted.rows[0], 201);
  })
);

router.get(
  "/discipline/students/:studentId/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    assertRole(req.auth, STUDENT_SUMMARY_ROLES, "No student discipline summary permission for this role");

    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");

    const context = await resolveStudentScopeContext(req.auth, path.studentId);
    assertIncidentScopeByStudentContext(req.auth, context);

    const params = [req.auth.schoolId, path.studentId];
    const where = ["di.school_id = $1", "di.student_id = $2"];

    if (!canViewSensitiveIncidents(req.auth)) {
      where.push("di.is_sensitive = FALSE");
    }

    const incidentsResult = await pool.query(
      `
        SELECT
          di.id,
          di.student_id,
          di.classroom_id,
          di.section_id,
          di.reported_by_user_id,
          di.incident_date,
          di.incident_type,
          di.description,
          di.location,
          di.witnesses,
          di.severity,
          di.status,
          di.resolution_notes,
          di.pastoral_notes,
          di.resolved_by_user_id,
          di.resolved_at,
          di.is_sensitive,
          di.created_at,
          di.updated_at,
          s.student_code,
          s.first_name AS student_first_name,
          s.last_name AS student_last_name,
          reporter.first_name AS reported_by_first_name,
          reporter.last_name AS reported_by_last_name,
          resolver.first_name AS resolved_by_first_name,
          resolver.last_name AS resolved_by_last_name
        FROM discipline_incidents di
        JOIN students s
          ON s.id = di.student_id
         AND s.school_id = di.school_id
        LEFT JOIN users reporter
          ON reporter.id = di.reported_by_user_id
        LEFT JOIN users resolver
          ON resolver.id = di.resolved_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY di.incident_date DESC, di.created_at DESC
        LIMIT 120
      `,
      params
    );

    const incidents = incidentsResult.rows;

    let consequencesByIncident = new Map();
    if (incidents.length > 0) {
      const incidentIds = incidents.map((row) => row.id);
      const consequencesResult = await pool.query(
        `
          SELECT
            dc.id,
            dc.incident_id,
            dc.consequence_type,
            dc.description,
            dc.starts_on,
            dc.ends_on,
            dc.parent_notified,
            dc.parent_notified_at,
            dc.administered_by_user_id,
            dc.created_at,
            u.first_name AS administered_by_first_name,
            u.last_name AS administered_by_last_name
          FROM discipline_consequences dc
          LEFT JOIN users u
            ON u.id = dc.administered_by_user_id
          WHERE dc.school_id = $1
            AND dc.incident_id = ANY($2::uuid[])
          ORDER BY dc.starts_on DESC, dc.created_at DESC
        `,
        [req.auth.schoolId, incidentIds]
      );

      consequencesByIncident = consequencesResult.rows.reduce((acc, row) => {
        if (!acc.has(row.incident_id)) {
          acc.set(row.incident_id, []);
        }
        acc.get(row.incident_id).push(row);
        return acc;
      }, new Map());
    }

    const safeRows = incidents.map((incident) =>
      sanitizeIncident(
        {
          ...incident,
          consequences: consequencesByIncident.get(incident.id) || [],
        },
        req.auth,
        {
          parentSafe: hasRole(req.auth, "parent") || hasRole(req.auth, "student"),
        }
      )
    );

    const counts = {
      total_incidents: safeRows.length,
      open_incidents: safeRows.filter((row) => row.status === "reported" || row.status === "under_review").length,
      escalated_incidents: safeRows.filter((row) => row.status === "escalated").length,
      resolved_incidents: safeRows.filter((row) => row.status === "resolved").length,
      by_severity: {
        low: safeRows.filter((row) => row.severity === "low").length,
        medium: safeRows.filter((row) => row.severity === "medium").length,
        high: safeRows.filter((row) => row.severity === "high").length,
        critical: safeRows.filter((row) => row.severity === "critical").length,
      },
      consequence_count: safeRows.reduce((sum, row) => sum + ((row.consequences || []).length || 0), 0),
    };

    return success(
      res,
      {
        student_id: path.studentId,
        ...counts,
        incidents: safeRows,
      },
      200
    );
  })
);

router.use((error, _req, _res, next) => {
  next(parsePgErrorAsAppError(error));
});

module.exports = router;
