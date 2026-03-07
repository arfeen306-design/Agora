const config = require("../config");
const pool = require("../db");

async function fetchNotificationWorkerSnapshot() {
  const maxRetries = Math.max(1, Number(config.notifications.worker.maxRetries || 3));
  const result = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (
          WHERE
            status = 'failed'
            AND (
              CASE
                WHEN COALESCE(payload->>'retry_count', '') ~ '^[0-9]+$'
                  THEN (payload->>'retry_count')::int
                ELSE 0
              END
            ) < $1
        )::int AS failed_with_retry_remaining,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'queued'))) / 60.0,
          0
        ) AS oldest_queued_minutes,
        MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent_at
      FROM notifications
    `,
    [maxRetries]
  );

  const row = result.rows[0] || {};
  return {
    queued_count: Number(row.queued_count || 0),
    failed_with_retry_remaining: Number(row.failed_with_retry_remaining || 0),
    oldest_queued_minutes: Math.round(Number(row.oldest_queued_minutes || 0) * 100) / 100,
    last_sent_at: row.last_sent_at || null,
  };
}

module.exports = {
  fetchNotificationWorkerSnapshot,
};
