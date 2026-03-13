const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const LEADERSHIP_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
];

const ADMIN_ROLES = ["school_admin", "principal", "vice_principal"];

const classroomKpiSchema = z
  .object({
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    academic_year_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
  })
  .strict();

const teacherPerformanceSchema = z
  .object({
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    section_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const studentsAtRiskSchema = z
  .object({
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    classroom_id: z.string().uuid().optional(),
    attendance_threshold: z.coerce.number().min(0).max(100).default(75),
    marks_threshold: z.coerce.number().min(0).max(100).default(50),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const kpiTargetUpdateSchema = z
  .object({
    attendance_rate_target: z.number().min(0).max(100).optional(),
    marks_avg_target: z.number().min(0).max(100).optional(),
    homework_completion_target: z.number().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.attendance_rate_target !== undefined ||
      data.marks_avg_target !== undefined ||
      data.homework_completion_target !== undefined,
    { message: "At least one target field is required" }
  );

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

function normalizeWindow(query) {
  const now = new Date();
  const to = query.date_to
    ? new Date(`${query.date_to}T00:00:00.000Z`)
    : now;
  const from = query.date_from
    ? new Date(`${query.date_from}T00:00:00.000Z`)
    : new Date(to.getTime() - 1000 * 60 * 60 * 24 * 30);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid date range");
  }
  if (from.getTime() > to.getTime()) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "date_from must be on or before date_to"
    );
  }

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ─── GET /analytics/classroom-kpis ──────────────────────────────────
// Per-classroom attendance rate, average marks, homework completion
router.get(
  "/classroom-kpis",
  requireAuth,
  requireRoles(...LEADERSHIP_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      classroomKpiSchema,
      req.query,
      "Invalid classroom KPI query"
    );
    const window = normalizeWindow(query);

    const params = [req.auth.schoolId, window.from, window.to];
    const classroomWhere = ["c.school_id = $1", "c.is_active = TRUE"];

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      classroomWhere.push(`c.academic_year_id = $${params.length}`);
    }
    if (query.section_id) {
      params.push(query.section_id);
      classroomWhere.push(`c.section_id = $${params.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          c.id AS classroom_id,
          c.grade_label,
          c.section_label,
          -- Attendance KPI
          COALESCE((
            SELECT
              ROUND(
                COUNT(*) FILTER (WHERE ar.status = 'present'::attendance_status) * 100.0 /
                NULLIF(COUNT(*)::numeric, 0),
                2
              )
            FROM attendance_records ar
            WHERE ar.school_id = c.school_id
              AND ar.classroom_id = c.id
              AND ar.attendance_date >= $2::date
              AND ar.attendance_date <= $3::date
          ), 0) AS attendance_rate,
          -- Marks KPI
          COALESCE((
            SELECT
              ROUND(AVG(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100), 2)
            FROM assessments a
            JOIN assessment_scores sc
              ON sc.school_id = a.school_id
             AND sc.assessment_id = a.id
            WHERE a.school_id = c.school_id
              AND a.classroom_id = c.id
              AND COALESCE(a.assessment_date, a.created_at::date) >= $2::date
              AND COALESCE(a.assessment_date, a.created_at::date) <= $3::date
          ), 0) AS marks_avg,
          -- Homework completion KPI
          COALESCE((
            SELECT
              ROUND(
                COUNT(*) FILTER (
                  WHERE COALESCE(hs.status, 'assigned'::homework_submission_status)
                    IN ('submitted'::homework_submission_status, 'reviewed'::homework_submission_status)
                ) * 100.0 /
                NULLIF(COUNT(*)::numeric, 0),
                2
              )
            FROM homework h
            JOIN student_enrollments se
              ON se.school_id = h.school_id
             AND se.classroom_id = h.classroom_id
             AND se.status = 'active'
            LEFT JOIN homework_submissions hs
              ON hs.school_id = h.school_id
             AND hs.homework_id = h.id
             AND hs.student_id = se.student_id
            WHERE h.school_id = c.school_id
              AND h.classroom_id = c.id
              AND h.assigned_at::date >= $2::date
              AND h.assigned_at::date <= $3::date
          ), 0) AS homework_completion_rate,
          -- Student count
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            WHERE se.school_id = c.school_id
              AND se.classroom_id = c.id
              AND se.status = 'active'
          ) AS active_students
        FROM classrooms c
        WHERE ${classroomWhere.join(" AND ")}
        ORDER BY c.grade_label ASC, c.section_label ASC
      `,
      params
    );

    // Load targets for comparison
    const targetsResult = await pool.query(
      "SELECT kpi_targets FROM schools WHERE id = $1",
      [req.auth.schoolId]
    );
    const targets = targetsResult.rows[0]?.kpi_targets || {
      attendance_rate_target: 85,
      marks_avg_target: 60,
      homework_completion_target: 70,
    };

    const classrooms = result.rows.map((row) => ({
      classroom_id: row.classroom_id,
      classroom_label: `${row.grade_label} ${row.section_label}`.trim(),
      active_students: row.active_students,
      attendance_rate: Number(row.attendance_rate),
      marks_avg: Number(row.marks_avg),
      homework_completion_rate: Number(row.homework_completion_rate),
      below_target: {
        attendance:
          Number(row.attendance_rate) < (targets.attendance_rate_target || 85),
        marks: Number(row.marks_avg) < (targets.marks_avg_target || 60),
        homework:
          Number(row.homework_completion_rate) <
          (targets.homework_completion_target || 70),
      },
    }));

    return success(res, {
      window: { date_from: window.from, date_to: window.to },
      targets,
      classrooms,
    });
  })
);

// ─── GET /analytics/teacher-performance ─────────────────────────────
// Per-teacher homework assignment count, attendance marking rate
router.get(
  "/teacher-performance",
  requireAuth,
  requireRoles(...LEADERSHIP_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      teacherPerformanceSchema,
      req.query,
      "Invalid teacher performance query"
    );
    const window = normalizeWindow(query);

    const params = [req.auth.schoolId, window.from, window.to];
    const teacherWhere = [
      "sp.school_id = $1",
      "sp.employment_status = 'active'",
    ];

    if (query.section_id) {
      params.push(query.section_id);
      teacherWhere.push(`sp.primary_section_id = $${params.length}`);
    }

    // Count teachers for pagination
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM staff_profiles sp
        WHERE ${teacherWhere.join(" AND ")}
          AND sp.primary_role IN ('teacher', 'class_teacher')
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalItems / query.page_size)
    );
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const result = await pool.query(
      `
        SELECT
          sp.id AS staff_id,
          sp.user_id,
          u.first_name,
          u.last_name,
          sp.designation,
          -- Homework assigned count
          COALESCE((
            SELECT COUNT(*)::int
            FROM homework h
            JOIN teachers t ON t.id = h.teacher_id AND t.school_id = h.school_id
            WHERE t.user_id = sp.user_id
              AND h.school_id = sp.school_id
              AND h.assigned_at::date >= $2::date
              AND h.assigned_at::date <= $3::date
          ), 0) AS homework_assigned_count,
          -- Attendance records marked
          COALESCE((
            SELECT COUNT(*)::int
            FROM attendance_records ar
            WHERE ar.recorded_by_user_id = sp.user_id
              AND ar.school_id = sp.school_id
              AND ar.attendance_date >= $2::date
              AND ar.attendance_date <= $3::date
          ), 0) AS attendance_records_marked,
          -- Assessments created
          COALESCE((
            SELECT COUNT(*)::int
            FROM assessments a
            WHERE a.created_by_user_id = sp.user_id
              AND a.school_id = sp.school_id
              AND COALESCE(a.assessment_date, a.created_at::date) >= $2::date
              AND COALESCE(a.assessment_date, a.created_at::date) <= $3::date
          ), 0) AS assessments_created_count
        FROM staff_profiles sp
        JOIN users u ON u.id = sp.user_id
        WHERE ${teacherWhere.join(" AND ")}
          AND sp.primary_role IN ('teacher', 'class_teacher')
        ORDER BY u.first_name ASC, u.last_name ASC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, result.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

// ─── GET /analytics/students-at-risk ────────────────────────────────
// Students with attendance or marks below configurable thresholds
router.get(
  "/students-at-risk",
  requireAuth,
  requireRoles(...LEADERSHIP_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      studentsAtRiskSchema,
      req.query,
      "Invalid students-at-risk query"
    );
    const window = normalizeWindow(query);

    const params = [
      req.auth.schoolId,
      window.from,
      window.to,
      query.attendance_threshold,
      query.marks_threshold,
    ];

    const studentWhere = [
      "se.school_id = $1",
      "se.status = 'active'",
      "s.status = 'active'",
    ];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      studentWhere.push(`se.classroom_id = $${params.length}`);
    }

    const countResult = await pool.query(
      `
        WITH student_kpis AS (
          SELECT
            se.student_id,
            COALESCE((
              SELECT
                ROUND(
                  COUNT(*) FILTER (WHERE ar.status = 'present'::attendance_status) * 100.0 /
                  NULLIF(COUNT(*)::numeric, 0),
                  2
                )
              FROM attendance_records ar
              WHERE ar.school_id = se.school_id
                AND ar.student_id = se.student_id
                AND ar.attendance_date >= $2::date
                AND ar.attendance_date <= $3::date
            ), 0) AS attendance_rate,
            COALESCE((
              SELECT
                ROUND(AVG(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100), 2)
              FROM assessment_scores sc
              JOIN assessments a
                ON a.id = sc.assessment_id
               AND a.school_id = sc.school_id
              WHERE sc.school_id = se.school_id
                AND sc.student_id = se.student_id
                AND COALESCE(a.assessment_date, a.created_at::date) >= $2::date
                AND COALESCE(a.assessment_date, a.created_at::date) <= $3::date
            ), 0) AS marks_avg
          FROM student_enrollments se
          JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
          WHERE ${studentWhere.join(" AND ")}
        )
        SELECT COUNT(*)::int AS total
        FROM student_kpis
        WHERE attendance_rate < $4 OR marks_avg < $5
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(
      1,
      Math.ceil(totalItems / query.page_size)
    );
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const result = await pool.query(
      `
        WITH student_kpis AS (
          SELECT
            se.student_id,
            se.classroom_id,
            c.grade_label,
            c.section_label,
            s.student_code,
            s.first_name,
            s.last_name,
            COALESCE((
              SELECT
                ROUND(
                  COUNT(*) FILTER (WHERE ar.status = 'present'::attendance_status) * 100.0 /
                  NULLIF(COUNT(*)::numeric, 0),
                  2
                )
              FROM attendance_records ar
              WHERE ar.school_id = se.school_id
                AND ar.student_id = se.student_id
                AND ar.attendance_date >= $2::date
                AND ar.attendance_date <= $3::date
            ), 0) AS attendance_rate,
            COALESCE((
              SELECT
                ROUND(AVG(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100), 2)
              FROM assessment_scores sc
              JOIN assessments a
                ON a.id = sc.assessment_id
               AND a.school_id = sc.school_id
              WHERE sc.school_id = se.school_id
                AND sc.student_id = se.student_id
                AND COALESCE(a.assessment_date, a.created_at::date) >= $2::date
                AND COALESCE(a.assessment_date, a.created_at::date) <= $3::date
            ), 0) AS marks_avg
          FROM student_enrollments se
          JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
          JOIN classrooms c ON c.id = se.classroom_id AND c.school_id = se.school_id
          WHERE ${studentWhere.join(" AND ")}
        )
        SELECT *
        FROM student_kpis
        WHERE attendance_rate < $4 OR marks_avg < $5
        ORDER BY attendance_rate ASC, marks_avg ASC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const students = result.rows.map((row) => ({
      student_id: row.student_id,
      student_code: row.student_code,
      first_name: row.first_name,
      last_name: row.last_name,
      classroom_id: row.classroom_id,
      classroom_label: `${row.grade_label} ${row.section_label}`.trim(),
      attendance_rate: Number(row.attendance_rate),
      marks_avg: Number(row.marks_avg),
      risk_factors: [
        ...(Number(row.attendance_rate) < query.attendance_threshold
          ? ["low_attendance"]
          : []),
        ...(Number(row.marks_avg) < query.marks_threshold
          ? ["low_marks"]
          : []),
      ],
    }));

    return success(res, students, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
      thresholds: {
        attendance: query.attendance_threshold,
        marks: query.marks_threshold,
      },
    });
  })
);

// ─── GET /analytics/targets ─────────────────────────────────────────
router.get(
  "/targets",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT kpi_targets FROM schools WHERE id = $1",
      [req.auth.schoolId]
    );

    const defaults = {
      attendance_rate_target: 85,
      marks_avg_target: 60,
      homework_completion_target: 70,
    };

    return success(res, {
      ...defaults,
      ...(result.rows[0]?.kpi_targets || {}),
    });
  })
);

// ─── PATCH /analytics/targets ───────────────────────────────────────
router.patch(
  "/targets",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(
      kpiTargetUpdateSchema,
      req.body,
      "Invalid KPI target update"
    );

    // Read current then merge
    const current = await pool.query(
      "SELECT kpi_targets FROM schools WHERE id = $1",
      [req.auth.schoolId]
    );
    const existing = current.rows[0]?.kpi_targets || {};
    const merged = { ...existing, ...body };

    await pool.query(
      "UPDATE schools SET kpi_targets = $1::jsonb, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(merged), req.auth.schoolId]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "analytics.targets.updated",
      entityName: "schools",
      entityId: req.auth.schoolId,
      metadata: { targets: merged },
    });

    return success(res, merged, 200);
  })
);

module.exports = router;
