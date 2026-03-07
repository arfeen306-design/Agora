const config = require("../config");
const pool = require("../db");
const { dispatchNotification } = require("../services/notification-dispatcher");

let shouldStop = false;

async function stopWorker(signal) {
  shouldStop = true;
  // eslint-disable-next-line no-console
  console.log(`[worker] received ${signal}, shutting down...`);
  await pool.end().catch(() => {});
}

function safeRetryCount(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const raw = payload.retry_count;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) return Number(raw);
  return 0;
}

function computeBackoffSeconds(attempt) {
  const base = Math.max(1, Number(config.notifications.worker.baseBackoffSeconds || 30));
  const max = Math.max(base, Number(config.notifications.worker.maxBackoffSeconds || 1800));
  const value = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(max, value);
}

function parseJsonPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return payload;
}

async function claimNextNotification(client) {
  const maxRetries = Math.max(1, Number(config.notifications.worker.maxRetries || 3));

  const result = await client.query(
    `
      WITH candidates AS (
        SELECT
          n.id,
          n.school_id,
          n.user_id,
          n.title,
          n.body,
          n.channel,
          n.status,
          n.payload,
          n.created_at
        FROM notifications n
        WHERE
          n.status = 'queued'::notification_status
          OR (
            n.status = 'failed'::notification_status
            AND (
              CASE
                WHEN COALESCE(n.payload->>'retry_count', '') ~ '^[0-9]+$'
                  THEN (n.payload->>'retry_count')::int
                ELSE 0
              END
            ) < $1
            AND (
              COALESCE(n.payload->>'next_retry_at', '') = ''
              OR (
                COALESCE(n.payload->>'next_retry_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                AND (n.payload->>'next_retry_at')::timestamptz <= NOW()
              )
            )
          )
        ORDER BY
          CASE WHEN n.status = 'queued'::notification_status THEN 0 ELSE 1 END,
          n.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      SELECT *
      FROM candidates
    `,
    [maxRetries]
  );

  return result.rows[0] || null;
}

async function markNotificationSent(client, notification, dispatchMeta) {
  const payload = parseJsonPayload(notification.payload);
  const patch = {
    ...payload,
    last_attempt_at: new Date().toISOString(),
    last_error: null,
    next_retry_at: null,
    dispatch: dispatchMeta,
  };

  const result = await client.query(
    `
      UPDATE notifications
      SET
        status = 'sent'::notification_status,
        sent_at = COALESCE(sent_at, NOW()),
        payload = $2::jsonb
      WHERE id = $1
      RETURNING id, status, channel, user_id, sent_at
    `,
    [notification.id, JSON.stringify(patch)]
  );
  return result.rows[0] || null;
}

async function markNotificationFailed(client, notification, error) {
  const payload = parseJsonPayload(notification.payload);
  const previousRetries = safeRetryCount(payload);
  const nextRetryCount = previousRetries + 1;
  const maxRetries = Math.max(1, Number(config.notifications.worker.maxRetries || 3));
  const shouldRetryAgain = nextRetryCount < maxRetries;
  const backoffSeconds = shouldRetryAgain ? computeBackoffSeconds(nextRetryCount) : null;

  const nextRetryAt = shouldRetryAgain
    ? new Date(Date.now() + backoffSeconds * 1000).toISOString()
    : null;

  const patch = {
    ...payload,
    retry_count: nextRetryCount,
    last_attempt_at: new Date().toISOString(),
    last_error: String(error?.message || "Unknown dispatch error").slice(0, 500),
    next_retry_at: nextRetryAt,
    retries_exhausted: !shouldRetryAgain,
  };

  const result = await client.query(
    `
      UPDATE notifications
      SET
        status = 'failed'::notification_status,
        payload = $2::jsonb
      WHERE id = $1
      RETURNING id, status, channel, user_id, payload
    `,
    [notification.id, JSON.stringify(patch)]
  );
  return result.rows[0] || null;
}

async function processOneNotification() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const notification = await claimNextNotification(client);
    if (!notification) {
      await client.query("COMMIT");
      return { processed: false };
    }

    try {
      const dispatchResult = await dispatchNotification(notification, config);
      const saved = await markNotificationSent(client, notification, dispatchResult);
      await client.query("COMMIT");
      return { processed: true, success: true, notification: saved };
    } catch (dispatchError) {
      const saved = await markNotificationFailed(client, notification, dispatchError);
      await client.query("COMMIT");
      return { processed: true, success: false, notification: saved, error: dispatchError };
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runBatch() {
  const batchSize = Math.max(1, Number(config.notifications.worker.batchSize || 20));
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batchSize; i += 1) {
    const result = await processOneNotification();
    if (!result.processed) {
      break;
    }
    processed += 1;
    if (result.success) {
      sent += 1;
      // eslint-disable-next-line no-console
      console.log(`[worker] sent notification ${result.notification?.id || "unknown"}`);
    } else {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(
        `[worker] failed notification ${result.notification?.id || "unknown"}: ${
          result.error?.message || "unknown error"
        }`
      );
    }
  }

  return { processed, sent, failed };
}

async function startWorker() {
  const intervalMs = Math.max(500, Number(config.notifications.worker.intervalMs || 5000));
  const runOnce = Boolean(config.notifications.worker.runOnce);

  // eslint-disable-next-line no-console
  console.log(
    `[worker] notification worker started interval=${intervalMs}ms batch=${config.notifications.worker.batchSize} maxRetries=${config.notifications.worker.maxRetries} runOnce=${runOnce}`
  );

  const cycle = async () => {
    const summary = await runBatch();
    if (summary.processed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[worker] cycle complete processed=${summary.processed} sent=${summary.sent} failed=${summary.failed}`
      );
    }
  };

  if (runOnce) {
    await cycle();
    await pool.end();
    return;
  }

  process.once("SIGINT", () => {
    stopWorker("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopWorker("SIGTERM");
  });

  // Keep worker alive and polling.
  while (!shouldStop) {
    try {
      await cycle();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[worker] cycle error: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

startWorker().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(`[worker] fatal error: ${error.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
