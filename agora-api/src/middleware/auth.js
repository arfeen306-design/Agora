const AppError = require("../utils/app-error");
const { verifyAccessToken } = require("../utils/jwt");

const TENANT_ID_KEYS = new Set(["school_id", "schoolId"]);

function extractBearerToken(headerValue) {
  if (!headerValue) return null;
  const parts = headerValue.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

function collectTenantIds(value, out, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 50; i += 1) {
      collectTenantIds(value[i], out, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  const entries = Object.entries(value).slice(0, 50);
  for (const [key, item] of entries) {
    if (TENANT_ID_KEYS.has(key) && typeof item === "string") {
      out.push(item);
    }
    collectTenantIds(item, out, depth + 1);
  }
}

function findTenantMismatch(req, schoolId) {
  const tenantIds = [];
  collectTenantIds(req.params, tenantIds);
  collectTenantIds(req.query, tenantIds);
  collectTenantIds(req.body, tenantIds);

  const headerSchoolId = req.header("X-School-Id");
  if (typeof headerSchoolId === "string" && headerSchoolId.trim().length > 0) {
    tenantIds.push(headerSchoolId.trim());
  }

  for (const tenantId of tenantIds) {
    if (tenantId !== schoolId) {
      return tenantId;
    }
  }

  return null;
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

    const mismatch = findTenantMismatch(req, req.auth.schoolId);
    if (mismatch) {
      return next(
        new AppError(
          403,
          "TENANT_SCOPE_MISMATCH",
          "Cross-school access denied by tenant boundary policy"
        )
      );
    }

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
