const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { buildCsvBuffer, buildPdfBuffer, getReportFileName } = require("../utils/report-export");
const { listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const csvOrPdfSchema = z.enum(["csv", "pdf"]);

const commonFilterSchema = z.object({
  student_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  max_rows: z.coerce.number().int().min(1).max(10000).default(1000),
});

const marksFilterSchema = commonFilterSchema.extend({
  assessment_type: z.string().trim().min(1).max(60).optional(),
});

const feesFilterSchema = commonFilterSchema.extend({
  status: z.enum(["draft", "issued", "partial", "paid", "overdue", "cancelled"]).optional(),
});

const commonExportFilterSchema = commonFilterSchema.extend({
  format: csvOrPdfSchema.default("csv"),
});

const marksExportFilterSchema = marksFilterSchema.extend({
  format: csvOrPdfSchema.default("csv"),
});

const feesExportFilterSchema = feesFilterSchema.extend({
  format: csvOrPdfSchema.default("csv"),
});

const executiveOverviewQuerySchema = z
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
    classroom_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
    trend_points: z.coerce.number().int().min(4).max(24).default(12),
  })
  .strict();

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

function ensureAcademicReportReadRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "headmistress") ||
    hasRole(auth, "teacher") ||
    hasRole(auth, "parent") ||
    hasRole(auth, "student")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No academic report access for this role");
}

function ensureFeesReportReadRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "accountant")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No fees report access for this role");
}

function ensureAcademicReportExportRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "headmistress") ||
    hasRole(auth, "teacher") ||
    hasRole(auth, "parent") ||
    hasRole(auth, "student")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No academic report export access for this role");
}

function ensureFeesReportExportRole(auth) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "accountant") || hasRole(auth, "principal")) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No fees export access for this role");
}

function ensureExecutiveReportReadRole(auth) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "principal") || hasRole(auth, "vice_principal")) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No executive analytics access for this role");
}

function auditReportExport({ auth, actorUserId, reportType, format, rowCount, filters }) {
  fireAndForgetAuditLog({
    schoolId: auth.schoolId,
    actorUserId,
    action: "reports.data.exported",
    entityName: "reports",
    metadata: {
      report_type: reportType,
      format,
      row_count: rowCount,
      filters,
    },
  });
}

async function appendStudentRoleScopeClause({
  auth,
  where,
  params,
  studentColumn,
  schoolColumn,
}) {
  if (hasRole(auth, "school_admin")) {
    return;
  }

  if (hasRole(auth, "principal") || hasRole(auth, "vice_principal") || hasRole(auth, "accountant")) {
    return;
  }

  if (hasRole(auth, "headmistress")) {
    params.push(auth.userId);
    where.push(`
      EXISTS (
        SELECT 1
        FROM student_enrollments se
        JOIN classrooms c ON c.id = se.classroom_id
        WHERE se.school_id = ${schoolColumn}
          AND se.student_id = ${studentColumn}
          AND se.status = 'active'
          AND c.school_id = se.school_id
          AND c.section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = se.school_id
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
        FROM student_enrollments se
        WHERE se.school_id = ${schoolColumn}
          AND se.student_id = ${studentColumn}
          AND se.status = 'active'
          AND se.classroom_id = ANY($${params.length}::uuid[])
      )
    `);
    return;
  }

  if (hasRole(auth, "parent")) {
    params.push(auth.userId);
    where.push(`
      EXISTS (
        SELECT 1
        FROM parent_students ps
        JOIN parents p ON p.id = ps.parent_id
        WHERE ps.school_id = ${schoolColumn}
          AND ps.student_id = ${studentColumn}
          AND p.school_id = ${schoolColumn}
          AND p.user_id = $${params.length}
      )
    `);
    return;
  }

  if (hasRole(auth, "student")) {
    params.push(auth.userId);
    where.push(`
      EXISTS (
        SELECT 1
        FROM student_user_accounts sua
        JOIN students s ON s.id = sua.student_id
        WHERE sua.user_id = $${params.length}
          AND sua.student_id = ${studentColumn}
          AND s.school_id = ${schoolColumn}
      )
    `);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No report access for this role");
}

function parseNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeExecutiveWindow(query) {
  const now = new Date();
  const safeTo = query.date_to ? new Date(`${query.date_to}T00:00:00.000Z`) : now;
  const safeFrom = query.date_from
    ? new Date(`${query.date_from}T00:00:00.000Z`)
    : new Date(safeTo.getTime() - 1000 * 60 * 60 * 24 * 84);

  if (Number.isNaN(safeFrom.getTime()) || Number.isNaN(safeTo.getTime())) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid executive analytics date range");
  }
  if (safeFrom.getTime() > safeTo.getTime()) {
    throw new AppError(422, "VALIDATION_ERROR", "date_from must be on or before date_to");
  }

  return {
    from: safeFrom.toISOString().slice(0, 10),
    to: safeTo.toISOString().slice(0, 10),
  };
}

async function sendExportFile({
  res,
  reportKey,
  title,
  subtitle,
  columns,
  rows,
  format,
}) {
  if (format === "csv") {
    const buffer = buildCsvBuffer({ columns, rows });
    const fileName = getReportFileName({ reportKey, ext: "csv" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buffer);
  }

  const buffer = await buildPdfBuffer({ title, subtitle, columns, rows });
  const fileName = getReportFileName({ reportKey, ext: "pdf" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.status(200).send(buffer);
}

router.get(
  "/reports/executive/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureExecutiveReportReadRole(req.auth);
    const query = parseSchema(executiveOverviewQuerySchema, req.query, "Invalid executive overview query");
    const window = normalizeExecutiveWindow(query);

    const scopedParams = [req.auth.schoolId, window.from, window.to];
    const scopedWhere = [
      "c.school_id = $1",
      "DATE(source_date) >= $2::date",
      "DATE(source_date) <= $3::date",
    ];

    if (query.classroom_id) {
      scopedParams.push(query.classroom_id);
      scopedWhere.push(`c.id = $${scopedParams.length}`);
    }
    if (query.section_id) {
      scopedParams.push(query.section_id);
      scopedWhere.push(`c.section_id = $${scopedParams.length}`);
    }
    if (query.academic_year_id) {
      scopedParams.push(query.academic_year_id);
      scopedWhere.push(`c.academic_year_id = $${scopedParams.length}`);
    }

    const attendanceTrendResult = await pool.query(
      `
        WITH scoped AS (
          SELECT
            ar.attendance_date::date AS source_date,
            ar.status
          FROM attendance_records ar
          JOIN classrooms c
            ON c.id = ar.classroom_id
           AND c.school_id = ar.school_id
          WHERE ${scopedWhere
            .join(" AND ")
            .replaceAll("source_date", "ar.attendance_date")}
        )
        SELECT
          DATE_TRUNC('week', source_date::timestamp)::date AS period_start,
          COUNT(*)::int AS total_records,
          COUNT(*) FILTER (WHERE status = 'present'::attendance_status)::int AS present_count,
          COUNT(*) FILTER (WHERE status = 'absent'::attendance_status)::int AS absent_count,
          COUNT(*) FILTER (WHERE status = 'late'::attendance_status)::int AS late_count,
          COUNT(*) FILTER (WHERE status = 'leave'::attendance_status)::int AS leave_count
        FROM scoped
        GROUP BY period_start
        ORDER BY period_start DESC
        LIMIT $${scopedParams.length + 1}
      `,
      [...scopedParams, query.trend_points]
    );

    const marksTrendResult = await pool.query(
      `
        WITH scoped AS (
          SELECT
            COALESCE(a.assessment_date, a.created_at::date)::date AS source_date,
            (sc.marks_obtained / NULLIF(a.max_marks, 0)) * 100 AS percentage
          FROM assessments a
          JOIN assessment_scores sc
            ON sc.school_id = a.school_id
           AND sc.assessment_id = a.id
          JOIN classrooms c
            ON c.id = a.classroom_id
           AND c.school_id = a.school_id
          WHERE ${scopedWhere
            .join(" AND ")
            .replaceAll("source_date", "COALESCE(a.assessment_date, a.created_at::date)")}
        )
        SELECT
          DATE_TRUNC('month', source_date::timestamp)::date AS period_start,
          COUNT(*)::int AS score_count,
          COALESCE(AVG(percentage), 0)::numeric AS avg_percentage
        FROM scoped
        GROUP BY period_start
        ORDER BY period_start DESC
        LIMIT $${scopedParams.length + 1}
      `,
      [...scopedParams, query.trend_points]
    );

    const homeworkByClassroomResult = await pool.query(
      `
        SELECT
          c.id AS classroom_id,
          c.grade_label,
          c.section_label,
          COUNT(*)::int AS total_assigned,
          COUNT(*) FILTER (
            WHERE COALESCE(hs.status, 'assigned'::homework_submission_status)
              IN ('submitted'::homework_submission_status, 'reviewed'::homework_submission_status)
          )::int AS completed_count
        FROM homework h
        JOIN classrooms c
          ON c.id = h.classroom_id
         AND c.school_id = h.school_id
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.status = 'active'
        LEFT JOIN homework_submissions hs
          ON hs.school_id = h.school_id
         AND hs.homework_id = h.id
         AND hs.student_id = se.student_id
        WHERE ${scopedWhere
          .join(" AND ")
          .replaceAll("source_date", "h.assigned_at::date")}
        GROUP BY c.id, c.grade_label, c.section_label
        ORDER BY total_assigned DESC
        LIMIT 10
      `,
      scopedParams
    );

    const feeAgingResult = await pool.query(
      `
        WITH scoped AS (
          SELECT
            fi.id,
            fi.due_date,
            GREATEST(fi.amount_due - fi.amount_paid, 0) AS outstanding_amount
          FROM fee_invoices fi
          LEFT JOIN LATERAL (
            SELECT se.classroom_id
            FROM student_enrollments se
            WHERE se.school_id = fi.school_id
              AND se.student_id = fi.student_id
              AND se.status = 'active'
            ORDER BY se.joined_on DESC NULLS LAST, se.created_at DESC
            LIMIT 1
          ) latest_enrollment ON TRUE
          LEFT JOIN classrooms c
            ON c.id = latest_enrollment.classroom_id
           AND c.school_id = fi.school_id
          WHERE fi.school_id = $1
            AND fi.period_end >= $2::date - INTERVAL '90 days'
            AND fi.period_start <= $3::date + INTERVAL '30 days'
            AND ($4::uuid IS NULL OR c.id = $4::uuid)
            AND ($5::uuid IS NULL OR c.section_id = $5::uuid)
        )
        SELECT
          COALESCE(SUM(outstanding_amount), 0)::numeric AS outstanding_total,
          COUNT(*) FILTER (
            WHERE outstanding_amount > 0
              AND due_date < CURRENT_DATE
          )::int AS overdue_invoices,
          COALESCE(
            SUM(
              CASE
                WHEN outstanding_amount > 0
                 AND due_date >= CURRENT_DATE
                THEN outstanding_amount
                ELSE 0
              END
            ),
            0
          )::numeric AS current_bucket_total,
          COALESCE(
            SUM(
              CASE
                WHEN outstanding_amount > 0
                 AND CURRENT_DATE - due_date BETWEEN 1 AND 30
                THEN outstanding_amount
                ELSE 0
              END
            ),
            0
          )::numeric AS bucket_1_30_total,
          COALESCE(
            SUM(
              CASE
                WHEN outstanding_amount > 0
                 AND CURRENT_DATE - due_date BETWEEN 31 AND 60
                THEN outstanding_amount
                ELSE 0
              END
            ),
            0
          )::numeric AS bucket_31_60_total,
          COALESCE(
            SUM(
              CASE
                WHEN outstanding_amount > 0
                 AND CURRENT_DATE - due_date > 60
                THEN outstanding_amount
                ELSE 0
              END
            ),
            0
          )::numeric AS bucket_61_plus_total
        FROM scoped
      `,
      [req.auth.schoolId, window.from, window.to, query.classroom_id || null, query.section_id || null]
    );

    const attendanceTrend = attendanceTrendResult.rows
      .map((row) => {
        const total = Number(row.total_records || 0);
        const present = Number(row.present_count || 0);
        return {
          period_start: row.period_start,
          total_records: total,
          present_count: present,
          absent_count: Number(row.absent_count || 0),
          late_count: Number(row.late_count || 0),
          leave_count: Number(row.leave_count || 0),
          present_rate: total > 0 ? Number(((present * 100) / total).toFixed(2)) : 0,
        };
      })
      .reverse();

    const marksTrend = marksTrendResult.rows
      .map((row) => ({
        period_start: row.period_start,
        score_count: Number(row.score_count || 0),
        avg_percentage: Number(parseNumeric(row.avg_percentage).toFixed(2)),
      }))
      .reverse();

    const homeworkByClassroom = homeworkByClassroomResult.rows.map((row) => {
      const totalAssigned = Number(row.total_assigned || 0);
      const completed = Number(row.completed_count || 0);
      return {
        classroom_id: row.classroom_id,
        classroom_label: `${row.grade_label || "Grade"} ${row.section_label || ""}`.trim(),
        total_assigned: totalAssigned,
        completed_count: completed,
        completion_rate: totalAssigned > 0 ? Number(((completed * 100) / totalAssigned).toFixed(2)) : 0,
      };
    });

    const feeAgingRow = feeAgingResult.rows[0] || {};
    const feeAging = {
      outstanding_total: parseNumeric(feeAgingRow.outstanding_total),
      overdue_invoices: Number(feeAgingRow.overdue_invoices || 0),
      current_bucket_total: parseNumeric(feeAgingRow.current_bucket_total),
      bucket_1_30_total: parseNumeric(feeAgingRow.bucket_1_30_total),
      bucket_31_60_total: parseNumeric(feeAgingRow.bucket_31_60_total),
      bucket_61_plus_total: parseNumeric(feeAgingRow.bucket_61_plus_total),
    };

    const attendanceKpi =
      attendanceTrend.length > 0
        ? Number(
            (
              attendanceTrend.reduce((acc, row) => acc + Number(row.present_rate || 0), 0) / attendanceTrend.length
            ).toFixed(2)
          )
        : 0;
    const marksKpi =
      marksTrend.length > 0
        ? Number((marksTrend.reduce((acc, row) => acc + Number(row.avg_percentage || 0), 0) / marksTrend.length).toFixed(2))
        : 0;

    const homeworkTotals = homeworkByClassroom.reduce(
      (acc, row) => {
        acc.total += Number(row.total_assigned || 0);
        acc.completed += Number(row.completed_count || 0);
        return acc;
      },
      { total: 0, completed: 0 }
    );
    const homeworkKpi =
      homeworkTotals.total > 0 ? Number(((homeworkTotals.completed * 100) / homeworkTotals.total).toFixed(2)) : 0;

    const alerts = [];
    if (attendanceKpi > 0 && attendanceKpi < 85) {
      alerts.push({
        key: "attendance_rate_low",
        severity: "warning",
        message: "Attendance trend is below 85% for the selected window.",
        value: attendanceKpi,
      });
    }
    if (marksKpi > 0 && marksKpi < 60) {
      alerts.push({
        key: "marks_average_low",
        severity: "critical",
        message: "Average marks trend is below 60%. Academic interventions are recommended.",
        value: marksKpi,
      });
    }
    if (homeworkKpi > 0 && homeworkKpi < 70) {
      alerts.push({
        key: "homework_completion_low",
        severity: "warning",
        message: "Homework completion trend is below 70%.",
        value: homeworkKpi,
      });
    }
    if (feeAging.outstanding_total > 0) {
      alerts.push({
        key: "fee_outstanding",
        severity: feeAging.bucket_61_plus_total > 0 ? "critical" : "warning",
        message: "Outstanding fee balance detected.",
        value: feeAging.outstanding_total,
      });
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "reports.executive.overview.viewed",
      entityName: "reports",
      metadata: {
        date_from: window.from,
        date_to: window.to,
        academic_year_id: query.academic_year_id || null,
        classroom_id: query.classroom_id || null,
        section_id: query.section_id || null,
      },
    });

    return success(res, {
      generated_at: new Date().toISOString(),
      window: {
        date_from: window.from,
        date_to: window.to,
      },
      kpis: {
        attendance_present_rate: attendanceKpi,
        marks_avg_percentage: marksKpi,
        homework_completion_rate: homeworkKpi,
        fee_outstanding_total: feeAging.outstanding_total,
        fee_overdue_invoices: feeAging.overdue_invoices,
      },
      attendance_trend: attendanceTrend,
      marks_trend: marksTrend,
      homework_by_classroom: homeworkByClassroom,
      fee_aging: feeAging,
      alerts,
    });
  })
);

async function buildAttendanceFilters(auth, query) {
  const params = [auth.schoolId];
  const where = ["ar.school_id = $1"];

  if (query.student_id) {
    params.push(query.student_id);
    where.push(`ar.student_id = $${params.length}`);
  }
  if (query.classroom_id) {
    params.push(query.classroom_id);
    where.push(`ar.classroom_id = $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`ar.attendance_date >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`ar.attendance_date <= $${params.length}`);
  }

  await appendStudentRoleScopeClause({
    auth,
    where,
    params,
    studentColumn: "ar.student_id",
    schoolColumn: "ar.school_id",
  });

  return { params, whereClause: where.join(" AND ") };
}

async function buildHomeworkFilters(auth, query) {
  const params = [auth.schoolId];
  const where = ["h.school_id = $1", "se.school_id = h.school_id", "se.classroom_id = h.classroom_id", "se.status = 'active'"];

  if (query.student_id) {
    params.push(query.student_id);
    where.push(`se.student_id = $${params.length}`);
  }
  if (query.classroom_id) {
    params.push(query.classroom_id);
    where.push(`h.classroom_id = $${params.length}`);
  }
  if (query.subject_id) {
    params.push(query.subject_id);
    where.push(`h.subject_id = $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`h.due_at::date >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`h.due_at::date <= $${params.length}`);
  }

  await appendStudentRoleScopeClause({
    auth,
    where,
    params,
    studentColumn: "se.student_id",
    schoolColumn: "se.school_id",
  });

  return { params, whereClause: where.join(" AND ") };
}

async function buildMarksFilters(auth, query) {
  const params = [auth.schoolId];
  const where = ["a.school_id = $1", "sc.school_id = a.school_id", "sc.assessment_id = a.id"];

  if (query.student_id) {
    params.push(query.student_id);
    where.push(`sc.student_id = $${params.length}`);
  }
  if (query.classroom_id) {
    params.push(query.classroom_id);
    where.push(`a.classroom_id = $${params.length}`);
  }
  if (query.subject_id) {
    params.push(query.subject_id);
    where.push(`a.subject_id = $${params.length}`);
  }
  if (query.assessment_type) {
    params.push(query.assessment_type);
    where.push(`a.assessment_type = $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`a.assessment_date >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`a.assessment_date <= $${params.length}`);
  }

  await appendStudentRoleScopeClause({
    auth,
    where,
    params,
    studentColumn: "sc.student_id",
    schoolColumn: "sc.school_id",
  });

  return { params, whereClause: where.join(" AND ") };
}

async function buildFeesFilters(auth, query) {
  const params = [auth.schoolId];
  const where = ["fi.school_id = $1"];

  if (query.student_id) {
    params.push(query.student_id);
    where.push(`fi.student_id = $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`fi.due_date >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`fi.due_date <= $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`fi.status = $${params.length}::invoice_status`);
  }

  await appendStudentRoleScopeClause({
    auth,
    where,
    params,
    studentColumn: "fi.student_id",
    schoolColumn: "fi.school_id",
  });

  return { params, whereClause: where.join(" AND ") };
}

router.get(
  "/reports/attendance/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportReadRole(req.auth);
    const query = parseSchema(commonFilterSchema, req.query, "Invalid attendance summary query");
    const filters = await buildAttendanceFilters(req.auth, query);

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(*) FILTER (WHERE ar.status = 'present'::attendance_status)::int AS present_count,
          COUNT(*) FILTER (WHERE ar.status = 'absent'::attendance_status)::int AS absent_count,
          COUNT(*) FILTER (WHERE ar.status = 'late'::attendance_status)::int AS late_count,
          COUNT(*) FILTER (WHERE ar.status = 'leave'::attendance_status)::int AS leave_count
        FROM attendance_records ar
        WHERE ${filters.whereClause}
      `,
      filters.params
    );

    const row = summaryResult.rows[0] || {};
    const total = Number(row.total_records || 0);
    const summary = {
      total_records: total,
      present_count: Number(row.present_count || 0),
      absent_count: Number(row.absent_count || 0),
      late_count: Number(row.late_count || 0),
      leave_count: Number(row.leave_count || 0),
      present_rate: total > 0 ? Number(((Number(row.present_count || 0) * 100) / total).toFixed(2)) : 0,
      absent_rate: total > 0 ? Number(((Number(row.absent_count || 0) * 100) / total).toFixed(2)) : 0,
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/reports/homework/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportReadRole(req.auth);
    const query = parseSchema(commonFilterSchema, req.query, "Invalid homework summary query");
    const filters = await buildHomeworkFilters(req.auth, query);

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_assigned,
          COUNT(*) FILTER (
            WHERE COALESCE(hs.status, 'assigned'::homework_submission_status)
              IN ('submitted'::homework_submission_status, 'reviewed'::homework_submission_status)
          )::int AS submitted_count,
          COUNT(*) FILTER (
            WHERE hs.status = 'reviewed'::homework_submission_status
          )::int AS reviewed_count,
          COUNT(*) FILTER (
            WHERE hs.status = 'missing'::homework_submission_status
               OR (
                 COALESCE(hs.status, 'assigned'::homework_submission_status) = 'assigned'::homework_submission_status
                 AND h.due_at IS NOT NULL
                 AND h.due_at < NOW()
               )
          )::int AS missing_count,
          COUNT(DISTINCT h.id)::int AS distinct_homework_count
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.status = 'active'
        LEFT JOIN homework_submissions hs
          ON hs.school_id = h.school_id
         AND hs.homework_id = h.id
         AND hs.student_id = se.student_id
        WHERE ${filters.whereClause}
      `,
      filters.params
    );

    const row = summaryResult.rows[0] || {};
    const totalAssigned = Number(row.total_assigned || 0);
    const submittedCount = Number(row.submitted_count || 0);
    const missingCount = Number(row.missing_count || 0);
    const pendingCount = Math.max(0, totalAssigned - submittedCount - missingCount);

    const summary = {
      distinct_homework_count: Number(row.distinct_homework_count || 0),
      total_assigned: totalAssigned,
      submitted_count: submittedCount,
      reviewed_count: Number(row.reviewed_count || 0),
      missing_count: missingCount,
      pending_count: pendingCount,
      completion_rate:
        totalAssigned > 0 ? Number(((submittedCount * 100) / totalAssigned).toFixed(2)) : 0,
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/reports/marks/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportReadRole(req.auth);
    const query = parseSchema(marksFilterSchema, req.query, "Invalid marks summary query");
    const filters = await buildMarksFilters(req.auth, query);

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS score_count,
          COUNT(DISTINCT a.id)::int AS assessment_count,
          COALESCE(AVG(sc.marks_obtained), 0)::numeric AS avg_marks_obtained,
          COALESCE(MAX(sc.marks_obtained), 0)::numeric AS max_marks_obtained,
          COALESCE(MIN(sc.marks_obtained), 0)::numeric AS min_marks_obtained,
          COALESCE(AVG((sc.marks_obtained / NULLIF(a.max_marks, 0)) * 100), 0)::numeric AS avg_percentage
        FROM assessments a
        JOIN assessment_scores sc
          ON sc.school_id = a.school_id
         AND sc.assessment_id = a.id
        WHERE ${filters.whereClause}
      `,
      filters.params
    );

    const row = summaryResult.rows[0] || {};
    const summary = {
      score_count: Number(row.score_count || 0),
      assessment_count: Number(row.assessment_count || 0),
      avg_marks_obtained: parseNumeric(row.avg_marks_obtained),
      max_marks_obtained: parseNumeric(row.max_marks_obtained),
      min_marks_obtained: parseNumeric(row.min_marks_obtained),
      avg_percentage: Number(parseNumeric(row.avg_percentage).toFixed(2)),
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/reports/fees/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureFeesReportReadRole(req.auth);
    const query = parseSchema(feesFilterSchema, req.query, "Invalid fees summary query");
    const filters = await buildFeesFilters(req.auth, query);

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_invoices,
          COUNT(*) FILTER (
            WHERE fi.amount_paid >= fi.amount_due
               OR fi.status = 'paid'::invoice_status
          )::int AS paid_count,
          COUNT(*) FILTER (
            WHERE fi.amount_paid < fi.amount_due
              AND fi.due_date < CURRENT_DATE
              AND fi.status IN (
                'issued'::invoice_status,
                'partial'::invoice_status,
                'overdue'::invoice_status
              )
          )::int AS overdue_count,
          COALESCE(SUM(fi.amount_due), 0)::numeric AS amount_due_total,
          COALESCE(SUM(fi.amount_paid), 0)::numeric AS amount_paid_total,
          COALESCE(SUM(fi.amount_due - fi.amount_paid), 0)::numeric AS outstanding_total,
          COALESCE(
            SUM(
              CASE
                WHEN fi.amount_paid < fi.amount_due
                  AND fi.due_date < CURRENT_DATE
                  AND fi.status IN (
                    'issued'::invoice_status,
                    'partial'::invoice_status,
                    'overdue'::invoice_status
                  )
                THEN fi.amount_due - fi.amount_paid
                ELSE 0
              END
            ),
            0
          )::numeric AS overdue_total
        FROM fee_invoices fi
        WHERE ${filters.whereClause}
      `,
      filters.params
    );

    const row = summaryResult.rows[0] || {};
    const summary = {
      total_invoices: Number(row.total_invoices || 0),
      paid_count: Number(row.paid_count || 0),
      overdue_count: Number(row.overdue_count || 0),
      amount_due_total: parseNumeric(row.amount_due_total),
      amount_paid_total: parseNumeric(row.amount_paid_total),
      outstanding_total: parseNumeric(row.outstanding_total),
      overdue_total: parseNumeric(row.overdue_total),
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/reports/attendance/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportExportRole(req.auth);
    const query = parseSchema(commonExportFilterSchema, req.query, "Invalid attendance export query");
    const filters = await buildAttendanceFilters(req.auth, query);
    const params = [...filters.params, query.max_rows];

    const rowsResult = await pool.query(
      `
        SELECT
          ar.id AS attendance_id,
          ar.attendance_date,
          ar.student_id,
          ar.classroom_id,
          ar.status,
          ar.check_in_at,
          ar.source,
          ar.note
        FROM attendance_records ar
        WHERE ${filters.whereClause}
        ORDER BY ar.attendance_date DESC, ar.created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    auditReportExport({
      auth: req.auth,
      actorUserId: req.auth.userId,
      reportType: "attendance",
      format: query.format,
      rowCount: rowsResult.rows.length,
      filters: {
        student_id: query.student_id || null,
        classroom_id: query.classroom_id || null,
        date_from: query.date_from || null,
        date_to: query.date_to || null,
      },
    });

    await sendExportFile({
      res,
      reportKey: "attendance",
      title: "Attendance Report",
      subtitle: `Generated at ${new Date().toISOString()}`,
      columns: [
        { key: "attendance_id", label: "attendance_id" },
        { key: "attendance_date", label: "attendance_date" },
        { key: "student_id", label: "student_id" },
        { key: "classroom_id", label: "classroom_id" },
        { key: "status", label: "status" },
        { key: "check_in_at", label: "check_in_at" },
        { key: "source", label: "source" },
        { key: "note", label: "note" },
      ],
      rows: rowsResult.rows,
      format: query.format,
    });
  })
);

router.get(
  "/reports/homework/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportExportRole(req.auth);
    const query = parseSchema(commonExportFilterSchema, req.query, "Invalid homework export query");
    const filters = await buildHomeworkFilters(req.auth, query);
    const params = [...filters.params, query.max_rows];

    const rowsResult = await pool.query(
      `
        SELECT
          h.id AS homework_id,
          h.classroom_id,
          h.subject_id,
          h.title,
          h.due_at,
          se.student_id,
          COALESCE(hs.status, 'assigned'::homework_submission_status) AS submission_status,
          hs.submitted_at,
          hs.graded_at,
          hs.score
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.status = 'active'
        LEFT JOIN homework_submissions hs
          ON hs.school_id = h.school_id
         AND hs.homework_id = h.id
         AND hs.student_id = se.student_id
        WHERE ${filters.whereClause}
        ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    auditReportExport({
      auth: req.auth,
      actorUserId: req.auth.userId,
      reportType: "homework",
      format: query.format,
      rowCount: rowsResult.rows.length,
      filters: {
        student_id: query.student_id || null,
        classroom_id: query.classroom_id || null,
        subject_id: query.subject_id || null,
        date_from: query.date_from || null,
        date_to: query.date_to || null,
      },
    });

    await sendExportFile({
      res,
      reportKey: "homework",
      title: "Homework Report",
      subtitle: `Generated at ${new Date().toISOString()}`,
      columns: [
        { key: "homework_id", label: "homework_id" },
        { key: "classroom_id", label: "classroom_id" },
        { key: "subject_id", label: "subject_id" },
        { key: "title", label: "title" },
        { key: "due_at", label: "due_at" },
        { key: "student_id", label: "student_id" },
        { key: "submission_status", label: "submission_status" },
        { key: "submitted_at", label: "submitted_at" },
        { key: "graded_at", label: "graded_at" },
        { key: "score", label: "score" },
      ],
      rows: rowsResult.rows,
      format: query.format,
    });
  })
);

router.get(
  "/reports/marks/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureAcademicReportExportRole(req.auth);
    const query = parseSchema(marksExportFilterSchema, req.query, "Invalid marks export query");
    const filters = await buildMarksFilters(req.auth, query);
    const params = [...filters.params, query.max_rows];

    const rowsResult = await pool.query(
      `
        SELECT
          a.id AS assessment_id,
          a.classroom_id,
          a.subject_id,
          a.title AS assessment_title,
          a.assessment_type,
          a.assessment_date,
          a.max_marks,
          sc.student_id,
          sc.marks_obtained,
          sc.remarks,
          CASE
            WHEN a.max_marks > 0 THEN ROUND((sc.marks_obtained / a.max_marks) * 100, 2)
            ELSE 0
          END AS percentage
        FROM assessments a
        JOIN assessment_scores sc
          ON sc.school_id = a.school_id
         AND sc.assessment_id = a.id
        WHERE ${filters.whereClause}
        ORDER BY a.assessment_date DESC NULLS LAST, a.created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    auditReportExport({
      auth: req.auth,
      actorUserId: req.auth.userId,
      reportType: "marks",
      format: query.format,
      rowCount: rowsResult.rows.length,
      filters: {
        student_id: query.student_id || null,
        classroom_id: query.classroom_id || null,
        subject_id: query.subject_id || null,
        assessment_type: query.assessment_type || null,
        date_from: query.date_from || null,
        date_to: query.date_to || null,
      },
    });

    await sendExportFile({
      res,
      reportKey: "marks",
      title: "Marks Report",
      subtitle: `Generated at ${new Date().toISOString()}`,
      columns: [
        { key: "assessment_id", label: "assessment_id" },
        { key: "classroom_id", label: "classroom_id" },
        { key: "subject_id", label: "subject_id" },
        { key: "assessment_title", label: "assessment_title" },
        { key: "assessment_type", label: "assessment_type" },
        { key: "assessment_date", label: "assessment_date" },
        { key: "max_marks", label: "max_marks" },
        { key: "student_id", label: "student_id" },
        { key: "marks_obtained", label: "marks_obtained" },
        { key: "percentage", label: "percentage" },
        { key: "remarks", label: "remarks" },
      ],
      rows: rowsResult.rows,
      format: query.format,
    });
  })
);

router.get(
  "/reports/fees/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureFeesReportExportRole(req.auth);
    const query = parseSchema(feesExportFilterSchema, req.query, "Invalid fees export query");
    const filters = await buildFeesFilters(req.auth, query);
    const params = [...filters.params, query.max_rows];

    const rowsResult = await pool.query(
      `
        SELECT
          fi.id AS invoice_id,
          fi.student_id,
          fi.period_start,
          fi.period_end,
          fi.due_date,
          fi.status,
          fi.amount_due,
          fi.amount_paid,
          (fi.amount_due - fi.amount_paid) AS outstanding_amount
        FROM fee_invoices fi
        WHERE ${filters.whereClause}
        ORDER BY fi.due_date DESC, fi.created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    auditReportExport({
      auth: req.auth,
      actorUserId: req.auth.userId,
      reportType: "fees",
      format: query.format,
      rowCount: rowsResult.rows.length,
      filters: {
        student_id: query.student_id || null,
        status: query.status || null,
        date_from: query.date_from || null,
        date_to: query.date_to || null,
      },
    });

    await sendExportFile({
      res,
      reportKey: "fees",
      title: "Fees Report",
      subtitle: `Generated at ${new Date().toISOString()}`,
      columns: [
        { key: "invoice_id", label: "invoice_id" },
        { key: "student_id", label: "student_id" },
        { key: "period_start", label: "period_start" },
        { key: "period_end", label: "period_end" },
        { key: "due_date", label: "due_date" },
        { key: "status", label: "status" },
        { key: "amount_due", label: "amount_due" },
        { key: "amount_paid", label: "amount_paid" },
        { key: "outstanding_amount", label: "outstanding_amount" },
      ],
      rows: rowsResult.rows,
      format: query.format,
    });
  })
);

module.exports = router;
