const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { ensureTeacherProjectionForUser } = require("../utils/teacher-projection");
const { listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const PROFILE_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "accountant",
  "front_desk",
  "hr_admin",
];

const PROFILE_MANAGE_ROLES = ["school_admin", "principal", "vice_principal"];
const SECTION_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];
const CLASSROOM_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    timezone: z.string().trim().min(2).max(120).optional(),
    logo_url: z.string().trim().url().max(1000).optional(),
    branch_name: z.string().trim().min(1).max(160).optional(),
    address_line: z.string().trim().min(1).max(300).optional(),
    contact_phone: z.string().trim().min(3).max(60).optional(),
    contact_email: z.string().trim().email().max(160).optional(),
    academic_year_label: z.string().trim().min(2).max(60).optional(),
    school_starts_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    school_ends_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    weekly_holidays: z.array(z.string().trim().min(2).max(30)).max(7).optional(),
    late_arrival_cutoff: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    attendance_rules: z.record(z.any()).optional(),
    principal_user_id: z.string().uuid().nullable().optional(),
    vice_principal_user_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const sectionsListSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const sectionCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(24),
  section_type: z
    .enum(["pre_school", "junior", "middle", "senior", "high_school", "general"])
    .default("general"),
  head_user_id: z.string().uuid().nullable().optional(),
  coordinator_user_id: z.string().uuid().nullable().optional(),
  display_order: z.coerce.number().int().min(0).max(500).default(0),
  announcements_enabled: z.boolean().default(true),
  is_active: z.boolean().default(true),
  metadata: z.record(z.any()).default({}),
});

const sectionUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    code: z.string().trim().min(2).max(24).optional(),
    section_type: z.enum(["pre_school", "junior", "middle", "senior", "high_school", "general"]).optional(),
    head_user_id: z.string().uuid().nullable().optional(),
    coordinator_user_id: z.string().uuid().nullable().optional(),
    display_order: z.coerce.number().int().min(0).max(500).optional(),
    announcements_enabled: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

const classroomListSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  section_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const classroomCreateSchema = z.object({
  academic_year_id: z.string().uuid(),
  grade_label: z.string().trim().min(1).max(80),
  section_label: z.string().trim().min(1).max(80),
  section_id: z.string().uuid().nullable().optional(),
  classroom_code: z.string().trim().min(1).max(30).nullable().optional(),
  room_number: z.string().trim().min(1).max(30).nullable().optional(),
  homeroom_teacher_user_id: z.string().uuid().nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
  is_active: z.boolean().default(true),
});

const classroomUpdateSchema = z
  .object({
    grade_label: z.string().trim().min(1).max(80).optional(),
    section_label: z.string().trim().min(1).max(80).optional(),
    section_id: z.string().uuid().nullable().optional(),
    classroom_code: z.string().trim().min(1).max(30).nullable().optional(),
    room_number: z.string().trim().min(1).max(30).nullable().optional(),
    homeroom_teacher_user_id: z.string().uuid().nullable().optional(),
    capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const academicYearPathSchema = z.object({
  id: z.string().uuid(),
});

const sectionDashboardQuerySchema = z.object({
  section_id: z.string().uuid().optional(),
  include_detail: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
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

function isSchoolLeadership(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "super_admin")
  );
}

async function assertUserInSchool(schoolId, userId, fieldName) {
  if (!userId) return;
  const check = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1 AND id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );

  if (!check.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
}

async function resolveTeacherIdByUser(schoolId, userId) {
  if (!userId) return null;
  const teacher = await ensureTeacherProjectionForUser({
    schoolId,
    userId,
    roles: ["teacher"],
  });

  if (!teacher?.id) {
    throw new AppError(422, "VALIDATION_ERROR", "Homeroom teacher user must have teacher profile");
  }

  return teacher.id;
}

async function assertSectionVisibleToHm({ auth, sectionId }) {
  if (!sectionId || isSchoolLeadership(auth)) return;
  if (!hasRole(auth, "headmistress")) return;

  const check = await pool.query(
    `
      SELECT ss.id
      FROM school_sections ss
      WHERE ss.school_id = $1
        AND ss.id = $2
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
      LIMIT 1
    `,
    [auth.schoolId, sectionId, auth.userId]
  );

  if (!check.rows[0]) {
    throw new AppError(403, "FORBIDDEN", "Headmistress scope does not include this section");
  }
}

async function fetchSchoolProfile(schoolId) {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.code,
        s.name,
        s.timezone,
        s.is_active,
        s.logo_url,
        s.branch_name,
        s.address_line,
        s.contact_phone,
        s.contact_email,
        s.academic_year_label,
        s.school_starts_at,
        s.school_ends_at,
        s.weekly_holidays,
        s.late_arrival_cutoff,
        s.attendance_rules,
        s.principal_user_id,
        s.vice_principal_user_id,
        pu.first_name AS principal_first_name,
        pu.last_name AS principal_last_name,
        pu.email AS principal_email,
        vu.first_name AS vice_principal_first_name,
        vu.last_name AS vice_principal_last_name,
        vu.email AS vice_principal_email,
        (
          SELECT COUNT(*)::int
          FROM school_sections ss
          WHERE ss.school_id = s.id
            AND ss.is_active = TRUE
        ) AS active_sections,
        (
          SELECT COUNT(*)::int
          FROM classrooms c
          WHERE c.school_id = s.id
            AND c.is_active = TRUE
        ) AS active_classrooms,
        (
          SELECT COUNT(*)::int
          FROM staff_profiles sp
          WHERE sp.school_id = s.id
            AND sp.employment_status = 'active'
        ) AS active_staff,
        (
          SELECT COUNT(*)::int
          FROM students st
          WHERE st.school_id = s.id
            AND st.status = 'active'
        ) AS active_students
      FROM schools s
      LEFT JOIN users pu ON pu.id = s.principal_user_id
      LEFT JOIN users vu ON vu.id = s.vice_principal_user_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [schoolId]
  );

  return result.rows[0] || null;
}

router.get(
  "/institution/profile",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const profile = await fetchSchoolProfile(req.auth.schoolId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "School profile not found");
    }

    return success(res, profile, 200);
  })
);

router.patch(
  "/institution/profile",
  requireAuth,
  requireRoles(...PROFILE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(profileUpdateSchema, req.body, "Invalid institution profile update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    if (Object.prototype.hasOwnProperty.call(body, "principal_user_id") && body.principal_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.principal_user_id, "principal_user_id");
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "vice_principal_user_id") &&
      body.vice_principal_user_id
    ) {
      await assertUserInSchool(
        req.auth.schoolId,
        body.vice_principal_user_id,
        "vice_principal_user_id"
      );
    }

    const values = [req.auth.schoolId];
    const setClauses = [];

    for (const [key, value] of entries) {
      values.push(key === "attendance_rules" ? JSON.stringify(value || {}) : value);
      if (key === "attendance_rules") {
        setClauses.push(`${key} = $${values.length}::jsonb`);
      } else {
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE schools
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      values
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "School profile not found");
    }

    const profile = await fetchSchoolProfile(req.auth.schoolId);
    return success(res, profile, 200);
  })
);

router.get(
  "/institution/sections",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(sectionsListSchema, req.query, "Invalid section list query");
    const params = [req.auth.schoolId];
    const where = ["ss.school_id = $1"];

    if (typeof query.is_active === "boolean") {
      params.push(query.is_active);
      where.push(`ss.is_active = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(ss.name ILIKE $${params.length} OR ss.code ILIKE $${params.length})`);
    }

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
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
      `);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM school_sections ss
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
          ss.id,
          ss.school_id,
          ss.name,
          ss.code,
          ss.section_type,
          ss.head_user_id,
          ss.coordinator_user_id,
          ss.announcements_enabled,
          ss.display_order,
          ss.is_active,
          ss.metadata,
          ss.created_at,
          ss.updated_at,
          hu.first_name AS head_first_name,
          hu.last_name AS head_last_name,
          hu.email AS head_email,
          cu.first_name AS coordinator_first_name,
          cu.last_name AS coordinator_last_name,
          cu.email AS coordinator_email,
          (
            SELECT COUNT(*)::int
            FROM classrooms c
            WHERE c.school_id = ss.school_id
              AND c.section_id = ss.id
              AND c.is_active = TRUE
          ) AS class_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            JOIN classrooms c2
              ON c2.id = se.classroom_id
             AND c2.school_id = se.school_id
            WHERE se.school_id = ss.school_id
              AND c2.section_id = ss.id
              AND se.status = 'active'
          ) AS active_students
        FROM school_sections ss
        LEFT JOIN users hu ON hu.id = ss.head_user_id
        LEFT JOIN users cu ON cu.id = ss.coordinator_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ss.display_order ASC, ss.name ASC
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

router.post(
  "/institution/sections",
  requireAuth,
  requireRoles(...SECTION_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(sectionCreateSchema, req.body, "Invalid section create payload");

    await assertUserInSchool(req.auth.schoolId, body.head_user_id || null, "head_user_id");
    await assertUserInSchool(
      req.auth.schoolId,
      body.coordinator_user_id || null,
      "coordinator_user_id"
    );

    const created = await pool.query(
      `
        INSERT INTO school_sections (
          school_id,
          name,
          code,
          section_type,
          head_user_id,
          coordinator_user_id,
          display_order,
          announcements_enabled,
          is_active,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        body.name,
        body.code,
        body.section_type,
        body.head_user_id || null,
        body.coordinator_user_id || null,
        body.display_order,
        body.announcements_enabled,
        body.is_active,
        JSON.stringify(body.metadata || {}),
      ]
    );

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/institution/sections/:sectionId",
  requireAuth,
  requireRoles(...SECTION_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(sectionUpdateSchema, req.body, "Invalid section update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const sectionCheck = await pool.query(
      `
        SELECT id
        FROM school_sections
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, req.params.sectionId]
    );

    if (!sectionCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Section not found");
    }

    await assertSectionVisibleToHm({ auth: req.auth, sectionId: req.params.sectionId });

    if (Object.prototype.hasOwnProperty.call(body, "head_user_id") && body.head_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.head_user_id, "head_user_id");
    }
    if (Object.prototype.hasOwnProperty.call(body, "coordinator_user_id") && body.coordinator_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.coordinator_user_id, "coordinator_user_id");
    }

    const values = [req.auth.schoolId, req.params.sectionId];
    const setClauses = [];

    for (const [key, value] of entries) {
      values.push(key === "metadata" ? JSON.stringify(value || {}) : value);
      if (key === "metadata") {
        setClauses.push(`${key} = $${values.length}::jsonb`);
      } else {
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE school_sections
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
        RETURNING *
      `,
      values
    );

    return success(res, updated.rows[0], 200);
  })
);

router.get(
  "/institution/classrooms",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(classroomListSchema, req.query, "Invalid classroom list query");

    const params = [req.auth.schoolId];
    const where = ["c.school_id = $1"];

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`c.section_id = $${params.length}`);
    }

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`c.academic_year_id = $${params.length}`);
    }

    if (typeof query.is_active === "boolean") {
      params.push(query.is_active);
      where.push(`c.is_active = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          c.grade_label ILIKE $${params.length}
          OR c.section_label ILIKE $${params.length}
          OR COALESCE(c.classroom_code, '') ILIKE $${params.length}
          OR COALESCE(c.room_number, '') ILIKE $${params.length}
        )
      `);
    }

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          c.section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = c.school_id
              AND (
                ss.head_user_id = $${params.length}
                OR ss.coordinator_user_id = $${params.length}
              )
          )
          OR c.id IN (
            SELECT sca.classroom_id
            FROM staff_classroom_assignments sca
            JOIN staff_profiles sp ON sp.id = sca.staff_profile_id
            WHERE sca.school_id = c.school_id
              AND sp.user_id = $${params.length}
              AND sca.is_active = TRUE
          )
        )
      `);
    }

    if (
      hasRole(req.auth, "teacher") &&
      !hasRole(req.auth, "headmistress") &&
      !isSchoolLeadership(req.auth)
    ) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });

      if (teacherClassroomIds.length === 0) {
        where.push("FALSE");
      } else {
        params.push(teacherClassroomIds);
        where.push(`c.id = ANY($${params.length}::uuid[])`);
      }
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM classrooms c
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
          c.id,
          c.school_id,
          c.academic_year_id,
          c.grade_label,
          c.section_label,
          c.section_id,
          c.classroom_code,
          c.room_number,
          c.capacity,
          c.is_active,
          c.created_at,
          c.updated_at,
          ay.name AS academic_year_name,
          ss.name AS section_name,
          ss.code AS section_code,
          c.homeroom_teacher_id,
          tu.id AS homeroom_teacher_user_id,
          tu.first_name AS homeroom_teacher_first_name,
          tu.last_name AS homeroom_teacher_last_name,
          hsp.id AS homeroom_teacher_staff_profile_id,
          hsp.staff_code AS homeroom_teacher_staff_code,
          COALESCE(hsp.designation, ht.designation) AS homeroom_teacher_designation,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            WHERE se.school_id = c.school_id
              AND se.classroom_id = c.id
              AND se.status = 'active'
          ) AS active_student_count
        FROM classrooms c
        JOIN academic_years ay
          ON ay.id = c.academic_year_id
         AND ay.school_id = c.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        LEFT JOIN teachers ht
          ON ht.id = c.homeroom_teacher_id
         AND ht.school_id = c.school_id
        LEFT JOIN users tu
          ON tu.id = ht.user_id
        LEFT JOIN staff_profiles hsp
          ON hsp.user_id = ht.user_id
         AND hsp.school_id = c.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY ay.is_current DESC, c.grade_label ASC, c.section_label ASC
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

router.post(
  "/institution/classrooms",
  requireAuth,
  requireRoles(...CLASSROOM_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(classroomCreateSchema, req.body, "Invalid classroom create payload");

    const academicYearOk = await pool.query(
      `
        SELECT id
        FROM academic_years
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, body.academic_year_id]
    );

    if (!academicYearOk.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "academic_year_id does not belong to this school");
    }

    if (body.section_id) {
      const sectionOk = await pool.query(
        `
          SELECT id
          FROM school_sections
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
        `,
        [req.auth.schoolId, body.section_id]
      );
      if (!sectionOk.rows[0]) {
        throw new AppError(422, "VALIDATION_ERROR", "section_id does not belong to this school");
      }

      await assertSectionVisibleToHm({ auth: req.auth, sectionId: body.section_id });
    }

    const homeroomTeacherId = await resolveTeacherIdByUser(
      req.auth.schoolId,
      body.homeroom_teacher_user_id || null
    );

    const created = await pool.query(
      `
        INSERT INTO classrooms (
          school_id,
          academic_year_id,
          grade_label,
          section_label,
          section_id,
          classroom_code,
          room_number,
          homeroom_teacher_id,
          capacity,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        body.academic_year_id,
        body.grade_label,
        body.section_label,
        body.section_id || null,
        body.classroom_code || null,
        body.room_number || null,
        homeroomTeacherId,
        body.capacity || null,
        body.is_active,
      ]
    );

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/institution/classrooms/:classroomId",
  requireAuth,
  requireRoles(...CLASSROOM_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(classroomUpdateSchema, req.body, "Invalid classroom update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const classroomCheck = await pool.query(
      `
        SELECT id, section_id
        FROM classrooms
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, req.params.classroomId]
    );

    if (!classroomCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Classroom not found");
    }

    if (body.section_id) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: body.section_id });
    } else if (classroomCheck.rows[0].section_id) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: classroomCheck.rows[0].section_id });
    }

    const values = [req.auth.schoolId, req.params.classroomId];
    const setClauses = [];

    for (const [key, value] of entries) {
      if (key === "homeroom_teacher_user_id") {
        const teacherId = await resolveTeacherIdByUser(req.auth.schoolId, value || null);
        values.push(teacherId);
        setClauses.push(`homeroom_teacher_id = $${values.length}`);
      } else {
        values.push(value);
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE classrooms
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
        RETURNING *
      `,
      values
    );

    return success(res, updated.rows[0], 200);
  })
);

router.patch(
  "/institution/academic-years/:id/activate",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(academicYearPathSchema, req.params, "Invalid academic year id");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const targetYearResult = await client.query(
        `
          SELECT id, school_id, name, starts_on, ends_on, is_current
          FROM academic_years
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
        `,
        [req.auth.schoolId, path.id]
      );

      const targetYear = targetYearResult.rows[0];
      if (!targetYear) {
        throw new AppError(404, "NOT_FOUND", "Academic year not found");
      }

      const previouslyCurrentResult = await client.query(
        `
          SELECT id, name
          FROM academic_years
          WHERE school_id = $1
            AND is_current = TRUE
            AND id <> $2
          LIMIT 1
        `,
        [req.auth.schoolId, path.id]
      );
      const previousCurrent = previouslyCurrentResult.rows[0] || null;

      await client.query(
        `
          UPDATE academic_years
          SET is_current = FALSE, updated_at = NOW()
          WHERE school_id = $1
            AND id <> $2
            AND is_current = TRUE
        `,
        [req.auth.schoolId, path.id]
      );

      const activatedResult = await client.query(
        `
          UPDATE academic_years
          SET is_current = TRUE, updated_at = NOW()
          WHERE school_id = $1
            AND id = $2
          RETURNING id, school_id, name, starts_on, ends_on, is_current, created_at, updated_at
        `,
        [req.auth.schoolId, path.id]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "institution.academic_year.activated",
        entityName: "academic_years",
        entityId: path.id,
        metadata: {
          previous_current_id: previousCurrent?.id || null,
          previous_current_name: previousCurrent?.name || null,
          activated_name: activatedResult.rows[0]?.name || null,
        },
      });

      return success(
        res,
        {
          activated: activatedResult.rows[0],
          previous_current: previousCurrent,
        },
        200
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/institution/dashboards/principal",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal"),
  asyncHandler(async (req, res) => {
    const attendanceSummary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'present')::int AS present_count,
          COUNT(*) FILTER (WHERE status = 'late')::int AS late_count,
          COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_count,
          COUNT(*) FILTER (WHERE status = 'leave')::int AS leave_count
        FROM attendance_records
        WHERE school_id = $1
          AND attendance_date = CURRENT_DATE
      `,
      [req.auth.schoolId]
    );

    const sectionAttendance = await pool.query(
      `
        SELECT
          ss.id AS section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          COUNT(ar.id)::int AS attendance_records_today,
          COUNT(ar.id) FILTER (WHERE ar.status = 'present')::int AS present_count,
          COUNT(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_count,
          COUNT(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_count
        FROM school_sections ss
        LEFT JOIN classrooms c
          ON c.school_id = ss.school_id
         AND c.section_id = ss.id
        LEFT JOIN attendance_records ar
          ON ar.school_id = ss.school_id
         AND ar.classroom_id = c.id
         AND ar.attendance_date = CURRENT_DATE
        WHERE ss.school_id = $1
          AND ss.is_active = TRUE
        GROUP BY ss.id, ss.name, ss.code, ss.display_order
        ORDER BY ss.display_order ASC, ss.name ASC
      `,
      [req.auth.schoolId]
    );

    const homeworkCompletion = await pool.query(
      `
        SELECT
          COALESCE(ss.code, 'UNASSIGNED') AS section_code,
          COALESCE(ss.name, 'Unassigned') AS section_name,
          COUNT(hs.id)::int AS total_submissions,
          COUNT(hs.id) FILTER (WHERE hs.status IN ('submitted', 'reviewed'))::int AS completed_submissions,
          COUNT(hs.id) FILTER (WHERE hs.status = 'missing')::int AS missing_submissions
        FROM homework_submissions hs
        JOIN homework h
          ON h.id = hs.homework_id
         AND h.school_id = hs.school_id
        JOIN classrooms c
          ON c.id = h.classroom_id
         AND c.school_id = h.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE hs.school_id = $1
          AND h.assigned_at >= NOW() - INTERVAL '30 days'
        GROUP BY COALESCE(ss.code, 'UNASSIGNED'), COALESCE(ss.name, 'Unassigned')
        ORDER BY section_name ASC
      `,
      [req.auth.schoolId]
    );

    const marksUpload = await pool.query(
      `
        SELECT
          COUNT(DISTINCT a.id)::int AS assessment_count,
          COUNT(sc.id)::int AS score_count,
          COUNT(DISTINCT a.created_by_user_id)::int AS contributing_teachers
        FROM assessments a
        LEFT JOIN assessment_scores sc
          ON sc.assessment_id = a.id
         AND sc.school_id = a.school_id
        WHERE a.school_id = $1
          AND a.created_at >= NOW() - INTERVAL '30 days'
      `,
      [req.auth.schoolId]
    );

    const feeAndEvents = await pool.query(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM fee_invoices fi
            WHERE fi.school_id = $1
              AND fi.status IN ('overdue', 'issued', 'partial')
              AND fi.due_date < CURRENT_DATE
          ) AS defaulter_invoices,
          (
            SELECT COUNT(*)::int
            FROM events e
            WHERE e.school_id = $1
              AND e.starts_at >= NOW()
              AND e.starts_at <= NOW() + INTERVAL '14 days'
          ) AS upcoming_events,
          (
            SELECT COUNT(*)::int
            FROM delegated_permissions dp
            WHERE dp.school_id = $1
              AND dp.is_active = TRUE
              AND (dp.ends_at IS NULL OR dp.ends_at >= NOW())
          ) AS active_delegations
      `,
      [req.auth.schoolId]
    );

    const summary = {
      attendance_today: attendanceSummary.rows[0] || {
        total: 0,
        present_count: 0,
        late_count: 0,
        absent_count: 0,
        leave_count: 0,
      },
      section_attendance: sectionAttendance.rows,
      homework_completion_by_section: homeworkCompletion.rows,
      marks_upload_status: marksUpload.rows[0] || {
        assessment_count: 0,
        score_count: 0,
        contributing_teachers: 0,
      },
      finance_and_alerts: feeAndEvents.rows[0] || {
        defaulter_invoices: 0,
        upcoming_events: 0,
        active_delegations: 0,
      },
      generated_at: new Date().toISOString(),
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/institution/dashboards/section",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      sectionDashboardQuerySchema,
      req.query,
      "Invalid section dashboard query"
    );
    const params = [req.auth.schoolId];
    let scopeFilter = "";

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      scopeFilter = `
        AND (
          ss.head_user_id = $2
          OR ss.coordinator_user_id = $2
          OR EXISTS (
            SELECT 1
            FROM staff_profiles sp
            WHERE sp.school_id = ss.school_id
              AND sp.user_id = $2
              AND sp.primary_section_id = ss.id
          )
        )
      `;
    }

    const rows = await pool.query(
      `
        SELECT
          ss.id AS section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          ss.section_type,
          COUNT(DISTINCT c.id)::int AS class_count,
          COUNT(DISTINCT se.student_id)::int AS active_students,
          COUNT(DISTINCT sp.id)::int AS assigned_staff,
          COUNT(ar.id)::int AS attendance_records_today,
          COUNT(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_today,
          COUNT(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_today
        FROM school_sections ss
        LEFT JOIN classrooms c
          ON c.school_id = ss.school_id
         AND c.section_id = ss.id
         AND c.is_active = TRUE
        LEFT JOIN student_enrollments se
          ON se.school_id = ss.school_id
         AND se.classroom_id = c.id
         AND se.status = 'active'
        LEFT JOIN staff_profiles sp
          ON sp.school_id = ss.school_id
         AND sp.primary_section_id = ss.id
         AND sp.employment_status = 'active'
        LEFT JOIN attendance_records ar
          ON ar.school_id = ss.school_id
         AND ar.classroom_id = c.id
         AND ar.attendance_date = CURRENT_DATE
        WHERE ss.school_id = $1
          AND ss.is_active = TRUE
          ${scopeFilter}
        GROUP BY ss.id, ss.name, ss.code, ss.section_type, ss.display_order
        ORDER BY ss.display_order ASC, ss.name ASC
      `,
      params
    );

    const sections = rows.rows;
    const visibleSectionIds = new Set(sections.map((row) => row.section_id));

    let selectedSectionId = query.section_id || sections[0]?.section_id || null;
    if (selectedSectionId && !visibleSectionIds.has(selectedSectionId)) {
      throw new AppError(404, "NOT_FOUND", "Section not found for this dashboard scope");
    }

    let selectedSectionDetail = null;
    if (query.include_detail && selectedSectionId) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: selectedSectionId });

      const selectedSectionRow =
        sections.find((row) => row.section_id === selectedSectionId) || null;

      const [classAttendanceResult, teacherCompletionResult, lateAbsentResult, eventsResult, announcementsResult] =
        await Promise.all([
          pool.query(
            `
              SELECT
                c.id AS classroom_id,
                c.grade_label,
                c.section_label,
                c.classroom_code,
                COUNT(ar.id)::int AS attendance_records_today,
                COUNT(ar.id) FILTER (WHERE ar.status = 'present')::int AS present_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'leave')::int AS leave_count
              FROM classrooms c
              LEFT JOIN attendance_records ar
                ON ar.school_id = c.school_id
               AND ar.classroom_id = c.id
               AND ar.attendance_date = CURRENT_DATE
              WHERE c.school_id = $1
                AND c.section_id = $2
                AND c.is_active = TRUE
              GROUP BY c.id, c.grade_label, c.section_label, c.classroom_code
              ORDER BY c.grade_label ASC, c.section_label ASC
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                (
                  SELECT COUNT(*)::int
                  FROM staff_profiles sp
                  WHERE sp.school_id = $1
                    AND sp.primary_section_id = $2
                    AND sp.employment_status = 'active'
                ) AS assigned_staff,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_total_submissions,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND hs.status IN ('submitted', 'reviewed')
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_completed_submissions,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND hs.status = 'missing'
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_missing_submissions,
                (
                  SELECT COUNT(DISTINCT a.id)::int
                  FROM assessments a
                  JOIN classrooms c
                    ON c.id = a.classroom_id
                   AND c.school_id = a.school_id
                  WHERE a.school_id = $1
                    AND c.section_id = $2
                    AND a.created_at >= NOW() - INTERVAL '30 days'
                ) AS marks_assessments_count,
                (
                  SELECT COUNT(sc.id)::int
                  FROM assessment_scores sc
                  JOIN assessments a
                    ON a.id = sc.assessment_id
                   AND a.school_id = sc.school_id
                  JOIN classrooms c
                    ON c.id = a.classroom_id
                   AND c.school_id = a.school_id
                  WHERE sc.school_id = $1
                    AND c.section_id = $2
                    AND a.created_at >= NOW() - INTERVAL '30 days'
                ) AS marks_scores_count
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                ar.id AS attendance_record_id,
                ar.student_id,
                st.student_code,
                st.first_name,
                st.last_name,
                ar.status,
                ar.check_in_at,
                c.id AS classroom_id,
                c.grade_label,
                c.section_label
              FROM attendance_records ar
              JOIN students st
                ON st.id = ar.student_id
               AND st.school_id = ar.school_id
              JOIN classrooms c
                ON c.id = ar.classroom_id
               AND c.school_id = ar.school_id
              WHERE ar.school_id = $1
                AND c.section_id = $2
                AND ar.attendance_date = CURRENT_DATE
                AND ar.status IN ('late', 'absent')
              ORDER BY
                CASE ar.status WHEN 'absent' THEN 0 ELSE 1 END,
                st.first_name ASC
              LIMIT 25
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                e.id,
                e.title,
                e.description,
                e.event_type,
                e.starts_at,
                e.ends_at,
                e.target_scope,
                e.target_classroom_id,
                c.grade_label,
                c.section_label
              FROM events e
              LEFT JOIN classrooms c
                ON c.id = e.target_classroom_id
               AND c.school_id = e.school_id
              WHERE e.school_id = $1
                AND e.starts_at >= NOW()
                AND e.starts_at <= NOW() + INTERVAL '14 days'
                AND (
                  e.target_scope = 'school'
                  OR (e.target_scope = 'classroom' AND c.section_id = $2)
                )
              ORDER BY e.starts_at ASC
              LIMIT 8
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                e.id,
                e.title,
                e.description,
                e.event_type,
                e.starts_at,
                e.target_scope,
                e.target_classroom_id,
                c.grade_label,
                c.section_label
              FROM events e
              LEFT JOIN classrooms c
                ON c.id = e.target_classroom_id
               AND c.school_id = e.school_id
              WHERE e.school_id = $1
                AND (
                  e.event_type IN ('announcement', 'notice', 'circular')
                  OR e.event_type ILIKE '%announce%'
                )
                AND (
                  e.target_scope = 'school'
                  OR (e.target_scope = 'classroom' AND c.section_id = $2)
                )
              ORDER BY e.starts_at DESC NULLS LAST, e.created_at DESC
              LIMIT 6
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
        ]);

      const classAttendance = classAttendanceResult.rows.map((row) => {
        const total = Number(row.attendance_records_today) || 0;
        const present = Number(row.present_count) || 0;
        const attendanceRate = total > 0 ? (present / total) * 100 : 0;
        return {
          classroom_id: row.classroom_id,
          classroom_label: `${row.grade_label} - ${row.section_label}`,
          classroom_code: row.classroom_code,
          attendance_records_today: total,
          present_count: present,
          late_count: Number(row.late_count) || 0,
          absent_count: Number(row.absent_count) || 0,
          leave_count: Number(row.leave_count) || 0,
          attendance_rate: Number(attendanceRate.toFixed(2)),
        };
      });

      const completionRow = teacherCompletionResult.rows[0] || {};
      selectedSectionDetail = {
        section: selectedSectionRow,
        class_attendance: classAttendance,
        teacher_completion: {
          assigned_staff: Number(completionRow.assigned_staff) || 0,
          homework_total_submissions: Number(completionRow.homework_total_submissions) || 0,
          homework_completed_submissions: Number(completionRow.homework_completed_submissions) || 0,
          homework_missing_submissions: Number(completionRow.homework_missing_submissions) || 0,
          marks_assessments_count: Number(completionRow.marks_assessments_count) || 0,
          marks_scores_count: Number(completionRow.marks_scores_count) || 0,
        },
        late_absent_students: lateAbsentResult.rows.map((row) => ({
          attendance_record_id: row.attendance_record_id,
          student_id: row.student_id,
          student_code: row.student_code,
          first_name: row.first_name,
          last_name: row.last_name,
          status: row.status,
          check_in_at: row.check_in_at,
          classroom_id: row.classroom_id,
          classroom_label: `${row.grade_label} - ${row.section_label}`,
        })),
        upcoming_events: eventsResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          event_type: row.event_type,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          target_scope: row.target_scope,
          target_classroom_id: row.target_classroom_id,
          classroom_label:
            row.grade_label && row.section_label
              ? `${row.grade_label} - ${row.section_label}`
              : null,
        })),
        announcements: announcementsResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          event_type: row.event_type,
          starts_at: row.starts_at,
          target_scope: row.target_scope,
          target_classroom_id: row.target_classroom_id,
          classroom_label:
            row.grade_label && row.section_label
              ? `${row.grade_label} - ${row.section_label}`
              : null,
        })),
      };
    }

    return success(
      res,
      {
        sections,
        selected_section_id: selectedSectionId,
        selected_section_detail: selectedSectionDetail,
        generated_at: new Date().toISOString(),
      },
      200
    );
  })
);

module.exports = router;
