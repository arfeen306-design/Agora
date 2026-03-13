const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { requireInternalApiKey } = require("../middleware/internal-key");
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
      ["in_app", "push", "email", "sms", "whatsapp"].includes(payload.channel)
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

// ─── Scheduled Notifications ────────────────────────────────────────

const ADMIN_SCHEDULE_ROLES = ["school_admin", "principal", "vice_principal"];

const scheduledListQuerySchema = z.object({
  status: z.enum(["pending", "sent", "cancelled", "failed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createScheduledSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]).default("in_app"),
  target_type: z.enum(["role", "user", "classroom", "all"]),
  target_id: z.string().trim().min(1).max(200).nullable().optional(),
  send_at: z.string().datetime(),
  metadata: z.record(z.any()).default({}),
});

router.get(
  "/notifications/scheduled",
  requireAuth,
  requireRoles(...ADMIN_SCHEDULE_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(scheduledListQuerySchema, req.query, "Invalid scheduled query");

    const params = [req.auth.schoolId];
    const where = ["sn.school_id = $1"];

    if (query.status) {
      params.push(query.status);
      where.push(`sn.status = $${params.length}`);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM scheduled_notifications sn WHERE ${where.join(" AND ")}`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listResult = await pool.query(
      `
        SELECT
          sn.*,
          u.first_name AS created_by_first_name,
          u.last_name AS created_by_last_name
        FROM scheduled_notifications sn
        LEFT JOIN users u ON u.id = sn.created_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY sn.send_at ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );

    return success(res, listResult.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

router.post(
  "/notifications/scheduled",
  requireAuth,
  requireRoles(...ADMIN_SCHEDULE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createScheduledSchema, req.body, "Invalid scheduled notification");

    const sendAt = new Date(body.send_at);
    if (sendAt.getTime() <= Date.now()) {
      throw new AppError(422, "VALIDATION_ERROR", "send_at must be in the future");
    }

    if (body.target_type !== "all" && !body.target_id) {
      throw new AppError(422, "VALIDATION_ERROR", "target_id is required for this target_type");
    }

    const result = await pool.query(
      `
        INSERT INTO scheduled_notifications (
          school_id, title, body, channel, target_type, target_id,
          send_at, created_by_user_id, metadata
        )
        VALUES ($1, $2, $3, $4::notification_channel, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        body.title,
        body.body,
        body.channel,
        body.target_type,
        body.target_id || null,
        body.send_at,
        req.auth.userId,
        JSON.stringify(body.metadata),
      ]
    );

    return success(res, result.rows[0], 201);
  })
);

router.delete(
  "/notifications/scheduled/:scheduledId",
  requireAuth,
  requireRoles(...ADMIN_SCHEDULE_ROLES),
  asyncHandler(async (req, res) => {
    const { scheduledId } = parseSchema(
      z.object({ scheduledId: z.string().uuid() }),
      req.params,
      "Invalid scheduled ID"
    );

    const result = await pool.query(
      `
        UPDATE scheduled_notifications
        SET status = 'cancelled', updated_at = NOW()
        WHERE school_id = $1 AND id = $2 AND status = 'pending'
        RETURNING id
      `,
      [req.auth.schoolId, scheduledId]
    );

    if (!result.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Scheduled notification not found or already processed");
    }

    return success(res, { cancelled: true }, 200);
  })
);

// ─── Bulk Notifications ─────────────────────────────────────────────

const bulkSendSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]).default("in_app"),
  target_type: z.enum(["role", "classroom", "all"]),
  target_id: z.string().trim().min(1).max(200).nullable().optional(),
});

router.post(
  "/notifications/bulk",
  requireAuth,
  requireRoles(...ADMIN_SCHEDULE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(bulkSendSchema, req.body, "Invalid bulk notification");

    if (body.target_type !== "all" && !body.target_id) {
      throw new AppError(422, "VALIDATION_ERROR", "target_id required for this target_type");
    }

    let userIds = [];

    if (body.target_type === "all") {
      const result = await pool.query(
        "SELECT id FROM users WHERE school_id = $1 AND is_active = TRUE",
        [req.auth.schoolId]
      );
      userIds = result.rows.map((r) => r.id);
    } else if (body.target_type === "role") {
      const result = await pool.query(
        `
          SELECT DISTINCT ur.user_id AS id
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          JOIN users u ON u.id = ur.user_id AND u.school_id = $1 AND u.is_active = TRUE
          WHERE r.code = $2
        `,
        [req.auth.schoolId, body.target_id]
      );
      userIds = result.rows.map((r) => r.id);
    } else if (body.target_type === "classroom") {
      const result = await pool.query(
        `
          SELECT DISTINCT u.id
          FROM student_enrollments se
          JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
          LEFT JOIN student_user_accounts sua ON sua.student_id = s.id
          LEFT JOIN users u ON u.id = sua.user_id AND u.school_id = se.school_id AND u.is_active = TRUE
          WHERE se.school_id = $1 AND se.classroom_id = $2::uuid AND se.status = 'active'
            AND u.id IS NOT NULL
          UNION
          SELECT DISTINCT p.user_id AS id
          FROM student_enrollments se
          JOIN parent_students ps ON ps.student_id = se.student_id AND ps.school_id = se.school_id
          JOIN parents p ON p.id = ps.parent_id AND p.school_id = ps.school_id
          JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id AND u.is_active = TRUE
          WHERE se.school_id = $1 AND se.classroom_id = $2::uuid AND se.status = 'active'
        `,
        [req.auth.schoolId, body.target_id]
      );
      userIds = result.rows.map((r) => r.id);
    }

    if (userIds.length === 0) {
      return success(res, { queued_count: 0, reason: "no_recipients" }, 200);
    }

    const client = await pool.connect();
    let queuedCount = 0;
    try {
      await client.query("BEGIN");
      for (const userId of userIds) {
        await client.query(
          `
            INSERT INTO notifications (school_id, user_id, title, body, channel, status, payload)
            VALUES ($1, $2, $3, $4, $5::notification_channel, 'queued'::notification_status, $6::jsonb)
          `,
          [
            req.auth.schoolId,
            userId,
            body.title,
            body.body,
            body.channel,
            JSON.stringify({
              source: "bulk",
              target_type: body.target_type,
              target_id: body.target_id,
              sent_by: req.auth.userId,
            }),
          ]
        );
        queuedCount++;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return success(res, { queued_count: queuedCount }, 201);
  })
);

// ─── Notification Preferences ───────────────────────────────────────

const preferencesUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        event_type: z.string().trim().min(1).max(120),
        channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]),
        enabled: z.boolean(),
      })
    )
    .min(1)
    .max(50),
});

router.get(
  "/notifications/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT event_type, channel, enabled
        FROM notification_preferences
        WHERE school_id = $1 AND user_id = $2
        ORDER BY event_type, channel
      `,
      [req.auth.schoolId, req.auth.userId]
    );
    return success(res, result.rows);
  })
);

router.patch(
  "/notifications/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(preferencesUpdateSchema, req.body, "Invalid preferences update");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const pref of body.preferences) {
        await client.query(
          `
            INSERT INTO notification_preferences (school_id, user_id, event_type, channel, enabled)
            VALUES ($1, $2, $3, $4::notification_channel, $5)
            ON CONFLICT (school_id, user_id, event_type, channel)
            DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
          `,
          [req.auth.schoolId, req.auth.userId, pref.event_type, pref.channel, pref.enabled]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return success(res, { updated: body.preferences.length }, 200);
  })
);

// ─── Notification Templates ─────────────────────────────────────────

const { listTemplates } = require("../services/notification-templates");

router.get(
  "/notifications/templates",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal"),
  asyncHandler(async (_req, res) => {
    return success(res, listTemplates());
  })
);

// ─── Notification Analytics ─────────────────────────────────────────

const ANALYTICS_ROLES = ["school_admin", "principal", "vice_principal"];

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

router.get(
  "/notifications/analytics",
  requireAuth,
  requireRoles(...ANALYTICS_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(analyticsQuerySchema, req.query);

    // Delivery stats by channel
    const channelStats = await pool.query(
      `
        SELECT
          channel::text,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'sent'::notification_status)::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed'::notification_status)::int AS failed,
          COUNT(*) FILTER (WHERE status = 'queued'::notification_status)::int AS queued,
          COUNT(*) FILTER (WHERE status = 'read'::notification_status)::int AS read_count,
          ROUND(COUNT(*) FILTER (WHERE status = 'failed'::notification_status)::numeric
            / NULLIF(COUNT(*)::numeric, 0) * 100, 2) AS failure_rate
        FROM notifications
        WHERE school_id = $1
          AND created_at >= NOW() - make_interval(days => $2::int)
        GROUP BY channel
        ORDER BY total DESC
      `,
      [req.auth.schoolId, query.days]
    );

    // Daily volumes
    const dailyVolume = await pool.query(
      `
        SELECT DATE(created_at) AS day,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'sent'::notification_status)::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed'::notification_status)::int AS failed
        FROM notifications
        WHERE school_id = $1
          AND created_at >= NOW() - make_interval(days => $2::int)
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 30
      `,
      [req.auth.schoolId, query.days]
    );

    // Overall summary
    const summary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_all_time,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
        FROM notifications
        WHERE school_id = $1
      `,
      [req.auth.schoolId]
    );

    return success(res, {
      period_days: query.days,
      channel_stats: channelStats.rows,
      daily_volume: dailyVolume.rows,
      summary: summary.rows[0] || {},
    });
  })
);

// ─── Delivery Log ───────────────────────────────────────────────────

const deliveryLogQuerySchema = z.object({
  channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]).optional(),
  status: z.enum(["queued", "sent", "failed", "read"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

router.get(
  "/notifications/delivery-log",
  requireAuth,
  requireRoles(...ANALYTICS_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(deliveryLogQuerySchema, req.query);

    const params = [req.auth.schoolId];
    const where = ["n.school_id = $1"];

    if (query.channel) { params.push(query.channel); where.push(`n.channel = $${params.length}::notification_channel`); }
    if (query.status) { params.push(query.status); where.push(`n.status = $${params.length}::notification_status`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM notifications n WHERE ${where.join(" AND ")}`, params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT n.id, n.user_id, n.title, n.channel, n.status, n.sent_at, n.read_at, n.created_at,
          n.payload->>'event_type' AS event_type,
          n.payload->>'source' AS source,
          u.first_name, u.last_name, u.email
        FROM notifications n
        LEFT JOIN users u ON u.id = n.user_id AND u.school_id = n.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY n.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );

    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

module.exports = router;
