const config = require("../config");
const pool = require("../db");
const { publishNotificationWorkerMetrics } = require("../services/cloudwatch-worker-metrics");
const { fetchNotificationWorkerSnapshot } = require("../services/worker-queue-metrics");

let shouldStop = false;
let loggedDisabled = false;

async function stopWorker(signal) {
  shouldStop = true;
  // eslint-disable-next-line no-console
  console.log(`[worker-metrics] received ${signal}, shutting down...`);
  await pool.end().catch(() => {});
}

async function runCycle() {
  const snapshot = await fetchNotificationWorkerSnapshot();

  if (!config.workerMetrics.publishEnabled) {
    if (!loggedDisabled) {
      // eslint-disable-next-line no-console
      console.log("[worker-metrics] publish is disabled (WORKER_METRICS_PUBLISH_ENABLED=false)");
      loggedDisabled = true;
    }
    return { published: false, snapshot };
  }

  const result = await publishNotificationWorkerMetrics(snapshot);
  // eslint-disable-next-line no-console
  console.log(
    `[worker-metrics] published namespace=${result.namespace} queued=${snapshot.queued_count} oldest_minutes=${snapshot.oldest_queued_minutes} failed_pending=${snapshot.failed_with_retry_remaining}`
  );
  return { published: true, snapshot };
}

async function startWorker() {
  const intervalMs = Math.max(5000, Number(config.workerMetrics.publishIntervalMs || 60000));
  const runOnce = Boolean(config.workerMetrics.publishRunOnce);

  // eslint-disable-next-line no-console
  console.log(
    `[worker-metrics] started interval=${intervalMs}ms runOnce=${runOnce} enabled=${config.workerMetrics.publishEnabled} namespace=${config.workerMetrics.namespace} region=${config.workerMetrics.awsRegion} service=${config.workerMetrics.serviceDimension}`
  );

  if (runOnce) {
    await runCycle();
    await pool.end();
    return;
  }

  process.once("SIGINT", () => {
    stopWorker("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopWorker("SIGTERM");
  });

  while (!shouldStop) {
    try {
      await runCycle();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[worker-metrics] cycle error: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

startWorker().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(`[worker-metrics] fatal error: ${error.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
