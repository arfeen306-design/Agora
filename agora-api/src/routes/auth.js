const crypto = require("crypto");

const bcrypt = require("bcryptjs");
const express = require("express");
const { z } = require("zod");

const config = require("../config");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rate-limit");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { sha256 } = require("../utils/crypto");
const { success } = require("../utils/http");
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require("../utils/jwt");

const router = express.Router();

const loginRateLimiter = createRateLimiter({
  name: "auth_login",
  windowMs: config.rateLimit.authLoginWindowMs,
  max: config.rateLimit.authLoginMax,
  keyFn: (req) => `${req.ip || "unknown"}:${String(req.body?.email || "").toLowerCase()}`,
});

const loginSchema = z.object({
  school_code: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

function toValidationDetails(zodError) {
  return zodError.issues.map((issue) => ({
    field: issue.path.join("."),
    issue: issue.message,
  }));
}

function parseBody(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid request body", toValidationDetails(parsed.error));
  }
  return parsed.data;
}

function isBcryptHash(value) {
  return typeof value === "string" && value.startsWith("$2");
}

async function verifyPassword(password, storedHash) {
  if (!isBcryptHash(storedHash)) {
    return false;
  }
  return bcrypt.compare(password, storedHash);
}

async function getUserByLogin(schoolCode, email) {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.school_id,
        u.email,
        u.first_name,
        u.last_name,
        u.password_hash,
        u.is_active AS user_active,
        s.is_active AS school_active
      FROM users u
      JOIN schools s ON s.id = u.school_id
      WHERE s.code = $1
        AND LOWER(u.email) = LOWER($2)
      LIMIT 1
    `,
    [schoolCode, email]
  );

  return result.rows[0] || null;
}

async function getSchoolByCode(schoolCode) {
  const result = await pool.query(
    `
      SELECT id
      FROM schools
      WHERE code = $1
      LIMIT 1
    `,
    [schoolCode]
  );

  return result.rows[0] || null;
}

async function getUserById(userId, schoolId) {
  const result = await pool.query(
    `
      SELECT
        id,
        school_id,
        email,
        first_name,
        last_name,
        is_active
      FROM users
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
    `,
    [userId, schoolId]
  );

  return result.rows[0] || null;
}

async function getUserRoles(userId) {
  const result = await pool.query(
    `
      SELECT r.code
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.code ASC
    `,
    [userId]
  );

  return result.rows.map((row) => row.code);
}

function makeUserResponse(user, roles) {
  return {
    id: user.id,
    school_id: user.school_id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    roles,
  };
}

async function createSessionAndTokens(client, user, roles) {
  const sessionId = crypto.randomUUID();
  const accessToken = signAccessToken(user, roles);
  const refreshToken = signRefreshToken(user, sessionId);

  const accessPayload = verifyAccessToken(accessToken);
  const refreshPayload = verifyRefreshToken(refreshToken);

  const expiresIn = Math.max(0, Number(accessPayload.exp || 0) - Math.floor(Date.now() / 1000));
  const refreshExpiresAt = new Date(Number(refreshPayload.exp) * 1000);
  const refreshTokenHash = sha256(refreshToken);

  await client.query(
    `
      INSERT INTO user_sessions (
        id,
        school_id,
        user_id,
        refresh_token_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [sessionId, user.school_id, user.id, refreshTokenHash, refreshExpiresAt]
  );

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    token_type: "Bearer",
  };
}

router.post(
  "/login",
  loginRateLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const user = await getUserByLogin(input.school_code, input.email);

    if (!user || !user.user_active || !user.school_active) {
      const school = user ? { id: user.school_id } : await getSchoolByCode(input.school_code);
      if (school?.id) {
        fireAndForgetAuditLog({
          schoolId: school.id,
          actorUserId: user?.id || null,
          action: "auth.session.login_failed",
          entityName: "user_sessions",
          metadata: {
            school_code: input.school_code,
            email: input.email,
            reason: "invalid_credentials",
            ip_address: req.ip,
            user_agent: req.header("User-Agent") || null,
          },
        });
      }
      throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");
    }

    const passwordOk = await verifyPassword(input.password, user.password_hash);
    if (!passwordOk) {
      fireAndForgetAuditLog({
        schoolId: user.school_id,
        actorUserId: user.id,
        action: "auth.session.login_failed",
        entityName: "user_sessions",
        metadata: {
          school_code: input.school_code,
          email: input.email,
          reason: "invalid_credentials",
          ip_address: req.ip,
          user_agent: req.header("User-Agent") || null,
        },
      });
      throw new AppError(401, "UNAUTHORIZED", "Invalid credentials");
    }

    const roles = await getUserRoles(user.id);
    if (roles.length === 0) {
      throw new AppError(403, "FORBIDDEN", "No role assigned to this account");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tokenBundle = await createSessionAndTokens(client, user, roles);
      await client.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: user.school_id,
        actorUserId: user.id,
        action: "auth.session.login",
        entityName: "user_sessions",
        metadata: {
          email: input.email,
          roles,
          ip_address: req.ip,
          user_agent: req.header("User-Agent") || null,
        },
      });

      success(
        res,
        {
          ...tokenBundle,
          user: makeUserResponse(user, roles),
        },
        200
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const input = parseBody(refreshSchema, req.body);

    let payload;
    try {
      payload = verifyRefreshToken(input.refresh_token);
    } catch (_e) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid refresh token");
    }

    if (payload.token_type !== "refresh" || !payload.sid || !payload.sub || !payload.school_id) {
      throw new AppError(401, "UNAUTHORIZED", "Malformed refresh token");
    }

    const sessionCheck = await pool.query(
      `
        SELECT
          id,
          user_id,
          school_id,
          refresh_token_hash,
          expires_at,
          revoked_at
        FROM user_sessions
        WHERE id = $1
        LIMIT 1
      `,
      [payload.sid]
    );

    const session = sessionCheck.rows[0];
    const incomingHash = sha256(input.refresh_token);

    if (
      !session ||
      session.user_id !== payload.sub ||
      session.school_id !== payload.school_id ||
      session.refresh_token_hash !== incomingHash ||
      session.revoked_at ||
      new Date(session.expires_at) <= new Date()
    ) {
      throw new AppError(401, "UNAUTHORIZED", "Refresh session is invalid or expired");
    }

    const user = await getUserById(payload.sub, payload.school_id);
    if (!user || !user.is_active) {
      throw new AppError(401, "UNAUTHORIZED", "User is inactive");
    }

    const roles = await getUserRoles(user.id);
    if (roles.length === 0) {
      throw new AppError(403, "FORBIDDEN", "No role assigned to this account");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
        [session.id]
      );
      const tokenBundle = await createSessionAndTokens(client, user, roles);
      await client.query("COMMIT");

      success(
        res,
        {
          ...tokenBundle,
          user: makeUserResponse(user, roles),
        },
        200
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return success(res, { logged_out: true }, 200);
    }

    let payload = null;
    try {
      payload = verifyRefreshToken(parsed.data.refresh_token);
    } catch (_e) {
      payload = null;
    }

    if (payload && payload.sid) {
      await pool.query(
        "UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
        [payload.sid]
      );

      fireAndForgetAuditLog({
        schoolId: payload.school_id,
        actorUserId: payload.sub,
        action: "auth.session.logout",
        entityName: "user_sessions",
        entityId: payload.sid,
        metadata: {
          session_id: payload.sid,
          ip_address: req.ip,
          user_agent: req.header("User-Agent") || null,
        },
      });
    }

    return success(res, { logged_out: true }, 200);
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.auth.userId, req.auth.schoolId);
    if (!user || !user.is_active) {
      throw new AppError(401, "UNAUTHORIZED", "User not found or inactive");
    }

    const roles = await getUserRoles(user.id);
    return success(res, makeUserResponse(user, roles), 200);
  })
);

module.exports = router;
