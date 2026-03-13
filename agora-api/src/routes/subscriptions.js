const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { loadSchoolSubscription } = require("../middleware/plan-enforcement");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const ADMIN_ROLES = ["school_admin", "principal", "vice_principal"];

const subscribeSchema = z.object({
  plan_code: z.string().trim().min(1).max(60),
  billing_cycle: z.enum(["monthly", "annual"]).default("monthly"),
  payment_gateway: z.string().trim().min(1).max(60).optional(),
  gateway_customer_id: z.string().trim().max(255).optional(),
});

const changePlanSchema = z
  .object({
    plan_code: z.string().trim().min(1).max(60).optional(),
    billing_cycle: z.enum(["monthly", "annual"]).optional(),
  })
  .refine((data) => data.plan_code || data.billing_cycle, {
    message: "At least one of plan_code or billing_cycle is required",
    path: ["body"],
  });

const invoiceListSchema = z.object({
  status: z.enum(["draft", "issued", "paid", "overdue", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
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

// ─── GET /subscriptions/plans ───────────────────────────────────────
// Public — list available plans
router.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `
        SELECT
          code,
          name,
          description,
          price_monthly,
          price_annual,
          max_students,
          max_staff,
          max_storage_gb,
          ai_tutor_enabled,
          sms_enabled,
          api_access_enabled,
          custom_branding_enabled,
          display_order
        FROM subscription_plans
        WHERE is_active = TRUE
        ORDER BY display_order ASC
      `
    );
    return success(res, result.rows, 200);
  })
);

// ─── GET /subscriptions/current ─────────────────────────────────────
// Get current school subscription + plan details
router.get(
  "/current",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const subscription = await loadSchoolSubscription(req.auth.schoolId);

    if (!subscription) {
      return success(
        res,
        {
          subscribed: false,
          plan_code: "free",
          message: "No active subscription. School is on the free plan.",
        },
        200
      );
    }

    return success(res, { subscribed: true, ...subscription }, 200);
  })
);

// ─── POST /subscriptions/subscribe ──────────────────────────────────
// Subscribe to a plan (or upgrade from free)
router.post(
  "/subscribe",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(subscribeSchema, req.body, "Invalid subscribe payload");

    // Verify plan exists
    const planResult = await pool.query(
      "SELECT * FROM subscription_plans WHERE code = $1 AND is_active = TRUE LIMIT 1",
      [body.plan_code]
    );
    const plan = planResult.rows[0];
    if (!plan) {
      throw new AppError(404, "NOT_FOUND", "Plan not found or inactive");
    }

    // Check if already subscribed
    const existingResult = await pool.query(
      "SELECT id, status FROM school_subscriptions WHERE school_id = $1 LIMIT 1",
      [req.auth.schoolId]
    );
    if (existingResult.rows[0]) {
      const existing = existingResult.rows[0];
      if (existing.status === "active" || existing.status === "trialing") {
        throw new AppError(
          409,
          "CONFLICT",
          "School already has an active subscription. Use PATCH to change plan."
        );
      }
    }

    // Calculate period
    const now = new Date();
    const periodEnd = new Date(now);
    if (body.billing_cycle === "annual") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const price =
      body.billing_cycle === "annual"
        ? Number(plan.price_annual)
        : Number(plan.price_monthly);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert subscription (replace cancelled/expired)
      const subResult = await client.query(
        `
          INSERT INTO school_subscriptions (
            school_id, plan_id, billing_cycle, status,
            current_period_start, current_period_end,
            trial_ends_at, payment_gateway,
            gateway_customer_id
          )
          VALUES ($1, $2, $3::billing_cycle, $4::subscription_status, $5, $6, $7, $8, $9)
          ON CONFLICT (school_id)
          DO UPDATE SET
            plan_id = EXCLUDED.plan_id,
            billing_cycle = EXCLUDED.billing_cycle,
            status = EXCLUDED.status,
            current_period_start = EXCLUDED.current_period_start,
            current_period_end = EXCLUDED.current_period_end,
            trial_ends_at = EXCLUDED.trial_ends_at,
            payment_gateway = EXCLUDED.payment_gateway,
            gateway_customer_id = EXCLUDED.gateway_customer_id,
            cancelled_at = NULL,
            cancel_reason = NULL,
            updated_at = NOW()
          RETURNING *
        `,
        [
          req.auth.schoolId,
          plan.id,
          body.billing_cycle,
          price === 0 ? "active" : "trialing",
          now.toISOString(),
          periodEnd.toISOString(),
          price === 0 ? null : new Date(now.getTime() + 14 * 86400000).toISOString(),
          body.payment_gateway || "manual",
          body.gateway_customer_id || null,
        ]
      );

      // Update schools.subscription_plan
      await client.query(
        "UPDATE schools SET subscription_plan = $1, updated_at = NOW() WHERE id = $2",
        [body.plan_code, req.auth.schoolId]
      );

      // Generate first invoice (if paid plan)
      let invoice = null;
      if (price > 0) {
        const invoiceNumber = `INV-${req.auth.schoolId.slice(0, 8).toUpperCase()}-${Date.now()}`;
        const invoiceResult = await client.query(
          `
            INSERT INTO platform_invoices (
              school_id, subscription_id, invoice_number,
              period_start, period_end, amount_due, currency,
              status, due_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'PKR', 'issued', $7)
            RETURNING *
          `,
          [
            req.auth.schoolId,
            subResult.rows[0].id,
            invoiceNumber,
            now.toISOString().slice(0, 10),
            periodEnd.toISOString().slice(0, 10),
            price,
            new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
          ]
        );
        invoice = invoiceResult.rows[0];
      }

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "subscription.created",
        entityName: "school_subscriptions",
        entityId: subResult.rows[0].id,
        metadata: { plan_code: body.plan_code, billing_cycle: body.billing_cycle },
      });

      return success(
        res,
        {
          subscription: subResult.rows[0],
          invoice,
        },
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

// ─── PATCH /subscriptions/current ───────────────────────────────────
// Change plan or billing cycle
router.patch(
  "/current",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(changePlanSchema, req.body, "Invalid plan change payload");

    const existing = await pool.query(
      `
        SELECT ss.*, sp.code AS current_plan_code
        FROM school_subscriptions ss
        JOIN subscription_plans sp ON sp.id = ss.plan_id
        WHERE ss.school_id = $1
        LIMIT 1
      `,
      [req.auth.schoolId]
    );

    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "No subscription found. Use POST /subscribe first.");
    }

    const sub = existing.rows[0];
    if (sub.status === "cancelled" || sub.status === "expired") {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Cannot modify a cancelled/expired subscription. Please re-subscribe."
      );
    }

    const setClauses = [];
    const values = [req.auth.schoolId];

    if (body.plan_code && body.plan_code !== sub.current_plan_code) {
      const planResult = await pool.query(
        "SELECT * FROM subscription_plans WHERE code = $1 AND is_active = TRUE LIMIT 1",
        [body.plan_code]
      );
      if (!planResult.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Target plan not found or inactive");
      }
      values.push(planResult.rows[0].id);
      setClauses.push(`plan_id = $${values.length}`);

      // Update schools.subscription_plan
      await pool.query(
        "UPDATE schools SET subscription_plan = $1, updated_at = NOW() WHERE id = $2",
        [body.plan_code, req.auth.schoolId]
      );
    }

    if (body.billing_cycle) {
      values.push(body.billing_cycle);
      setClauses.push(`billing_cycle = $${values.length}::billing_cycle`);
    }

    if (setClauses.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "No changes to apply");
    }

    const updateResult = await pool.query(
      `
        UPDATE school_subscriptions
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE school_id = $1
        RETURNING *
      `,
      values
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "subscription.updated",
      entityName: "school_subscriptions",
      entityId: updateResult.rows[0].id,
      metadata: { plan_code: body.plan_code, billing_cycle: body.billing_cycle },
    });

    const updated = await loadSchoolSubscription(req.auth.schoolId);
    return success(res, updated, 200);
  })
);

// ─── POST /subscriptions/cancel ─────────────────────────────────────
router.post(
  "/cancel",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const cancelSchema = z.object({
      reason: z.string().trim().max(1000).optional(),
    });
    const body = parseSchema(cancelSchema, req.body || {}, "Invalid cancel payload");

    const existing = await pool.query(
      "SELECT id, status FROM school_subscriptions WHERE school_id = $1 LIMIT 1",
      [req.auth.schoolId]
    );

    if (!existing.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "No subscription found");
    }

    if (
      existing.rows[0].status === "cancelled" ||
      existing.rows[0].status === "expired"
    ) {
      throw new AppError(422, "VALIDATION_ERROR", "Subscription is already cancelled/expired");
    }

    const updateResult = await pool.query(
      `
        UPDATE school_subscriptions
        SET
          status = 'cancelled'::subscription_status,
          cancelled_at = NOW(),
          cancel_reason = $2,
          updated_at = NOW()
        WHERE school_id = $1
        RETURNING *
      `,
      [req.auth.schoolId, body.reason || null]
    );

    await pool.query(
      "UPDATE schools SET subscription_plan = 'free', updated_at = NOW() WHERE id = $1",
      [req.auth.schoolId]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "subscription.cancelled",
      entityName: "school_subscriptions",
      entityId: updateResult.rows[0].id,
      metadata: { reason: body.reason },
    });

    return success(res, updateResult.rows[0], 200);
  })
);

// ─── GET /subscriptions/invoices ────────────────────────────────────
router.get(
  "/invoices",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(invoiceListSchema, req.query, "Invalid invoice list query");

    const params = [req.auth.schoolId];
    const where = ["pi.school_id = $1"];

    if (query.status) {
      params.push(query.status);
      where.push(`pi.status = $${params.length}::platform_invoice_status`);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM platform_invoices pi WHERE ${where.join(" AND ")}`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          pi.id,
          pi.invoice_number,
          pi.period_start,
          pi.period_end,
          pi.amount_due,
          pi.amount_paid,
          pi.tax,
          pi.currency,
          pi.status,
          pi.due_date,
          pi.paid_at,
          pi.created_at
        FROM platform_invoices pi
        WHERE ${where.join(" AND ")}
        ORDER BY pi.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(res, rowsResult.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

// ─── GET /subscriptions/invoices/:id ────────────────────────────────
router.get(
  "/invoices/:invoiceId",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ invoiceId: z.string().uuid() }),
      req.params,
      "Invalid invoice id"
    );

    const invoiceResult = await pool.query(
      `
        SELECT
          pi.*,
          sp.code AS plan_code,
          sp.name AS plan_name
        FROM platform_invoices pi
        LEFT JOIN school_subscriptions ss ON ss.id = pi.subscription_id
        LEFT JOIN subscription_plans sp ON sp.id = ss.plan_id
        WHERE pi.school_id = $1
          AND pi.id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.invoiceId]
    );

    if (!invoiceResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Invoice not found");
    }

    // Get payments for this invoice
    const paymentsResult = await pool.query(
      `
        SELECT id, amount, payment_date, method, gateway_ref, status, notes, created_at
        FROM platform_payments
        WHERE invoice_id = $1 AND school_id = $2
        ORDER BY payment_date DESC
      `,
      [path.invoiceId, req.auth.schoolId]
    );

    return success(
      res,
      {
        invoice: invoiceResult.rows[0],
        payments: paymentsResult.rows,
      },
      200
    );
  })
);

// ─── GET /subscriptions/usage ───────────────────────────────────────
// Current usage vs plan limits
router.get(
  "/usage",
  requireAuth,
  requireRoles(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const subscription = await loadSchoolSubscription(req.auth.schoolId);

    const [studentsResult, staffResult] = await Promise.all([
      pool.query(
        "SELECT COUNT(*)::int AS count FROM students WHERE school_id = $1 AND status = 'active'",
        [req.auth.schoolId]
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM staff_profiles WHERE school_id = $1 AND employment_status = 'active'",
        [req.auth.schoolId]
      ),
    ]);

    const activeStudents = studentsResult.rows[0]?.count || 0;
    const activeStaff = staffResult.rows[0]?.count || 0;

    const limits = subscription
      ? {
          max_students: subscription.max_students,
          max_staff: subscription.max_staff,
          max_storage_gb: subscription.max_storage_gb,
        }
      : { max_students: 50, max_staff: 10, max_storage_gb: 1 };

    return success(
      res,
      {
        plan_code: subscription?.plan_code || "free",
        plan_name: subscription?.plan_name || "Free",
        usage: {
          students: {
            current: activeStudents,
            limit: limits.max_students,
            percentage: Math.round((activeStudents / Math.max(limits.max_students, 1)) * 100),
          },
          staff: {
            current: activeStaff,
            limit: limits.max_staff,
            percentage: Math.round((activeStaff / Math.max(limits.max_staff, 1)) * 100),
          },
          storage_gb: {
            current: 0, // placeholder for future storage tracking
            limit: limits.max_storage_gb,
            percentage: 0,
          },
        },
        features: {
          ai_tutor: subscription?.ai_tutor_enabled || false,
          sms: subscription?.sms_enabled || false,
          api_access: subscription?.api_access_enabled || false,
          custom_branding: subscription?.custom_branding_enabled || false,
        },
      },
      200
    );
  })
);

module.exports = router;
