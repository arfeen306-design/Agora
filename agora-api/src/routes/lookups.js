const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const { listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const commonLookupSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(100),
});

const studentsLookupSchema = commonLookupSchema.extend({
  classroom_id: z.string().uuid().optional(),
  section_id: z.string().uuid().optional(),
});

const subjectsLookupSchema = commonLookupSchema.extend({
  classroom_id: z.string().uuid().optional(),
});

const sectionsLookupSchema = commonLookupSchema.extend({
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const staffLookupSchema = commonLookupSchema.extend({
  staff_type: z.string().trim().min(1).max(60).optional(),
  section_id: z.string().uuid().optional(),
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

function isTeacherOnly(auth) {
  return hasRole(auth, "teacher") && !isLeadership(auth) && !hasRole(auth, "headmistress");
}

function isHeadmistressOnly(auth) {
  return hasRole(auth, "headmistress") && !isLeadership(auth);
}

router.get(
  "/lookups/classrooms",
  requireAuth,
  requireRoles(
    "school_admin",
    "principal",
    "vice_principal",
    "headmistress",
    "teacher",
    "hr_admin",
    "front_desk",
    "accountant"
  ),
  asyncHandler(async (req, res) => {
    const query = parseSchema(commonLookupSchema, req.query, "Invalid classroom lookup query");
    const params = [req.auth.schoolId];
    const where = ["c.school_id = $1", "c.is_active = TRUE"];

    if (isHeadmistressOnly(req.auth)) {
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

    if (isTeacherOnly(req.auth)) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`c.id = ANY($${params.length}::uuid[])`);
      }
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(
        `(
          c.grade_label ILIKE $${params.length}
          OR c.section_label ILIKE $${params.length}
          OR COALESCE(c.classroom_code, '') ILIKE $${params.length}
          OR ay.name ILIKE $${params.length}
        )`
      );
    }

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          c.id,
          c.grade_label,
          c.section_label,
          c.classroom_code,
          c.room_number,
          ay.name AS academic_year_name,
          ss.name AS section_name
        FROM classrooms c
        JOIN academic_years ay
          ON ay.id = c.academic_year_id
         AND ay.school_id = c.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY ay.is_current DESC, c.grade_label ASC, c.section_label ASC
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      grade_label: row.grade_label,
      section_label: row.section_label,
      classroom_code: row.classroom_code,
      room_number: row.room_number,
      academic_year_name: row.academic_year_name,
      section_name: row.section_name,
      label: `${row.grade_label} - ${row.section_label}`,
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/students",
  requireAuth,
  requireRoles(
    "school_admin",
    "principal",
    "vice_principal",
    "headmistress",
    "teacher",
    "hr_admin",
    "front_desk",
    "accountant"
  ),
  asyncHandler(async (req, res) => {
    const query = parseSchema(studentsLookupSchema, req.query, "Invalid student lookup query");
    const params = [req.auth.schoolId];
    const where = ["se.school_id = $1", "se.status = 'active'"];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`se.classroom_id = $${params.length}`);
    }

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`c.section_id = $${params.length}`);
    }

    if (isHeadmistressOnly(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        c.section_id IN (
          SELECT ss.id
          FROM school_sections ss
          WHERE ss.school_id = se.school_id
            AND (
              ss.head_user_id = $${params.length}
              OR ss.coordinator_user_id = $${params.length}
            )
        )
      `);
    }

    if (isTeacherOnly(req.auth)) {
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

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name,
          se.classroom_id,
          c.grade_label,
          c.section_label,
          ss.name AS section_name
        FROM student_enrollments se
        JOIN students s
          ON s.id = se.student_id
         AND s.school_id = se.school_id
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY s.first_name ASC, s.last_name ASC NULLS LAST
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      student_code: row.student_code,
      first_name: row.first_name,
      last_name: row.last_name,
      classroom_id: row.classroom_id,
      classroom_label: `${row.grade_label} - ${row.section_label}`,
      section_name: row.section_name,
      label: `${row.first_name} ${row.last_name || ""}`.trim(),
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/subjects",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher", "hr_admin"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(subjectsLookupSchema, req.query, "Invalid subject lookup query");
    const params = [req.auth.schoolId];
    const where = ["s.school_id = $1"];

    if (isTeacherOnly(req.auth)) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`
          EXISTS (
            SELECT 1
            FROM classroom_subjects cs
            WHERE cs.school_id = s.school_id
              AND cs.subject_id = s.id
              AND cs.classroom_id = ANY($${params.length}::uuid[])
          )
        `);
      }
    }

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM classroom_subjects cs2
          WHERE cs2.school_id = s.school_id
            AND cs2.subject_id = s.id
            AND cs2.classroom_id = $${params.length}
        )
      `);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(s.code ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          s.id,
          s.code,
          s.name
        FROM subjects s
        WHERE ${where.join(" AND ")}
        ORDER BY s.name ASC
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      label: `${row.name} (${row.code})`,
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/sections",
  requireAuth,
  requireRoles(
    "school_admin",
    "principal",
    "vice_principal",
    "headmistress",
    "teacher",
    "hr_admin",
    "front_desk",
    "accountant"
  ),
  asyncHandler(async (req, res) => {
    const query = parseSchema(sectionsLookupSchema, req.query, "Invalid section lookup query");

    const params = [req.auth.schoolId];
    const where = ["ss.school_id = $1"];

    if (typeof query.is_active === "boolean") {
      params.push(query.is_active);
      where.push(`ss.is_active = $${params.length}`);
    }

    if (isHeadmistressOnly(req.auth)) {
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

    if (isTeacherOnly(req.auth)) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`
          EXISTS (
            SELECT 1
            FROM classrooms c
            WHERE c.school_id = ss.school_id
              AND c.section_id = ss.id
              AND c.id = ANY($${params.length}::uuid[])
          )
        `);
      }
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(ss.name ILIKE $${params.length} OR ss.code ILIKE $${params.length})`);
    }

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          ss.id,
          ss.name,
          ss.code,
          ss.section_type,
          ss.is_active,
          ss.display_order
        FROM school_sections ss
        WHERE ${where.join(" AND ")}
        ORDER BY ss.display_order ASC, ss.name ASC
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      section_type: row.section_type,
      is_active: row.is_active,
      label: `${row.name} (${row.code})`,
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/staff",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "hr_admin", "front_desk"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(staffLookupSchema, req.query, "Invalid staff lookup query");

    const params = [req.auth.schoolId];
    const where = ["sp.school_id = $1", "u.is_active = TRUE"];

    if (query.staff_type) {
      params.push(query.staff_type);
      where.push(`sp.staff_type = $${params.length}`);
    }

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`sp.primary_section_id = $${params.length}`);
    }

    if (isHeadmistressOnly(req.auth)) {
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

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          u.first_name ILIKE $${params.length}
          OR COALESCE(u.last_name, '') ILIKE $${params.length}
          OR u.email ILIKE $${params.length}
          OR sp.staff_code ILIKE $${params.length}
        )
      `);
    }

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          sp.id,
          sp.user_id,
          sp.staff_code,
          sp.staff_type,
          sp.designation,
          u.first_name,
          u.last_name,
          u.email,
          ss.name AS section_name,
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
        ORDER BY u.first_name ASC, u.last_name ASC NULLS LAST
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      staff_code: row.staff_code,
      staff_type: row.staff_type,
      designation: row.designation,
      section_name: row.section_name,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      roles: row.roles,
      label: `${row.first_name} ${row.last_name || ""}`.trim(),
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/academic-years",
  requireAuth,
  requireRoles(
    "school_admin",
    "principal",
    "vice_principal",
    "headmistress",
    "teacher",
    "hr_admin",
    "front_desk",
    "accountant"
  ),
  asyncHandler(async (req, res) => {
    const query = parseSchema(commonLookupSchema, req.query, "Invalid academic year lookup query");
    const params = [req.auth.schoolId];
    const where = ["ay.school_id = $1"];

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`ay.name ILIKE $${params.length}`);
    }

    params.push(query.page_size);

    const rows = await pool.query(
      `
        SELECT
          ay.id,
          ay.name,
          ay.starts_on,
          ay.ends_on,
          ay.is_current
        FROM academic_years ay
        WHERE ${where.join(" AND ")}
        ORDER BY ay.is_current DESC, ay.starts_on DESC
        LIMIT $${params.length}
      `,
      params
    );

    const data = rows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      is_current: row.is_current,
      label: row.is_current ? `${row.name} (Current)` : row.name,
    }));

    return success(res, data, 200);
  })
);

module.exports = router;
