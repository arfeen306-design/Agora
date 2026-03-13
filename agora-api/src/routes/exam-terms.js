const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

// --- Schemas ---

const listQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  term_type: z.enum(["midterm", "final", "monthly"]),
  academic_year_id: z.string().uuid(),
  starts_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ends_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    term_type: z.enum(["midterm", "final", "monthly"]).optional(),
    starts_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    ends_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    is_locked: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

// --- Helpers ---

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

function ensureManageRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "teacher")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No permission to manage exam terms");
}

// --- Routes ---

// GET /exam-terms — list terms for current school
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(listQuerySchema, req.query, "Invalid exam terms query");

    const params = [req.auth.schoolId];
    const where = ["et.school_id = $1"];

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`et.academic_year_id = $${params.length}`);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM exam_terms et WHERE ${whereClause}`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const result = await pool.query(
      `
        SELECT
          et.id,
          et.school_id,
          et.academic_year_id,
          ay.name AS academic_year_name,
          et.name,
          et.term_type,
          et.starts_on,
          et.ends_on,
          et.is_locked,
          et.created_at,
          et.updated_at
        FROM exam_terms et
        LEFT JOIN academic_years ay ON ay.id = et.academic_year_id
        WHERE ${whereClause}
        ORDER BY et.starts_on ASC NULLS LAST, et.created_at ASC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, result.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

// POST /exam-terms — create a new exam term
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureManageRole(req.auth);
    const body = parseSchema(createSchema, req.body, "Invalid exam term payload");

    // Verify academic year belongs to school
    const ayResult = await pool.query(
      "SELECT id FROM academic_years WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, body.academic_year_id]
    );
    if (!ayResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Academic year not found for this school");
    }

    const result = await pool.query(
      `
        INSERT INTO exam_terms (school_id, academic_year_id, name, term_type, starts_on, ends_on)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, school_id, academic_year_id, name, term_type, starts_on, ends_on, is_locked, created_at
      `,
      [
        req.auth.schoolId,
        body.academic_year_id,
        body.name,
        body.term_type,
        body.starts_on || null,
        body.ends_on || null,
      ]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "exam_terms.created",
      entityName: "exam_terms",
      entityId: result.rows[0].id,
      metadata: {
        academic_year_id: body.academic_year_id,
        term_type: body.term_type,
      },
    });

    return success(res, result.rows[0], 201);
  })
);

// PATCH /exam-terms/:termId — update an exam term
router.patch(
  "/:termId",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureManageRole(req.auth);
    const termId = parseSchema(z.object({ termId: z.string().uuid() }), req.params).termId;
    const body = parseSchema(updateSchema, req.body, "Invalid exam term patch payload");

    // Verify term belongs to school
    const existing = await pool.query(
      "SELECT id, is_locked FROM exam_terms WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, termId]
    );
    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Exam term not found");
    }

    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(body)) {
      values.push(value);
      setClauses.push(`${key} = $${values.length}`);
    }

    values.push(termId);
    const result = await pool.query(
      `
        UPDATE exam_terms
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING id, school_id, academic_year_id, name, term_type, starts_on, ends_on, is_locked, created_at, updated_at
      `,
      values
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "exam_terms.updated",
      entityName: "exam_terms",
      entityId: termId,
      metadata: {
        updated_fields: Object.keys(body),
      },
    });

    return success(res, result.rows[0], 200);
  })
);

// DELETE /exam-terms/:termId — delete if no linked assessments
router.delete(
  "/:termId",
  requireAuth,
  requireRoles("school_admin", "principal"),
  asyncHandler(async (req, res) => {
    const termId = parseSchema(z.object({ termId: z.string().uuid() }), req.params).termId;

    const existing = await pool.query(
      "SELECT id FROM exam_terms WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, termId]
    );
    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Exam term not found");
    }

    // Check for linked assessments
    const linkedResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM assessments WHERE exam_term_id = $1",
      [termId]
    );
    if (linkedResult.rows[0]?.count > 0) {
      throw new AppError(
        409,
        "CONFLICT",
        `Cannot delete: ${linkedResult.rows[0].count} assessment(s) are linked to this term`
      );
    }

    // Check for linked report cards
    const rcResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM report_cards WHERE exam_term_id = $1",
      [termId]
    );
    if (rcResult.rows[0]?.count > 0) {
      throw new AppError(
        409,
        "CONFLICT",
        `Cannot delete: ${rcResult.rows[0].count} report card(s) are linked to this term`
      );
    }

    await pool.query("DELETE FROM exam_terms WHERE id = $1", [termId]);

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "exam_terms.deleted",
      entityName: "exam_terms",
      entityId: termId,
      metadata: {},
    });

    return success(res, { deleted: true }, 200);
  })
);

module.exports = router;
