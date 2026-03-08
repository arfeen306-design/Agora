const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { buildCsvBuffer, buildPdfBuffer, getReportFileName } = require("../utils/report-export");

const router = express.Router();

const csvOrPdfSchema = z.enum(["csv", "pdf"]);

const listAuditLogsQuerySchema = z.object({
  actor_user_id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entity_name: z.string().trim().min(1).max(120).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const exportAuditLogsQuerySchema = z.object({
  actor_user_id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entity_name: z.string().trim().min(1).max(120).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  format: csvOrPdfSchema.default("csv"),
  max_rows: z.coerce.number().int().min(1).max(10000).default(1000),
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

function buildAuditFilters({ schoolId, query }) {
  const params = [schoolId];
  const where = ["al.school_id = $1"];

  if (query.actor_user_id) {
    params.push(query.actor_user_id);
    where.push(`al.actor_user_id = $${params.length}`);
  }
  if (query.action) {
    params.push(`%${query.action}%`);
    where.push(`al.action ILIKE $${params.length}`);
  }
  if (query.entity_name) {
    params.push(query.entity_name);
    where.push(`al.entity_name = $${params.length}`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`al.created_at >= $${params.length}::timestamptz`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`al.created_at <= $${params.length}::timestamptz`);
  }

  return {
    params,
    whereClause: where.join(" AND "),
  };
}

function mapAuditRow(row) {
  return {
    id: row.id,
    school_id: row.school_id,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    actor_email: row.actor_email,
    action: row.action,
    entity_name: row.entity_name,
    entity_id: row.entity_id,
    metadata: row.metadata || {},
    created_at: row.created_at,
  };
}

async function sendAuditExport({ res, rows, format, subtitle }) {
  const columns = [
    { key: "created_at", label: "Created At" },
    { key: "actor_name", label: "Actor Name" },
    { key: "actor_email", label: "Actor Email" },
    { key: "action", label: "Action" },
    { key: "entity_name", label: "Entity" },
    { key: "entity_id", label: "Entity ID" },
    { key: "metadata", label: "Metadata" },
  ];

  if (format === "csv") {
    const buffer = buildCsvBuffer({
      columns,
      rows,
    });
    const fileName = getReportFileName({ reportKey: "audit_logs", ext: "csv" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buffer);
  }

  const buffer = await buildPdfBuffer({
    title: "Audit Logs Export",
    subtitle,
    columns,
    rows,
  });
  const fileName = getReportFileName({ reportKey: "audit_logs", ext: "pdf" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  return res.status(200).send(buffer);
}

// ---------------------------------------------------------------------------
// GET /admin/audit-logs — List audit logs (school admin only)
// ---------------------------------------------------------------------------
router.get(
  "/audit-logs",
  requireAuth,
  requireRoles("school_admin"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listAuditLogsQuerySchema, req.query, "Invalid audit logs query");
    const { params, whereClause } = buildAuditFilters({ schoolId: req.auth.schoolId, query });

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM audit_logs al
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
          al.id,
          al.school_id,
          al.actor_user_id,
          al.action,
          al.entity_name,
          al.entity_id,
          al.metadata,
          al.created_at,
          TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS actor_name,
          u.email AS actor_email
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(
      res,
      rowsResult.rows.map(mapAuditRow),
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
// GET /admin/audit-logs/export — Export audit logs as CSV or PDF
// ---------------------------------------------------------------------------
router.get(
  "/audit-logs/export",
  requireAuth,
  requireRoles("school_admin"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(exportAuditLogsQuerySchema, req.query, "Invalid audit log export query");
    const { params, whereClause } = buildAuditFilters({ schoolId: req.auth.schoolId, query });

    const listParams = [...params, query.max_rows];
    const rowsResult = await pool.query(
      `
        SELECT
          al.created_at,
          TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS actor_name,
          u.email AS actor_email,
          al.action,
          al.entity_name,
          al.entity_id,
          al.metadata
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE ${whereClause}
        ORDER BY al.created_at DESC
        LIMIT $${listParams.length}
      `,
      listParams
    );

    const subtitle = `Rows: ${rowsResult.rows.length} | Generated: ${new Date().toISOString()}`;

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "security.audit.exported",
      entityName: "audit_logs",
      metadata: {
        format: query.format,
        row_count: rowsResult.rows.length,
        filters: {
          actor_user_id: query.actor_user_id || null,
          action: query.action || null,
          entity_name: query.entity_name || null,
          date_from: query.date_from || null,
          date_to: query.date_to || null,
        },
      },
    });

    return sendAuditExport({
      res,
      rows: rowsResult.rows,
      format: query.format,
      subtitle,
    });
  })
);

module.exports = router;
