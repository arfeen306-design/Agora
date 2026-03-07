function createRateLimiter({ name = "default", windowMs = 60000, max = 60, keyFn = null } = {}) {
  const bucket = new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of bucket.entries()) {
      if (state.resetAt <= now) bucket.delete(key);
    }
  }, Math.max(1000, Math.floor(windowMs / 2)));
  cleanupInterval.unref?.();

  function buildKey(req) {
    if (typeof keyFn === "function") return `${name}:${keyFn(req)}`;
    return `${name}:${req.ip || "unknown"}`;
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = buildKey(req);
    const current = bucket.get(key);

    if (!current || current.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count <= max) {
      return next();
    }

    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
        details: [{ limiter: name, retry_after_seconds: retryAfter }],
      },
      meta: {
        request_id: res.locals.requestId || null,
      },
    });
  };
}

module.exports = {
  createRateLimiter,
};
