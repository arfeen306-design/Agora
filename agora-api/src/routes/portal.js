const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const studentPathSchema = z.object({
  studentId: z.string().uuid(),
});

const paginationSchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

async function getParentLinkedStudents(schoolId, userId) {
  const result = await pool.query(
    `
      SELECT
        s.id AS student_id,
        s.student_code,
        s.first_name,
        s.last_name,
        s.status,
        se.classroom_id,
        c.grade_label,
        c.section_label,
        ps.relation_type,
        ps.is_primary
      FROM parents p
      JOIN parent_students ps
        ON ps.parent_id = p.id
       AND ps.school_id = p.school_id
      JOIN students s
        ON s.id = ps.student_id
       AND s.school_id = ps.school_id
      LEFT JOIN student_enrollments se
        ON se.student_id = s.id
       AND se.school_id = s.school_id
       AND se.status = 'active'
      LEFT JOIN classrooms c
        ON c.id = se.classroom_id
       AND c.school_id = se.school_id
      WHERE p.school_id = $1
        AND p.user_id = $2
      ORDER BY s.first_name ASC, s.last_name ASC
    `,
    [schoolId, userId]
  );
  return result.rows;
}

async function assertParentOwnsStudent(schoolId, userId, studentId) {
  const result = await pool.query(
    `
      SELECT 1
      FROM parents p
      JOIN parent_students ps
        ON ps.parent_id = p.id
       AND ps.school_id = p.school_id
      WHERE p.school_id = $1
        AND p.user_id = $2
        AND ps.student_id = $3
      LIMIT 1
    `,
    [schoolId, userId, studentId]
  );
  if (!result.rows[0]) {
    throw new AppError(403, "FORBIDDEN", "You do not have access to this student");
  }
}

async function getStudentIdByUser(schoolId, userId) {
  const result = await pool.query(
    `
      SELECT sua.student_id
      FROM student_user_accounts sua
      JOIN students s ON s.id = sua.student_id AND s.school_id = $1
      WHERE sua.user_id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );
  if (!result.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Student account not linked");
  }
  return result.rows[0].student_id;
}

function normalizeWindow(query) {
  const now = new Date();
  const to = query.date_to ? new Date(`${query.date_to}T00:00:00.000Z`) : now;
  const from = query.date_from
    ? new Date(`${query.date_from}T00:00:00.000Z`)
    : new Date(to.getTime() - 1000 * 60 * 60 * 24 * 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ─── GET /portal/parent/dashboard ───────────────────────────────────
// Aggregated parent dashboard: linked students, attendance, marks, homework, fees, events
router.get(
  "/parent/dashboard",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const children = await getParentLinkedStudents(req.auth.schoolId, req.auth.userId);
    const studentIds = children.map((c) => c.student_id);

    if (studentIds.length === 0) {
      return success(res, {
        children: [],
        attendance_summary: {},
        recent_marks: [],
        pending_homework: [],
        fee_summary: {},
        upcoming_events: [],
      });
    }

    // Attendance summary (last 30 days)
    const attendanceResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(*) FILTER (WHERE status = 'present'::attendance_status)::int AS present,
          COUNT(*) FILTER (WHERE status = 'absent'::attendance_status)::int AS absent,
          COUNT(*) FILTER (WHERE status = 'late'::attendance_status)::int AS late,
          COUNT(*) FILTER (WHERE status = 'leave'::attendance_status)::int AS on_leave
        FROM attendance_records
        WHERE school_id = $1
          AND student_id = ANY($2::uuid[])
          AND attendance_date >= (CURRENT_DATE - INTERVAL '30 days')
      `,
      [req.auth.schoolId, studentIds]
    );

    // Recent marks (last 5 assessments)
    const marksResult = await pool.query(
      `
        SELECT
          sc.student_id,
          a.title AS assessment_title,
          a.assessment_type,
          sc.marks_obtained,
          a.max_marks,
          ROUND(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100, 2) AS percentage,
          COALESCE(a.assessment_date, a.created_at::date) AS assessment_date,
          sub.name AS subject_name
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id AND a.school_id = sc.school_id
        LEFT JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id
        WHERE sc.school_id = $1
          AND sc.student_id = ANY($2::uuid[])
        ORDER BY COALESCE(a.assessment_date, a.created_at::date) DESC
        LIMIT 10
      `,
      [req.auth.schoolId, studentIds]
    );

    // Pending homework
    const homeworkResult = await pool.query(
      `
        SELECT
          h.id AS homework_id,
          h.title,
          h.due_at,
          h.classroom_id,
          sub.name AS subject_name,
          hs.status AS submission_status,
          hs.student_id
        FROM homework h
        LEFT JOIN subjects sub ON sub.id = h.subject_id AND sub.school_id = h.school_id
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.status = 'active'
         AND se.student_id = ANY($2::uuid[])
        LEFT JOIN homework_submissions hs
          ON hs.homework_id = h.id
         AND hs.student_id = se.student_id
         AND hs.school_id = h.school_id
        WHERE h.school_id = $1
          AND h.is_published = TRUE
          AND COALESCE(hs.status, 'assigned'::homework_submission_status) IN ('assigned'::homework_submission_status, 'missing'::homework_submission_status)
          AND (h.due_at IS NULL OR h.due_at >= NOW() - INTERVAL '7 days')
        ORDER BY h.due_at ASC NULLS LAST
        LIMIT 15
      `,
      [req.auth.schoolId, studentIds]
    );

    // Fee summary
    const feeResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(amount_due), 0)::numeric AS total_due,
          COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
          COALESCE(SUM(amount_due - amount_paid), 0)::numeric AS balance,
          COUNT(*) FILTER (WHERE status = 'overdue'::invoice_status)::int AS overdue_count
        FROM fee_invoices
        WHERE school_id = $1
          AND student_id = ANY($2::uuid[])
      `,
      [req.auth.schoolId, studentIds]
    );

    // Upcoming events (next 14 days)
    const eventsResult = await pool.query(
      `
        SELECT
          id, title, description, event_type, starts_at, ends_at, target_scope
        FROM events
        WHERE school_id = $1
          AND starts_at >= NOW()
          AND starts_at <= NOW() + INTERVAL '14 days'
        ORDER BY starts_at ASC
        LIMIT 10
      `,
      [req.auth.schoolId]
    );

    return success(res, {
      children,
      attendance_summary: attendanceResult.rows[0] || {},
      recent_marks: marksResult.rows,
      pending_homework: homeworkResult.rows,
      fee_summary: {
        total_due: Number(feeResult.rows[0]?.total_due || 0),
        total_paid: Number(feeResult.rows[0]?.total_paid || 0),
        balance: Number(feeResult.rows[0]?.balance || 0),
        overdue_count: feeResult.rows[0]?.overdue_count || 0,
      },
      upcoming_events: eventsResult.rows,
    });
  })
);

// ─── GET /portal/parent/children ────────────────────────────────────
router.get(
  "/parent/children",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const children = await getParentLinkedStudents(req.auth.schoolId, req.auth.userId);
    return success(res, children);
  })
);

// ─── GET /portal/parent/child/:studentId/attendance ─────────────────
router.get(
  "/parent/child/:studentId/attendance",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params, "Invalid student ID");
    const query = parseSchema(paginationSchema, req.query, "Invalid query");
    const window = normalizeWindow(query);

    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const params = [req.auth.schoolId, studentId, window.from, window.to];

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM attendance_records
        WHERE school_id = $1 AND student_id = $2
          AND attendance_date >= $3::date AND attendance_date <= $4::date
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listResult = await pool.query(
      `
        SELECT
          ar.id, ar.attendance_date, ar.status, ar.check_in_at, ar.source, ar.note,
          c.grade_label, c.section_label
        FROM attendance_records ar
        LEFT JOIN classrooms c ON c.id = ar.classroom_id AND c.school_id = ar.school_id
        WHERE ar.school_id = $1 AND ar.student_id = $2
          AND ar.attendance_date >= $3::date AND ar.attendance_date <= $4::date
        ORDER BY ar.attendance_date DESC
        LIMIT $5 OFFSET $6
      `,
      [...params, query.page_size, offset]
    );

    return success(res, listResult.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /portal/parent/child/:studentId/academics ──────────────────
router.get(
  "/parent/child/:studentId/academics",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params, "Invalid student ID");
    const query = parseSchema(paginationSchema, req.query, "Invalid query");

    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const params = [req.auth.schoolId, studentId];

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM assessment_scores WHERE school_id = $1 AND student_id = $2`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listResult = await pool.query(
      `
        SELECT
          sc.id, sc.marks_obtained, sc.remarks,
          a.title AS assessment_title, a.assessment_type, a.max_marks,
          COALESCE(a.assessment_date, a.created_at::date) AS assessment_date,
          ROUND(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100, 2) AS percentage,
          sub.name AS subject_name, sub.code AS subject_code
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id AND a.school_id = sc.school_id
        LEFT JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id
        WHERE sc.school_id = $1 AND sc.student_id = $2
        ORDER BY COALESCE(a.assessment_date, a.created_at::date) DESC
        LIMIT $3 OFFSET $4
      `,
      [...params, query.page_size, offset]
    );

    return success(res, listResult.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /portal/parent/child/:studentId/homework ───────────────────
router.get(
  "/parent/child/:studentId/homework",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params, "Invalid student ID");
    const query = parseSchema(paginationSchema, req.query, "Invalid query");

    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const params = [req.auth.schoolId, studentId];

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.student_id = $2
         AND se.status = 'active'
        WHERE h.school_id = $1 AND h.is_published = TRUE
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listResult = await pool.query(
      `
        SELECT
          h.id AS homework_id, h.title, h.description, h.assigned_at, h.due_at,
          sub.name AS subject_name,
          hs.status AS submission_status, hs.submitted_at, hs.score, hs.feedback
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.student_id = $2
         AND se.status = 'active'
        LEFT JOIN subjects sub ON sub.id = h.subject_id AND sub.school_id = h.school_id
        LEFT JOIN homework_submissions hs
          ON hs.homework_id = h.id AND hs.student_id = $2 AND hs.school_id = h.school_id
        WHERE h.school_id = $1 AND h.is_published = TRUE
        ORDER BY h.due_at DESC NULLS LAST, h.assigned_at DESC
        LIMIT $3 OFFSET $4
      `,
      [...params, query.page_size, offset]
    );

    return success(res, listResult.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /portal/parent/child/:studentId/fees ───────────────────────
router.get(
  "/parent/child/:studentId/fees",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params, "Invalid student ID");
    const query = parseSchema(paginationSchema, req.query, "Invalid query");

    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const params = [req.auth.schoolId, studentId];

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM fee_invoices WHERE school_id = $1 AND student_id = $2`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listResult = await pool.query(
      `
        SELECT
          fi.id, fi.period_start, fi.period_end, fi.amount_due, fi.amount_paid,
          (fi.amount_due - fi.amount_paid) AS balance,
          fi.due_date, fi.status, fi.issued_at,
          fp.title AS plan_title
        FROM fee_invoices fi
        LEFT JOIN fee_plans fp ON fp.id = fi.fee_plan_id AND fp.school_id = fi.school_id
        WHERE fi.school_id = $1 AND fi.student_id = $2
        ORDER BY fi.due_date DESC
        LIMIT $3 OFFSET $4
      `,
      [...params, query.page_size, offset]
    );

    // Summary
    const summaryResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(amount_due), 0)::numeric AS total_due,
          COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
          COALESCE(SUM(amount_due - amount_paid), 0)::numeric AS balance,
          COUNT(*) FILTER (WHERE status = 'overdue'::invoice_status)::int AS overdue_count
        FROM fee_invoices
        WHERE school_id = $1 AND student_id = $2
      `,
      params
    );

    return success(res, {
      invoices: listResult.rows,
      summary: {
        total_due: Number(summaryResult.rows[0]?.total_due || 0),
        total_paid: Number(summaryResult.rows[0]?.total_paid || 0),
        balance: Number(summaryResult.rows[0]?.balance || 0),
        overdue_count: summaryResult.rows[0]?.overdue_count || 0,
      },
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /portal/student/dashboard ──────────────────────────────────
router.get(
  "/student/dashboard",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    // Enrollment info
    const enrollmentResult = await pool.query(
      `
        SELECT
          se.classroom_id, c.grade_label, c.section_label,
          ay.name AS academic_year
        FROM student_enrollments se
        JOIN classrooms c ON c.id = se.classroom_id AND c.school_id = se.school_id
        JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.school_id = se.school_id
        WHERE se.school_id = $1 AND se.student_id = $2 AND se.status = 'active'
        ORDER BY ay.is_current DESC, ay.starts_on DESC
        LIMIT 1
      `,
      [req.auth.schoolId, studentId]
    );

    // Attendance (last 30 days)
    const attendanceResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'present'::attendance_status)::int AS present,
          COUNT(*) FILTER (WHERE status = 'absent'::attendance_status)::int AS absent,
          COUNT(*) FILTER (WHERE status = 'late'::attendance_status)::int AS late
        FROM attendance_records
        WHERE school_id = $1 AND student_id = $2
          AND attendance_date >= (CURRENT_DATE - INTERVAL '30 days')
      `,
      [req.auth.schoolId, studentId]
    );

    // Recent marks
    const marksResult = await pool.query(
      `
        SELECT
          a.title, a.assessment_type, sc.marks_obtained, a.max_marks,
          ROUND(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100, 2) AS percentage,
          COALESCE(a.assessment_date, a.created_at::date) AS assessment_date,
          sub.name AS subject_name
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id AND a.school_id = sc.school_id
        LEFT JOIN subjects sub ON sub.id = a.subject_id AND sub.school_id = a.school_id
        WHERE sc.school_id = $1 AND sc.student_id = $2
        ORDER BY COALESCE(a.assessment_date, a.created_at::date) DESC
        LIMIT 10
      `,
      [req.auth.schoolId, studentId]
    );

    // Pending homework
    const homeworkResult = await pool.query(
      `
        SELECT
          h.id, h.title, h.due_at, sub.name AS subject_name,
          COALESCE(hs.status, 'assigned'::homework_submission_status) AS submission_status
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id AND se.classroom_id = h.classroom_id
         AND se.student_id = $2 AND se.status = 'active'
        LEFT JOIN subjects sub ON sub.id = h.subject_id AND sub.school_id = h.school_id
        LEFT JOIN homework_submissions hs
          ON hs.homework_id = h.id AND hs.student_id = $2 AND hs.school_id = h.school_id
        WHERE h.school_id = $1 AND h.is_published = TRUE
          AND COALESCE(hs.status, 'assigned'::homework_submission_status)
              IN ('assigned'::homework_submission_status, 'missing'::homework_submission_status)
          AND (h.due_at IS NULL OR h.due_at >= NOW() - INTERVAL '7 days')
        ORDER BY h.due_at ASC NULLS LAST
        LIMIT 10
      `,
      [req.auth.schoolId, studentId]
    );

    // Fee summary
    const feeResult = await pool.query(
      `
        SELECT
          COALESCE(SUM(amount_due), 0)::numeric AS total_due,
          COALESCE(SUM(amount_paid), 0)::numeric AS total_paid,
          COALESCE(SUM(amount_due - amount_paid), 0)::numeric AS balance
        FROM fee_invoices
        WHERE school_id = $1 AND student_id = $2
      `,
      [req.auth.schoolId, studentId]
    );

    // Tutor stats
    const tutorResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_sessions,
          COUNT(DISTINCT subject_id)::int AS subjects_explored,
          MAX(started_at) AS last_session_at
        FROM tutor_sessions
        WHERE school_id = $1 AND student_id = $2
      `,
      [req.auth.schoolId, studentId]
    );

    return success(res, {
      student_id: studentId,
      enrollment: enrollmentResult.rows[0] || null,
      attendance_summary: attendanceResult.rows[0] || {},
      recent_marks: marksResult.rows,
      pending_homework: homeworkResult.rows,
      fee_summary: {
        total_due: Number(feeResult.rows[0]?.total_due || 0),
        total_paid: Number(feeResult.rows[0]?.total_paid || 0),
        balance: Number(feeResult.rows[0]?.balance || 0),
      },
      tutor_stats: tutorResult.rows[0] || { total_sessions: 0, active_sessions: 0, subjects_explored: 0 },
    });
  })
);

// ─── GET /portal/student/timetable ──────────────────────────────────
router.get(
  "/student/timetable",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const dayQuery = z
      .object({ day_of_week: z.coerce.number().int().min(1).max(7).optional() })
      .parse(req.query);

    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    // Find student's current classroom
    const enrollmentResult = await pool.query(
      `
        SELECT se.classroom_id
        FROM student_enrollments se
        WHERE se.school_id = $1 AND se.student_id = $2 AND se.status = 'active'
        ORDER BY se.created_at DESC
        LIMIT 1
      `,
      [req.auth.schoolId, studentId]
    );

    if (!enrollmentResult.rows[0]) {
      return success(res, { entries: [], message: "No active enrollment found" });
    }

    const classroomId = enrollmentResult.rows[0].classroom_id;
    const params = [req.auth.schoolId, classroomId];
    const where = ["te.school_id = $1", "te.classroom_id = $2", "te.is_active = TRUE"];

    if (dayQuery.day_of_week) {
      params.push(dayQuery.day_of_week);
      where.push(`ts.day_of_week = $${params.length}`);
    }

    const result = await pool.query(
      `
        SELECT
          te.id AS entry_id,
          ts.day_of_week,
          tp.period_number, tp.label AS period_label,
          tp.starts_at, tp.ends_at, tp.is_break,
          te.entry_type, te.room_number, te.notes,
          sub.name AS subject_name, sub.code AS subject_code,
          tu.first_name AS teacher_first_name, tu.last_name AS teacher_last_name
        FROM timetable_entries te
        JOIN timetable_slots ts ON ts.id = te.slot_id AND ts.school_id = te.school_id
        JOIN timetable_periods tp ON tp.id = ts.period_id AND tp.school_id = ts.school_id
        LEFT JOIN subjects sub ON sub.id = te.subject_id AND sub.school_id = te.school_id
        LEFT JOIN teachers t ON t.id = te.teacher_id AND t.school_id = te.school_id
        LEFT JOIN users tu ON tu.id = t.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ts.day_of_week ASC, tp.period_number ASC
      `,
      params
    );

    return success(res, {
      classroom_id: classroomId,
      entries: result.rows,
    });
  })
);

module.exports = router;
