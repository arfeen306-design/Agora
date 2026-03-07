const { recordError } = require("../utils/observability");

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  recordError({ code });

  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: "error",
      type: "error",
      request_id: res.locals.requestId || null,
      method: req.method,
      path: req.path,
      status_code: status,
      code,
      message: err.message || "Unexpected error",
      at: new Date().toISOString(),
    })
  );

  res.status(status).json({
    success: false,
    error: {
      code,
      message: err.message || "Unexpected error",
      details: err.details || [],
    },
    meta: {
      request_id: res.locals.requestId || null,
    },
  });
}

module.exports = errorHandler;
