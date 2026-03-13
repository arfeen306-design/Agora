const { recordError } = require("../utils/observability");
const logger = require("../utils/logger");

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";
  recordError({ code });

  logger.error(
    {
      type: "error",
      request_id: res.locals.requestId || null,
      method: req.method,
      path: req.path,
      status_code: status,
      code,
      message: err.message || "Unexpected error",
    },
    "request error"
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
