const bcrypt = require("bcryptjs");
const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { syncTeacherProjectionForStaffProfile } = require("../utils/teacher-projection");
const { getTeacherIdentityByUser, listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const ROLE_CODES = [
  "super_admin",
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "accountant",
  "teacher",
  "parent",
  "student",
  "front_desk",
  "hr_admin",
];

const STAFF_TYPES = [
  "teacher",
  "principal",
  "vice_principal",
  "headmistress",
  "accountant",
  "front_desk",
  "hr_admin",
  "admin_officer",
  "coordinator",
  "other",
];

const STAFF_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "hr_admin"];
const STAFF_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin"];

const STUDENT_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "front_desk",
  "hr_admin",
];
const STUDENT_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "hr_admin"];
const STUDENT_DETAIL_EXTRA_ROLES = ["parent", "student"];

const PARENT_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "front_desk",
];
const PARENT_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "front_desk"];

const listStaffQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  staff_type: z.enum(STAFF_TYPES).optional(),
  primary_section_id: z.string().uuid().optional(),
  employment_status: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createStaffSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().min(3).max(60).optional(),
  temporary_password: z.string().min(6).max(120).default("ChangeMe123!"),
  roles: z.array(z.enum(ROLE_CODES)).min(1),
  staff_code: z.string().trim().min(2).max(40),
  staff_type: z.enum(STAFF_TYPES),
  designation: z.string().trim().max(120).optional(),
  joining_date: z.string().date().optional(),
  employment_status: z.string().trim().min(1).max(40).default("active"),
  reporting_manager_user_id: z.string().uuid().nullable().optional(),
  primary_section_id: z.string().uuid().nullable().optional(),
  id_document_no: z.string().trim().max(120).optional(),
  appointment_document_url: z.string().trim().url().max(1000).optional(),
  policy_acknowledged_at: z.string().datetime().optional(),
  metadata: z.record(z.any()).default({}),
});

const updateStaffSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80).optional(),
    last_name: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().min(3).max(60).nullable().optional(),
    roles: z.array(z.enum(ROLE_CODES)).min(1).optional(),
    staff_type: z.enum(STAFF_TYPES).optional(),
    designation: z.string().trim().max(120).nullable().optional(),
    joining_date: z.string().date().nullable().optional(),
    employment_status: z.string().trim().min(1).max(40).optional(),
    reporting_manager_user_id: z.string().uuid().nullable().optional(),
    primary_section_id: z.string().uuid().nullable().optional(),
    id_document_no: z.string().trim().max(120).nullable().optional(),
    appointment_document_url: z.string().trim().url().max(1000).nullable().optional(),
    policy_acknowledged_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.any()).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const listStudentsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  classroom_id: z.string().uuid().optional(),
  section_id: z.string().uuid().optional(),
  status: z.string().trim().min(1).max(40).optional(),
  admission_status: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createStudentSchema = z.object({
  student_code: z.string().trim().min(2).max(40),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional(),
  date_of_birth: z.string().date().optional(),
  gender: z.string().trim().max(20).optional(),
  admission_date: z.string().date().optional(),
  admission_status: z.string().trim().min(1).max(40).default("admitted"),
  status: z.string().trim().min(1).max(40).default("active"),
  emergency_contact_name: z.string().trim().max(120).optional(),
  emergency_contact_phone: z.string().trim().max(60).optional(),
  medical_alert: z.string().trim().max(400).optional(),
  transport_info: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  classroom_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  roll_no: z.coerce.number().int().min(1).max(9999).optional(),
  parent_user_id: z.string().uuid().optional(),
  relation_type: z.string().trim().min(1).max(40).default("guardian"),
  is_primary_parent: z.boolean().default(true),
  parent: z
    .object({
      first_name: z.string().trim().min(1).max(80),
      last_name: z.string().trim().max(80).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(3).max(60).optional(),
      temporary_password: z.string().min(6).max(120).default("ChangeMe123!"),
      is_active: z.boolean().default(true),
      occupation: z.string().trim().max(120).optional(),
      guardian_name: z.string().trim().max(160).optional(),
      father_name: z.string().trim().max(160).optional(),
      mother_name: z.string().trim().max(160).optional(),
      whatsapp_number: z.string().trim().max(60).optional(),
      address_line: z.string().trim().max(300).optional(),
      preferred_channel: z.enum(["in_app", "push", "email", "sms"]).default("in_app"),
      relation_type: z.string().trim().min(1).max(40).default("guardian"),
      is_primary: z.boolean().default(true),
    })
    .strict()
    .optional(),
});

const studentPathSchema = z.object({
  studentId: z.string().uuid(),
});

const staffPathSchema = z.object({
  staffId: z.string().uuid(),
});

const parentPathSchema = z.object({
  parentId: z.string().uuid(),
});

const listParentsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  student_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  section_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const linkedStudentSchema = z.object({
  student_id: z.string().uuid(),
  relation_type: z.string().trim().min(1).max(40).default("guardian"),
  is_primary: z.boolean().default(false),
});

const createParentSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(3).max(60).optional(),
  temporary_password: z.string().min(6).max(120).default("ChangeMe123!"),
  is_active: z.boolean().default(true),
  occupation: z.string().trim().max(120).optional(),
  guardian_name: z.string().trim().max(160).optional(),
  father_name: z.string().trim().max(160).optional(),
  mother_name: z.string().trim().max(160).optional(),
  whatsapp_number: z.string().trim().max(60).optional(),
  address_line: z.string().trim().max(300).optional(),
  preferred_channel: z.enum(["in_app", "push", "email", "sms"]).default("in_app"),
  linked_students: z.array(linkedStudentSchema).max(30).default([]),
});

const updateParentSchema = z
  .object({
    first_name: z.string().trim().min(1).max(80).optional(),
    last_name: z.string().trim().max(80).nullable().optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(3).max(60).nullable().optional(),
    is_active: z.boolean().optional(),
    occupation: z.string().trim().max(120).nullable().optional(),
    guardian_name: z.string().trim().max(160).nullable().optional(),
    father_name: z.string().trim().max(160).nullable().optional(),
    mother_name: z.string().trim().max(160).nullable().optional(),
    whatsapp_number: z.string().trim().max(60).nullable().optional(),
    address_line: z.string().trim().max(300).nullable().optional(),
    preferred_channel: z.enum(["in_app", "push", "email", "sms"]).optional(),
    linked_students: z.array(linkedStudentSchema).max(30).optional(),
  })
  .strict();

const timelineQuerySchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  max_events: z.coerce.number().int().min(1).max(300).default(120),
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

async function ensureRolesExist(roleCodes) {
  const unique = [...new Set(roleCodes)];
  const rows = await pool.query(
    `
      SELECT id, code
      FROM roles
      WHERE code = ANY($1::text[])
    `,
    [unique]
  );

  if (rows.rowCount !== unique.length) {
    const found = new Set(rows.rows.map((row) => row.code));
    const missing = unique.filter((code) => !found.has(code));
    throw new AppError(422, "VALIDATION_ERROR", `Unknown roles: ${missing.join(", ")}`);
  }

  return rows.rows;
}

async function ensureUserInSchool(schoolId, userId, fieldName) {
  if (!userId) return;

  const check = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );

  if (!check.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
}

async function ensureSectionInSchool(schoolId, sectionId, fieldName) {
  if (!sectionId) return;

  const check = await pool.query(
    `
      SELECT id
      FROM school_sections
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, sectionId]
  );

  if (!check.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
}

async function ensureClassroomInSchool(schoolId, classroomId) {
  if (!classroomId) return null;

  const result = await pool.query(
    `
      SELECT id, academic_year_id, section_id
      FROM classrooms
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );

  if (!result.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "classroom_id must belong to this school");
  }

  return result.rows[0];
}

async function ensureAcademicYearInSchool(schoolId, academicYearId) {
  if (!academicYearId) return null;

  const result = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, academicYearId]
  );

  if (!result.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "academic_year_id must belong to this school");
  }

  return result.rows[0];
}

async function resolveParentIdByUser(schoolId, parentUserId) {
  if (!parentUserId) return null;

  const parent = await pool.query(
    `
      SELECT p.id
      FROM parents p
      WHERE p.school_id = $1
        AND p.user_id = $2
      LIMIT 1
    `,
    [schoolId, parentUserId]
  );

  if (!parent.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "parent_user_id must map to a parent account");
  }

  return parent.rows[0].id;
}

function canViewParentContacts(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "headmistress") ||
    hasRole(auth, "teacher")
  );
}

function canViewStudentSensitiveProfile(auth, access) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "principal")) return true;
  if (access?.is_parent || access?.is_student_self || access?.is_homeroom_teacher) return true;
  return false;
}

async function getParentRoleId() {
  const role = await pool.query(
    `
      SELECT id
      FROM roles
      WHERE code = 'parent'
      LIMIT 1
    `
  );

  if (!role.rows[0]) {
    throw new AppError(500, "INTERNAL_SERVER_ERROR", "Parent role is not configured");
  }

  return role.rows[0].id;
}

async function getParentRoleIdFromClient(client) {
  const role = await client.query(
    `
      SELECT id
      FROM roles
      WHERE code = 'parent'
      LIMIT 1
    `
  );

  if (!role.rows[0]) {
    throw new AppError(500, "INTERNAL_SERVER_ERROR", "Parent role is not configured");
  }

  return role.rows[0].id;
}

function normalizeString(value) {
  const clean = String(value || "").trim();
  return clean || null;
}

function normalizeEmail(value) {
  const clean = String(value || "").trim().toLowerCase();
  return clean || null;
}

async function ensureOrCreateParentAccountForStudent({
  client,
  schoolId,
  parentInput,
  parentRoleId,
}) {
  const email = normalizeEmail(parentInput.email);
  const phone = normalizeString(parentInput.phone);
  const whatsapp = normalizeString(parentInput.whatsapp_number);

  const existingUser = await client.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND (
          ($2::text IS NOT NULL AND LOWER(email) = LOWER($2))
          OR ($3::text IS NOT NULL AND phone = $3)
          OR ($4::text IS NOT NULL AND phone = $4)
        )
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [schoolId, email, phone, whatsapp]
  );

  let userId = existingUser.rows[0]?.id || null;
  if (!userId) {
    const fallbackEmail = `parent.${Date.now()}.${Math.floor(Math.random() * 1000)}@agora.local`;
    const passwordHash = await bcrypt.hash(parentInput.temporary_password || "ChangeMe123!", 10);
    const createdUser = await client.query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        schoolId,
        email || fallbackEmail,
        phone || whatsapp,
        passwordHash,
        parentInput.first_name,
        normalizeString(parentInput.last_name),
        parentInput.is_active !== false,
      ]
    );
    userId = createdUser.rows[0].id;
  }

  await client.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, parentRoleId]
  );

  const parentProfile = await client.query(
    `
      INSERT INTO parents (
        school_id,
        user_id,
        occupation,
        guardian_name,
        father_name,
        mother_name,
        whatsapp_number,
        address_line,
        preferred_channel
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::notification_channel)
      ON CONFLICT (user_id)
      DO UPDATE SET
        occupation = COALESCE(EXCLUDED.occupation, parents.occupation),
        guardian_name = COALESCE(EXCLUDED.guardian_name, parents.guardian_name),
        father_name = COALESCE(EXCLUDED.father_name, parents.father_name),
        mother_name = COALESCE(EXCLUDED.mother_name, parents.mother_name),
        whatsapp_number = COALESCE(EXCLUDED.whatsapp_number, parents.whatsapp_number),
        address_line = COALESCE(EXCLUDED.address_line, parents.address_line),
        preferred_channel = COALESCE(EXCLUDED.preferred_channel, parents.preferred_channel),
        updated_at = NOW()
      RETURNING id
    `,
    [
      schoolId,
      userId,
      normalizeString(parentInput.occupation),
      normalizeString(parentInput.guardian_name) || normalizeString(parentInput.father_name),
      normalizeString(parentInput.father_name),
      normalizeString(parentInput.mother_name),
      whatsapp,
      normalizeString(parentInput.address_line),
      parentInput.preferred_channel || "in_app",
    ]
  );

  return parentProfile.rows[0].id;
}

async function ensureStudentsExistInSchool(schoolId, studentIds) {
  const uniqueIds = [...new Set(studentIds || [])];
  if (uniqueIds.length === 0) return;

  const rows = await pool.query(
    `
      SELECT id
      FROM students
      WHERE school_id = $1
        AND id = ANY($2::uuid[])
    `,
    [schoolId, uniqueIds]
  );

  if (rows.rowCount !== uniqueIds.length) {
    const found = new Set(rows.rows.map((row) => row.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new AppError(422, "VALIDATION_ERROR", `Unknown student ids: ${missing.join(", ")}`);
  }
}

async function getStudentAccessContext({ auth, studentId }) {
  const params = [auth.schoolId, studentId, auth.userId];
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
    params
  );

  const row = query.rows[0];
  if (!row?.student_exists) {
    throw new AppError(404, "NOT_FOUND", "Student not found");
  }

  let isHomeroomTeacher = false;
  let isSubjectTeacher = false;

  if (hasRole(auth, "teacher") && !isLeadership(auth)) {
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

  if (
    isLeadership(auth) ||
    hasRole(auth, "front_desk") ||
    hasRole(auth, "hr_admin") ||
    row.is_parent ||
    row.is_student_self ||
    row.is_homeroom_teacher ||
    row.is_subject_teacher ||
    row.is_headmistress_scope
  ) {
    return row;
  }

  throw new AppError(403, "FORBIDDEN", "No access to this student");
}

async function appendParentScope({ auth, params, where }) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "front_desk")
  ) {
    return;
  }

  if (hasRole(auth, "headmistress")) {
    params.push(auth.userId);
    where.push(`
      EXISTS (
        SELECT 1
        FROM parent_students ps
        JOIN student_enrollments se
          ON se.school_id = ps.school_id
         AND se.student_id = ps.student_id
         AND se.status = 'active'
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE ps.school_id = p.school_id
          AND ps.parent_id = p.id
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
    const teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });

    if (teacherClassroomIds.length === 0) {
      where.push("1 = 0");
      return;
    }

    params.push(teacherClassroomIds);
    where.push(`
      EXISTS (
        SELECT 1
        FROM parent_students ps
        JOIN student_enrollments se
          ON se.school_id = ps.school_id
         AND se.student_id = ps.student_id
         AND se.status = 'active'
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        WHERE ps.school_id = p.school_id
          AND ps.parent_id = p.id
          AND se.classroom_id = ANY($${params.length}::uuid[])
      )
    `);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No parent directory access for this role");
}

router.get(
  "/people/staff",
  requireAuth,
  requireRoles(...STAFF_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listStaffQuerySchema, req.query, "Invalid staff list query");

    const params = [req.auth.schoolId];
    const where = ["sp.school_id = $1"];

    if (query.staff_type) {
      params.push(query.staff_type);
      where.push(`sp.staff_type = $${params.length}`);
    }

    if (query.primary_section_id) {
      params.push(query.primary_section_id);
      where.push(`sp.primary_section_id = $${params.length}`);
    }

    if (query.employment_status) {
      params.push(query.employment_status);
      where.push(`sp.employment_status = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          u.first_name ILIKE $${params.length}
          OR COALESCE(u.last_name, '') ILIKE $${params.length}
          OR u.email ILIKE $${params.length}
          OR sp.staff_code ILIKE $${params.length}
          OR COALESCE(sp.designation, '') ILIKE $${params.length}
        )
      `);
    }

    if (hasRole(req.auth, "headmistress") && !isLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          sp.primary_section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = sp.school_id
              AND (
                ss.head_user_id = $${params.length}
                OR ss.coordinator_user_id = $${params.length}
              )
          )
          OR sp.user_id = $${params.length}
        )
      `);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM staff_profiles sp
        JOIN users u ON u.id = sp.user_id
        WHERE ${where.join(" AND ")}
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
          sp.id,
          sp.user_id,
          sp.staff_code,
          sp.staff_type,
          sp.designation,
          sp.employment_status,
          sp.joining_date,
          sp.reporting_manager_user_id,
          sp.primary_section_id,
          sp.id_document_no,
          sp.appointment_document_url,
          sp.policy_acknowledged_at,
          sp.metadata,
          sp.created_at,
          sp.updated_at,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.is_active,
          ss.name AS primary_section_name,
          COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), ARRAY[]::text[]) AS roles
        FROM staff_profiles sp
        JOIN users u
          ON u.id = sp.user_id
         AND u.school_id = sp.school_id
        LEFT JOIN school_sections ss
          ON ss.id = sp.primary_section_id
         AND ss.school_id = sp.school_id
        LEFT JOIN user_roles ur
          ON ur.user_id = sp.user_id
        LEFT JOIN roles r
          ON r.id = ur.role_id
        WHERE ${where.join(" AND ")}
        GROUP BY sp.id, u.id, ss.name
        ORDER BY sp.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, rows.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

router.get(
  "/people/staff/:staffId",
  requireAuth,
  requireRoles(...STAFF_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const params = [req.auth.schoolId, path.staffId];
    const where = ["sp.school_id = $1", "sp.id = $2"];

    if (hasRole(req.auth, "headmistress") && !isLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          sp.primary_section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = sp.school_id
              AND (
                ss.head_user_id = $${params.length}
                OR ss.coordinator_user_id = $${params.length}
              )
          )
          OR sp.user_id = $${params.length}
        )
      `);
    }

    const row = await pool.query(
      `
        SELECT
          sp.id,
          sp.user_id,
          sp.staff_code,
          sp.staff_type,
          sp.designation,
          sp.employment_status,
          sp.joining_date,
          sp.reporting_manager_user_id,
          sp.primary_section_id,
          sp.id_document_no,
          sp.appointment_document_url,
          sp.policy_acknowledged_at,
          sp.metadata,
          sp.created_at,
          sp.updated_at,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.is_active,
          ss.name AS primary_section_name,
          ss.code AS primary_section_code,
          COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), ARRAY[]::text[]) AS roles
        FROM staff_profiles sp
        JOIN users u
          ON u.id = sp.user_id
         AND u.school_id = sp.school_id
        LEFT JOIN school_sections ss
          ON ss.id = sp.primary_section_id
         AND ss.school_id = sp.school_id
        LEFT JOIN user_roles ur
          ON ur.user_id = sp.user_id
        LEFT JOIN roles r
          ON r.id = ur.role_id
        WHERE ${where.join(" AND ")}
        GROUP BY sp.id, u.id, ss.name, ss.code
        LIMIT 1
      `,
      params
    );

    if (!row.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    return success(res, row.rows[0], 200);
  })
);

router.post(
  "/people/staff",
  requireAuth,
  requireRoles(...STAFF_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createStaffSchema, req.body, "Invalid staff create payload");

    await ensureRolesExist(body.roles);
    await ensureUserInSchool(req.auth.schoolId, body.reporting_manager_user_id || null, "reporting_manager_user_id");
    await ensureSectionInSchool(req.auth.schoolId, body.primary_section_id || null, "primary_section_id");

    const passwordHash = await bcrypt.hash(body.temporary_password, 10);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const createdUser = await client.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, TRUE)
          RETURNING id, school_id, email, phone, first_name, last_name, is_active, created_at
        `,
        [
          req.auth.schoolId,
          body.email,
          body.phone || null,
          passwordHash,
          body.first_name,
          body.last_name || null,
        ]
      );

      const user = createdUser.rows[0];

      const roleRows = await client.query(
        `
          SELECT id, code
          FROM roles
          WHERE code = ANY($1::text[])
        `,
        [body.roles]
      );

      for (const role of roleRows.rows) {
        await client.query(
          `
            INSERT INTO user_roles (user_id, role_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [user.id, role.id]
        );
      }

      const createdStaff = await client.query(
        `
          INSERT INTO staff_profiles (
            school_id,
            user_id,
            staff_code,
            staff_type,
            designation,
            employment_status,
            joining_date,
            reporting_manager_user_id,
            primary_section_id,
            id_document_no,
            appointment_document_url,
            policy_acknowledged_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          user.id,
          body.staff_code,
          body.staff_type,
          body.designation || null,
          body.employment_status,
          body.joining_date || null,
          body.reporting_manager_user_id || null,
          body.primary_section_id || null,
          body.id_document_no || null,
          body.appointment_document_url || null,
          body.policy_acknowledged_at || null,
          JSON.stringify(body.metadata || {}),
        ]
      );

      await syncTeacherProjectionForStaffProfile(client, {
        schoolId: req.auth.schoolId,
        staffProfileId: createdStaff.rows[0].id,
      });

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "people.staff.created",
        entityName: "staff_profiles",
        entityId: createdStaff.rows[0].id,
        metadata: {
          user_id: user.id,
          roles: roleRows.rows.map((row) => row.code),
          staff_type: createdStaff.rows[0].staff_type,
          primary_section_id: createdStaff.rows[0].primary_section_id,
        },
      });

      return success(
        res,
        {
          user,
          staff: createdStaff.rows[0],
          roles: roleRows.rows.map((row) => row.code),
        },
        201
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Email or staff code already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.patch(
  "/people/staff/:staffId",
  requireAuth,
  requireRoles(...STAFF_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(updateStaffSchema, req.body, "Invalid staff update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const existing = await pool.query(
      `
        SELECT id, user_id, school_id
        FROM staff_profiles
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, req.params.staffId]
    );

    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    await ensureUserInSchool(req.auth.schoolId, body.reporting_manager_user_id || null, "reporting_manager_user_id");
    await ensureSectionInSchool(req.auth.schoolId, body.primary_section_id || null, "primary_section_id");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userValues = [req.auth.schoolId, existing.rows[0].user_id];
      const userSetClauses = [];

      if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
        userValues.push(body.first_name);
        userSetClauses.push(`first_name = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
        userValues.push(body.last_name);
        userSetClauses.push(`last_name = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "phone")) {
        userValues.push(body.phone);
        userSetClauses.push(`phone = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
        userValues.push(body.is_active);
        userSetClauses.push(`is_active = $${userValues.length}`);
      }

      if (userSetClauses.length > 0) {
        await client.query(
          `
            UPDATE users
            SET ${userSetClauses.join(", ")}, updated_at = NOW()
            WHERE school_id = $1
              AND id = $2
          `,
          userValues
        );
      }

      if (Array.isArray(body.roles)) {
        await ensureRolesExist(body.roles);

        await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [existing.rows[0].user_id]);

        const roleRows = await client.query(
          `
            SELECT id, code
            FROM roles
            WHERE code = ANY($1::text[])
          `,
          [body.roles]
        );

        for (const role of roleRows.rows) {
          await client.query(
            `
              INSERT INTO user_roles (user_id, role_id)
              VALUES ($1, $2)
            `,
            [existing.rows[0].user_id, role.id]
          );
        }

      }

      const staffValues = [req.auth.schoolId, req.params.staffId];
      const staffSetClauses = [];

      const staffFields = [
        "staff_type",
        "designation",
        "employment_status",
        "joining_date",
        "reporting_manager_user_id",
        "primary_section_id",
        "id_document_no",
        "appointment_document_url",
        "policy_acknowledged_at",
      ];

      for (const field of staffFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          staffValues.push(body[field]);
          staffSetClauses.push(`${field} = $${staffValues.length}`);
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "metadata")) {
        staffValues.push(JSON.stringify(body.metadata || {}));
        staffSetClauses.push(`metadata = $${staffValues.length}::jsonb`);
      }

      if (staffSetClauses.length > 0) {
        await client.query(
          `
            UPDATE staff_profiles
            SET ${staffSetClauses.join(", ")}, updated_at = NOW()
            WHERE school_id = $1
              AND id = $2
          `,
          staffValues
        );
      }

      await syncTeacherProjectionForStaffProfile(client, {
        schoolId: req.auth.schoolId,
        staffProfileId: existing.rows[0].id,
      });

      const updated = await client.query(
        `
          SELECT
            sp.*,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            u.is_active,
            COALESCE(array_remove(array_agg(DISTINCT r.code), NULL), ARRAY[]::text[]) AS roles
          FROM staff_profiles sp
          JOIN users u ON u.id = sp.user_id
          LEFT JOIN user_roles ur ON ur.user_id = sp.user_id
          LEFT JOIN roles r ON r.id = ur.role_id
          WHERE sp.school_id = $1
            AND sp.id = $2
          GROUP BY sp.id, u.id
          LIMIT 1
        `,
        [req.auth.schoolId, req.params.staffId]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "people.staff.updated",
        entityName: "staff_profiles",
        entityId: req.params.staffId,
        metadata: {
          updated_fields: Object.keys(body),
          roles_replaced: Array.isArray(body.roles),
          active_state_changed: Object.prototype.hasOwnProperty.call(body, "is_active"),
        },
      });

      return success(res, updated.rows[0], 200);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Duplicate values in staff update payload");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/me/students",
  requireAuth,
  requireRoles("parent", "student"),
  asyncHandler(async (req, res) => {
    let rows = [];

    if (hasRole(req.auth, "parent")) {
      const result = await pool.query(
        `
          SELECT
            s.id,
            s.student_code,
            s.first_name,
            s.last_name,
            ps.relation_type,
            ps.is_primary,
            se.classroom_id,
            c.grade_label,
            c.section_label,
            c.classroom_code,
            COALESCE(
              NULLIF(TRIM(CONCAT(ht_user.first_name, ' ', COALESCE(ht_user.last_name, ''))), ''),
              NULLIF(TRIM(CONCAT(class_teacher_user.first_name, ' ', COALESCE(class_teacher_user.last_name, ''))), '')
            ) AS class_teacher_name
          FROM parents p
          JOIN parent_students ps
            ON ps.parent_id = p.id
           AND ps.school_id = p.school_id
          JOIN students s
            ON s.id = ps.student_id
           AND s.school_id = ps.school_id
          LEFT JOIN LATERAL (
            SELECT
              se1.classroom_id
            FROM student_enrollments se1
            WHERE se1.school_id = s.school_id
              AND se1.student_id = s.id
              AND se1.status = 'active'
            ORDER BY se1.joined_on DESC NULLS LAST, se1.created_at DESC
            LIMIT 1
          ) se ON TRUE
          LEFT JOIN classrooms c
            ON c.id = se.classroom_id
           AND c.school_id = s.school_id
          LEFT JOIN teachers ht
            ON ht.id = c.homeroom_teacher_id
          LEFT JOIN users ht_user
            ON ht_user.id = ht.user_id
           AND ht_user.school_id = c.school_id
          LEFT JOIN LATERAL (
            SELECT
              sp.user_id
            FROM staff_classroom_assignments sca
            JOIN staff_profiles sp
              ON sp.id = sca.staff_profile_id
             AND sp.school_id = sca.school_id
            WHERE sca.school_id = c.school_id
              AND sca.classroom_id = c.id
              AND sca.is_active = TRUE
              AND sca.assignment_role = 'class_teacher'
            ORDER BY sca.created_at DESC
            LIMIT 1
          ) class_teacher_staff ON TRUE
          LEFT JOIN users class_teacher_user
            ON class_teacher_user.id = class_teacher_staff.user_id
           AND class_teacher_user.school_id = c.school_id
          WHERE p.school_id = $1
            AND p.user_id = $2
          ORDER BY ps.is_primary DESC, s.first_name ASC, s.last_name ASC NULLS LAST
        `,
        [req.auth.schoolId, req.auth.userId]
      );
      rows = result.rows;
    } else if (hasRole(req.auth, "student")) {
      const result = await pool.query(
        `
          SELECT
            s.id,
            s.student_code,
            s.first_name,
            s.last_name,
            'self'::text AS relation_type,
            TRUE AS is_primary,
            se.classroom_id,
            c.grade_label,
            c.section_label,
            c.classroom_code,
            COALESCE(
              NULLIF(TRIM(CONCAT(ht_user.first_name, ' ', COALESCE(ht_user.last_name, ''))), ''),
              NULLIF(TRIM(CONCAT(class_teacher_user.first_name, ' ', COALESCE(class_teacher_user.last_name, ''))), '')
            ) AS class_teacher_name
          FROM student_user_accounts sua
          JOIN students s
            ON s.id = sua.student_id
          LEFT JOIN LATERAL (
            SELECT
              se1.classroom_id
            FROM student_enrollments se1
            WHERE se1.school_id = s.school_id
              AND se1.student_id = s.id
              AND se1.status = 'active'
            ORDER BY se1.joined_on DESC NULLS LAST, se1.created_at DESC
            LIMIT 1
          ) se ON TRUE
          LEFT JOIN classrooms c
            ON c.id = se.classroom_id
           AND c.school_id = s.school_id
          LEFT JOIN teachers ht
            ON ht.id = c.homeroom_teacher_id
          LEFT JOIN users ht_user
            ON ht_user.id = ht.user_id
           AND ht_user.school_id = c.school_id
          LEFT JOIN LATERAL (
            SELECT
              sp.user_id
            FROM staff_classroom_assignments sca
            JOIN staff_profiles sp
              ON sp.id = sca.staff_profile_id
             AND sp.school_id = sca.school_id
            WHERE sca.school_id = c.school_id
              AND sca.classroom_id = c.id
              AND sca.is_active = TRUE
              AND sca.assignment_role = 'class_teacher'
            ORDER BY sca.created_at DESC
            LIMIT 1
          ) class_teacher_staff ON TRUE
          LEFT JOIN users class_teacher_user
            ON class_teacher_user.id = class_teacher_staff.user_id
           AND class_teacher_user.school_id = c.school_id
          WHERE s.school_id = $1
            AND sua.user_id = $2
          ORDER BY s.first_name ASC, s.last_name ASC NULLS LAST
        `,
        [req.auth.schoolId, req.auth.userId]
      );
      rows = result.rows;
    }

    const data = rows.map((row) => ({
      id: row.id,
      student_code: row.student_code,
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
      relation_type: row.relation_type,
      is_primary: Boolean(row.is_primary),
      classroom: row.classroom_id
        ? {
            classroom_id: row.classroom_id,
            grade_label: row.grade_label,
            section_label: row.section_label,
            classroom_code: row.classroom_code,
            display_name: `${row.grade_label} - ${row.section_label}`,
            class_teacher_name: row.class_teacher_name || null,
          }
        : null,
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/people/students",
  requireAuth,
  requireRoles(...STUDENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listStudentsQuerySchema, req.query, "Invalid student list query");

    const params = [req.auth.schoolId];
    const where = ["s.school_id = $1"];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`se.classroom_id = $${params.length}`);
    }

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`c.section_id = $${params.length}`);
    }

    if (query.status) {
      params.push(query.status);
      where.push(`s.status = $${params.length}`);
    }

    if (query.admission_status) {
      params.push(query.admission_status);
      where.push(`s.admission_status = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          s.student_code ILIKE $${params.length}
          OR s.first_name ILIKE $${params.length}
          OR COALESCE(s.last_name, '') ILIKE $${params.length}
        )
      `);
    }

    if (hasRole(req.auth, "teacher") && !isLeadership(req.auth)) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`se.classroom_id = ANY($${params.length}::uuid[])`);
      }
    }

    if (hasRole(req.auth, "headmistress") && !isLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        c.section_id IN (
          SELECT ss.id
          FROM school_sections ss
          WHERE ss.school_id = s.school_id
            AND (
              ss.head_user_id = $${params.length}
              OR ss.coordinator_user_id = $${params.length}
            )
        )
      `);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM students s
        LEFT JOIN student_enrollments se
          ON se.school_id = s.school_id
         AND se.student_id = s.id
         AND se.status = 'active'
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        WHERE ${where.join(" AND ")}
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
          s.id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.date_of_birth,
          s.gender,
          s.admission_date,
          s.admission_status,
          s.status,
          s.emergency_contact_name,
          s.emergency_contact_phone,
          s.medical_alert,
          s.transport_info,
          s.notes,
          se.classroom_id,
          se.roll_no,
          c.grade_label,
          c.section_label,
          c.classroom_code,
          c.section_id,
          ss.name AS section_name,
          ss.code AS section_code
        FROM students s
        LEFT JOIN student_enrollments se
          ON se.school_id = s.school_id
         AND se.student_id = s.id
         AND se.status = 'active'
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, rows.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

router.get(
  "/people/students/:studentId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");

    const isDetailRoleAllowed =
      STUDENT_VIEW_ROLES.some((role) => hasRole(req.auth, role)) ||
      STUDENT_DETAIL_EXTRA_ROLES.some((role) => hasRole(req.auth, role));
    if (!isDetailRoleAllowed) {
      throw new AppError(403, "FORBIDDEN", "No student detail permission for this role");
    }

    const access = await getStudentAccessContext({
      auth: req.auth,
      studentId: path.studentId,
    });

    const studentResult = await pool.query(
      `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.date_of_birth,
          s.gender,
          s.admission_date,
          s.admission_status,
          s.status,
          s.emergency_contact_name,
          s.emergency_contact_phone,
          s.medical_alert,
          s.transport_info,
          s.notes,
          se.classroom_id,
          se.academic_year_id,
          se.roll_no,
          se.joined_on,
          c.grade_label,
          c.section_label,
          c.classroom_code,
          c.section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          ay.name AS academic_year_name
        FROM students s
        LEFT JOIN student_enrollments se
          ON se.school_id = s.school_id
         AND se.student_id = s.id
         AND se.status = 'active'
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        LEFT JOIN academic_years ay
          ON ay.id = se.academic_year_id
         AND ay.school_id = se.school_id
        WHERE s.school_id = $1
          AND s.id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.studentId]
    );

    const row = studentResult.rows[0];
    if (!row) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }

    const canViewSensitive = canViewStudentSensitiveProfile(req.auth, access);
    const parentLinks = await pool.query(
      `
        SELECT
          ps.parent_id,
          ps.relation_type,
          ps.is_primary,
          p.user_id AS parent_user_id,
          to_jsonb(p)->>'guardian_name' AS guardian_name,
          to_jsonb(p)->>'father_name' AS father_name,
          to_jsonb(p)->>'mother_name' AS mother_name,
          to_jsonb(p)->>'whatsapp_number' AS whatsapp_number,
          u.first_name,
          u.last_name,
          u.email,
          u.phone
        FROM parent_students ps
        JOIN parents p
          ON p.id = ps.parent_id
         AND p.school_id = ps.school_id
        JOIN users u
          ON u.id = p.user_id
         AND u.school_id = p.school_id
        WHERE ps.school_id = $1
          AND ps.student_id = $2
        ORDER BY ps.is_primary DESC, u.first_name ASC
      `,
      [req.auth.schoolId, path.studentId]
    );

    const parents = parentLinks.rows.map((parent) => ({
      id: parent.parent_id,
      user_id: parent.parent_user_id,
      relation_type: parent.relation_type,
      is_primary: parent.is_primary,
      guardian_name: parent.guardian_name,
      father_name: parent.father_name,
      mother_name: parent.mother_name,
      first_name: parent.first_name,
      last_name: parent.last_name,
      email: canViewParentContacts(req.auth) ? parent.email : null,
      phone: canViewParentContacts(req.auth) ? parent.phone : null,
      whatsapp_number: canViewParentContacts(req.auth) ? parent.whatsapp_number : null,
    }));

    const student = {
      id: row.id,
      student_code: row.student_code,
      first_name: row.first_name,
      last_name: row.last_name,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      admission_date: row.admission_date,
      admission_status: row.admission_status,
      status: row.status,
      transport_info: row.transport_info,
      notes: row.notes,
      emergency_contact_name: canViewSensitive ? row.emergency_contact_name : null,
      emergency_contact_phone: canViewSensitive ? row.emergency_contact_phone : null,
      medical_alert: canViewSensitive ? row.medical_alert : null,
    };

    return success(
      res,
      {
        student,
        enrollment: row.classroom_id
          ? {
              classroom_id: row.classroom_id,
              academic_year_id: row.academic_year_id,
              roll_no: row.roll_no,
              joined_on: row.joined_on,
              classroom: {
                grade_label: row.grade_label,
                section_label: row.section_label,
                classroom_code: row.classroom_code,
                display_name: `${row.grade_label} - ${row.section_label}`,
              },
              section: row.section_id
                ? {
                    id: row.section_id,
                    name: row.section_name,
                    code: row.section_code,
                  }
                : null,
              academic_year_name: row.academic_year_name,
            }
          : null,
        parents,
      },
      200
    );
  })
);

router.post(
  "/people/students",
  requireAuth,
  requireRoles(...STUDENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createStudentSchema, req.body, "Invalid student create payload");
    if (body.parent_user_id && body.parent) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Provide either parent_user_id or parent payload, not both"
      );
    }

    const classroom = await ensureClassroomInSchool(req.auth.schoolId, body.classroom_id || null);

    let academicYearId = body.academic_year_id || null;
    if (academicYearId) {
      await ensureAcademicYearInSchool(req.auth.schoolId, academicYearId);
    } else if (classroom?.academic_year_id) {
      academicYearId = classroom.academic_year_id;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const studentInsert = await client.query(
        `
          INSERT INTO students (
            school_id,
            student_code,
            first_name,
            last_name,
            date_of_birth,
            gender,
            admission_date,
            status,
            admission_status,
            emergency_contact_name,
            emergency_contact_phone,
            medical_alert,
            transport_info,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          body.student_code,
          body.first_name,
          body.last_name || null,
          body.date_of_birth || null,
          body.gender || null,
          body.admission_date || null,
          body.status,
          body.admission_status,
          body.emergency_contact_name || null,
          body.emergency_contact_phone || null,
          body.medical_alert || null,
          body.transport_info || null,
          body.notes || null,
        ]
      );

      const student = studentInsert.rows[0];

      if (classroom && academicYearId) {
        await client.query(
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
            VALUES ($1, $2, $3, $4, $5, 'active', COALESCE($6::date, CURRENT_DATE))
          `,
          [
            req.auth.schoolId,
            student.id,
            classroom.id,
            academicYearId,
            body.roll_no || null,
            body.admission_date || null,
          ]
        );
      }

      let parentId = null;
      if (body.parent_user_id) {
        parentId = await resolveParentIdByUser(req.auth.schoolId, body.parent_user_id || null);
      } else if (body.parent) {
        const parentRoleId = await getParentRoleIdFromClient(client);
        parentId = await ensureOrCreateParentAccountForStudent({
          client,
          schoolId: req.auth.schoolId,
          parentInput: body.parent,
          parentRoleId,
        });
      }

      if (parentId) {
        await client.query(
          `
            INSERT INTO parent_students (
              school_id,
              parent_id,
              student_id,
              relation_type,
              is_primary
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (parent_id, student_id)
            DO UPDATE SET
              relation_type = EXCLUDED.relation_type,
              is_primary = EXCLUDED.is_primary
          `,
          [
            req.auth.schoolId,
            parentId,
            student.id,
            body.parent?.relation_type || body.relation_type,
            body.parent?.is_primary ?? body.is_primary_parent,
          ]
        );
      }

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "people.student.created",
        entityName: "students",
        entityId: student.id,
        metadata: {
          admission_status: student.admission_status,
          enrollment_classroom_id: classroom?.id || null,
          enrollment_academic_year_id: academicYearId || null,
          parent_linked: Boolean(parentId),
          parent_creation_mode: body.parent ? "inline_payload" : body.parent_user_id ? "existing_parent_user" : "none",
        },
      });

      return success(
        res,
        {
          student,
          enrollment: classroom
            ? {
                classroom_id: classroom.id,
                academic_year_id: academicYearId,
                roll_no: body.roll_no || null,
              }
            : null,
          parent_linked: Boolean(parentId),
          parent_id: parentId,
        },
        201
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Student code or enrollment already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/parents",
  requireAuth,
  requireRoles(...PARENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listParentsQuerySchema, req.query, "Invalid parent list query");

    const params = [req.auth.schoolId];
    const where = ["p.school_id = $1"];

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          COALESCE(to_jsonb(p)->>'guardian_name', '') ILIKE $${params.length}
          OR COALESCE(to_jsonb(p)->>'father_name', '') ILIKE $${params.length}
          OR COALESCE(to_jsonb(p)->>'mother_name', '') ILIKE $${params.length}
          OR u.first_name ILIKE $${params.length}
          OR COALESCE(u.last_name, '') ILIKE $${params.length}
          OR u.email ILIKE $${params.length}
          OR COALESCE(u.phone, '') ILIKE $${params.length}
        )
      `);
    }

    if (query.student_id) {
      params.push(query.student_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          WHERE ps.school_id = p.school_id
            AND ps.parent_id = p.id
            AND ps.student_id = $${params.length}
        )
      `);
    }

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN student_enrollments se
            ON se.school_id = ps.school_id
           AND se.student_id = ps.student_id
           AND se.status = 'active'
          WHERE ps.school_id = p.school_id
            AND ps.parent_id = p.id
            AND se.classroom_id = $${params.length}
        )
      `);
    }

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN student_enrollments se
            ON se.school_id = ps.school_id
           AND se.student_id = ps.student_id
           AND se.status = 'active'
          JOIN classrooms c
            ON c.id = se.classroom_id
           AND c.school_id = se.school_id
          WHERE ps.school_id = p.school_id
            AND ps.parent_id = p.id
            AND c.section_id = $${params.length}
        )
      `);
    }

    await appendParentScope({
      auth: req.auth,
      params,
      where,
    });

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM parents p
        JOIN users u
          ON u.id = p.user_id
         AND u.school_id = p.school_id
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          p.id,
          p.user_id,
          p.occupation,
          to_jsonb(p)->>'guardian_name' AS guardian_name,
          to_jsonb(p)->>'father_name' AS father_name,
          to_jsonb(p)->>'mother_name' AS mother_name,
          to_jsonb(p)->>'whatsapp_number' AS whatsapp_number,
          to_jsonb(p)->>'address_line' AS address_line,
          to_jsonb(p)->>'preferred_channel' AS preferred_channel,
          p.created_at,
          p.updated_at,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.is_active,
          u.last_login_at,
          (
            SELECT COUNT(*)::int
            FROM parent_students ps
            WHERE ps.school_id = p.school_id
              AND ps.parent_id = p.id
          ) AS linked_students_count
        FROM parents p
        JOIN users u
          ON u.id = p.user_id
         AND u.school_id = p.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY p.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const revealContacts = canViewParentContacts(req.auth);
    const data = rowsResult.rows.map((row) => ({
      ...row,
      email: revealContacts ? row.email : null,
      phone: revealContacts ? row.phone : null,
      whatsapp_number: revealContacts ? row.whatsapp_number : null,
      address_line: revealContacts ? row.address_line : null,
    }));

    return success(res, data, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

router.post(
  "/people/parents",
  requireAuth,
  requireRoles(...PARENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createParentSchema, req.body, "Invalid parent create payload");
    await ensureStudentsExistInSchool(
      req.auth.schoolId,
      body.linked_students.map((link) => link.student_id)
    );

    const roleId = await getParentRoleId();
    const passwordHash = await bcrypt.hash(body.temporary_password, 10);
    const fallbackEmail = `parent.${Date.now()}.${Math.floor(Math.random() * 1000)}@agora.local`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userInsert = await client.query(
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
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, email, phone, first_name, last_name, is_active, last_login_at, created_at
        `,
        [
          req.auth.schoolId,
          body.email || fallbackEmail,
          body.phone || null,
          passwordHash,
          body.first_name,
          body.last_name || null,
          body.is_active,
        ]
      );
      const user = userInsert.rows[0];

      await client.query(
        `
          INSERT INTO user_roles (user_id, role_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [user.id, roleId]
      );

      const parentInsert = await client.query(
        `
          INSERT INTO parents (
            school_id,
            user_id,
            occupation,
            guardian_name,
            father_name,
            mother_name,
            whatsapp_number,
            address_line,
            preferred_channel
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::notification_channel)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          user.id,
          body.occupation || null,
          body.guardian_name || null,
          body.father_name || null,
          body.mother_name || null,
          body.whatsapp_number || null,
          body.address_line || null,
          body.preferred_channel,
        ]
      );
      const parent = parentInsert.rows[0];

      for (const link of body.linked_students) {
        await client.query(
          `
            INSERT INTO parent_students (
              school_id,
              parent_id,
              student_id,
              relation_type,
              is_primary
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (parent_id, student_id)
            DO UPDATE SET
              relation_type = EXCLUDED.relation_type,
              is_primary = EXCLUDED.is_primary
          `,
          [
            req.auth.schoolId,
            parent.id,
            link.student_id,
            link.relation_type,
            link.is_primary,
          ]
        );
      }

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "people.parent.created",
        entityName: "parents",
        entityId: parent.id,
        metadata: {
          user_id: user.id,
          linked_students_count: body.linked_students.length,
        },
      });

      return success(
        res,
        {
          ...parent,
          user: {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            phone: canViewParentContacts(req.auth) ? user.phone : null,
            is_active: user.is_active,
            last_login_at: user.last_login_at,
          },
          linked_students: body.linked_students,
        },
        201
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Parent email, phone, or link already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/parents/:parentId",
  requireAuth,
  requireRoles(...PARENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(parentPathSchema, req.params, "Invalid parent id");

    const params = [req.auth.schoolId, path.parentId];
    const where = ["p.school_id = $1", "p.id = $2"];
    await appendParentScope({
      auth: req.auth,
      params,
      where,
    });

    const parentResult = await pool.query(
      `
        SELECT
          p.id,
          p.user_id,
          p.occupation,
          to_jsonb(p)->>'guardian_name' AS guardian_name,
          to_jsonb(p)->>'father_name' AS father_name,
          to_jsonb(p)->>'mother_name' AS mother_name,
          to_jsonb(p)->>'whatsapp_number' AS whatsapp_number,
          to_jsonb(p)->>'address_line' AS address_line,
          to_jsonb(p)->>'preferred_channel' AS preferred_channel,
          p.created_at,
          p.updated_at,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.is_active,
          u.last_login_at
        FROM parents p
        JOIN users u
          ON u.id = p.user_id
         AND u.school_id = p.school_id
        WHERE ${where.join(" AND ")}
        LIMIT 1
      `,
      params
    );

    const parent = parentResult.rows[0];
    if (!parent) {
      throw new AppError(404, "NOT_FOUND", "Parent not found");
    }

    const linkedStudents = await pool.query(
      `
        SELECT
          ps.student_id,
          ps.relation_type,
          ps.is_primary,
          s.student_code,
          s.first_name,
          s.last_name,
          s.status,
          se.classroom_id,
          c.grade_label,
          c.section_label
        FROM parent_students ps
        JOIN students s
          ON s.id = ps.student_id
         AND s.school_id = ps.school_id
        LEFT JOIN student_enrollments se
          ON se.school_id = s.school_id
         AND se.student_id = s.id
         AND se.status = 'active'
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        WHERE ps.school_id = $1
          AND ps.parent_id = $2
        ORDER BY ps.is_primary DESC, s.first_name ASC
      `,
      [req.auth.schoolId, path.parentId]
    );

    const revealContacts = canViewParentContacts(req.auth);
    const data = {
      ...parent,
      email: revealContacts ? parent.email : null,
      phone: revealContacts ? parent.phone : null,
      whatsapp_number: revealContacts ? parent.whatsapp_number : null,
      address_line: revealContacts ? parent.address_line : null,
      linked_students: linkedStudents.rows.map((row) => ({
        student_id: row.student_id,
        student_code: row.student_code,
        student_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
        relation_type: row.relation_type,
        is_primary: row.is_primary,
        status: row.status,
        classroom: row.classroom_id
          ? {
              classroom_id: row.classroom_id,
              grade_label: row.grade_label,
              section_label: row.section_label,
              display_name: `${row.grade_label} - ${row.section_label}`,
            }
          : null,
      })),
    };

    return success(res, data, 200);
  })
);

router.patch(
  "/people/parents/:parentId",
  requireAuth,
  requireRoles(...PARENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(parentPathSchema, req.params, "Invalid parent id");
    const body = parseSchema(updateParentSchema, req.body, "Invalid parent update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const existing = await pool.query(
      `
        SELECT p.id, p.user_id
        FROM parents p
        WHERE p.school_id = $1
          AND p.id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.parentId]
    );

    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Parent not found");
    }

    if (Array.isArray(body.linked_students)) {
      await ensureStudentsExistInSchool(
        req.auth.schoolId,
        body.linked_students.map((link) => link.student_id)
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userValues = [req.auth.schoolId, existing.rows[0].user_id];
      const userSetClauses = [];

      if (Object.prototype.hasOwnProperty.call(body, "first_name")) {
        userValues.push(body.first_name);
        userSetClauses.push(`first_name = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "last_name")) {
        userValues.push(body.last_name);
        userSetClauses.push(`last_name = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "email")) {
        userValues.push(body.email);
        userSetClauses.push(`email = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "phone")) {
        userValues.push(body.phone);
        userSetClauses.push(`phone = $${userValues.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
        userValues.push(body.is_active);
        userSetClauses.push(`is_active = $${userValues.length}`);
      }

      if (userSetClauses.length > 0) {
        await client.query(
          `
            UPDATE users
            SET ${userSetClauses.join(", ")}, updated_at = NOW()
            WHERE school_id = $1
              AND id = $2
          `,
          userValues
        );
      }

      const parentValues = [req.auth.schoolId, path.parentId];
      const parentSetClauses = [];
      const parentFields = [
        "occupation",
        "guardian_name",
        "father_name",
        "mother_name",
        "whatsapp_number",
        "address_line",
        "preferred_channel",
      ];

      for (const field of parentFields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
          parentValues.push(body[field]);
          if (field === "preferred_channel") {
            parentSetClauses.push(`${field} = $${parentValues.length}::notification_channel`);
          } else {
            parentSetClauses.push(`${field} = $${parentValues.length}`);
          }
        }
      }

      if (parentSetClauses.length > 0) {
        await client.query(
          `
            UPDATE parents
            SET ${parentSetClauses.join(", ")}, updated_at = NOW()
            WHERE school_id = $1
              AND id = $2
          `,
          parentValues
        );
      }

      if (Array.isArray(body.linked_students)) {
        await client.query(
          `
            DELETE FROM parent_students
            WHERE school_id = $1
              AND parent_id = $2
          `,
          [req.auth.schoolId, path.parentId]
        );

        for (const link of body.linked_students) {
          await client.query(
            `
              INSERT INTO parent_students (
                school_id,
                parent_id,
                student_id,
                relation_type,
                is_primary
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              req.auth.schoolId,
              path.parentId,
              link.student_id,
              link.relation_type,
              link.is_primary,
            ]
          );
        }
      }

      const updated = await client.query(
        `
          SELECT
            p.id,
            p.user_id,
            p.occupation,
            to_jsonb(p)->>'guardian_name' AS guardian_name,
            to_jsonb(p)->>'father_name' AS father_name,
            to_jsonb(p)->>'mother_name' AS mother_name,
            to_jsonb(p)->>'whatsapp_number' AS whatsapp_number,
            to_jsonb(p)->>'address_line' AS address_line,
            to_jsonb(p)->>'preferred_channel' AS preferred_channel,
            p.created_at,
            p.updated_at,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            u.is_active,
            u.last_login_at
          FROM parents p
          JOIN users u
            ON u.id = p.user_id
           AND u.school_id = p.school_id
          WHERE p.school_id = $1
            AND p.id = $2
          LIMIT 1
        `,
        [req.auth.schoolId, path.parentId]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "people.parent.updated",
        entityName: "parents",
        entityId: path.parentId,
        metadata: {
          updated_fields: Object.keys(body),
          links_replaced: Array.isArray(body.linked_students),
        },
      });

      const revealContacts = canViewParentContacts(req.auth);
      return success(
        res,
        {
          ...updated.rows[0],
          email: revealContacts ? updated.rows[0]?.email : null,
          phone: revealContacts ? updated.rows[0]?.phone : null,
          whatsapp_number: revealContacts ? updated.rows[0]?.whatsapp_number : null,
          address_line: revealContacts ? updated.rows[0]?.address_line : null,
        },
        200
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Duplicate email, phone, or parent linkage");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/students/:studentId/timeline",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");
    const query = parseSchema(timelineQuerySchema, req.query, "Invalid student timeline query");

    const isDetailRoleAllowed =
      STUDENT_VIEW_ROLES.some((role) => hasRole(req.auth, role)) ||
      STUDENT_DETAIL_EXTRA_ROLES.some((role) => hasRole(req.auth, role));
    if (!isDetailRoleAllowed) {
      throw new AppError(403, "FORBIDDEN", "No student timeline permission for this role");
    }

    await getStudentAccessContext({ auth: req.auth, studentId: path.studentId });

    const params = [req.auth.schoolId, path.studentId];
    const dateWhere = [];
    if (query.date_from) {
      params.push(query.date_from);
      dateWhere.push(`event_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      dateWhere.push(`event_date <= $${params.length}`);
    }
    const dateClause = dateWhere.length > 0 ? `AND ${dateWhere.join(" AND ")}` : "";

    params.push(query.max_events);
    const timelineResult = await pool.query(
      `
        SELECT *
        FROM (
          SELECT
            ar.attendance_date AS event_date,
            COALESCE(ar.check_in_at, ar.created_at) AS event_time,
            'attendance'::text AS event_type,
            jsonb_build_object(
              'status', ar.status,
              'check_in_at', ar.check_in_at,
              'source', ar.source,
              'note', ar.note
            ) AS payload
          FROM attendance_records ar
          WHERE ar.school_id = $1
            AND ar.student_id = $2

          UNION ALL

          SELECT
            h.assigned_at::date AS event_date,
            h.assigned_at AS event_time,
            'homework_assigned'::text AS event_type,
            jsonb_build_object(
              'homework_id', h.id,
              'title', h.title,
              'subject_id', h.subject_id,
              'due_at', h.due_at
            ) AS payload
          FROM homework h
          JOIN student_enrollments se
            ON se.school_id = h.school_id
           AND se.classroom_id = h.classroom_id
           AND se.student_id = $2
           AND se.status = 'active'
          WHERE h.school_id = $1

          UNION ALL

          SELECT
            a.assessment_date AS event_date,
            COALESCE(a.assessment_date::timestamptz, a.created_at) AS event_time,
            'assessment_score'::text AS event_type,
            jsonb_build_object(
              'assessment_id', a.id,
              'title', a.title,
              'assessment_type', a.assessment_type,
              'marks_obtained', sc.marks_obtained,
              'max_marks', a.max_marks
            ) AS payload
          FROM assessment_scores sc
          JOIN assessments a
            ON a.id = sc.assessment_id
           AND a.school_id = sc.school_id
          WHERE sc.school_id = $1
            AND sc.student_id = $2

          UNION ALL

          SELECT
            fi.due_date AS event_date,
            fi.created_at AS event_time,
            'fee_invoice'::text AS event_type,
            jsonb_build_object(
              'invoice_id', fi.id,
              'status', fi.status,
              'amount_due', fi.amount_due,
              'amount_paid', fi.amount_paid,
              'due_date', fi.due_date
            ) AS payload
          FROM fee_invoices fi
          WHERE fi.school_id = $1
            AND fi.student_id = $2
        ) timeline
        WHERE TRUE
          ${dateClause}
        ORDER BY event_time DESC NULLS LAST
        LIMIT $${params.length}
      `,
      params
    );

    return success(
      res,
      {
        student_id: path.studentId,
        events: timelineResult.rows.map((row) => ({
          type: row.event_type,
          date: row.event_date,
          time: row.event_time,
          data: row.payload,
        })),
      },
      200
    );
  })
);

router.get(
  "/people/students/:studentId/academic-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");

    const isDetailRoleAllowed =
      STUDENT_VIEW_ROLES.some((role) => hasRole(req.auth, role)) ||
      STUDENT_DETAIL_EXTRA_ROLES.some((role) => hasRole(req.auth, role));
    if (!isDetailRoleAllowed) {
      throw new AppError(403, "FORBIDDEN", "No academic summary permission for this role");
    }

    await getStudentAccessContext({ auth: req.auth, studentId: path.studentId });

    const attendanceSummary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_days,
          COUNT(*) FILTER (WHERE status = 'present'::attendance_status)::int AS present_count,
          COUNT(*) FILTER (WHERE status = 'absent'::attendance_status)::int AS absent_count,
          COUNT(*) FILTER (WHERE status = 'late'::attendance_status)::int AS late_count,
          COUNT(*) FILTER (WHERE status = 'leave'::attendance_status)::int AS leave_count
        FROM attendance_records
        WHERE school_id = $1
          AND student_id = $2
      `,
      [req.auth.schoolId, path.studentId]
    );

    const homeworkSummary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_assigned,
          COUNT(*) FILTER (
            WHERE COALESCE(hs.status, 'assigned'::homework_submission_status)
              IN ('submitted'::homework_submission_status, 'reviewed'::homework_submission_status)
          )::int AS submitted_count
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.student_id = $2
         AND se.status = 'active'
        LEFT JOIN homework_submissions hs
          ON hs.school_id = h.school_id
         AND hs.homework_id = h.id
         AND hs.student_id = se.student_id
        WHERE h.school_id = $1
      `,
      [req.auth.schoolId, path.studentId]
    );

    const marksSummary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS score_count,
          COUNT(DISTINCT sc.assessment_id)::int AS assessment_count,
          COALESCE(AVG((sc.marks_obtained / NULLIF(a.max_marks, 0)) * 100), 0)::numeric AS average_percentage
        FROM assessment_scores sc
        JOIN assessments a
          ON a.id = sc.assessment_id
         AND a.school_id = sc.school_id
        WHERE sc.school_id = $1
          AND sc.student_id = $2
      `,
      [req.auth.schoolId, path.studentId]
    );

    const canViewFeeSummary =
      hasRole(req.auth, "school_admin") ||
      hasRole(req.auth, "principal") ||
      hasRole(req.auth, "vice_principal") ||
      hasRole(req.auth, "accountant") ||
      hasRole(req.auth, "parent") ||
      hasRole(req.auth, "student");

    let feeSummary = null;
    if (canViewFeeSummary) {
      const feeResult = await pool.query(
        `
          SELECT
            COALESCE(SUM(amount_due), 0)::numeric AS total_due,
            COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
            COALESCE(SUM(amount_due - amount_paid), 0)::numeric AS outstanding,
            COUNT(*) FILTER (
              WHERE amount_paid < amount_due
                AND due_date < CURRENT_DATE
                AND status IN (
                  'issued'::invoice_status,
                  'partial'::invoice_status,
                  'overdue'::invoice_status
                )
            )::int AS overdue_count
          FROM fee_invoices
          WHERE school_id = $1
            AND student_id = $2
        `,
        [req.auth.schoolId, path.studentId]
      );
      feeSummary = {
        total_due: Number(feeResult.rows[0]?.total_due || 0),
        total_paid: Number(feeResult.rows[0]?.total_paid || 0),
        outstanding: Number(feeResult.rows[0]?.outstanding || 0),
        overdue_count: Number(feeResult.rows[0]?.overdue_count || 0),
      };
    }

    const attendance = attendanceSummary.rows[0] || {};
    const totalDays = Number(attendance.total_days || 0);
    const homework = homeworkSummary.rows[0] || {};

    const data = {
      student_id: path.studentId,
      attendance_summary: {
        total_days: totalDays,
        present: Number(attendance.present_count || 0),
        absent: Number(attendance.absent_count || 0),
        late: Number(attendance.late_count || 0),
        leave: Number(attendance.leave_count || 0),
        rate:
          totalDays > 0
            ? Number((((Number(attendance.present_count || 0) * 100) / totalDays)).toFixed(2))
            : 0,
      },
      homework_summary: {
        total_assigned: Number(homework.total_assigned || 0),
        submitted: Number(homework.submitted_count || 0),
        completion_rate:
          Number(homework.total_assigned || 0) > 0
            ? Number(
                (
                  (Number(homework.submitted_count || 0) * 100) /
                  Number(homework.total_assigned || 0)
                ).toFixed(2)
              )
            : 0,
      },
      marks_summary: {
        score_count: Number(marksSummary.rows[0]?.score_count || 0),
        assessment_count: Number(marksSummary.rows[0]?.assessment_count || 0),
        average_percentage: Number(Number(marksSummary.rows[0]?.average_percentage || 0).toFixed(2)),
      },
      fee_summary: feeSummary,
      generated_at: new Date().toISOString(),
    };

    return success(res, data, 200);
  })
);

module.exports = router;
