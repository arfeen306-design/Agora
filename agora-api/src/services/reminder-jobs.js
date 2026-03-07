const pool = require("../db");

function asInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

async function queueHomeworkDueReminders(client, config) {
  const withinHours = Math.max(1, asInt(config.reminders.homeworkDue.withinHours, 24));

  const result = await client.query(
    `
      WITH candidates AS (
        SELECT DISTINCT
          h.school_id,
          pu.id AS parent_user_id,
          s.id AS student_id,
          s.first_name AS student_first_name,
          h.id AS homework_id,
          h.title AS homework_title,
          h.due_at,
          ('homework_due:' || h.id::text || ':' || s.id::text) AS reminder_key
        FROM homework h
        JOIN student_enrollments se
          ON se.school_id = h.school_id
         AND se.classroom_id = h.classroom_id
         AND se.status = 'active'
        JOIN students s
          ON s.id = se.student_id
         AND s.school_id = h.school_id
        JOIN parent_students ps
          ON ps.school_id = h.school_id
         AND ps.student_id = s.id
        JOIN parents p
          ON p.id = ps.parent_id
         AND p.school_id = h.school_id
        JOIN users pu
          ON pu.id = p.user_id
         AND pu.school_id = h.school_id
         AND pu.is_active = TRUE
        LEFT JOIN homework_submissions hs
          ON hs.school_id = h.school_id
         AND hs.homework_id = h.id
         AND hs.student_id = s.id
         AND hs.status IN ('submitted'::homework_submission_status, 'reviewed'::homework_submission_status)
        WHERE h.is_published = TRUE
          AND h.due_at IS NOT NULL
          AND h.due_at > NOW()
          AND h.due_at <= NOW() + make_interval(hours => $1::int)
          AND hs.id IS NULL
      ),
      inserted AS (
        INSERT INTO notifications (
          school_id,
          user_id,
          title,
          body,
          channel,
          status,
          payload
        )
        SELECT
          c.school_id,
          c.parent_user_id,
          'Homework Due Reminder',
          format(
            '%s has homework "%s" due at %s.',
            c.student_first_name,
            c.homework_title,
            to_char(c.due_at, 'YYYY-MM-DD HH24:MI')
          ),
          'push'::notification_channel,
          'queued'::notification_status,
          jsonb_build_object(
            'source', 'reminder_worker',
            'reminder_type', 'homework_due',
            'reminder_key', c.reminder_key,
            'student_id', c.student_id,
            'homework_id', c.homework_id,
            'retry_count', 0,
            'next_retry_at', NULL
          )
        FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.school_id = c.school_id
            AND n.user_id = c.parent_user_id
            AND n.payload->>'reminder_key' = c.reminder_key
        )
        RETURNING id
      )
      SELECT COUNT(*)::int AS queued_count
      FROM inserted
    `,
    [withinHours]
  );

  return result.rows[0]?.queued_count || 0;
}

async function queueAttendanceAbsentReminders(client) {
  const result = await client.query(`
    WITH candidates AS (
      SELECT DISTINCT
        ar.school_id,
        pu.id AS parent_user_id,
        s.id AS student_id,
        s.first_name AS student_first_name,
        ar.id AS attendance_id,
        ar.attendance_date,
        ('attendance_absent:' || ar.id::text) AS reminder_key
      FROM attendance_records ar
      JOIN students s
        ON s.id = ar.student_id
       AND s.school_id = ar.school_id
      JOIN parent_students ps
        ON ps.school_id = ar.school_id
       AND ps.student_id = s.id
      JOIN parents p
        ON p.id = ps.parent_id
       AND p.school_id = ar.school_id
      JOIN users pu
        ON pu.id = p.user_id
       AND pu.school_id = ar.school_id
       AND pu.is_active = TRUE
      WHERE ar.attendance_date = CURRENT_DATE
        AND ar.status = 'absent'::attendance_status
    ),
    inserted AS (
      INSERT INTO notifications (
        school_id,
        user_id,
        title,
        body,
        channel,
        status,
        payload
      )
      SELECT
        c.school_id,
        c.parent_user_id,
        'Absence Alert',
        format(
          '%s is marked absent for %s.',
          c.student_first_name,
          c.attendance_date::text
        ),
        'push'::notification_channel,
        'queued'::notification_status,
        jsonb_build_object(
          'source', 'reminder_worker',
          'reminder_type', 'attendance_absent',
          'reminder_key', c.reminder_key,
          'student_id', c.student_id,
          'attendance_id', c.attendance_id,
          'attendance_date', c.attendance_date::text,
          'retry_count', 0,
          'next_retry_at', NULL
        )
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM notifications n
        WHERE n.school_id = c.school_id
          AND n.user_id = c.parent_user_id
          AND n.payload->>'reminder_key' = c.reminder_key
      )
      RETURNING id
    )
    SELECT COUNT(*)::int AS queued_count
    FROM inserted
  `);

  return result.rows[0]?.queued_count || 0;
}

async function queueOverdueFeeReminders(client) {
  const result = await client.query(`
    WITH candidates AS (
      SELECT DISTINCT
        fi.school_id,
        pu.id AS parent_user_id,
        s.id AS student_id,
        s.first_name AS student_first_name,
        fi.id AS invoice_id,
        fi.due_date,
        (fi.amount_due - fi.amount_paid) AS outstanding_amount,
        (CURRENT_DATE - fi.due_date) AS overdue_days,
        (
          'fee_overdue:' || fi.id::text || ':' || to_char(CURRENT_DATE, 'YYYYMMDD')
        ) AS reminder_key
      FROM fee_invoices fi
      JOIN students s
        ON s.id = fi.student_id
       AND s.school_id = fi.school_id
      JOIN parent_students ps
        ON ps.school_id = fi.school_id
       AND ps.student_id = s.id
      JOIN parents p
        ON p.id = ps.parent_id
       AND p.school_id = fi.school_id
      JOIN users pu
        ON pu.id = p.user_id
       AND pu.school_id = fi.school_id
       AND pu.is_active = TRUE
      WHERE fi.amount_paid < fi.amount_due
        AND fi.due_date < CURRENT_DATE
        AND fi.status IN ('issued'::invoice_status, 'partial'::invoice_status, 'overdue'::invoice_status)
    ),
    inserted AS (
      INSERT INTO notifications (
        school_id,
        user_id,
        title,
        body,
        channel,
        status,
        payload
      )
      SELECT
        c.school_id,
        c.parent_user_id,
        'Fee Overdue Reminder',
        format(
          'Fee is overdue for %s. Outstanding amount: %s (due date: %s, overdue by %s days).',
          c.student_first_name,
          to_char(c.outstanding_amount, 'FM999999990.00'),
          c.due_date::text,
          c.overdue_days::text
        ),
        'email'::notification_channel,
        'queued'::notification_status,
        jsonb_build_object(
          'source', 'reminder_worker',
          'reminder_type', 'fee_overdue',
          'reminder_key', c.reminder_key,
          'student_id', c.student_id,
          'invoice_id', c.invoice_id,
          'overdue_days', c.overdue_days,
          'outstanding_amount', c.outstanding_amount,
          'retry_count', 0,
          'next_retry_at', NULL
        )
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM notifications n
        WHERE n.school_id = c.school_id
          AND n.user_id = c.parent_user_id
          AND n.payload->>'reminder_key' = c.reminder_key
      )
      RETURNING id
    )
    SELECT COUNT(*)::int AS queued_count
    FROM inserted
  `);

  return result.rows[0]?.queued_count || 0;
}

async function runReminderCycle(config) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const summary = {
      homework_due: 0,
      attendance_absent: 0,
      fee_overdue: 0,
      total: 0,
    };

    if (config.reminders.homeworkDue.enabled) {
      summary.homework_due = await queueHomeworkDueReminders(client, config);
    }
    if (config.reminders.attendanceAbsent.enabled) {
      summary.attendance_absent = await queueAttendanceAbsentReminders(client);
    }
    if (config.reminders.feeOverdue.enabled) {
      summary.fee_overdue = await queueOverdueFeeReminders(client);
    }

    summary.total = summary.homework_due + summary.attendance_absent + summary.fee_overdue;

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  runReminderCycle,
};
