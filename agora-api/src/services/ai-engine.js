/**
 * AI Tutor Engine
 *
 * Provider-agnostic service for AI tutoring:
 * - Context building (student grade, subject, recent performance)
 * - Chat completion via OpenAI (or mock in dev)
 * - Token budget enforcement per school
 * - Session summarization
 */

const config = require("../config");
const pool = require("../db");

const AI_CONFIG = config.ai || {};
const MODEL = AI_CONFIG.model || "gpt-4o-mini";
const TOKEN_BUDGET = AI_CONFIG.tokenBudgetPerSchool || 500000;
const MAX_CONTEXT_TOKENS = AI_CONFIG.maxContextTokens || 4096;

// ─── OpenAI Client (lazy-loaded) ────────────────────────────────────

let openaiClient = null;

function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const apiKey = AI_CONFIG.apiKey;
  if (!apiKey) return null;

  try {
    const OpenAI = require("openai");
    openaiClient = new OpenAI({ apiKey });
    return openaiClient;
  } catch {
    return null;
  }
}

// ─── Token Estimation ───────────────────────────────────────────────

function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimation: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

// ─── Context Building ───────────────────────────────────────────────

async function buildStudentContext({ schoolId, studentId, subjectId }) {
  const parts = [];

  // Student info
  const studentResult = await pool.query(
    `
      SELECT s.first_name, s.last_name, c.grade_label, c.section_label
      FROM students s
      LEFT JOIN student_enrollments se
        ON se.student_id = s.id AND se.school_id = s.school_id AND se.status = 'active'
      LEFT JOIN classrooms c
        ON c.id = se.classroom_id AND c.school_id = se.school_id
      WHERE s.school_id = $1 AND s.id = $2
      LIMIT 1
    `,
    [schoolId, studentId]
  );

  if (studentResult.rows[0]) {
    const s = studentResult.rows[0];
    parts.push(`Student: ${s.first_name} ${s.last_name || ""}, Grade: ${s.grade_label || "N/A"}, Section: ${s.section_label || "N/A"}`);
  }

  // Subject info
  if (subjectId) {
    const subjectResult = await pool.query(
      "SELECT name, code FROM subjects WHERE school_id = $1 AND id = $2 LIMIT 1",
      [schoolId, subjectId]
    );
    if (subjectResult.rows[0]) {
      parts.push(`Subject: ${subjectResult.rows[0].name} (${subjectResult.rows[0].code || ""})`);
    }

    // Recent marks in this subject
    const marksResult = await pool.query(
      `
        SELECT a.title, sc.marks_obtained, a.max_marks, a.assessment_type
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id AND a.school_id = sc.school_id
        WHERE sc.school_id = $1 AND sc.student_id = $2 AND a.subject_id = $3
        ORDER BY COALESCE(a.assessment_date, a.created_at) DESC
        LIMIT 5
      `,
      [schoolId, studentId, subjectId]
    );

    if (marksResult.rows.length > 0) {
      const markLines = marksResult.rows.map(
        (m) => `  - ${m.title} (${m.assessment_type}): ${m.marks_obtained}/${m.max_marks}`
      );
      parts.push(`Recent Performance:\n${markLines.join("\n")}`);
    }
  }

  // Curriculum context if available
  if (subjectId) {
    const ctxResult = await pool.query(
      `
        SELECT topic, learning_objectives, curriculum_notes
        FROM tutor_contexts
        WHERE school_id = $1 AND subject_id = $2
        ORDER BY created_at DESC
        LIMIT 3
      `,
      [schoolId, subjectId]
    );

    if (ctxResult.rows.length > 0) {
      const topics = ctxResult.rows.map((c) => {
        let line = `  - ${c.topic}`;
        if (c.learning_objectives && c.learning_objectives.length > 0) {
          line += ` (Objectives: ${c.learning_objectives.join(", ")})`;
        }
        return line;
      });
      parts.push(`Curriculum Topics:\n${topics.join("\n")}`);
    }
  }

  return parts.join("\n\n");
}

function buildSystemPrompt({ studentContext, topic, schoolPromptOverride, difficultyLevel }) {
  const base = schoolPromptOverride ||
    `You are an AI tutor for school students. Be encouraging, patient, and educational. ` +
    `Guide students to understand concepts rather than just giving answers. ` +
    `Use age-appropriate language. Ask follow-up questions to check understanding. ` +
    `If a student is struggling, break down concepts into simpler parts.`;

  const parts = [base];

  if (difficultyLevel && difficultyLevel !== "adaptive") {
    parts.push(`Difficulty level: ${difficultyLevel}. Adjust your explanations accordingly.`);
  }

  if (topic) {
    parts.push(`Current topic: ${topic}`);
  }

  if (studentContext) {
    parts.push(`Context about this student:\n${studentContext}`);
  }

  const prompt = parts.join("\n\n");

  // Trim if over token limit
  const estimatedTokens = estimateTokens(prompt);
  if (estimatedTokens > MAX_CONTEXT_TOKENS) {
    return prompt.slice(0, MAX_CONTEXT_TOKENS * 4);
  }

  return prompt;
}

// ─── Token Budget Enforcement ───────────────────────────────────────

async function getMonthlyTokenUsage(schoolId) {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(total_tokens), 0)::int AS total
      FROM tutor_usage_logs
      WHERE school_id = $1
        AND created_at >= DATE_TRUNC('month', CURRENT_TIMESTAMP)
    `,
    [schoolId]
  );
  return result.rows[0]?.total || 0;
}

async function enforceTokenBudget(schoolId) {
  const used = await getMonthlyTokenUsage(schoolId);
  return {
    used,
    budget: TOKEN_BUDGET,
    remaining: Math.max(0, TOKEN_BUDGET - used),
    exhausted: used >= TOKEN_BUDGET,
  };
}

// ─── Chat Completion ────────────────────────────────────────────────

async function chat({ schoolId, sessionId, userId, systemPrompt, messages }) {
  const client = getOpenAIClient();
  const startTime = Date.now();

  // Build message array for API
  const apiMessages = [{ role: "system", content: systemPrompt }];
  for (const msg of messages) {
    apiMessages.push({ role: msg.role, content: msg.content });
  }

  let responseContent;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let model = MODEL;

  if (!client) {
    // Mock mode for development
    responseContent = generateMockResponse(messages[messages.length - 1]?.content || "");
    promptTokens = apiMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    completionTokens = estimateTokens(responseContent);
    totalTokens = promptTokens + completionTokens;
    model = "mock";
  } else {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: apiMessages,
        max_tokens: 1024,
        temperature: 0.7,
      });

      const choice = completion.choices?.[0];
      responseContent = choice?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";
      promptTokens = completion.usage?.prompt_tokens || estimateTokens(systemPrompt);
      completionTokens = completion.usage?.completion_tokens || estimateTokens(responseContent);
      totalTokens = completion.usage?.total_tokens || (promptTokens + completionTokens);
      model = completion.model || MODEL;
    } catch (error) {
      responseContent = "I'm experiencing a temporary issue. Please try again in a moment.";
      promptTokens = estimateTokens(systemPrompt);
      completionTokens = estimateTokens(responseContent);
      totalTokens = promptTokens + completionTokens;
    }
  }

  const latencyMs = Date.now() - startTime;

  // Log usage
  const costEstimate = totalTokens * 0.000001; // rough estimate
  await pool.query(
    `
      INSERT INTO tutor_usage_logs (school_id, session_id, user_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [schoolId, sessionId, userId, model, promptTokens, completionTokens, totalTokens, costEstimate]
  );

  return {
    content: responseContent,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    latencyMs,
  };
}

// ─── Session Summary ────────────────────────────────────────────────

async function summarizeSession({ schoolId, sessionId, userId, messages }) {
  const client = getOpenAIClient();

  const conversationText = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(0, 3000);

  const summaryPrompt = `Summarize this tutoring conversation in 2-3 sentences. Focus on what was taught and what the student learned:\n\n${conversationText}`;

  if (!client) {
    return "Session completed. The student engaged with the AI tutor on the topic.";
  }

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a helpful assistant that summarizes tutoring sessions concisely." },
        { role: "user", content: summaryPrompt },
      ],
      max_tokens: 200,
      temperature: 0.3,
    });

    const tokens = completion.usage?.total_tokens || 0;
    if (tokens > 0) {
      await pool.query(
        `INSERT INTO tutor_usage_logs (school_id, session_id, user_id, model, prompt_tokens, completion_tokens, total_tokens, cost_estimate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [schoolId, sessionId, userId, completion.model || MODEL,
         completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0,
         tokens, tokens * 0.000001]
      );
    }

    return completion.choices?.[0]?.message?.content || "Session completed.";
  } catch {
    return "Session completed. Summary generation encountered an error.";
  }
}

// ─── Mock Response Generator ────────────────────────────────────────

function generateMockResponse(userMessage) {
  const lower = (userMessage || "").toLowerCase();

  if (lower.includes("hello") || lower.includes("hi")) {
    return "Hello! I'm your AI tutor. What would you like to learn about today? Feel free to ask me any questions about your subjects!";
  }
  if (lower.includes("help") || lower.includes("explain")) {
    return "Of course! I'd be happy to help you understand this topic better. Let's break it down step by step. What specific part are you finding challenging?";
  }
  if (lower.includes("math") || lower.includes("equation") || lower.includes("calculate")) {
    return "Great question about math! Let me walk you through the approach. First, let's identify what we know and what we need to find. Can you tell me what values you're working with?";
  }
  if (lower.includes("science") || lower.includes("physics") || lower.includes("chemistry") || lower.includes("biology")) {
    return "That's an interesting science question! Let me help you understand the underlying concept. The key principle here involves understanding how things interact. What do you think might happen and why?";
  }

  return "That's a great question! Let me think about the best way to explain this. Can you tell me more about what you already know about this topic? That way I can tailor my explanation to your level of understanding.";
}

module.exports = {
  buildStudentContext,
  buildSystemPrompt,
  enforceTokenBudget,
  getMonthlyTokenUsage,
  chat,
  summarizeSession,
  estimateTokens,
};
