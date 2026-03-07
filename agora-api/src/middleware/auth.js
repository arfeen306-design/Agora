const AppError = require("../utils/app-error");
const { verifyAccessToken } = require("../utils/jwt");

function extractBearerToken(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

function requireAuth(req, _res, next) {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token) {
    return next(new AppError(401, "UNAUTHORIZED", "Missing bearer token"));
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.token_type !== "access") {
      return next(new AppError(401, "UNAUTHORIZED", "Invalid access token type"));
    }

    req.auth = {
      userId: payload.sub,
      schoolId: payload.school_id,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
    return next();
  } catch (_e) {
    return next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }
}

function requireRoles(...allowedRoles) {
  return function checkRoles(req, _res, next) {
    if (!req.auth) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    }

    const matched = req.auth.roles.some((role) => allowedRoles.includes(role));
    if (!matched) {
      return next(new AppError(403, "FORBIDDEN", "Insufficient role permissions"));
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRoles,
};
