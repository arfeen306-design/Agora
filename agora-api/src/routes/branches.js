const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const SUPER_ADMIN_ROLES = ["super_admin"];
const GROUP_ADMIN_ROLES = ["super_admin", "branch_group_admin"];

const groupCreateSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(200),
  logo_url: z.string().trim().url().max(1000).optional(),
  contact_email: z.string().trim().email().max(200).optional(),
  contact_phone: z.string().trim().min(3).max(60).optional(),
  metadata: z.record(z.any()).default({}),
});

const groupUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    logo_url: z.string().trim().url().max(1000).nullable().optional(),
    contact_email: z.string().trim().email().max(200).nullable().optional(),
    contact_phone: z.string().trim().min(3).max(60).nullable().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field is required for update" }
  );

const groupSchoolAddSchema = z.object({
  school_id: z.string().uuid(),
});

const crossBranchQuerySchema = z
  .object({
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

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

async function assertGroupAccess(auth, groupId) {
  if (hasRole(auth, "super_admin")) return;

  const check = await pool.query(
    `
      SELECT id
      FROM branch_group_admins
      WHERE branch_group_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [groupId, auth.userId]
  );

  if (!check.rows[0]) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have access to this branch group"
    );
  }
}

function normalizeWindow(query) {
  const now = new Date();
  const to = query.date_to
    ? new Date(`${query.date_to}T00:00:00.000Z`)
    : now;
  const from = query.date_from
    ? new Date(`${query.date_from}T00:00:00.000Z`)
    : new Date(to.getTime() - 1000 * 60 * 60 * 24 * 30);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ─── GET /branches/groups ───────────────────────────────────────────
router.get(
  "/groups",
  requireAuth,
  requireRoles(...GROUP_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    let rows;

    if (hasRole(req.auth, "super_admin")) {
      const result = await pool.query(
        `
          SELECT
            bg.*,
            (SELECT COUNT(*)::int FROM schools s WHERE s.branch_group_id = bg.id) AS school_count,
            (SELECT COUNT(*)::int FROM branch_group_admins bga WHERE bga.branch_group_id = bg.id) AS admin_count
          FROM branch_groups bg
          ORDER BY bg.name ASC
        `
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        `
          SELECT
            bg.*,
            (SELECT COUNT(*)::int FROM schools s WHERE s.branch_group_id = bg.id) AS school_count,
            (SELECT COUNT(*)::int FROM branch_group_admins bga WHERE bga.branch_group_id = bg.id) AS admin_count
          FROM branch_groups bg
          JOIN branch_group_admins bga2 ON bga2.branch_group_id = bg.id
          WHERE bga2.user_id = $1
          ORDER BY bg.name ASC
        `,
        [req.auth.userId]
      );
      rows = result.rows;
    }

    return success(res, rows, 200);
  })
);

// ─── POST /branches/groups ──────────────────────────────────────────
router.post(
  "/groups",
  requireAuth,
  requireRoles(...SUPER_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(
      groupCreateSchema,
      req.body,
      "Invalid branch group payload"
    );

    const result = await pool.query(
      `
        INSERT INTO branch_groups (code, name, logo_url, contact_email, contact_phone, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *
      `,
      [
        body.code,
        body.name,
        body.logo_url || null,
        body.contact_email || null,
        body.contact_phone || null,
        JSON.stringify(body.metadata || {}),
      ]
    );

    fireAndForgetAuditLog({
      schoolId: null,
      actorUserId: req.auth.userId,
      action: "branches.group.created",
      entityName: "branch_groups",
      entityId: result.rows[0].id,
      metadata: { code: body.code, name: body.name },
    });

    return success(res, result.rows[0], 201);
  })
);

// ─── GET /branches/groups/:id ───────────────────────────────────────
router.get(
  "/groups/:groupId",
  requireAuth,
  requireRoles(...GROUP_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { groupId } = parseSchema(
      z.object({ groupId: z.string().uuid() }),
      req.params,
      "Invalid group ID"
    );

    await assertGroupAccess(req.auth, groupId);

    const groupResult = await pool.query(
      "SELECT * FROM branch_groups WHERE id = $1 LIMIT 1",
      [groupId]
    );

    if (!groupResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Branch group not found");
    }

    const schoolsResult = await pool.query(
      `
        SELECT
          s.id,
          s.code,
          s.name,
          s.branch_name,
          s.address_line,
          s.timezone,
          s.is_active,
          (SELECT COUNT(*)::int FROM students st WHERE st.school_id = s.id AND st.status = 'active') AS active_students,
          (SELECT COUNT(*)::int FROM staff_profiles sp WHERE sp.school_id = s.id AND sp.employment_status = 'active') AS active_staff
        FROM schools s
        WHERE s.branch_group_id = $1
        ORDER BY s.name ASC
      `,
      [groupId]
    );

    const adminsResult = await pool.query(
      `
        SELECT
          bga.id,
          bga.user_id,
          u.first_name,
          u.last_name,
          u.email,
          bga.created_at
        FROM branch_group_admins bga
        JOIN users u ON u.id = bga.user_id
        WHERE bga.branch_group_id = $1
        ORDER BY u.first_name ASC
      `,
      [groupId]
    );

    return success(res, {
      group: groupResult.rows[0],
      schools: schoolsResult.rows,
      admins: adminsResult.rows,
    });
  })
);

// ─── PATCH /branches/groups/:id ─────────────────────────────────────
router.patch(
  "/groups/:groupId",
  requireAuth,
  requireRoles(...SUPER_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { groupId } = parseSchema(
      z.object({ groupId: z.string().uuid() }),
      req.params,
      "Invalid group ID"
    );

    const body = parseSchema(
      groupUpdateSchema,
      req.body,
      "Invalid branch group update"
    );

    const entries = Object.entries(body);
    const values = [groupId];
    const setClauses = [];

    for (const [key, value] of entries) {
      if (key === "metadata") {
        values.push(JSON.stringify(value || {}));
        setClauses.push(`${key} = $${values.length}::jsonb`);
      } else {
        values.push(value);
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const result = await pool.query(
      `
        UPDATE branch_groups
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      values
    );

    if (!result.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Branch group not found");
    }

    fireAndForgetAuditLog({
      schoolId: null,
      actorUserId: req.auth.userId,
      action: "branches.group.updated",
      entityName: "branch_groups",
      entityId: groupId,
      metadata: body,
    });

    return success(res, result.rows[0], 200);
  })
);

// ─── GET /branches/groups/:id/analytics ─────────────────────────────
// Cross-branch KPI comparison
router.get(
  "/groups/:groupId/analytics",
  requireAuth,
  requireRoles(...GROUP_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { groupId } = parseSchema(
      z.object({ groupId: z.string().uuid() }),
      req.params,
      "Invalid group ID"
    );
    const query = parseSchema(
      crossBranchQuerySchema,
      req.query,
      "Invalid analytics query"
    );

    await assertGroupAccess(req.auth, groupId);

    const window = normalizeWindow(query);

    const result = await pool.query(
      `
        SELECT
          s.id AS school_id,
          s.name AS school_name,
          s.branch_name,
          -- Active student count
          (SELECT COUNT(*)::int FROM students st
            WHERE st.school_id = s.id AND st.status = 'active') AS active_students,
          -- Active staff count
          (SELECT COUNT(*)::int FROM staff_profiles sp
            WHERE sp.school_id = s.id AND sp.employment_status = 'active') AS active_staff,
          -- School attendance rate
          COALESCE((
            SELECT
              ROUND(
                COUNT(*) FILTER (WHERE ar.status = 'present'::attendance_status) * 100.0 /
                NULLIF(COUNT(*)::numeric, 0), 2
              )
            FROM attendance_records ar
            WHERE ar.school_id = s.id
              AND ar.attendance_date >= $2::date
              AND ar.attendance_date <= $3::date
          ), 0) AS attendance_rate,
          -- School average marks
          COALESCE((
            SELECT ROUND(AVG(sc.marks_obtained / NULLIF(a.max_marks, 0) * 100), 2)
            FROM assessment_scores sc
            JOIN assessments a ON a.id = sc.assessment_id AND a.school_id = sc.school_id
            WHERE sc.school_id = s.id
              AND COALESCE(a.assessment_date, a.created_at::date) >= $2::date
              AND COALESCE(a.assessment_date, a.created_at::date) <= $3::date
          ), 0) AS marks_avg,
          -- Fee collection
          COALESCE((
            SELECT SUM(fp.amount)
            FROM fee_payments fp
            JOIN fee_invoices fi ON fi.id = fp.invoice_id AND fi.school_id = fp.school_id
            WHERE fp.school_id = s.id
              AND fp.payment_date >= $2::date
              AND fp.payment_date <= $3::date
          ), 0)::numeric AS fees_collected
        FROM schools s
        WHERE s.branch_group_id = $1
          AND s.is_active = TRUE
        ORDER BY s.name ASC
      `,
      [groupId, window.from, window.to]
    );

    return success(res, {
      group_id: groupId,
      window: { date_from: window.from, date_to: window.to },
      branches: result.rows.map((row) => ({
        school_id: row.school_id,
        school_name: row.school_name,
        branch_name: row.branch_name,
        active_students: row.active_students,
        active_staff: row.active_staff,
        attendance_rate: Number(row.attendance_rate),
        marks_avg: Number(row.marks_avg),
        fees_collected: Number(row.fees_collected),
      })),
    });
  })
);

// ─── POST /branches/groups/:id/schools ──────────────────────────────
router.post(
  "/groups/:groupId/schools",
  requireAuth,
  requireRoles(...SUPER_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { groupId } = parseSchema(
      z.object({ groupId: z.string().uuid() }),
      req.params,
      "Invalid group ID"
    );
    const body = parseSchema(
      groupSchoolAddSchema,
      req.body,
      "Invalid school addition payload"
    );

    // Verify group exists
    const groupCheck = await pool.query(
      "SELECT id FROM branch_groups WHERE id = $1 LIMIT 1",
      [groupId]
    );
    if (!groupCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Branch group not found");
    }

    // Verify school exists
    const schoolCheck = await pool.query(
      "SELECT id, name, branch_group_id FROM schools WHERE id = $1 LIMIT 1",
      [body.school_id]
    );
    if (!schoolCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "School not found");
    }
    if (schoolCheck.rows[0].branch_group_id) {
      throw new AppError(
        409,
        "CONFLICT",
        "School already belongs to a branch group. Remove it first."
      );
    }

    await pool.query(
      "UPDATE schools SET branch_group_id = $1, updated_at = NOW() WHERE id = $2",
      [groupId, body.school_id]
    );

    fireAndForgetAuditLog({
      schoolId: body.school_id,
      actorUserId: req.auth.userId,
      action: "branches.school.added",
      entityName: "branch_groups",
      entityId: groupId,
      metadata: { school_id: body.school_id },
    });

    return success(
      res,
      {
        group_id: groupId,
        school_id: body.school_id,
        school_name: schoolCheck.rows[0].name,
      },
      201
    );
  })
);

// ─── DELETE /branches/groups/:id/schools/:schoolId ───────────────────
router.delete(
  "/groups/:groupId/schools/:schoolId",
  requireAuth,
  requireRoles(...SUPER_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const params = parseSchema(
      z.object({
        groupId: z.string().uuid(),
        schoolId: z.string().uuid(),
      }),
      req.params,
      "Invalid path parameters"
    );

    const schoolCheck = await pool.query(
      "SELECT id, branch_group_id FROM schools WHERE id = $1 LIMIT 1",
      [params.schoolId]
    );

    if (!schoolCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "School not found");
    }
    if (schoolCheck.rows[0].branch_group_id !== params.groupId) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "School does not belong to this branch group"
      );
    }

    await pool.query(
      "UPDATE schools SET branch_group_id = NULL, updated_at = NOW() WHERE id = $1",
      [params.schoolId]
    );

    fireAndForgetAuditLog({
      schoolId: params.schoolId,
      actorUserId: req.auth.userId,
      action: "branches.school.removed",
      entityName: "branch_groups",
      entityId: params.groupId,
      metadata: { school_id: params.schoolId },
    });

    return success(res, { removed: true }, 200);
  })
);

module.exports = router;
