const test = require("node:test");
const assert = require("node:assert/strict");

const { buildNotificationMetricData } = require("../src/services/cloudwatch-worker-metrics");

test("buildNotificationMetricData maps notification snapshot to expected CloudWatch metric names", () => {
  const metrics = buildNotificationMetricData(
    {
      queued_count: 12,
      oldest_queued_minutes: 7.5,
      failed_with_retry_remaining: 3,
    },
    new Date("2026-03-07T00:00:00.000Z")
  );

  assert.equal(metrics.length, 3);
  assert.equal(metrics[0].MetricName, "NotificationQueueDepth");
  assert.equal(metrics[0].Value, 12);
  assert.equal(metrics[1].MetricName, "NotificationOldestQueuedMinutes");
  assert.equal(metrics[1].Value, 7.5);
  assert.equal(metrics[2].MetricName, "NotificationFailedPending");
  assert.equal(metrics[2].Value, 3);
});
