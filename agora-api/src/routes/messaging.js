const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getRealtimeHub } = require("../realtime/hub");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const conversationKindSchema = z.enum(["direct", "group", "broadcast"]);
const messageKindSchema = z.enum(["text", "file", "system"]);

const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createConversationSchema = z.object({
  kind: conversationKindSchema,
  title: z.string().trim().max(200).nullable().optional(),
  participant_user_ids: z.array(z.string().uuid()).min(1),
});

const listMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const createMessageSchema = z.object({
  kind: messageKindSchema.default("text"),
  body: z.string().trim().max(8000).optional(),
  attachment_urls: z.array(z.string().url()).default([]),
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

async function getConversationById({ schoolId, conversationId }) {
  const result = await pool.query(
    `
      SELECT id, school_id, kind, title, created_by_user_id, created_at
      FROM conversations
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
    `,
    [conversationId, schoolId]
  );
  return result.rows[0] || null;
}

async function isConversationParticipant({ conversationId, userId }) {
  const result = await pool.query(
    `
      SELECT 1
      FROM conversation_participants
      WHERE conversation_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [conversationId, userId]
  );
  return Boolean(result.rows[0]);
}

async function getConversationParticipantUserIds(conversationId) {
  const result = await pool.query(
    `
      SELECT user_id
      FROM conversation_participants
      WHERE conversation_id = $1
    `,
    [conversationId]
  );
  return result.rows.map((row) => row.user_id);
}

async function ensureParticipantOrThrow({ auth, conversationId }) {
  const allowed = await isConversationParticipant({
    conversationId,
    userId: auth.userId,
  });
  if (!allowed) {
    throw new AppError(403, "FORBIDDEN", "You are not a participant in this conversation");
  }
}

async function validateUsersInSchool({ schoolId, userIds }) {
  const result = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND is_active = TRUE
        AND id = ANY($2::uuid[])
    `,
    [schoolId, userIds]
  );
  return new Set(result.rows.map((row) => row.id));
}

router.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(listConversationsQuerySchema, req.query, "Invalid conversations query");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        WHERE c.school_id = $1
          AND cp.user_id = $2
      `,
      [req.auth.schoolId, req.auth.userId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const rowsResult = await pool.query(
      `
        SELECT
          c.id,
          c.kind,
          c.title,
          COALESCE(unread.unread_count, 0)::int AS unread_count,
          latest.last_message_preview
        FROM conversations c
        JOIN conversation_participants cp
          ON cp.conversation_id = c.id
         AND cp.user_id = $2
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN m.body IS NOT NULL AND LENGTH(TRIM(m.body)) > 0 THEN LEFT(m.body, 160)
              WHEN jsonb_array_length(m.attachment_urls) > 0 THEN '[attachment]'
              ELSE '[message]'
            END AS last_message_preview,
            m.sent_at
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 1
        ) latest ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS unread_count
          FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_user_id <> $2
            AND m.sent_at > COALESCE(cp.last_read_at, TO_TIMESTAMP(0))
        ) unread ON TRUE
        WHERE c.school_id = $1
        ORDER BY COALESCE(latest.sent_at, c.created_at) DESC, c.id DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.schoolId, req.auth.userId, query.page_size, offset]
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

router.post(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(createConversationSchema, req.body, "Invalid create conversation payload");

    const participantSet = new Set(body.participant_user_ids);
    participantSet.add(req.auth.userId);
    const participantUserIds = [...participantSet];

    if (body.kind === "direct" && participantUserIds.length !== 2) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Direct conversation must have exactly 2 participants"
      );
    }
    if ((body.kind === "group" || body.kind === "broadcast") && participantUserIds.length < 2) {
      throw new AppError(422, "VALIDATION_ERROR", "Group/broadcast conversation needs at least 2 participants");
    }

    const validUserIds = await validateUsersInSchool({
      schoolId: req.auth.schoolId,
      userIds: participantUserIds,
    });
    if (validUserIds.size !== participantUserIds.length) {
      throw new AppError(422, "VALIDATION_ERROR", "One or more participant users are invalid for this school");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const conversationResult = await client.query(
        `
          INSERT INTO conversations (
            school_id,
            kind,
            title,
            created_by_user_id
          )
          VALUES ($1, $2::conversation_kind, $3, $4)
          RETURNING id, kind, title
        `,
        [req.auth.schoolId, body.kind, body.title || null, req.auth.userId]
      );
      const conversation = conversationResult.rows[0];

      for (const userId of participantUserIds) {
        await client.query(
          `
            INSERT INTO conversation_participants (
              conversation_id,
              user_id,
              role_in_conversation,
              joined_at,
              last_read_at
            )
            VALUES ($1, $2, $3, NOW(), $4)
            ON CONFLICT (conversation_id, user_id) DO NOTHING
          `,
          [conversation.id, userId, "member", userId === req.auth.userId ? new Date().toISOString() : null]
        );
      }

      await client.query("COMMIT");

      const conversationPayload = {
        ...conversation,
        unread_count: 0,
        last_message_preview: null,
      };
      getRealtimeHub().emitToUsers(participantUserIds, "conversation.new", {
        conversation: conversationPayload,
      }, { schoolId: req.auth.schoolId });

      return success(
        res,
        conversationPayload,
        201
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/conversations/:conversationId/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ conversationId: z.string().uuid() }),
      req.params,
      "Invalid conversation id"
    );
    const query = parseSchema(listMessagesQuerySchema, req.query, "Invalid message list query");

    const conversation = await getConversationById({
      schoolId: req.auth.schoolId,
      conversationId: path.conversationId,
    });
    if (!conversation) {
      throw new AppError(404, "NOT_FOUND", "Conversation not found");
    }

    await ensureParticipantOrThrow({
      auth: req.auth,
      conversationId: path.conversationId,
    });

    let cursorSentAt = null;
    if (query.cursor) {
      const cursorResult = await pool.query(
        `
          SELECT id, sent_at
          FROM messages
          WHERE id = $1
            AND conversation_id = $2
          LIMIT 1
        `,
        [query.cursor, path.conversationId]
      );
      if (!cursorResult.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Cursor message not found in this conversation");
      }
      cursorSentAt = cursorResult.rows[0].sent_at;
    }

    const params = [req.auth.schoolId, path.conversationId];
    let cursorClause = "";
    if (query.cursor) {
      params.push(cursorSentAt);
      params.push(query.cursor);
      cursorClause = `
        AND (
          m.sent_at < $3
          OR (m.sent_at = $3 AND m.id < $4)
        )
      `;
    }

    params.push(query.limit + 1);
    const limitParamIndex = params.length;

    const rowsResult = await pool.query(
      `
        SELECT
          m.id,
          m.conversation_id,
          m.sender_user_id,
          m.kind,
          m.body,
          m.attachment_urls,
          m.sent_at,
          m.edited_at
        FROM messages m
        WHERE m.school_id = $1
          AND m.conversation_id = $2
          ${cursorClause}
        ORDER BY m.sent_at DESC, m.id DESC
        LIMIT $${limitParamIndex}
      `,
      params
    );

    const hasMore = rowsResult.rows.length > query.limit;
    const dataRows = hasMore ? rowsResult.rows.slice(0, query.limit) : rowsResult.rows;
    const nextCursor = hasMore ? dataRows[dataRows.length - 1].id : null;

    return success(res, dataRows, 200, { next_cursor: nextCursor });
  })
);

router.post(
  "/conversations/:conversationId/messages",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ conversationId: z.string().uuid() }),
      req.params,
      "Invalid conversation id"
    );
    const body = parseSchema(createMessageSchema, req.body, "Invalid create message payload");

    const conversation = await getConversationById({
      schoolId: req.auth.schoolId,
      conversationId: path.conversationId,
    });
    if (!conversation) {
      throw new AppError(404, "NOT_FOUND", "Conversation not found");
    }

    await ensureParticipantOrThrow({
      auth: req.auth,
      conversationId: path.conversationId,
    });

    const hasBody = typeof body.body === "string" && body.body.trim().length > 0;
    const hasAttachments = Array.isArray(body.attachment_urls) && body.attachment_urls.length > 0;
    if (!hasBody && !hasAttachments) {
      throw new AppError(422, "VALIDATION_ERROR", "Message must include body or attachment_urls");
    }

    const insertResult = await pool.query(
      `
        INSERT INTO messages (
          school_id,
          conversation_id,
          sender_user_id,
          kind,
          body,
          attachment_urls
        )
        VALUES ($1, $2, $3, $4::message_kind, $5, $6::jsonb)
        RETURNING
          id,
          conversation_id,
          sender_user_id,
          kind,
          body,
          attachment_urls,
          sent_at,
          edited_at
      `,
      [
        req.auth.schoolId,
        path.conversationId,
        req.auth.userId,
        body.kind,
        body.body || null,
        JSON.stringify(body.attachment_urls || []),
      ]
    );

    const message = insertResult.rows[0];
    const participantUserIds = await getConversationParticipantUserIds(path.conversationId);

    getRealtimeHub().emitToUsers(participantUserIds, "message.new", {
      conversation_id: path.conversationId,
      message,
    }, { schoolId: req.auth.schoolId });

    return success(res, message, 201);
  })
);

router.post(
  "/conversations/:conversationId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ conversationId: z.string().uuid() }),
      req.params,
      "Invalid conversation id"
    );

    const conversation = await getConversationById({
      schoolId: req.auth.schoolId,
      conversationId: path.conversationId,
    });
    if (!conversation) {
      throw new AppError(404, "NOT_FOUND", "Conversation not found");
    }

    await ensureParticipantOrThrow({
      auth: req.auth,
      conversationId: path.conversationId,
    });

    const participantUserIds = await getConversationParticipantUserIds(path.conversationId);

    const updateResult = await pool.query(
      `
        UPDATE conversation_participants
        SET last_read_at = NOW()
        WHERE conversation_id = $1
          AND user_id = $2
        RETURNING last_read_at
      `,
      [path.conversationId, req.auth.userId]
    );

    const readAt = updateResult.rows[0]?.last_read_at || new Date().toISOString();

    getRealtimeHub().emitToUsers(participantUserIds, "conversation.read", {
      conversation_id: path.conversationId,
      user_id: req.auth.userId,
      read_at: readAt,
    }, { schoolId: req.auth.schoolId });

    return success(res, { ok: true, read_at: readAt }, 200);
  })
);

module.exports = router;
