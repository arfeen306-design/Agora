const { verifyAccessToken } = require("../utils/jwt");
const { fireAndForgetAuditLog, sanitizeAuditValue } = require("../utils/audit-log");

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractBearerToken(headerValue) {
  if (!headerValue) return null;
  const [scheme, token] = String(headerValue).split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function getRequestActor(req) {
  const token = extractBearerToken(req.header("Authorization"));
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    if (payload.token_type !== "access") return null;
    if (!payload.school_id || !payload.sub) return null;

    return {
      schoolId: payload.school_id,
      userId: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
  } catch (_e) {
    return null;
  }
}

function resolveEntityInfo(pathname) {
  const normalized = String(pathname || "").replace(/^\/api\/v1\/?/, "");
  const segments = normalized.split("/").filter(Boolean);
  const entityName = segments[0] || "system";

  let entityId = null;
  for (const segment of segments) {
    if (UUID_REGEX.test(segment)) {
      entityId = segment;
      break;
    }
  }

  return {
    actionPath: normalized || "/",
    entityName,
    entityId,
  };
}

function auditTrail(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) {
    return next();
  }

  if (!req.originalUrl.startsWith("/api/v1")) {
    return next();
  }

  const actor = getRequestActor(req);
  if (!actor) {
    return next();
  }

  const { actionPath, entityName, entityId } = resolveEntityInfo(req.path);
  const startedAt = Date.now();

  res.on("finish", () => {
    // Skip logging failed server responses and internal worker trigger endpoint noise.
    if (res.statusCode >= 500 || actionPath.startsWith("internal/")) {
      return;
    }

    const metadata = sanitizeAuditValue({
      method: req.method,
      path: actionPath,
      status_code: res.statusCode,
      duration_ms: Date.now() - startedAt,
      query: req.query,
      body: req.body,
      request_id: res.locals.requestId || null,
      ip: req.ip,
      user_agent: req.header("User-Agent") || null,
      roles: actor.roles,
    });

    fireAndForgetAuditLog({
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      action: `${req.method} ${actionPath}`,
      entityName,
      entityId,
      metadata,
    });
  });

  return next();
}

module.exports = auditTrail;
