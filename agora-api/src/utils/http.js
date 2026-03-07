function success(res, data, status = 200, extraMeta = {}) {
  return res.status(status).json({
    success: true,
    data,
    meta: {
      request_id: res.locals.requestId || null,
      ...extraMeta,
    },
  });
}

module.exports = {
  success,
};
