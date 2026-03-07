const { recordRequest } = require("../utils/observability");

function requestObservability(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const finishedAt = process.hrtime.bigint();
    const durationMs = Number(finishedAt - startedAt) / 1_000_000;

    recordRequest({
      requestId: res.locals.requestId || null,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      schoolId: req.auth?.schoolId || null,
      userId: req.auth?.userId || null,
    });

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        type: "request",
        request_id: res.locals.requestId || null,
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        school_id: req.auth?.schoolId || null,
        user_id: req.auth?.userId || null,
        at: new Date().toISOString(),
      })
    );
  });

  next();
}

module.exports = requestObservability;
