const pool = require("../db");

const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization|api[-_]?key)/i;

function sanitizeAuditValue(value, depth = 0) {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return {
        _type: "array",
        length: value.length,
        preview: value.slice(0, 5).map((item) => sanitizeAuditValue(item, depth + 1)),
      };
    }
    return value.map((item) => sanitizeAuditValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    const out = {};
    const limitedKeys = keys.slice(0, 30);

    for (const key of limitedKeys) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeAuditValue(value[key], depth + 1);
      }
    }

    if (keys.length > limitedKeys.length) {
      out._extra_keys = keys.length - limitedKeys.length;
    }

    return out;
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}...[truncated]`;
  }

  return value;
}

async function createAuditLog({
  schoolId,
  actorUserId = null,
  action,
  entityName,
  entityId = null,
  metadata = {},
}) {
  if (!schoolId || !action || !entityName) return;

  await pool.query(
    `
      INSERT INTO audit_logs (
        school_id,
        actor_user_id,
        action,
        entity_name,
        entity_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      schoolId,
      actorUserId,
      action,
      entityName,
      entityId,
      JSON.stringify(sanitizeAuditValue(metadata)),
    ]
  );
}

function fireAndForgetAuditLog(payload) {
  createAuditLog(payload).catch(() => {
    // Audit logging should never break API responses.
  });
}

module.exports = {
  createAuditLog,
  fireAndForgetAuditLog,
  sanitizeAuditValue,
};
