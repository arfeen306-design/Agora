const AppError = require("../utils/app-error");
const pool = require("../db");
const { verifyAccessToken } = require("../utils/jwt");
const { ensureTeacherProjectionForUser } = require("../utils/teacher-projection");

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

async function requireAuth(req, _res, next) {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token) {
    return next(new AppError(401, "UNAUTHORIZED", "Missing bearer token"));
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (_e) {
    return next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }

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

  try {
    const activeCheck = await pool.query(
      `
        SELECT
          u.id,
          u.is_active AS user_active,
          s.is_active AS school_active
        FROM users u
        JOIN schools s ON s.id = u.school_id
        WHERE u.id = $1
          AND u.school_id = $2
        LIMIT 1
      `,
      [req.auth.userId, req.auth.schoolId]
    );

    const activeContext = activeCheck.rows[0];
    if (!activeContext || !activeContext.user_active || !activeContext.school_active) {
      return next(new AppError(401, "UNAUTHORIZED", "User account is inactive"));
    }

    // Backward-compatible bridge: keep legacy `teachers` projection in sync
    // so teacher-scoped routes continue to work while staff_profiles is primary.
    if (req.auth.roles.includes("teacher")) {
      try {
        const teacher = await ensureTeacherProjectionForUser({
          schoolId: req.auth.schoolId,
          userId: req.auth.userId,
          roles: req.auth.roles,
        });
        if (teacher?.id) {
          req.auth.teacherId = teacher.id;
        }
      } catch (_e) {
        // Non-fatal: auth should not fail due to projection sync.
      }
    }

    return next();
  } catch (error) {
    return next(error);
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
