const config = require("../config");
const pool = require("../db");
const { runReminderCycle } = require("../services/reminder-jobs");

let shouldStop = false;

async function stopWorker(signal) {
  shouldStop = true;
  // eslint-disable-next-line no-console
  console.log(`[reminder-worker] received ${signal}, shutting down...`);
  await pool.end().catch(() => {});
}

async function startReminderWorker() {
  const intervalMs = Math.max(5000, Number(config.reminders.worker.intervalMs || 300000));
  const runOnce = Boolean(config.reminders.worker.runOnce);

  // eslint-disable-next-line no-console
  console.log(
    `[reminder-worker] started interval=${intervalMs}ms runOnce=${runOnce} jobs={homework_due:${config.reminders.homeworkDue.enabled},attendance_absent:${config.reminders.attendanceAbsent.enabled},fee_overdue:${config.reminders.feeOverdue.enabled}}`
  );

  const cycle = async () => {
    const summary = await runReminderCycle(config);
    if (summary.total > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[reminder-worker] queued total=${summary.total} homework_due=${summary.homework_due} attendance_absent=${summary.attendance_absent} fee_overdue=${summary.fee_overdue}`
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

  while (!shouldStop) {
    try {
      await cycle();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[reminder-worker] cycle error: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

startReminderWorker().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(`[reminder-worker] fatal error: ${error.message}`);
  await pool.end().catch(() => {});
  process.exit(1);
});
