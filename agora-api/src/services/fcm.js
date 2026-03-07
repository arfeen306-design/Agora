const crypto = require("crypto");
const querystring = require("querystring");

const pool = require("../db");
const AppError = require("../utils/app-error");

const FCM_PERMANENT_ERROR_CODES = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "SENDER_ID_MISMATCH",
]);

const tokenCache = {
  accessToken: null,
  expiresAtEpoch: 0,
};

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizePrivateKey(value) {
  if (!value) return "";
  return String(value).replace(/\\n/g, "\n");
}

function ensureFcmConfig(config) {
  const fcm = config?.notifications?.push?.fcm || {};
  if (!fcm.projectId || !fcm.clientEmail || !fcm.privateKey) {
    throw new AppError(500, "CONFIG_ERROR", "FCM credentials are not configured");
  }
  return {
    projectId: fcm.projectId,
    clientEmail: fcm.clientEmail,
    privateKey: normalizePrivateKey(fcm.privateKey),
    tokenUri: fcm.tokenUri || "https://oauth2.googleapis.com/token",
    scope: fcm.scope || "https://www.googleapis.com/auth/firebase.messaging",
  };
}

function buildSignedAssertion({ clientEmail, privateKey, tokenUri, scope }) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: clientEmail,
    scope,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const message = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");

  return `${message}.${signature}`;
}

async function fetchAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && tokenCache.expiresAtEpoch - 60 > now) {
    return tokenCache.accessToken;
  }

  const fcm = ensureFcmConfig(config);
  const assertion = buildSignedAssertion(fcm);

  const response = await fetch(fcm.tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: querystring.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  let body;
  try {
    body = await response.json();
  } catch (_e) {
    body = null;
  }

  if (!response.ok || !body?.access_token) {
    const detail = body?.error_description || body?.error || `status ${response.status}`;
    throw new AppError(500, "FCM_AUTH_ERROR", `Failed to acquire FCM access token (${detail})`);
  }

  const expiresIn = Number(body.expires_in || 3600);
  tokenCache.accessToken = body.access_token;
  tokenCache.expiresAtEpoch = now + Math.max(60, expiresIn);
  return tokenCache.accessToken;
}

async function getActiveFcmTokens({ schoolId, userId }) {
  const result = await pool.query(
    `
      SELECT id, device_token
      FROM push_device_tokens
      WHERE school_id = $1
        AND user_id = $2
        AND provider = 'fcm'
        AND is_active = TRUE
      ORDER BY last_seen_at DESC, created_at DESC
    `,
    [schoolId, userId]
  );

  return result.rows;
}

async function deactivatePushToken({ tokenId, reason }) {
  await pool.query(
    `
      UPDATE push_device_tokens
      SET
        is_active = FALSE,
        revoked_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [tokenId]
  );

  return reason;
}

function sanitizeDataPayload(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  const keys = Object.keys(input).slice(0, 50);
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null) {
      out[key] = "";
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.slice(0, 500);
      continue;
    }
    out[key] = JSON.stringify(value).slice(0, 500);
  }
  return out;
}

function parseFcmFailure(body) {
  const status = body?.error?.status || null;
  const message = body?.error?.message || "Unknown FCM error";
  return {
    code: status,
    message,
    isPermanentTokenError: FCM_PERMANENT_ERROR_CODES.has(status),
  };
}

async function sendSingleTokenMessage({ accessToken, projectId, deviceToken, notification }) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: {
            title: String(notification.title || "").slice(0, 200),
            body: String(notification.body || "").slice(0, 2000),
          },
          data: sanitizeDataPayload(notification.payload),
        },
      }),
    }
  );

  let body;
  try {
    body = await response.json();
  } catch (_e) {
    body = null;
  }

  if (response.ok) {
    return {
      ok: true,
      messageId: body?.name || null,
    };
  }

  return {
    ok: false,
    ...parseFcmFailure(body),
    responseStatus: response.status,
  };
}

async function sendPushViaFcm(notification, config) {
  let tokens;
  try {
    tokens = await getActiveFcmTokens({
      schoolId: notification.school_id,
      userId: notification.user_id,
    });
  } catch (error) {
    if (error?.code === "42P01") {
      return {
        provider: "fcm",
        sent: 0,
        attempted: 0,
        skipped: true,
        reason: "push_device_tokens_table_missing",
      };
    }
    throw error;
  }

  if (tokens.length === 0) {
    return {
      provider: "fcm",
      sent: 0,
      attempted: 0,
      skipped: true,
      reason: "no_active_tokens",
    };
  }

  const fcm = ensureFcmConfig(config);
  const accessToken = await fetchAccessToken(config);

  let sent = 0;
  let permanentFailures = 0;
  const failures = [];
  const messageIds = [];

  for (const token of tokens) {
    const result = await sendSingleTokenMessage({
      accessToken,
      projectId: fcm.projectId,
      deviceToken: token.device_token,
      notification,
    });

    if (result.ok) {
      sent += 1;
      if (result.messageId) messageIds.push(result.messageId);
      continue;
    }

    failures.push({
      token_id: token.id,
      code: result.code,
      message: result.message,
      response_status: result.responseStatus,
    });

    if (result.isPermanentTokenError) {
      permanentFailures += 1;
      await deactivatePushToken({
        tokenId: token.id,
        reason: result.code || "INVALID_TOKEN",
      });
    }
  }

  if (sent === 0) {
    if (permanentFailures === tokens.length) {
      return {
        provider: "fcm",
        sent: 0,
        attempted: tokens.length,
        skipped: true,
        reason: "all_tokens_invalid",
        failures,
      };
    }

    throw new Error(
      `FCM delivery failed for all tokens (${failures.map((item) => item.code || "UNKNOWN").join(",")})`
    );
  }

  return {
    provider: "fcm",
    sent,
    attempted: tokens.length,
    failed: tokens.length - sent,
    message_ids: messageIds,
    failures,
  };
}

module.exports = {
  sendPushViaFcm,
};
