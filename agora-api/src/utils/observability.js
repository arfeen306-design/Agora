const STARTED_AT = new Date();
const MAX_RECENT_REQUESTS = 100;

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

module.exports = {
  recordRequest,
  recordError,
  getObservabilitySnapshot,
};
