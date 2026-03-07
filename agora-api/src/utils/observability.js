const STARTED_AT = new Date();
const MAX_RECENT_REQUESTS = 5000;

const state = {
  requests: {
    total: 0,
    by_method: {},
    by_status: {},
    by_route: {},
    recent: [],
  },
  errors: {
    total: 0,
    by_code: {},
  },
};

function normalizeRoute(path) {
  return String(path || "/")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\/\d+/g, "/:id");
}

function bumpCounter(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function recordRequest({ requestId, method, path, statusCode, durationMs, schoolId, userId }) {
  const routeKey = normalizeRoute(path);
  state.requests.total += 1;
  bumpCounter(state.requests.by_method, String(method || "UNKNOWN"));
  bumpCounter(state.requests.by_status, String(statusCode || 0));
  bumpCounter(state.requests.by_route, routeKey);

  state.requests.recent.push({
    request_id: requestId || null,
    method: method || null,
    path: routeKey,
    status_code: statusCode || null,
    duration_ms: durationMs || 0,
    school_id: schoolId || null,
    user_id: userId || null,
    at: new Date().toISOString(),
  });
  if (state.requests.recent.length > MAX_RECENT_REQUESTS) {
    state.requests.recent.splice(0, state.requests.recent.length - MAX_RECENT_REQUESTS);
  }
}

function recordError({ code }) {
  state.errors.total += 1;
  bumpCounter(state.errors.by_code, String(code || "INTERNAL_SERVER_ERROR"));
}

function getObservabilitySnapshot() {
  const mem = process.memoryUsage();
  return {
    service: "agora-api",
    started_at: STARTED_AT.toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      node_version: process.version,
      rss_bytes: mem.rss,
      heap_used_bytes: mem.heapUsed,
      heap_total_bytes: mem.heapTotal,
      external_bytes: mem.external,
    },
    requests: {
      total: state.requests.total,
      by_method: state.requests.by_method,
      by_status: state.requests.by_status,
      by_route: state.requests.by_route,
      recent: state.requests.recent,
    },
    errors: {
      total: state.errors.total,
      by_code: state.errors.by_code,
    },
  };
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getWindowRequestSummary(windowMinutes) {
  const minutes = Math.max(1, Math.floor(toFiniteNumber(windowMinutes, 1)));
  const cutoff = Date.now() - minutes * 60 * 1000;
  const relevant = state.requests.recent.filter((item) => {
    const at = Date.parse(item.at || "");
    return Number.isFinite(at) && at >= cutoff;
  });

  const total = relevant.length;
  const successful = relevant.filter((item) => Number(item.status_code) < 500).length;
  const failed = total - successful;
  const availabilityPercent = total > 0 ? (successful / total) * 100 : 100;
  const errorRateFraction = total > 0 ? failed / total : 0;

  return {
    window_minutes: minutes,
    total_requests: total,
    successful_requests: successful,
    failed_requests: failed,
    availability_percent: Math.round(availabilityPercent * 100) / 100,
    error_rate_fraction: errorRateFraction,
  };
}

function getSloSnapshot({
  availabilityTargetPercent,
  shortWindowMinutes,
  longWindowMinutes,
  burnRateWarning,
  burnRateCritical,
}) {
  const targetPercent = Math.min(100, Math.max(90, toFiniteNumber(availabilityTargetPercent, 99.9)));
  const warningThreshold = Math.max(0.1, toFiniteNumber(burnRateWarning, 2));
  const criticalThreshold = Math.max(warningThreshold, toFiniteNumber(burnRateCritical, 4));
  const shortSummary = getWindowRequestSummary(shortWindowMinutes);
  const longSummary = getWindowRequestSummary(longWindowMinutes);
  const allowedErrorFraction = Math.max(0.0001, (100 - targetPercent) / 100);
  const shortBurnRate = shortSummary.error_rate_fraction / allowedErrorFraction;
  const longBurnRate = longSummary.error_rate_fraction / allowedErrorFraction;
  const budgetRemainingPercent = Math.max(0, 100 - longBurnRate * 100);

  const alerts = [];
  if (shortBurnRate >= criticalThreshold || longBurnRate >= criticalThreshold) {
    alerts.push({
      key: "api_error_budget_burn_rate",
      severity: "critical",
      message: "API error budget burn rate is above critical threshold",
      short_burn_rate: Math.round(shortBurnRate * 100) / 100,
      long_burn_rate: Math.round(longBurnRate * 100) / 100,
      threshold: criticalThreshold,
    });
  } else if (shortBurnRate >= warningThreshold || longBurnRate >= warningThreshold) {
    alerts.push({
      key: "api_error_budget_burn_rate",
      severity: "warning",
      message: "API error budget burn rate is above warning threshold",
      short_burn_rate: Math.round(shortBurnRate * 100) / 100,
      long_burn_rate: Math.round(longBurnRate * 100) / 100,
      threshold: warningThreshold,
    });
  }

  return {
    target_availability_percent: targetPercent,
    short_window: {
      ...shortSummary,
      burn_rate: Math.round(shortBurnRate * 100) / 100,
    },
    long_window: {
      ...longSummary,
      burn_rate: Math.round(longBurnRate * 100) / 100,
    },
    error_budget_remaining_percent: Math.round(budgetRemainingPercent * 100) / 100,
    alerts,
  };
}

module.exports = {
  recordRequest,
  recordError,
  getObservabilitySnapshot,
  getSloSnapshot,
};
