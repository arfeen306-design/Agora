const config = require("../config");
const AppError = require("../utils/app-error");

function requireInternalApiKey(req, _res, next) {
  const incoming = req.header("X-Internal-Api-Key");
  if (!incoming || incoming !== config.internalApiKey) {
    return next(new AppError(401, "UNAUTHORIZED", "Invalid internal API key"));
  }
  return next();
}

module.exports = {
  requireInternalApiKey,
};
