const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const listQuerySchema = z.object({
  include_bands: z.coerce.boolean().default(true),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  is_default: z.boolean().optional().default(false),
  bands: z
    .array(
      z.object({
        grade: z.string().trim().min(1).max(20),
        min_percentage: z.number().min(0).max(100),
        max_percentage: z.number().min(0).max(100),
        gpa_points: z.number().min(0).max(5).nullable().optional(),
        sort_order: z.coerce.number().int().min(0).max(1000).optional().default(0),
      })
    )
    .min(1),
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

function validateBands(bands) {
  for (const band of bands) {
    if (band.max_percentage < band.min_percentage) {
      throw new AppError(422, "VALIDATION_ERROR", "Band max_percentage must be on or above min_percentage", [
        { field: "bands", issue: "invalid_range" },
      ]);
    }
  }
}

router.get(
  "/",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listQuerySchema, req.query, "Invalid grading scales query");

    const scalesResult = await pool.query(
      `
        SELECT id, school_id, name, is_default, created_at
        FROM grading_scales
        WHERE school_id = $1
        ORDER BY is_default DESC, name ASC
      `,
      [req.auth.schoolId]
    );

    if (!query.include_bands) {
      return success(res, scalesResult.rows, 200);
    }

    if (scalesResult.rows.length === 0) {
      return success(res, [], 200);
    }

    const bandsResult = await pool.query(
      `
        SELECT
          id,
          grading_scale_id,
          grade,
          min_percentage,
          max_percentage,
          gpa_points,
          sort_order
        FROM grading_scale_bands
        WHERE grading_scale_id = ANY($1::uuid[])
        ORDER BY sort_order ASC, min_percentage DESC
      `,
      [scalesResult.rows.map((row) => row.id)]
    );

    const byScale = new Map();
    for (const band of bandsResult.rows) {
      if (!byScale.has(band.grading_scale_id)) byScale.set(band.grading_scale_id, []);
      byScale.get(band.grading_scale_id).push(band);
    }

    return success(
      res,
      scalesResult.rows.map((row) => ({
        ...row,
        bands: byScale.get(row.id) || [],
      })),
      200
    );
  })
);

router.post(
  "/",
  requireAuth,
  requireRoles("school_admin"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createSchema, req.body, "Invalid grading scale payload");
    validateBands(body.bands);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (body.is_default) {
        await client.query(
          `
            UPDATE grading_scales
            SET is_default = FALSE, updated_at = NOW()
            WHERE school_id = $1
              AND is_default = TRUE
          `,
          [req.auth.schoolId]
        );
      }

      const scaleResult = await client.query(
        `
          INSERT INTO grading_scales (school_id, name, is_default)
          VALUES ($1, $2, $3)
          RETURNING id, school_id, name, is_default, created_at
        `,
        [req.auth.schoolId, body.name, body.is_default]
      );

      const scale = scaleResult.rows[0];

      for (const band of body.bands) {
        await client.query(
          `
            INSERT INTO grading_scale_bands (
              grading_scale_id,
              grade,
              min_percentage,
              max_percentage,
              gpa_points,
              sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            scale.id,
            band.grade,
            band.min_percentage,
            band.max_percentage,
            band.gpa_points || null,
            band.sort_order,
          ]
        );
      }

      const bandsResult = await client.query(
        `
          SELECT
            id,
            grading_scale_id,
            grade,
            min_percentage,
            max_percentage,
            gpa_points,
            sort_order
          FROM grading_scale_bands
          WHERE grading_scale_id = $1
          ORDER BY sort_order ASC, min_percentage DESC
        `,
        [scale.id]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "grading_scale.created",
        entityName: "grading_scales",
        entityId: scale.id,
        metadata: {
          name: scale.name,
          is_default: scale.is_default,
          band_count: bandsResult.rows.length,
        },
      });

      return success(
        res,
        {
          ...scale,
          bands: bandsResult.rows,
        },
        201
      );
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "A grading scale with this name already exists in this school");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
