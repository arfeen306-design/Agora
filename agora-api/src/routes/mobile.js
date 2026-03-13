const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const studentPathSchema = z.object({ studentId: z.string().uuid() });

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const registerDeviceSchema = z.object({
  device_token: z.string().trim().min(10).max(500),
  platform: z.enum(["ios", "android", "web"]),
  app_version: z.string().trim().max(20).optional(),
  device_model: z.string().trim().max(120).optional(),
  os_version: z.string().trim().max(60).optional(),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", message,
      parsed.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })));
  }
  return parsed.data;
}

async function getStudentIdByUser(schoolId, userId) {
  const result = await pool.query(
    `SELECT sua.student_id FROM student_user_accounts sua
     JOIN students s ON s.id = sua.student_id AND s.school_id = $1
     WHERE sua.user_id = $2 LIMIT 1`,
    [schoolId, userId]
  );
  if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Student account not linked");
  return result.rows[0].student_id;
}

async function getParentStudentIds(schoolId, userId) {
  const result = await pool.query(
    `SELECT ps.student_id FROM parents p
     JOIN parent_students ps ON ps.parent_id = p.id AND ps.school_id = p.school_id
     WHERE p.school_id = $1 AND p.user_id = $2`,
    [schoolId, userId]
  );
  return result.rows.map((r) => r.student_id);
}

async function assertParentOwnsStudent(schoolId, userId, studentId) {
  const result = await pool.query(
    `SELECT 1 FROM parents p
     JOIN parent_students ps ON ps.parent_id = p.id AND ps.school_id = p.school_id
     WHERE p.school_id = $1 AND p.user_id = $2 AND ps.student_id = $3 LIMIT 1`,
    [schoolId, userId, studentId]
  );
  if (!result.rows[0]) throw new AppError(403, "FORBIDDEN", "No access to this student");
}

// ─── DEVICE REGISTRATION ────────────────────────────────────────────

router.post(
  "/devices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(registerDeviceSchema, req.body, "Invalid device registration");

    const result = await pool.query(
      `
        INSERT INTO user_devices (school_id, user_id, device_token, platform, app_version, device_model, os_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, device_token) DO UPDATE SET
          platform = EXCLUDED.platform, app_version = EXCLUDED.app_version,
          device_model = EXCLUDED.device_model, os_version = EXCLUDED.os_version,
          is_active = TRUE, last_seen_at = NOW(), updated_at = NOW()
        RETURNING *
      `,
      [req.auth.schoolId, req.auth.userId, body.device_token, body.platform,
       body.app_version || null, body.device_model || null, body.os_version || null]
    );
    return success(res, result.rows[0], 201);
  })
);

router.delete(
  "/devices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ device_token: z.string().trim().min(10) }).parse(req.body);
    await pool.query(
      "UPDATE user_devices SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1 AND device_token = $2",
      [req.auth.userId, body.device_token]
    );
    return success(res, { deregistered: true });
  })
);

// ─── PARENT QUICK SYNC ─────────────────────────────────────────────

router.get(
  "/sync/parent",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const studentIds = await getParentStudentIds(req.auth.schoolId, req.auth.userId);
    if (studentIds.length === 0) {
      return success(res, { children_count: 0, unread_notifications: 0, pending_homework: 0, overdue_fees: 0, upcoming_events: 0 });
    }

    const result = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM user_notifications WHERE user_id = $1 AND read_at IS NULL) AS unread_notifications,
          (
            SELECT COUNT(*)::int FROM homework h
            JOIN student_enrollments se ON se.school_id = h.school_id AND se.classroom_id = h.classroom_id
              AND se.student_id = ANY($3::uuid[]) AND se.status = 'active'
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = se.student_id AND hs.school_id = h.school_id
            WHERE h.school_id = $2 AND h.is_published = TRUE
              AND COALESCE(hs.status, 'assigned'::homework_submission_status) IN ('assigned'::homework_submission_status, 'missing'::homework_submission_status)
              AND (h.due_at IS NULL OR h.due_at >= NOW() - INTERVAL '3 days')
          ) AS pending_homework,
          (
            SELECT COUNT(*)::int FROM fee_invoices
            WHERE school_id = $2 AND student_id = ANY($3::uuid[]) AND status = 'overdue'::invoice_status
          ) AS overdue_fees,
          (
            SELECT COUNT(*)::int FROM events
            WHERE school_id = $2 AND starts_at >= NOW() AND starts_at <= NOW() + INTERVAL '7 days'
          ) AS upcoming_events
      `,
      [req.auth.userId, req.auth.schoolId, studentIds]
    );

    const row = result.rows[0] || {};
    return success(res, {
      children_count: studentIds.length,
      unread_notifications: Number(row.unread_notifications || 0),
      pending_homework: Number(row.pending_homework || 0),
      overdue_fees: Number(row.overdue_fees || 0),
      upcoming_events: Number(row.upcoming_events || 0),
    });
  })
);

// ─── STUDENT QUICK SYNC ────────────────────────────────────────────

router.get(
  "/sync/student",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    const result = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM user_notifications WHERE user_id = $1 AND read_at IS NULL) AS unread_notifications,
          (
            SELECT status::text FROM attendance_records
            WHERE school_id = $2 AND student_id = $3 AND attendance_date = CURRENT_DATE
            LIMIT 1
          ) AS today_attendance,
          (
            SELECT COUNT(*)::int FROM homework h
            JOIN student_enrollments se ON se.school_id = h.school_id AND se.classroom_id = h.classroom_id
              AND se.student_id = $3 AND se.status = 'active'
            LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = $3 AND hs.school_id = h.school_id
            WHERE h.school_id = $2 AND h.is_published = TRUE
              AND COALESCE(hs.status, 'assigned'::homework_submission_status) IN ('assigned'::homework_submission_status, 'missing'::homework_submission_status)
              AND (h.due_at IS NULL OR h.due_at >= NOW() - INTERVAL '3 days')
          ) AS pending_homework,
          (
            SELECT COALESCE(SUM(amount_due - amount_paid), 0)::numeric
            FROM fee_invoices WHERE school_id = $2 AND student_id = $3
              AND status NOT IN ('paid'::invoice_status, 'cancelled'::invoice_status)
          ) AS fee_balance
      `,
      [req.auth.userId, req.auth.schoolId, studentId]
    );

    // Today's timetable
    const dayOfWeek = new Date().getDay() || 7; // 1=Mon...7=Sun
    const timetableResult = await pool.query(
      `
        SELECT tp.period_number, tp.label, tp.starts_at, tp.ends_at, tp.is_break,
          sub.name AS subject_name, te.room_number
        FROM student_enrollments se
        JOIN timetable_entries te ON te.school_id = se.school_id AND te.classroom_id = se.classroom_id AND te.is_active = TRUE
        JOIN timetable_slots ts ON ts.id = te.slot_id AND ts.school_id = te.school_id AND ts.day_of_week = $4
        JOIN timetable_periods tp ON tp.id = ts.period_id AND tp.school_id = ts.school_id
        LEFT JOIN subjects sub ON sub.id = te.subject_id AND sub.school_id = te.school_id
        WHERE se.school_id = $1 AND se.student_id = $2 AND se.status = 'active'
        ORDER BY tp.period_number ASC
        LIMIT 20
      `,
      [req.auth.schoolId, studentId, studentId, dayOfWeek]
    );

    const row = result.rows[0] || {};
    return success(res, {
      unread_notifications: Number(row.unread_notifications || 0),
      today_attendance: row.today_attendance || null,
      pending_homework: Number(row.pending_homework || 0),
      fee_balance: Number(Number(row.fee_balance || 0).toFixed(2)),
      today_timetable: timetableResult.rows,
      tutor: {
        active_sessions: await pool.query(
          "SELECT COUNT(*)::int AS c FROM tutor_sessions WHERE school_id = $1 AND student_id = $2 AND status = 'active'",
          [req.auth.schoolId, studentId]
        ).then((r) => r.rows[0]?.c || 0),
        enabled: await pool.query(
          "SELECT is_enabled FROM tutor_configs WHERE school_id = $1",
          [req.auth.schoolId]
        ).then((r) => r.rows[0]?.is_enabled || false),
      },
    });
  })
);

// ─── UNIFIED FEED ───────────────────────────────────────────────────

router.get(
  "/feed",
  requireAuth,
  requireRoles("parent", "student"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery, req.query);
    const offset = (query.page - 1) * query.page_size;

    // Notifications + events merged
    const result = await pool.query(
      `
        (
          SELECT 'notification' AS feed_type, un.id, n.title, n.body AS description,
            n.channel::text AS channel, un.read_at, un.created_at AS feed_date
          FROM user_notifications un
          JOIN notifications n ON n.id = un.notification_id AND n.school_id = $2
          WHERE un.user_id = $1
          ORDER BY un.created_at DESC
          LIMIT $3
        )
        UNION ALL
        (
          SELECT 'event' AS feed_type, e.id, e.title, e.description,
            e.event_type AS channel, NULL AS read_at, e.starts_at AS feed_date
          FROM events e
          WHERE e.school_id = $2
            AND e.starts_at >= NOW() - INTERVAL '7 days'
            AND e.starts_at <= NOW() + INTERVAL '14 days'
          ORDER BY e.starts_at DESC
          LIMIT $3
        )
        ORDER BY feed_date DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.userId, req.auth.schoolId, query.page_size, offset]
    );

    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size },
    });
  })
);

// ─── PARENT: CHILD DISCIPLINE ───────────────────────────────────────

router.get(
  "/child/:studentId/discipline",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params);
    const query = parseSchema(paginationQuery, req.query);
    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE school_id = $1 AND student_id = $2",
      [req.auth.schoolId, studentId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT di.id, di.incident_type, di.description, di.severity, di.occurred_at,
          di.status, di.resolution, di.consequence,
          u.first_name AS reported_by_first, u.last_name AS reported_by_last
        FROM discipline_incidents di
        LEFT JOIN users u ON u.id = di.reported_by_user_id
        WHERE di.school_id = $1 AND di.student_id = $2
        ORDER BY di.occurred_at DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.schoolId, studentId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── PARENT: CHILD TRANSPORT ────────────────────────────────────────

router.get(
  "/child/:studentId/transport",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params);
    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const result = await pool.query(
      `
        SELECT ta.id, ta.direction, ta.is_active,
          tr.route_name, tr.route_code, tr.schedule_type,
          ts.stop_name, ts.pickup_time, ts.dropoff_time, ts.address,
          tv.vehicle_number, tv.vehicle_type, tv.driver_name, tv.driver_phone
        FROM transport_assignments ta
        JOIN transport_routes tr ON tr.id = ta.route_id AND tr.school_id = ta.school_id
        LEFT JOIN transport_stops ts ON ts.id = ta.stop_id
        LEFT JOIN transport_vehicles tv ON tv.route_id = tr.id AND tv.school_id = tr.school_id AND tv.is_active = TRUE
        WHERE ta.school_id = $1 AND ta.student_id = $2 AND ta.is_active = TRUE
      `,
      [req.auth.schoolId, studentId]
    );
    return success(res, result.rows);
  })
);

// ─── PARENT: CHILD REPORT CARDS ─────────────────────────────────────

router.get(
  "/child/:studentId/report-cards",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params);
    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const result = await pool.query(
      `
        SELECT rc.id, rc.status, rc.generated_at, rc.remarks, rc.grade_average,
          et.name AS exam_term_name, et.term_type,
          ay.name AS academic_year_name
        FROM report_cards rc
        JOIN exam_terms et ON et.id = rc.exam_term_id AND et.school_id = rc.school_id
        LEFT JOIN academic_years ay ON ay.id = et.academic_year_id AND ay.school_id = et.school_id
        WHERE rc.school_id = $1 AND rc.student_id = $2
        ORDER BY rc.generated_at DESC NULLS LAST
      `,
      [req.auth.schoolId, studentId]
    );
    return success(res, result.rows);
  })
);

// ─── PARENT: CHILD TUTOR QUICK ──────────────────────────────────────

router.get(
  "/child/:studentId/tutor-quick",
  requireAuth,
  requireRoles("parent"),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params);
    await assertParentOwnsStudent(req.auth.schoolId, req.auth.userId, studentId);

    const result = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_sessions,
          COALESCE(SUM(message_count), 0)::int AS total_messages,
          COUNT(DISTINCT subject_id)::int AS subjects_explored,
          MAX(started_at) AS last_session_at
        FROM tutor_sessions
        WHERE school_id = $1 AND student_id = $2
      `,
      [req.auth.schoolId, studentId]
    );

    // Recent session summaries
    const recentResult = await pool.query(
      `
        SELECT ts.topic, ts.summary, ts.started_at, ts.closed_at,
          sub.name AS subject_name
        FROM tutor_sessions ts
        LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.student_id = $2 AND ts.summary IS NOT NULL
        ORDER BY ts.started_at DESC LIMIT 5
      `,
      [req.auth.schoolId, studentId]
    );

    return success(res, {
      stats: result.rows[0] || {},
      recent_sessions: recentResult.rows,
    });
  })
);

// ─── STUDENT: OWN DISCIPLINE ────────────────────────────────────────

router.get(
  "/student/discipline",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);
    const query = parseSchema(paginationQuery, req.query);

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM discipline_incidents WHERE school_id = $1 AND student_id = $2",
      [req.auth.schoolId, studentId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT di.id, di.incident_type, di.description, di.severity, di.occurred_at,
          di.status, di.resolution, di.consequence
        FROM discipline_incidents di
        WHERE di.school_id = $1 AND di.student_id = $2
        ORDER BY di.occurred_at DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.schoolId, studentId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── STUDENT: OWN TRANSPORT ────────────────────────────────────────

router.get(
  "/student/transport",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    const result = await pool.query(
      `
        SELECT ta.id, ta.direction, ta.is_active,
          tr.route_name, tr.route_code, tr.schedule_type,
          ts.stop_name, ts.pickup_time, ts.dropoff_time, ts.address,
          tv.vehicle_number, tv.vehicle_type, tv.driver_name, tv.driver_phone
        FROM transport_assignments ta
        JOIN transport_routes tr ON tr.id = ta.route_id AND tr.school_id = ta.school_id
        LEFT JOIN transport_stops ts ON ts.id = ta.stop_id
        LEFT JOIN transport_vehicles tv ON tv.route_id = tr.id AND tv.school_id = tr.school_id AND tv.is_active = TRUE
        WHERE ta.school_id = $1 AND ta.student_id = $2 AND ta.is_active = TRUE
      `,
      [req.auth.schoolId, studentId]
    );
    return success(res, result.rows);
  })
);

// ─── STUDENT: OWN REPORT CARDS ──────────────────────────────────────

router.get(
  "/student/report-cards",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    const result = await pool.query(
      `
        SELECT rc.id, rc.status, rc.generated_at, rc.remarks, rc.grade_average,
          et.name AS exam_term_name, et.term_type,
          ay.name AS academic_year_name
        FROM report_cards rc
        JOIN exam_terms et ON et.id = rc.exam_term_id AND et.school_id = rc.school_id
        LEFT JOIN academic_years ay ON ay.id = et.academic_year_id AND ay.school_id = et.school_id
        WHERE rc.school_id = $1 AND rc.student_id = $2
        ORDER BY rc.generated_at DESC NULLS LAST
      `,
      [req.auth.schoolId, studentId]
    );
    return success(res, result.rows);
  })
);

// ─── STUDENT: TUTOR QUICK ──────────────────────────────────────────

router.get(
  "/student/tutor-quick",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    const result = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_sessions,
          COALESCE(SUM(message_count), 0)::int AS total_messages,
          COUNT(DISTINCT subject_id)::int AS subjects_explored,
          MAX(started_at) AS last_session_at
        FROM tutor_sessions
        WHERE school_id = $1 AND student_id = $2
      `,
      [req.auth.schoolId, studentId]
    );

    const enabledResult = await pool.query(
      "SELECT is_enabled FROM tutor_configs WHERE school_id = $1",
      [req.auth.schoolId]
    );

    return success(res, {
      tutor_enabled: enabledResult.rows[0]?.is_enabled || false,
      stats: result.rows[0] || {},
    });
  })
);

// ─── APP CHECK ──────────────────────────────────────────────────────

router.get(
  "/app-check",
  requireAuth,
  asyncHandler(async (req, res) => {
    const configResult = await pool.query(
      "SELECT * FROM app_configs WHERE school_id = $1 LIMIT 1",
      [req.auth.schoolId]
    );

    const config = configResult.rows[0];
    if (!config) {
      return success(res, {
        min_version: "1.0.0",
        latest_version: "1.0.0",
        force_update: false,
        maintenance_mode: false,
        maintenance_message: null,
        app_store_url: null,
        play_store_url: null,
      });
    }

    return success(res, {
      min_version: config.min_app_version,
      latest_version: config.latest_app_version,
      force_update: config.force_update,
      maintenance_mode: config.maintenance_mode,
      maintenance_message: config.maintenance_message,
      app_store_url: config.app_store_url,
      play_store_url: config.play_store_url,
    });
  })
);

module.exports = router;
