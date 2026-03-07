const express = require("express");

const config = require("../config");
const pool = require("../db");
const { requireInternalApiKey } = require("../middleware/internal-key");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const { getObservabilitySnapshot, getSloSnapshot } = require("../utils/observability");

const router = express.Router();

function evaluateWorkerAlerts(workerSnapshot) {
  const alerts = [];
  const queueDepth = Number(workerSnapshot.queued_count || 0);
  const oldestQueuedMinutes = Number(workerSnapshot.oldest_queued_minutes || 0);
  const failedPending = Number(workerSnapshot.failed_with_retry_remaining || 0);

  if (queueDepth >= config.alerts.workerQueueDepthCritical) {
    alerts.push({
      key: "worker_queue_depth",
      severity: "critical",
      message: "Notification worker queue depth exceeded critical threshold",
      value: queueDepth,
      threshold: config.alerts.workerQueueDepthCritical,
    });
  } else if (queueDepth >= config.alerts.workerQueueDepthWarning) {
    alerts.push({
      key: "worker_queue_depth",
      severity: "warning",
      message: "Notification worker queue depth exceeded warning threshold",
      value: queueDepth,
      threshold: config.alerts.workerQueueDepthWarning,
    });
  }

  if (oldestQueuedMinutes >= config.alerts.workerOldestQueuedMinutesCritical) {
    alerts.push({
      key: "worker_oldest_queued_minutes",
      severity: "critical",
      message: "Oldest queued notification age exceeded critical threshold",
      value: Math.round(oldestQueuedMinutes * 100) / 100,
      threshold: config.alerts.workerOldestQueuedMinutesCritical,
    });
  } else if (oldestQueuedMinutes >= config.alerts.workerOldestQueuedMinutesWarning) {
    alerts.push({
      key: "worker_oldest_queued_minutes",
      severity: "warning",
      message: "Oldest queued notification age exceeded warning threshold",
      value: Math.round(oldestQueuedMinutes * 100) / 100,
      threshold: config.alerts.workerOldestQueuedMinutesWarning,
    });
  }

  if (failedPending >= config.alerts.workerFailedPendingCritical) {
    alerts.push({
      key: "worker_failed_pending",
      severity: "critical",
      message: "Failed notifications pending retry exceeded critical threshold",
      value: failedPending,
      threshold: config.alerts.workerFailedPendingCritical,
    });
  } else if (failedPending >= config.alerts.workerFailedPendingWarning) {
    alerts.push({
      key: "worker_failed_pending",
      severity: "warning",
      message: "Failed notifications pending retry exceeded warning threshold",
      value: failedPending,
      threshold: config.alerts.workerFailedPendingWarning,
    });
  }

  return alerts;
}

async function fetchWorkerQueueSnapshot() {
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

  return result.rows[0] || {
    queued_count: 0,
    failed_with_retry_remaining: 0,
    oldest_queued_minutes: 0,
    last_sent_at: null,
  };
}

router.get(
  "/internal/observability/metrics",
  requireInternalApiKey,
  asyncHandler(async (_req, res) => {
    const snapshot = getObservabilitySnapshot();
    return success(res, snapshot, 200);
  })
);

router.get(
  "/internal/observability/ready",
  requireInternalApiKey,
  asyncHandler(async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      return success(
        res,
        {
          service: "agora-api",
          ready: true,
          db: "up",
          timestamp: new Date().toISOString(),
        },
        200
      );
    } catch (_e) {
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Database is not ready",
          details: [],
        },
        meta: {
          request_id: res.locals.requestId || null,
        },
      });
    }
  })
);

router.get(
  "/internal/observability/slo",
  requireInternalApiKey,
  asyncHandler(async (_req, res) => {
    const slo = getSloSnapshot({
      availabilityTargetPercent: config.slo.availabilityTargetPercent,
      shortWindowMinutes: config.slo.shortWindowMinutes,
      longWindowMinutes: config.slo.longWindowMinutes,
      burnRateWarning: config.slo.burnRateWarning,
      burnRateCritical: config.slo.burnRateCritical,
    });

    const workerSnapshot = await fetchWorkerQueueSnapshot();
    const worker = {
      queued_count: Number(workerSnapshot.queued_count || 0),
      failed_with_retry_remaining: Number(workerSnapshot.failed_with_retry_remaining || 0),
      oldest_queued_minutes: Math.round(Number(workerSnapshot.oldest_queued_minutes || 0) * 100) / 100,
      last_sent_at: workerSnapshot.last_sent_at || null,
      thresholds: {
        queue_warning: config.alerts.workerQueueDepthWarning,
        queue_critical: config.alerts.workerQueueDepthCritical,
        oldest_queued_minutes_warning: config.alerts.workerOldestQueuedMinutesWarning,
        oldest_queued_minutes_critical: config.alerts.workerOldestQueuedMinutesCritical,
        failed_pending_warning: config.alerts.workerFailedPendingWarning,
        failed_pending_critical: config.alerts.workerFailedPendingCritical,
      },
    };

    const alerts = [...slo.alerts, ...evaluateWorkerAlerts(worker)];

    return success(
      res,
      {
        service: "agora-api",
        generated_at: new Date().toISOString(),
        slo,
        workers: {
          notifications: worker,
        },
        alerts,
      },
      200
    );
  })
);

module.exports = router;
