const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const RBAC_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin"];
const RBAC_MANAGE_ROLES = ["school_admin", "principal", "vice_principal"];

const rolePermissionRowSchema = z.object({
  code: z.string().trim().min(3).max(120),
  scope_level: z.enum(["school", "section", "classroom"]).default("school"),
  can_view: z.boolean().default(true),
  can_create: z.boolean().default(false),
  can_edit: z.boolean().default(false),
  can_delete: z.boolean().default(false),
});

const updateRolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionRowSchema).max(500),
});

const listDelegationQuerySchema = z.object({
  granted_to_user_id: z.string().uuid().optional(),
  active_only: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("true"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createDelegationSchema = z
  .object({
    granted_to_user_id: z.string().uuid(),
    permission_code: z.string().trim().min(3).max(120),
    scope_type: z.enum(["school", "section", "classroom"]).default("school"),
    scope_id: z.string().uuid().nullable().optional(),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    grant_reason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scope_type !== "school" && !data.scope_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scope_id is required for section/classroom scoped delegation",
        path: ["scope_id"],
      });
    }

    if (data.starts_at && data.ends_at) {
      const starts = new Date(data.starts_at);
      const ends = new Date(data.ends_at);
      if (!Number.isNaN(starts.getTime()) && !Number.isNaN(ends.getTime()) && ends <= starts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ends_at must be after starts_at",
          path: ["ends_at"],
        });
      }
    }
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

function ensureScopeManagePermission(auth, permissionCode) {
  if (hasRole(auth, "school_admin") || hasRole(auth, "super_admin")) return;

  const sensitiveCodes = new Set([
    "rbac.permissions.manage",
    "rbac.delegation.manage",
    "audit.logs.view",
  ]);

  if (sensitiveCodes.has(permissionCode)) {
    throw new AppError(403, "FORBIDDEN", "Only school admin can delegate this permission");
  }
}

async function ensureUserInSchool(schoolId, userId, fieldName) {
  const check = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );

  if (!check.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
}

async function ensureScopeInSchool(schoolId, scopeType, scopeId) {
  if (!scopeId || scopeType === "school") return;

  if (scopeType === "section") {
    const section = await pool.query(
      `
        SELECT id
        FROM school_sections
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [schoolId, scopeId]
    );

    if (!section.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id section does not belong to this school");
    }
    return;
  }

  if (scopeType === "classroom") {
    const classroom = await pool.query(
      `
        SELECT id
        FROM classrooms
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [schoolId, scopeId]
    );

    if (!classroom.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id classroom does not belong to this school");
    }
  }
}

router.get(
  "/rbac/templates",
  requireAuth,
  requireRoles(...RBAC_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const roles = await pool.query(
      `
        SELECT
          r.id,
          r.code,
          r.description,
          (
            SELECT COUNT(*)::int
            FROM user_roles ur
            JOIN users u ON u.id = ur.user_id
            WHERE ur.role_id = r.id
              AND u.school_id = $1
          ) AS assigned_users,
          COALESCE(
            json_agg(
              json_build_object(
                'code', p.code,
                'module', p.module,
                'description', p.description,
                'scope_level', rp.scope_level,
                'can_view', rp.can_view,
                'can_create', rp.can_create,
                'can_edit', rp.can_edit,
                'can_delete', rp.can_delete
              )
              ORDER BY p.module, p.code
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::json
          ) AS permissions
        FROM roles r
        LEFT JOIN role_permissions rp
          ON rp.role_id = r.id
        LEFT JOIN permissions p
          ON p.id = rp.permission_id
        GROUP BY r.id
        ORDER BY r.code ASC
      `,
      [req.auth.schoolId]
    );

    return success(res, roles.rows, 200);
  })
);

router.put(
  "/rbac/templates/:roleCode",
  requireAuth,
  requireRoles(...RBAC_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(updateRolePermissionsSchema, req.body, "Invalid role permission payload");

    const role = await pool.query(
      `
        SELECT id, code
        FROM roles
        WHERE code = $1
        LIMIT 1
      `,
      [req.params.roleCode]
    );

    if (!role.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Role template not found");
    }

    if (role.rows[0].code === "super_admin" && !hasRole(req.auth, "school_admin")) {
      throw new AppError(403, "FORBIDDEN", "Only school admin can manage super admin template");
    }

    const permissionCodes = body.permissions.map((row) => row.code);
    const permissionRows = permissionCodes.length
      ? await pool.query(
          `
            SELECT id, code
            FROM permissions
            WHERE code = ANY($1::text[])
          `,
          [permissionCodes]
        )
      : { rows: [] };

    if (permissionRows.rows.length !== permissionCodes.length) {
      const found = new Set(permissionRows.rows.map((row) => row.code));
      const missing = permissionCodes.filter((code) => !found.has(code));
      throw new AppError(422, "VALIDATION_ERROR", `Unknown permission codes: ${missing.join(", ")}`);
    }

    const permissionByCode = new Map(permissionRows.rows.map((row) => [row.code, row.id]));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          DELETE FROM role_permissions
          WHERE role_id = $1
        `,
        [role.rows[0].id]
      );

      for (const row of body.permissions) {
        await client.query(
          `
            INSERT INTO role_permissions (
              role_id,
              permission_id,
              scope_level,
              can_view,
              can_create,
              can_edit,
              can_delete
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            role.rows[0].id,
            permissionByCode.get(row.code),
            row.scope_level,
            row.can_view,
            row.can_create,
            row.can_edit,
            row.can_delete,
          ]
        );
      }

      await client.query("COMMIT");
      return success(
        res,
        {
          role_code: role.rows[0].code,
          permissions_updated: body.permissions.length,
        },
        200
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
  "/rbac/delegations",
  requireAuth,
  requireRoles(...RBAC_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listDelegationQuerySchema, req.query, "Invalid delegation list query");

    const params = [req.auth.schoolId];
    const where = ["dp.school_id = $1"];

    if (query.granted_to_user_id) {
      params.push(query.granted_to_user_id);
      where.push(`dp.granted_to_user_id = $${params.length}`);
    }

    if (query.active_only) {
      where.push("dp.is_active = TRUE");
      where.push("(dp.ends_at IS NULL OR dp.ends_at >= NOW())");
      where.push("dp.starts_at <= NOW()");
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM delegated_permissions dp
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          dp.id,
          dp.school_id,
          dp.granted_by_user_id,
          dp.granted_to_user_id,
          dp.scope_type,
          dp.scope_id,
          dp.grant_reason,
          dp.starts_at,
          dp.ends_at,
          dp.is_active,
          dp.created_at,
          p.code AS permission_code,
          p.module AS permission_module,
          p.description AS permission_description,
          gbu.first_name AS granted_by_first_name,
          gbu.last_name AS granted_by_last_name,
          gbu.email AS granted_by_email,
          gtu.first_name AS granted_to_first_name,
          gtu.last_name AS granted_to_last_name,
          gtu.email AS granted_to_email
        FROM delegated_permissions dp
        JOIN permissions p
          ON p.id = dp.permission_id
        JOIN users gbu
          ON gbu.id = dp.granted_by_user_id
        JOIN users gtu
          ON gtu.id = dp.granted_to_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY dp.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, rows.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

router.post(
  "/rbac/delegations",
  requireAuth,
  requireRoles(...RBAC_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createDelegationSchema, req.body, "Invalid delegation payload");

    if (body.granted_to_user_id === req.auth.userId) {
      throw new AppError(422, "VALIDATION_ERROR", "Cannot delegate permissions to yourself");
    }

    await ensureUserInSchool(req.auth.schoolId, body.granted_to_user_id, "granted_to_user_id");
    await ensureScopeInSchool(req.auth.schoolId, body.scope_type, body.scope_id || null);

    const permission = await pool.query(
      `
        SELECT id, code, module
        FROM permissions
        WHERE code = $1
        LIMIT 1
      `,
      [body.permission_code]
    );

    if (!permission.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "permission_code not found");
    }

    ensureScopeManagePermission(req.auth, permission.rows[0].code);

    const inserted = await pool.query(
      `
        INSERT INTO delegated_permissions (
          school_id,
          granted_by_user_id,
          granted_to_user_id,
          permission_id,
          scope_type,
          scope_id,
          grant_reason,
          starts_at,
          ends_at,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9, TRUE)
        RETURNING id, school_id, granted_by_user_id, granted_to_user_id, scope_type, scope_id, grant_reason, starts_at, ends_at, is_active, created_at
      `,
      [
        req.auth.schoolId,
        req.auth.userId,
        body.granted_to_user_id,
        permission.rows[0].id,
        body.scope_type,
        body.scope_id || null,
        body.grant_reason || null,
        body.starts_at || null,
        body.ends_at || null,
      ]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "security.delegation.created",
      entityName: "delegated_permissions",
      entityId: inserted.rows[0].id,
      metadata: {
        granted_to_user_id: body.granted_to_user_id,
        permission_code: permission.rows[0].code,
        scope_type: body.scope_type,
        scope_id: body.scope_id || null,
        starts_at: inserted.rows[0].starts_at,
        ends_at: inserted.rows[0].ends_at,
        grant_reason: body.grant_reason || null,
      },
    });

    return success(
      res,
      {
        ...inserted.rows[0],
        permission_code: permission.rows[0].code,
      },
      201
    );
  })
);

router.patch(
  "/rbac/delegations/:delegationId/revoke",
  requireAuth,
  requireRoles(...RBAC_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const updated = await pool.query(
      `
        UPDATE delegated_permissions dp
        SET
          is_active = FALSE,
          ends_at = NOW(),
          updated_at = NOW()
        FROM permissions p
        WHERE dp.school_id = $1
          AND dp.id = $2
          AND dp.is_active = TRUE
          AND p.id = dp.permission_id
        RETURNING
          dp.id,
          dp.school_id,
          dp.granted_by_user_id,
          dp.granted_to_user_id,
          dp.scope_type,
          dp.scope_id,
          dp.starts_at,
          dp.ends_at,
          dp.is_active,
          dp.updated_at,
          p.code AS permission_code
      `,
      [req.auth.schoolId, req.params.delegationId]
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Delegation not found or already revoked");
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "security.delegation.revoked",
      entityName: "delegated_permissions",
      entityId: updated.rows[0].id,
      metadata: {
        granted_to_user_id: updated.rows[0].granted_to_user_id,
        granted_by_user_id: updated.rows[0].granted_by_user_id,
        permission_code: updated.rows[0].permission_code,
        scope_type: updated.rows[0].scope_type,
        scope_id: updated.rows[0].scope_id,
        revoked_at: updated.rows[0].updated_at,
      },
    });

    return success(res, updated.rows[0], 200);
  })
);

router.get(
  "/rbac/me/effective-permissions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rolePermissions = await pool.query(
      `
        SELECT DISTINCT
          p.code,
          p.module,
          p.description,
          rp.scope_level,
          rp.can_view,
          rp.can_create,
          rp.can_edit,
          rp.can_delete,
          'role'::text AS source
        FROM user_roles ur
        JOIN role_permissions rp
          ON rp.role_id = ur.role_id
        JOIN permissions p
          ON p.id = rp.permission_id
        WHERE ur.user_id = $1
      `,
      [req.auth.userId]
    );

    const delegated = await pool.query(
      `
        SELECT
          p.code,
          p.module,
          p.description,
          dp.scope_type AS scope_level,
          TRUE AS can_view,
          TRUE AS can_create,
          TRUE AS can_edit,
          FALSE AS can_delete,
          'delegated'::text AS source,
          dp.scope_id,
          dp.starts_at,
          dp.ends_at
        FROM delegated_permissions dp
        JOIN permissions p
          ON p.id = dp.permission_id
        WHERE dp.school_id = $1
          AND dp.granted_to_user_id = $2
          AND dp.is_active = TRUE
          AND dp.starts_at <= NOW()
          AND (dp.ends_at IS NULL OR dp.ends_at >= NOW())
      `,
      [req.auth.schoolId, req.auth.userId]
    );

    return success(
      res,
      {
        roles: req.auth.roles,
        role_permissions: rolePermissions.rows,
        delegated_permissions: delegated.rows,
      },
      200
    );
  })
);

module.exports = router;
