const crypto = require("crypto");

function requestId(req, res, next) {
  const incoming = req.header("X-Request-Id");
  const id = incoming || crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

module.exports = requestId;
