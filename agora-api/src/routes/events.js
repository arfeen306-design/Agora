const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const targetScopeSchema = z.enum(["school", "classroom"]);

const listEventsQuerySchema = z.object({
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  event_type: z.string().trim().min(1).optional(),
  target_scope: targetScopeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  event_type: z.string().trim().min(1).max(60),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  target_scope: targetScopeSchema,
  target_classroom_id: z.string().uuid().optional(),
});

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    event_type: z.string().trim().min(1).max(60).optional(),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().optional(),
    target_scope: targetScopeSchema.optional(),
    target_classroom_id: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
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

async function getEventById({ schoolId, eventId }) {
  const result = await pool.query(
    `
      SELECT
        id,
        school_id,
        title,
        description,
        event_type,
        starts_at,
        ends_at,
        target_scope,
        target_classroom_id,
        created_by_user_id,
        created_at
      FROM events
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, eventId]
  );
  return result.rows[0] || null;
}

// ---------------------------------------------------------------------------
// GET /events — List events (all authenticated users)
// ---------------------------------------------------------------------------
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(listEventsQuerySchema, req.query, "Invalid events query");

    const params = [req.auth.schoolId];
    const where = ["e.school_id = $1"];

    if (query.date_from) {
      params.push(query.date_from);
      where.push(`e.starts_at >= $${params.length}::timestamptz`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`e.starts_at <= $${params.length}::timestamptz`);
    }
    if (query.event_type) {
      params.push(query.event_type);
      where.push(`e.event_type = $${params.length}`);
    }
    if (query.target_scope) {
      params.push(query.target_scope);
      where.push(`e.target_scope = $${params.length}`);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM events e
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
          e.id,
          e.school_id,
          e.title,
          e.description,
          e.event_type,
          e.starts_at,
          e.ends_at,
          e.target_scope,
          e.target_classroom_id,
          e.created_by_user_id,
          e.created_at
        FROM events e
        WHERE ${whereClause}
        ORDER BY e.starts_at DESC, e.created_at DESC
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

// ---------------------------------------------------------------------------
// POST /events — Create event (admin/teacher)
// ---------------------------------------------------------------------------
router.post(
  "/",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createEventSchema, req.body, "Invalid event create payload");

    if (body.target_scope === "classroom") {
      if (!body.target_classroom_id) {
        throw new AppError(422, "VALIDATION_ERROR", "target_classroom_id is required when target_scope is classroom");
      }
      const classroomOk = await pool.query(
        "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
        [req.auth.schoolId, body.target_classroom_id]
      );
      if (!classroomOk.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Classroom not found for this school");
      }
    }

    const insertResult = await pool.query(
      `
        INSERT INTO events (
          school_id,
          title,
          description,
          event_type,
          starts_at,
          ends_at,
          target_scope,
          target_classroom_id,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8, $9)
        RETURNING
          id,
          school_id,
          title,
          description,
          event_type,
          starts_at,
          ends_at,
          target_scope,
          target_classroom_id,
          created_by_user_id,
          created_at
      `,
      [
        req.auth.schoolId,
        body.title,
        body.description || null,
        body.event_type,
        body.starts_at,
        body.ends_at,
        body.target_scope,
        body.target_classroom_id || null,
        req.auth.userId,
      ]
    );

    return success(res, insertResult.rows[0], 201);
  })
);

// ---------------------------------------------------------------------------
// GET /events/:eventId — Get single event
// ---------------------------------------------------------------------------
router.get(
  "/:eventId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ eventId: z.string().uuid() }),
      req.params,
      "Invalid event id"
    );

    const event = await getEventById({
      schoolId: req.auth.schoolId,
      eventId: path.eventId,
    });
    if (!event) {
      throw new AppError(404, "NOT_FOUND", "Event not found");
    }

    return success(res, event, 200);
  })
);

// ---------------------------------------------------------------------------
// PATCH /events/:eventId — Update event (admin, or teacher who created it)
// ---------------------------------------------------------------------------
router.patch(
  "/:eventId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ eventId: z.string().uuid() }),
      req.params,
      "Invalid event id"
    );
    const body = parseSchema(updateEventSchema, req.body, "Invalid event patch payload");

    const event = await getEventById({
      schoolId: req.auth.schoolId,
      eventId: path.eventId,
    });
    if (!event) {
      throw new AppError(404, "NOT_FOUND", "Event not found");
    }

    // Teachers can only update events they created
    if (hasRole(req.auth, "teacher") && !hasRole(req.auth, "school_admin")) {
      if (event.created_by_user_id !== req.auth.userId) {
        throw new AppError(403, "FORBIDDEN", "Teacher can only update events they created");
      }
    }

    // Validate classroom if target_scope is being set to classroom
    const effectiveScope = Object.prototype.hasOwnProperty.call(body, "target_scope")
      ? body.target_scope
      : event.target_scope;
    const effectiveClassroomId = Object.prototype.hasOwnProperty.call(body, "target_classroom_id")
      ? body.target_classroom_id
      : event.target_classroom_id;

    if (effectiveScope === "classroom") {
      if (!effectiveClassroomId) {
        throw new AppError(422, "VALIDATION_ERROR", "target_classroom_id is required when target_scope is classroom");
      }
      const classroomOk = await pool.query(
        "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
        [req.auth.schoolId, effectiveClassroomId]
      );
      if (!classroomOk.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Classroom not found for this school");
      }
    }

    const setClauses = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      values.push(body.title);
      setClauses.push(`title = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "description")) {
      values.push(body.description);
      setClauses.push(`description = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "event_type")) {
      values.push(body.event_type);
      setClauses.push(`event_type = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "starts_at")) {
      values.push(body.starts_at);
      setClauses.push(`starts_at = $${values.length}::timestamptz`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "ends_at")) {
      values.push(body.ends_at);
      setClauses.push(`ends_at = $${values.length}::timestamptz`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "target_scope")) {
      values.push(body.target_scope);
      setClauses.push(`target_scope = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "target_classroom_id")) {
      values.push(body.target_classroom_id);
      setClauses.push(`target_classroom_id = $${values.length}`);
    }

    values.push(path.eventId);
    const updateResult = await pool.query(
      `
        UPDATE events
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          school_id,
          title,
          description,
          event_type,
          starts_at,
          ends_at,
          target_scope,
          target_classroom_id,
          created_by_user_id,
          created_at
      `,
      values
    );

    return success(res, updateResult.rows[0], 200);
  })
);

// ---------------------------------------------------------------------------
// DELETE /events/:eventId — Remove event (admin only)
// ---------------------------------------------------------------------------
router.delete(
  "/:eventId",
  requireAuth,
  requireRoles("school_admin"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ eventId: z.string().uuid() }),
      req.params,
      "Invalid event id"
    );

    const event = await getEventById({
      schoolId: req.auth.schoolId,
      eventId: path.eventId,
    });
    if (!event) {
      throw new AppError(404, "NOT_FOUND", "Event not found");
    }

    await pool.query("DELETE FROM events WHERE id = $1", [path.eventId]);
    return success(res, { ok: true }, 200);
  })
);

module.exports = router;
