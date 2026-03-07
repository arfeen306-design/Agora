function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_SERVER_ERROR";

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
