const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const commonLookupSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(100),
});

const studentsLookupSchema = commonLookupSchema.extend({
  classroom_id: z.string().uuid().optional(),
});

const subjectsLookupSchema = commonLookupSchema.extend({
  classroom_id: z.string().uuid().optional(),
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

function isTeacher(auth) {
  return hasRole(auth, "teacher") && !hasRole(auth, "school_admin");
}

router.get(
  "/lookups/classrooms",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(commonLookupSchema, req.query, "Invalid classroom lookup query");
    const params = [req.auth.schoolId];
    const where = ["c.school_id = $1"];

    if (isTeacher(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          EXISTS (
            SELECT 1
            FROM teachers t
            WHERE t.school_id = c.school_id
              AND t.user_id = $${params.length}
              AND c.homeroom_teacher_id = t.id
          )
          OR EXISTS (
            SELECT 1
            FROM classroom_subjects cs
            JOIN teachers t ON t.id = cs.teacher_id
            WHERE cs.school_id = c.school_id
              AND cs.classroom_id = c.id
              AND t.school_id = c.school_id
              AND t.user_id = $${params.length}
          )
        )
      `);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(
        `(c.grade_label ILIKE $${params.length} OR c.section_label ILIKE $${params.length} OR ay.name ILIKE $${params.length})`
      );
    }

    params.push(query.page_size);
    const rows = await pool.query(
      `
        SELECT
          c.id,
          c.grade_label,
          c.section_label,
          ay.name AS academic_year_name
        FROM classrooms c
        JOIN academic_years ay
          ON ay.id = c.academic_year_id
         AND ay.school_id = c.school_id
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
      academic_year_name: row.academic_year_name,
      label: `${row.grade_label} - ${row.section_label}`,
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/students",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(studentsLookupSchema, req.query, "Invalid student lookup query");
    const params = [req.auth.schoolId];
    const where = ["se.school_id = $1", "se.status = 'active'"];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`se.classroom_id = $${params.length}`);
    }

    if (isTeacher(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          EXISTS (
            SELECT 1
            FROM classrooms c
            JOIN teachers t ON t.id = c.homeroom_teacher_id
            WHERE c.school_id = se.school_id
              AND c.id = se.classroom_id
              AND t.user_id = $${params.length}
              AND t.school_id = se.school_id
          )
          OR EXISTS (
            SELECT 1
            FROM classroom_subjects cs
            JOIN teachers t ON t.id = cs.teacher_id
            WHERE cs.school_id = se.school_id
              AND cs.classroom_id = se.classroom_id
              AND t.user_id = $${params.length}
              AND t.school_id = se.school_id
          )
        )
      `);
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
          c.section_label
        FROM student_enrollments se
        JOIN students s
          ON s.id = se.student_id
         AND s.school_id = se.school_id
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
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
      label: `${row.first_name} ${row.last_name || ""}`.trim(),
    }));

    return success(res, data, 200);
  })
);

router.get(
  "/lookups/subjects",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(subjectsLookupSchema, req.query, "Invalid subject lookup query");
    const params = [req.auth.schoolId];
    const where = ["s.school_id = $1"];

    if (isTeacher(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM classroom_subjects cs
          JOIN teachers t ON t.id = cs.teacher_id
          WHERE cs.school_id = s.school_id
            AND cs.subject_id = s.id
            AND t.school_id = s.school_id
            AND t.user_id = $${params.length}
        )
      `);
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

module.exports = router;
