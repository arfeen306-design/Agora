const express = require("express");
const { z } = require("zod");

const config = require("../config");
const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { getRealtimeHub } = require("../realtime/hub");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const channelSchema = z.enum(["in_app", "push", "email", "sms"]);
const statusSchema = z.enum(["queued", "sent", "failed", "read"]);

const listNotificationsQuerySchema = z.object({
  status: statusSchema.optional(),
  channel: channelSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const testNotificationSchema = z.object({
  user_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  channel: channelSchema,
});

const pushProviderSchema = z.enum(["fcm"]);
const pushPlatformSchema = z.enum(["android", "ios", "web"]);

const upsertPushTokenSchema = z.object({
  provider: pushProviderSchema.default("fcm"),
  platform: pushPlatformSchema,
  device_token: z.string().trim().min(20).max(4096),
  device_id: z.string().trim().min(1).max(200).optional(),
  app_version: z.string().trim().min(1).max(100).optional(),
});

const internalTriggerSchema = z.object({
  event_type: z.string().trim().min(1).max(120),
  school_id: z.string().uuid(),
  actor_user_id: z.string().uuid(),
  payload: z.record(z.any()),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      message,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        issue: issue.message,
      }))
    );
  }
  return parsed.data;
}

function hasRole(auth, role) {
  return Array.isArray(auth?.roles) && auth.roles.includes(role);
}

function requireInternalApiKey(req, _res, next) {
  const incoming = req.header("X-Internal-Api-Key");
  if (!incoming || incoming !== config.internalApiKey) {
    return next(new AppError(401, "UNAUTHORIZED", "Invalid internal API key"));
  }
  return next();
}

async function userExistsInSchool({ schoolId, userId }) {
  const result = await pool.query(
    "SELECT id FROM users WHERE school_id = $1 AND id = $2 LIMIT 1",
    [schoolId, userId]
  );
  return Boolean(result.rows[0]);
}

function emitNotificationRealtime({ schoolId, notification, event }) {
  getRealtimeHub().emitToUser(
    notification.user_id,
    event,
    { notification },
    { schoolId }
  );
}

async function upsertPushToken({
  schoolId,
  userId,
  provider,
  platform,
  deviceToken,
  deviceId,
  appVersion,
}) {
  const result = await pool.query(
    `
      INSERT INTO push_device_tokens (
        school_id,
        user_id,
        provider,
        platform,
        device_token,
        device_id,
        app_version,
        is_active,
        last_seen_at,
        revoked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NULL)
      ON CONFLICT (school_id, device_token)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        provider = EXCLUDED.provider,
        platform = EXCLUDED.platform,
        device_id = EXCLUDED.device_id,
        app_version = EXCLUDED.app_version,
        is_active = TRUE,
        last_seen_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW()
      RETURNING
        id,
        school_id,
        user_id,
        provider,
        platform,
        device_token,
        device_id,
        app_version,
        is_active,
        last_seen_at,
        created_at,
        updated_at
    `,
    [schoolId, userId, provider, platform, deviceToken, deviceId || null, appVersion || null]
  );

  return result.rows[0];
}

router.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(listNotificationsQuerySchema, req.query, "Invalid notifications query");

    const params = [req.auth.schoolId, req.auth.userId];
    const where = ["n.school_id = $1", "n.user_id = $2"];

    if (query.status) {
      params.push(query.status);
      where.push(`n.status = $${params.length}::notification_status`);
    }
    if (query.channel) {
      params.push(query.channel);
      where.push(`n.channel = $${params.length}::notification_channel`);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM notifications n
        WHERE ${whereClause}
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          n.id,
          n.user_id,
          n.title,
          n.body,
          n.channel,
          n.status,
          n.payload,
          n.sent_at,
          n.read_at,
          n.created_at
        FROM notifications n
        WHERE ${whereClause}
        ORDER BY n.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(
      res,
      rowsResult.rows,
      200,
      {
        pagination: {
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          total_pages: totalPages,
        },
      }
    );
  })
);

router.patch(
  "/notifications/:notificationId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ notificationId: z.string().uuid() }),
      req.params,
      "Invalid notification id"
    );

    const notificationResult = await pool.query(
      `
        SELECT id, user_id
        FROM notifications
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.notificationId]
    );
    const existingNotification = notificationResult.rows[0];
    if (!existingNotification) {
      throw new AppError(404, "NOT_FOUND", "Notification not found");
    }

    if (existingNotification.user_id !== req.auth.userId && !hasRole(req.auth, "school_admin")) {
      throw new AppError(403, "FORBIDDEN", "Cannot modify this notification");
    }

    const updateResult = await pool.query(
      `
        UPDATE notifications
        SET
          status = 'read'::notification_status,
          read_at = COALESCE(read_at, NOW())
        WHERE id = $1
        RETURNING
          id,
          user_id,
          title,
          body,
          channel,
          status,
          payload,
          sent_at,
          read_at,
          created_at
      `,
      [path.notificationId]
    );

    const notification = updateResult.rows[0];
    emitNotificationRealtime({
      schoolId: req.auth.schoolId,
      notification,
      event: "notification.read",
    });

    return success(res, notification, 200);
  })
);

router.post(
  "/notifications/test",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(testNotificationSchema, req.body, "Invalid test notification payload");

    const targetExists = await userExistsInSchool({
      schoolId: req.auth.schoolId,
      userId: body.user_id,
    });
    if (!targetExists) {
      throw new AppError(404, "NOT_FOUND", "Target user not found in this school");
    }

    const insertResult = await pool.query(
      `
        INSERT INTO notifications (
          school_id,
          user_id,
          title,
          body,
          channel,
          status,
          payload
        )
        VALUES ($1, $2, $3, $4, $5::notification_channel, 'queued'::notification_status, $6::jsonb)
        RETURNING
          id,
          user_id,
          title,
          body,
          channel,
          status,
          payload,
          sent_at,
          read_at,
          created_at
      `,
      [
        req.auth.schoolId,
        body.user_id,
        body.title,
        body.body,
        body.channel,
        JSON.stringify({
          source: "test",
          actor_user_id: req.auth.userId,
          retry_count: 0,
          next_retry_at: null,
        }),
      ]
    );

    const notification = insertResult.rows[0];
    emitNotificationRealtime({
      schoolId: req.auth.schoolId,
      notification,
      event: "notification.new",
    });

    return success(res, notification, 200);
  })
);

router.get(
  "/notifications/push-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    let result;
    try {
      result = await pool.query(
        `
          SELECT
            id,
            provider,
            platform,
            device_id,
            app_version,
            is_active,
            last_seen_at,
            created_at,
            updated_at
          FROM push_device_tokens
          WHERE school_id = $1
            AND user_id = $2
          ORDER BY last_seen_at DESC, created_at DESC
        `,
        [req.auth.schoolId, req.auth.userId]
      );
    } catch (error) {
      if (error?.code === "42P01") {
        return success(res, [], 200);
      }
      throw error;
    }

    return success(res, result.rows, 200);
  })
);

router.post(
  "/notifications/push-tokens",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(upsertPushTokenSchema, req.body, "Invalid push token payload");

    let token;
    try {
      token = await upsertPushToken({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
        provider: body.provider,
        platform: body.platform,
        deviceToken: body.device_token,
        deviceId: body.device_id,
        appVersion: body.app_version,
      });
    } catch (error) {
      if (error?.code === "42P01") {
        throw new AppError(
          500,
          "MIGRATION_REQUIRED",
          "push_device_tokens table is missing. Apply latest database schema."
        );
      }
      throw error;
    }

    return success(res, token, 200);
  })
);

router.delete(
  "/notifications/push-tokens/:tokenId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ tokenId: z.string().uuid() }),
      req.params,
      "Invalid push token id"
    );

    let result;
    try {
      result = await pool.query(
        `
          UPDATE push_device_tokens
          SET
            is_active = FALSE,
            revoked_at = NOW(),
            updated_at = NOW()
          WHERE school_id = $1
            AND user_id = $2
            AND id = $3
          RETURNING id
        `,
        [req.auth.schoolId, req.auth.userId, path.tokenId]
      );
    } catch (error) {
      if (error?.code === "42P01") {
        throw new AppError(
          500,
          "MIGRATION_REQUIRED",
          "push_device_tokens table is missing. Apply latest database schema."
        );
      }
      throw error;
    }

    if (!result.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Push token not found");
    }

    return success(res, { ok: true }, 200);
  })
);

router.post(
  "/internal/notifications/trigger",
  requireInternalApiKey,
  asyncHandler(async (req, res) => {
    const body = parseSchema(internalTriggerSchema, req.body, "Invalid internal trigger payload");

    const schoolExistsResult = await pool.query("SELECT id FROM schools WHERE id = $1 LIMIT 1", [body.school_id]);
    if (!schoolExistsResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "School not found");
    }

    const actorExists = await userExistsInSchool({
      schoolId: body.school_id,
      userId: body.actor_user_id,
    });
    if (!actorExists) {
      throw new AppError(404, "NOT_FOUND", "Actor user not found in school");
    }

    const payload = body.payload || {};
    const targetIds = new Set();
    if (Array.isArray(payload.user_ids)) {
      for (const item of payload.user_ids) {
        if (typeof item === "string") targetIds.add(item);
      }
    }
    if (typeof payload.user_id === "string") {
      targetIds.add(payload.user_id);
    }

    if (targetIds.size === 0) {
      return success(res, { queued_count: 0, reason: "no_recipients" }, 200);
    }

    const userIds = [...targetIds];
    const validUsersResult = await pool.query(
      `
        SELECT id
        FROM users
        WHERE school_id = $1
          AND id = ANY($2::uuid[])
      `,
      [body.school_id, userIds]
    );
    const validIds = validUsersResult.rows.map((row) => row.id);
    if (validIds.length === 0) {
      return success(res, { queued_count: 0, reason: "no_valid_recipients" }, 200);
    }

    const title =
      typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title.trim()
        : `Event: ${body.event_type}`;
    const textBody =
      typeof payload.body === "string" && payload.body.trim().length > 0
        ? payload.body.trim()
        : "A new school event occurred.";
    const channel =
      typeof payload.channel === "string" &&
      ["in_app", "push", "email", "sms"].includes(payload.channel)
        ? payload.channel
        : "in_app";

    const client = await pool.connect();
    const insertedNotifications = [];
    try {
      await client.query("BEGIN");
      for (const userId of validIds) {
        const insertResult = await client.query(
          `
            INSERT INTO notifications (
              school_id,
              user_id,
              title,
              body,
              channel,
              status,
              payload
            )
            VALUES ($1, $2, $3, $4, $5::notification_channel, 'queued'::notification_status, $6::jsonb)
            RETURNING
              id,
              user_id,
              title,
              body,
              channel,
              status,
              payload,
              sent_at,
              read_at,
              created_at
          `,
          [
            body.school_id,
            userId,
            title,
            textBody,
            channel,
            JSON.stringify({
              source: "internal_trigger",
              event_type: body.event_type,
              actor_user_id: body.actor_user_id,
              payload,
              retry_count: 0,
              next_retry_at: null,
            }),
          ]
        );
        insertedNotifications.push(insertResult.rows[0]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    for (const notification of insertedNotifications) {
      emitNotificationRealtime({
        schoolId: body.school_id,
        notification,
        event: "notification.new",
      });
    }

    return success(
      res,
      {
        queued_count: validIds.length,
      },
      200
    );
  })
);

module.exports = router;
