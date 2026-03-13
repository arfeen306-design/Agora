const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const aiEngine = require("../services/ai-engine");
const { triggerForStudentParents, triggerByRole } = require("../services/notification-triggers");

const router = express.Router();

const ADMIN_ROLES = ["school_admin", "principal", "vice_principal"];

const sessionPathSchema = z.object({ sessionId: z.string().uuid() });
const studentPathSchema = z.object({ studentId: z.string().uuid() });

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createSessionSchema = z.object({
  subject_id: z.string().uuid().optional(),
  topic: z.string().trim().min(1).max(300).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

const updateConfigSchema = z.object({
  is_enabled: z.boolean().optional(),
  enabled_subjects: z.array(z.string().uuid()).optional(),
  system_prompt_override: z.string().trim().max(5000).nullable().optional(),
  difficulty_level: z.enum(["easy", "medium", "hard", "adaptive"]).optional(),
  max_messages_per_session: z.coerce.number().int().min(5).max(200).optional(),
  max_sessions_per_day: z.coerce.number().int().min(1).max(100).optional(),
  allowed_roles: z.array(z.string().trim().min(1).max(60)).optional(),
  metadata: z.record(z.any()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", message,
      parsed.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })));
  }
  return parsed.data;
}

async function getStudentIdByUser(schoolId, userId) {
  const result = await pool.query(
    `SELECT sua.student_id FROM student_user_accounts sua JOIN students s ON s.id = sua.student_id AND s.school_id = $1 WHERE sua.user_id = $2 LIMIT 1`,
    [schoolId, userId]
  );
  if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Student account not linked");
  return result.rows[0].student_id;
}

async function getTutorConfig(schoolId) {
  const result = await pool.query(
    "SELECT * FROM tutor_configs WHERE school_id = $1 LIMIT 1",
    [schoolId]
  );
  return result.rows[0] || null;
}

async function ensureTutorEnabled(schoolId) {
  const config = await getTutorConfig(schoolId);
  if (!config || !config.is_enabled) {
    throw new AppError(403, "FORBIDDEN", "AI Tutor is not enabled for this school");
  }
  return config;
}

// ─── POST /tutor/sessions ───────────────────────────────────────────
router.post(
  "/sessions",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const config = await ensureTutorEnabled(req.auth.schoolId);
    const body = parseSchema(createSessionSchema, req.body, "Invalid session");
    const studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);

    // Check budget
    const budget = await aiEngine.enforceTokenBudget(req.auth.schoolId);
    if (budget.exhausted) {
      throw new AppError(429, "TOKEN_BUDGET_EXHAUSTED", "Monthly AI token budget has been reached");
    }

    // Check daily session limit
    const dailyCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM tutor_sessions
       WHERE school_id = $1 AND user_id = $2 AND started_at >= CURRENT_DATE`,
      [req.auth.schoolId, req.auth.userId]
    );
    if ((dailyCount.rows[0]?.count || 0) >= config.max_sessions_per_day) {
      throw new AppError(429, "SESSION_LIMIT", `Maximum ${config.max_sessions_per_day} sessions per day`);
    }

    // Validate subject if provided
    if (body.subject_id) {
      const subCheck = await pool.query(
        "SELECT id FROM subjects WHERE school_id = $1 AND id = $2 LIMIT 1",
        [req.auth.schoolId, body.subject_id]
      );
      if (!subCheck.rows[0]) throw new AppError(404, "NOT_FOUND", "Subject not found");
    }

    // Build context
    const studentContext = await aiEngine.buildStudentContext({
      schoolId: req.auth.schoolId,
      studentId,
      subjectId: body.subject_id,
    });

    const contextSnapshot = {
      student_context: studentContext,
      difficulty: config.difficulty_level,
      topic: body.topic,
    };

    const result = await pool.query(
      `
        INSERT INTO tutor_sessions (school_id, student_id, user_id, subject_id, topic, model_used, context_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [req.auth.schoolId, studentId, req.auth.userId, body.subject_id || null,
       body.topic || null, "gpt-4o-mini", JSON.stringify(contextSnapshot)]
    );

    // Insert system message
    const systemPrompt = aiEngine.buildSystemPrompt({
      studentContext,
      topic: body.topic,
      schoolPromptOverride: config.system_prompt_override,
      difficultyLevel: config.difficulty_level,
    });

    await pool.query(
      `INSERT INTO tutor_messages (school_id, session_id, role, content, token_count)
       VALUES ($1, $2, 'system', $3, $4)`,
      [req.auth.schoolId, result.rows[0].id, systemPrompt, aiEngine.estimateTokens(systemPrompt)]
    );

    return success(res, result.rows[0], 201);
  })
);

// ─── GET /tutor/sessions ────────────────────────────────────────────
router.get(
  "/sessions",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery.extend({
      status: z.enum(["active", "closed", "expired"]).optional(),
    }), req.query);

    const params = [req.auth.schoolId, req.auth.userId];
    const where = ["ts.school_id = $1", "ts.user_id = $2"];

    if (query.status) { params.push(query.status); where.push(`ts.status = $${params.length}`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tutor_sessions ts WHERE ${where.join(" AND ")}`, params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT ts.*, sub.name AS subject_name
        FROM tutor_sessions ts
        LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY ts.started_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /tutor/sessions/:sessionId ─────────────────────────────────
router.get(
  "/sessions/:sessionId",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const { sessionId } = parseSchema(sessionPathSchema, req.params);

    const sessionResult = await pool.query(
      `SELECT ts.*, sub.name AS subject_name
       FROM tutor_sessions ts
       LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
       WHERE ts.school_id = $1 AND ts.id = $2 AND ts.user_id = $3 LIMIT 1`,
      [req.auth.schoolId, sessionId, req.auth.userId]
    );
    if (!sessionResult.rows[0]) throw new AppError(404, "NOT_FOUND", "Session not found");

    const messagesResult = await pool.query(
      `SELECT id, role, content, token_count, model, latency_ms, created_at
       FROM tutor_messages
       WHERE school_id = $1 AND session_id = $2 AND role != 'system'
       ORDER BY created_at ASC`,
      [req.auth.schoolId, sessionId]
    );

    return success(res, {
      session: sessionResult.rows[0],
      messages: messagesResult.rows,
    });
  })
);

// ─── POST /tutor/sessions/:sessionId/messages ───────────────────────
router.post(
  "/sessions/:sessionId/messages",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const { sessionId } = parseSchema(sessionPathSchema, req.params);
    const body = parseSchema(sendMessageSchema, req.body, "Invalid message");

    // Verify session
    const sessionResult = await pool.query(
      "SELECT * FROM tutor_sessions WHERE school_id = $1 AND id = $2 AND user_id = $3 LIMIT 1",
      [req.auth.schoolId, sessionId, req.auth.userId]
    );
    const session = sessionResult.rows[0];
    if (!session) throw new AppError(404, "NOT_FOUND", "Session not found");
    if (session.status !== "active") throw new AppError(422, "SESSION_CLOSED", "This session is no longer active");

    // Check message limit
    const config = await getTutorConfig(req.auth.schoolId);
    const maxMessages = config?.max_messages_per_session || 50;
    if (session.message_count >= maxMessages) {
      throw new AppError(429, "MESSAGE_LIMIT", `Maximum ${maxMessages} messages per session reached`);
    }

    // Check budget
    const budget = await aiEngine.enforceTokenBudget(req.auth.schoolId);
    if (budget.exhausted) {
      throw new AppError(429, "TOKEN_BUDGET_EXHAUSTED", "Monthly AI token budget exhausted");
    }

    // Save user message
    const userTokens = aiEngine.estimateTokens(body.content);
    await pool.query(
      `INSERT INTO tutor_messages (school_id, session_id, role, content, token_count)
       VALUES ($1, $2, 'user', $3, $4)`,
      [req.auth.schoolId, sessionId, body.content, userTokens]
    );

    // Get conversation history
    const historyResult = await pool.query(
      `SELECT role, content FROM tutor_messages
       WHERE school_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [req.auth.schoolId, sessionId]
    );

    // Get system prompt from first message
    const systemMsg = historyResult.rows.find((m) => m.role === "system");
    const conversationMessages = historyResult.rows.filter((m) => m.role !== "system");

    // Generate AI response
    const aiResponse = await aiEngine.chat({
      schoolId: req.auth.schoolId,
      sessionId,
      userId: req.auth.userId,
      systemPrompt: systemMsg?.content || "You are a helpful AI tutor.",
      messages: conversationMessages,
    });

    // Save assistant message
    await pool.query(
      `INSERT INTO tutor_messages (school_id, session_id, role, content, token_count, model, latency_ms)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6)`,
      [req.auth.schoolId, sessionId, aiResponse.content, aiResponse.completionTokens,
       aiResponse.model, aiResponse.latencyMs]
    );

    // Update session counters
    await pool.query(
      `UPDATE tutor_sessions SET message_count = message_count + 2,
       total_tokens_used = total_tokens_used + $3, updated_at = NOW()
       WHERE id = $1 AND school_id = $2`,
      [sessionId, req.auth.schoolId, aiResponse.totalTokens]
    );

    return success(res, {
      user_message: { role: "user", content: body.content, token_count: userTokens },
      assistant_message: {
        role: "assistant",
        content: aiResponse.content,
        token_count: aiResponse.completionTokens,
        model: aiResponse.model,
        latency_ms: aiResponse.latencyMs,
      },
      session_message_count: session.message_count + 2,
      token_budget: {
        used: budget.used + aiResponse.totalTokens,
        remaining: budget.remaining - aiResponse.totalTokens,
      },
    });
  })
);

// ─── POST /tutor/sessions/:sessionId/close ──────────────────────────
router.post(
  "/sessions/:sessionId/close",
  requireAuth,
  requireRoles("student"),
  asyncHandler(async (req, res) => {
    const { sessionId } = parseSchema(sessionPathSchema, req.params);

    const sessionResult = await pool.query(
      "SELECT * FROM tutor_sessions WHERE school_id = $1 AND id = $2 AND user_id = $3 AND status = 'active' LIMIT 1",
      [req.auth.schoolId, sessionId, req.auth.userId]
    );
    if (!sessionResult.rows[0]) throw new AppError(404, "NOT_FOUND", "Active session not found");

    // Get messages for summary
    const messagesResult = await pool.query(
      "SELECT role, content FROM tutor_messages WHERE school_id = $1 AND session_id = $2 ORDER BY created_at ASC",
      [req.auth.schoolId, sessionId]
    );

    const summary = await aiEngine.summarizeSession({
      schoolId: req.auth.schoolId,
      sessionId,
      userId: req.auth.userId,
      messages: messagesResult.rows,
    });

    const updateResult = await pool.query(
      `UPDATE tutor_sessions SET status = 'closed', summary = $3, closed_at = NOW(), updated_at = NOW()
       WHERE school_id = $1 AND id = $2 RETURNING *`,
      [req.auth.schoolId, sessionId, summary]
    );

    // Notify parents about session summary
    const session = sessionResult.rows[0];
    triggerForStudentParents({
      schoolId: req.auth.schoolId,
      studentId: session.student_id,
      eventType: "tutor.session_summary",
      data: {
        student_name: session.student_id,
        topic: session.topic || "General",
        summary: summary ? summary.slice(0, 200) : "Session completed.",
      },
    }).catch(() => {}); // fire-and-forget

    // Check budget warning at 80%
    const budget = await aiEngine.enforceTokenBudget(req.auth.schoolId);
    if (budget.remaining > 0 && budget.used / (budget.used + budget.remaining) >= 0.8) {
      triggerByRole({
        schoolId: req.auth.schoolId,
        eventType: "tutor.budget_warning",
        roleCode: "school_admin",
        data: {
          percent_used: Math.round(budget.used / (budget.used + budget.remaining) * 100),
          remaining_tokens: budget.remaining,
        },
      }).catch(() => {}); // fire-and-forget
    }

    return success(res, updateResult.rows[0]);
  })
);

// ─── GET /tutor/history ─────────────────────────────────────────────
router.get(
  "/history",
  requireAuth,
  requireRoles("student", "parent"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery, req.query);

    // For parent, need to resolve which student
    let studentId;
    if (req.auth.roles?.includes("student")) {
      studentId = await getStudentIdByUser(req.auth.schoolId, req.auth.userId);
    } else {
      // Parent - show first child's history (or use query param)
      const childQuery = z.object({ student_id: z.string().uuid().optional() }).parse(req.query);
      if (childQuery.student_id) {
        studentId = childQuery.student_id;
      } else {
        const childResult = await pool.query(
          `SELECT ps.student_id FROM parents p JOIN parent_students ps ON ps.parent_id = p.id AND ps.school_id = p.school_id
           WHERE p.school_id = $1 AND p.user_id = $2 LIMIT 1`,
          [req.auth.schoolId, req.auth.userId]
        );
        if (!childResult.rows[0]) throw new AppError(404, "NOT_FOUND", "No linked students found");
        studentId = childResult.rows[0].student_id;
      }
    }

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM tutor_sessions WHERE school_id = $1 AND student_id = $2",
      [req.auth.schoolId, studentId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT ts.id, ts.topic, ts.status, ts.summary, ts.message_count,
          ts.total_tokens_used, ts.started_at, ts.closed_at,
          sub.name AS subject_name
        FROM tutor_sessions ts
        LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.student_id = $2
        ORDER BY ts.started_at DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.schoolId, studentId, query.page_size, offset]
    );

    // Stats
    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS total_sessions,
        COALESCE(SUM(message_count), 0)::int AS total_messages,
        COALESCE(SUM(total_tokens_used), 0)::int AS total_tokens,
        COUNT(DISTINCT subject_id)::int AS subjects_explored
       FROM tutor_sessions WHERE school_id = $1 AND student_id = $2`,
      [req.auth.schoolId, studentId]
    );

    return success(res, {
      sessions: result.rows,
      stats: statsResult.rows[0] || {},
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── GET /tutor/usage ───────────────────────────────────────────────
router.get(
  "/usage",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const budget = await aiEngine.enforceTokenBudget(req.auth.schoolId);

    const statsResult = await pool.query(
      `
        SELECT
          COUNT(DISTINCT ts.id)::int AS total_sessions,
          COUNT(DISTINCT ts.student_id)::int AS unique_students,
          COALESCE(SUM(ts.message_count), 0)::int AS total_messages,
          COUNT(DISTINCT ts.subject_id)::int AS subjects_used
        FROM tutor_sessions ts
        WHERE ts.school_id = $1
          AND ts.started_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
      `,
      [req.auth.schoolId]
    );

    // Top subjects
    const topSubjects = await pool.query(
      `
        SELECT sub.name AS subject_name, COUNT(*)::int AS session_count,
          COALESCE(SUM(ts.total_tokens_used), 0)::int AS tokens_used
        FROM tutor_sessions ts
        JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.started_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
        GROUP BY sub.name
        ORDER BY session_count DESC
        LIMIT 10
      `,
      [req.auth.schoolId]
    );

    // Daily usage for current month
    const dailyUsage = await pool.query(
      `
        SELECT DATE(created_at) AS day, SUM(total_tokens)::int AS tokens
        FROM tutor_usage_logs
        WHERE school_id = $1 AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `,
      [req.auth.schoolId]
    );

    return success(res, {
      budget,
      stats: statsResult.rows[0] || {},
      top_subjects: topSubjects.rows,
      daily_usage: dailyUsage.rows,
    });
  })
);

// ─── GET /tutor/config ──────────────────────────────────────────────
router.get(
  "/config",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const config = await getTutorConfig(req.auth.schoolId);
    if (!config) {
      return success(res, {
        is_enabled: false,
        enabled_subjects: [],
        difficulty_level: "adaptive",
        max_messages_per_session: 50,
        max_sessions_per_day: 10,
        allowed_roles: ["student"],
        metadata: {},
      });
    }
    return success(res, config);
  })
);

// ─── PATCH /tutor/config ────────────────────────────────────────────
router.patch(
  "/config",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(updateConfigSchema, req.body, "Invalid config update");

    const sets = ["updated_at = NOW()"];
    const params = [req.auth.schoolId];

    if (body.is_enabled !== undefined) { params.push(body.is_enabled); sets.push(`is_enabled = $${params.length}`); }
    if (body.enabled_subjects !== undefined) { params.push(body.enabled_subjects); sets.push(`enabled_subjects = $${params.length}`); }
    if (body.system_prompt_override !== undefined) { params.push(body.system_prompt_override); sets.push(`system_prompt_override = $${params.length}`); }
    if (body.difficulty_level !== undefined) { params.push(body.difficulty_level); sets.push(`difficulty_level = $${params.length}`); }
    if (body.max_messages_per_session !== undefined) { params.push(body.max_messages_per_session); sets.push(`max_messages_per_session = $${params.length}`); }
    if (body.max_sessions_per_day !== undefined) { params.push(body.max_sessions_per_day); sets.push(`max_sessions_per_day = $${params.length}`); }
    if (body.allowed_roles !== undefined) { params.push(body.allowed_roles); sets.push(`allowed_roles = $${params.length}`); }
    if (body.metadata !== undefined) { params.push(JSON.stringify(body.metadata)); sets.push(`metadata = $${params.length}::jsonb`); }

    const result = await pool.query(
      `
        INSERT INTO tutor_configs (school_id, ${sets.map((s) => s.split(" = ")[0]).filter((s) => s !== "updated_at").join(", ")})
        VALUES ($1, ${params.slice(1).map((_, i) => `$${i + 2}`).join(", ")})
        ON CONFLICT (school_id)
        DO UPDATE SET ${sets.join(", ")}
        RETURNING *
      `,
      params
    );

    return success(res, result.rows[0]);
  })
);

// ─── GET /tutor/insights/:studentId ─────────────────────────────────
router.get(
  "/insights/:studentId",
  requireAuth,
  requireRoles("teacher", ...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { studentId } = parseSchema(studentPathSchema, req.params);

    // Session overview
    const overview = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_sessions,
          COALESCE(SUM(message_count), 0)::int AS total_messages,
          COALESCE(SUM(total_tokens_used), 0)::int AS total_tokens,
          MIN(started_at) AS first_session,
          MAX(started_at) AS last_session,
          COUNT(DISTINCT subject_id)::int AS subjects_explored
        FROM tutor_sessions
        WHERE school_id = $1 AND student_id = $2
      `,
      [req.auth.schoolId, studentId]
    );

    // Subject breakdown
    const subjectBreakdown = await pool.query(
      `
        SELECT
          sub.name AS subject_name,
          COUNT(*)::int AS sessions,
          COALESCE(SUM(ts.message_count), 0)::int AS messages,
          MAX(ts.started_at) AS last_session
        FROM tutor_sessions ts
        JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.student_id = $2
        GROUP BY sub.name
        ORDER BY sessions DESC
      `,
      [req.auth.schoolId, studentId]
    );

    // Recent session summaries
    const recentSummaries = await pool.query(
      `
        SELECT ts.topic, ts.summary, ts.message_count, ts.started_at, ts.closed_at,
          sub.name AS subject_name
        FROM tutor_sessions ts
        LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.student_id = $2 AND ts.summary IS NOT NULL
        ORDER BY ts.started_at DESC
        LIMIT 10
      `,
      [req.auth.schoolId, studentId]
    );

    return success(res, {
      overview: overview.rows[0] || {},
      subject_breakdown: subjectBreakdown.rows,
      recent_summaries: recentSummaries.rows,
    });
  })
);

// ─── Analytics: Engagement Trends ───────────────────────────────────
const trendsQuerySchema = z.object({
  period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
  days: z.coerce.number().int().min(7).max(180).default(30),
});

router.get(
  "/analytics/trends",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(trendsQuerySchema, req.query);

    let dateTrunc = "day";
    if (query.period === "weekly") dateTrunc = "week";
    if (query.period === "monthly") dateTrunc = "month";

    const result = await pool.query(
      `
        SELECT
          DATE_TRUNC('${dateTrunc}', ts.started_at)::date AS period_start,
          COUNT(*)::int AS sessions,
          COUNT(DISTINCT ts.student_id)::int AS unique_students,
          COALESCE(SUM(ts.message_count), 0)::int AS total_messages,
          COALESCE(SUM(ts.total_tokens_used), 0)::int AS tokens_used,
          ROUND(AVG(ts.message_count), 1) AS avg_messages_per_session
        FROM tutor_sessions ts
        WHERE ts.school_id = $1
          AND ts.started_at >= NOW() - make_interval(days => $2::int)
        GROUP BY DATE_TRUNC('${dateTrunc}', ts.started_at)
        ORDER BY period_start DESC
      `,
      [req.auth.schoolId, query.days]
    );

    // Overall stats for the period
    const stats = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_sessions,
          COUNT(DISTINCT student_id)::int AS unique_students,
          COALESCE(SUM(message_count), 0)::int AS total_messages,
          COALESCE(SUM(total_tokens_used), 0)::int AS total_tokens,
          ROUND(AVG(message_count), 1) AS avg_messages,
          COUNT(DISTINCT subject_id)::int AS subjects_used
        FROM tutor_sessions
        WHERE school_id = $1 AND started_at >= NOW() - make_interval(days => $2::int)
      `,
      [req.auth.schoolId, query.days]
    );

    return success(res, {
      period: query.period,
      days: query.days,
      trends: result.rows,
      summary: stats.rows[0] || {},
    });
  })
);

// ─── Analytics: Leaderboard ─────────────────────────────────────────
router.get(
  "/analytics/leaderboard",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(z.object({
      days: z.coerce.number().int().min(7).max(90).default(30),
      limit: z.coerce.number().int().min(5).max(50).default(15),
    }), req.query);

    // Most active students
    const topStudents = await pool.query(
      `
        SELECT
          ts.student_id,
          s.first_name, s.last_name, s.student_code,
          COUNT(*)::int AS session_count,
          COALESCE(SUM(ts.message_count), 0)::int AS total_messages,
          COUNT(DISTINCT ts.subject_id)::int AS subjects_explored,
          MAX(ts.started_at) AS last_session_at
        FROM tutor_sessions ts
        JOIN students s ON s.id = ts.student_id AND s.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.started_at >= NOW() - make_interval(days => $2::int)
        GROUP BY ts.student_id, s.first_name, s.last_name, s.student_code
        ORDER BY session_count DESC
        LIMIT $3
      `,
      [req.auth.schoolId, query.days, query.limit]
    );

    // Most popular subjects
    const topSubjects = await pool.query(
      `
        SELECT
          sub.name AS subject_name, sub.code AS subject_code,
          COUNT(*)::int AS session_count,
          COUNT(DISTINCT ts.student_id)::int AS unique_students,
          COALESCE(SUM(ts.message_count), 0)::int AS total_messages
        FROM tutor_sessions ts
        JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        WHERE ts.school_id = $1 AND ts.started_at >= NOW() - make_interval(days => $2::int)
        GROUP BY sub.name, sub.code
        ORDER BY session_count DESC
        LIMIT $3
      `,
      [req.auth.schoolId, query.days, query.limit]
    );

    return success(res, {
      period_days: query.days,
      top_students: topStudents.rows,
      top_subjects: topSubjects.rows,
    });
  })
);

// ─── Admin: Browse All Sessions ─────────────────────────────────────
const adminSessionsQuerySchema = paginationQuery.extend({
  status: z.enum(["active", "closed", "expired"]).optional(),
  student_id: z.string().uuid().optional(),
});

router.get(
  "/admin/sessions",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(adminSessionsQuerySchema, req.query);

    const params = [req.auth.schoolId];
    const where = ["ts.school_id = $1"];

    if (query.status) { params.push(query.status); where.push(`ts.status = $${params.length}`); }
    if (query.student_id) { params.push(query.student_id); where.push(`ts.student_id = $${params.length}`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tutor_sessions ts WHERE ${where.join(" AND ")}`, params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT ts.*, sub.name AS subject_name,
          s.first_name AS student_first, s.last_name AS student_last, s.student_code
        FROM tutor_sessions ts
        LEFT JOIN subjects sub ON sub.id = ts.subject_id AND sub.school_id = ts.school_id
        LEFT JOIN students s ON s.id = ts.student_id AND s.school_id = ts.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY ts.started_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );

    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── Admin: Force-Terminate Session ─────────────────────────────────
router.post(
  "/admin/sessions/:sessionId/terminate",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { sessionId } = parseSchema(sessionPathSchema, req.params);

    const sessionResult = await pool.query(
      "SELECT * FROM tutor_sessions WHERE school_id = $1 AND id = $2 AND status = 'active' LIMIT 1",
      [req.auth.schoolId, sessionId]
    );
    if (!sessionResult.rows[0]) throw new AppError(404, "NOT_FOUND", "Active session not found");

    const updateResult = await pool.query(
      `UPDATE tutor_sessions SET status = 'closed', summary = 'Session terminated by admin.',
       closed_at = NOW(), updated_at = NOW()
       WHERE school_id = $1 AND id = $2 RETURNING *`,
      [req.auth.schoolId, sessionId]
    );

    return success(res, updateResult.rows[0]);
  })
);

module.exports = router;
