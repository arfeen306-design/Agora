const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");

const config = require("../config");

let cachedClient = null;
let cachedRegion = null;

function toFinite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildNotificationMetricData(snapshot, at) {
  const timestamp = at || new Date();
  const dimensions = [
    {
      Name: "Service",
      Value: config.workerMetrics.serviceDimension,
    },
  ];

  return [
    {
      MetricName: "NotificationQueueDepth",
      Timestamp: timestamp,
      Unit: "Count",
      Value: toFinite(snapshot.queued_count, 0),
      Dimensions: dimensions,
    },
    {
      MetricName: "NotificationOldestQueuedMinutes",
      Timestamp: timestamp,
      Unit: "None",
      Value: toFinite(snapshot.oldest_queued_minutes, 0),
      Dimensions: dimensions,
    },
    {
      MetricName: "NotificationFailedPending",
      Timestamp: timestamp,
      Unit: "Count",
      Value: toFinite(snapshot.failed_with_retry_remaining, 0),
      Dimensions: dimensions,
    },
  ];
}

function getCloudWatchClient() {
  if (!cachedClient || cachedRegion !== config.workerMetrics.awsRegion) {
    cachedClient = new CloudWatchClient({
      region: config.workerMetrics.awsRegion,
    });
    cachedRegion = config.workerMetrics.awsRegion;
  }
  return cachedClient;
}

async function publishNotificationWorkerMetrics(snapshot) {
  if (!config.workerMetrics.publishEnabled) {
    return {
      published: false,
      reason: "disabled",
      namespace: config.workerMetrics.namespace,
    };
  }

  const metricData = buildNotificationMetricData(snapshot, new Date());
  const command = new PutMetricDataCommand({
    Namespace: config.workerMetrics.namespace,
    MetricData: metricData,
  });
  await getCloudWatchClient().send(command);

  return {
    published: true,
    namespace: config.workerMetrics.namespace,
    metric_count: metricData.length,
  };
}

module.exports = {
  buildNotificationMetricData,
  publishNotificationWorkerMetrics,
};
