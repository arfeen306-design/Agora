const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const invoiceStatusSchema = z.enum(["draft", "issued", "partial", "paid", "overdue", "cancelled"]);
const paymentMethodSchema = z.enum(["cash", "bank", "online"]);

const listPlansQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  is_active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createPlanSchema = z.object({
  academic_year_id: z.string().uuid(),
  classroom_id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  amount: z.number().positive(),
  due_day: z.number().int().min(1).max(31),
  is_active: z.boolean().default(true),
});

const updatePlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    amount: z.number().positive().optional(),
    due_day: z.number().int().min(1).max(31).optional(),
    is_active: z.boolean().optional(),
    classroom_id: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const listInvoicesQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  status: invoiceStatusSchema.optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createInvoiceSchema = z.object({
  student_id: z.string().uuid(),
  fee_plan_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_due: z.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: invoiceStatusSchema.default("draft"),
});

const createPaymentSchema = z.object({
  amount: z.number().positive(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: paymentMethodSchema,
  reference_no: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const listPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const feesSummaryQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const defaultersQuerySchema = z.object({
  academic_year_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  min_outstanding: z.coerce.number().min(0).default(0),
  min_days_overdue: z.coerce.number().int().min(0).default(0),
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

function assertDateRange({ dateFrom, dateTo, fromField = "date_from", toField = "date_to" }) {
  if (!dateFrom || !dateTo) return;
  if (dateFrom > dateTo) {
    throw new AppError(422, "VALIDATION_ERROR", `${fromField} must be on or before ${toField}`, [
      { field: fromField, issue: "invalid_range" },
      { field: toField, issue: "invalid_range" },
    ]);
  }
}

function hasRole(auth, role) {
  return Array.isArray(auth?.roles) && auth.roles.includes(role);
}

function canReadFeePlans(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "accountant") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal")
  );
}

function canManageFeeData(auth) {
  return hasRole(auth, "school_admin") || hasRole(auth, "accountant");
}

function canReadInvoices(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "accountant") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "parent")
  );
}

function canReadPayments(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "accountant") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "parent")
  );
}

function canReadPaymentReference(auth) {
  return hasRole(auth, "school_admin") || hasRole(auth, "accountant");
}

// ---------------------------------------------------------------------------
// GET /fees/plans — List fee plans (admin only)
// ---------------------------------------------------------------------------
router.get(
  "/plans",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!canReadFeePlans(req.auth)) {
      throw new AppError(403, "FORBIDDEN", "No fee plan read permission for this role");
    }

    const query = parseSchema(listPlansQuerySchema, req.query, "Invalid fee plans query");

    const params = [req.auth.schoolId];
    const where = ["fp.school_id = $1"];

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`fp.academic_year_id = $${params.length}`);
    }
    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`fp.classroom_id = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(query, "is_active")) {
      params.push(query.is_active);
      where.push(`fp.is_active = $${params.length}`);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM fee_plans fp
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
          fp.id,
          fp.school_id,
          fp.academic_year_id,
          fp.classroom_id,
          fp.title,
          fp.amount,
          fp.due_day,
          fp.is_active,
          fp.created_at
        FROM fee_plans fp
        WHERE ${whereClause}
        ORDER BY fp.created_at DESC
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
// POST /fees/plans — Create fee plan (admin only)
// ---------------------------------------------------------------------------
router.post(
  "/plans",
  requireAuth,
  requireRoles("school_admin", "accountant"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createPlanSchema, req.body, "Invalid fee plan create payload");

    if (body.classroom_id) {
      const classroomOk = await pool.query(
        "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
        [req.auth.schoolId, body.classroom_id]
      );
      if (!classroomOk.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Classroom not found for this school");
      }
    }

    const insertResult = await pool.query(
      `
        INSERT INTO fee_plans (
          school_id,
          academic_year_id,
          classroom_id,
          title,
          amount,
          due_day,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          school_id,
          academic_year_id,
          classroom_id,
          title,
          amount,
          due_day,
          is_active,
          created_at
      `,
      [
        req.auth.schoolId,
        body.academic_year_id,
        body.classroom_id || null,
        body.title,
        body.amount,
        body.due_day,
        body.is_active,
      ]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "finance.fee_plan.created",
      entityName: "fee_plans",
      entityId: insertResult.rows[0].id,
      metadata: {
        academic_year_id: body.academic_year_id,
        classroom_id: body.classroom_id || null,
        title: body.title,
        amount: body.amount,
      },
    });

    return success(res, insertResult.rows[0], 201);
  })
);

// ---------------------------------------------------------------------------
// PATCH /fees/plans/:planId — Update fee plan (admin only)
// ---------------------------------------------------------------------------
router.patch(
  "/plans/:planId",
  requireAuth,
  requireRoles("school_admin", "accountant"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ planId: z.string().uuid() }),
      req.params,
      "Invalid fee plan id"
    );
    const body = parseSchema(updatePlanSchema, req.body, "Invalid fee plan patch payload");

    const planResult = await pool.query(
      `
        SELECT id
        FROM fee_plans
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.planId]
    );
    if (!planResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }

    if (Object.prototype.hasOwnProperty.call(body, "classroom_id") && body.classroom_id) {
      const classroomOk = await pool.query(
        "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
        [req.auth.schoolId, body.classroom_id]
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
    if (Object.prototype.hasOwnProperty.call(body, "amount")) {
      values.push(body.amount);
      setClauses.push(`amount = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "due_day")) {
      values.push(body.due_day);
      setClauses.push(`due_day = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
      values.push(body.is_active);
      setClauses.push(`is_active = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "classroom_id")) {
      values.push(body.classroom_id);
      setClauses.push(`classroom_id = $${values.length}`);
    }

    values.push(path.planId);
    const updateResult = await pool.query(
      `
        UPDATE fee_plans
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          school_id,
          academic_year_id,
          classroom_id,
          title,
          amount,
          due_day,
          is_active,
          created_at
      `,
      values
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "finance.fee_plan.updated",
      entityName: "fee_plans",
      entityId: path.planId,
      metadata: {
        updated_fields: Object.keys(body),
      },
    });

    return success(res, updateResult.rows[0], 200);
  })
);

// ---------------------------------------------------------------------------
// GET /fees/invoices — List invoices
//   admin sees all, parent sees their child's
// ---------------------------------------------------------------------------
router.get(
  "/invoices",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!canReadInvoices(req.auth)) {
      throw new AppError(403, "FORBIDDEN", "No invoice read permission for this role");
    }

    const query = parseSchema(listInvoicesQuerySchema, req.query, "Invalid invoices query");
    assertDateRange({ dateFrom: query.date_from, dateTo: query.date_to });

    const params = [req.auth.schoolId];
    const where = ["fi.school_id = $1"];

    if (query.student_id) {
      params.push(query.student_id);
      where.push(`fi.student_id = $${params.length}`);
    }
    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = fi.school_id
            AND fp.id = fi.fee_plan_id
            AND fp.academic_year_id = $${params.length}
        )
      `);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`fi.status = $${params.length}::invoice_status`);
    }
    if (query.date_from) {
      params.push(query.date_from);
      where.push(`fi.due_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`fi.due_date <= $${params.length}`);
    }

    // Parent can only see invoices for their own children
    if (hasRole(req.auth, "parent") && !hasRole(req.auth, "school_admin")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          WHERE ps.school_id = fi.school_id
            AND ps.student_id = fi.student_id
            AND p.school_id = fi.school_id
            AND p.user_id = $${params.length}
        )
      `);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM fee_invoices fi
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
          fi.id,
          fi.school_id,
          fi.student_id,
          fi.fee_plan_id,
          fi.period_start,
          fi.period_end,
          fi.amount_due,
          fi.amount_paid,
          fi.due_date,
          fi.status,
          fi.created_at
        FROM fee_invoices fi
        WHERE ${whereClause}
        ORDER BY fi.due_date DESC, fi.created_at DESC
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
// POST /fees/invoices — Create invoice (admin only)
// ---------------------------------------------------------------------------
router.post(
  "/invoices",
  requireAuth,
  requireRoles("school_admin", "accountant"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createInvoiceSchema, req.body, "Invalid invoice create payload");
    assertDateRange({
      dateFrom: body.period_start,
      dateTo: body.period_end,
      fromField: "period_start",
      toField: "period_end",
    });

    const studentOk = await pool.query(
      "SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, body.student_id]
    );
    if (!studentOk.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Student not found in this school");
    }

    const planOk = await pool.query(
      "SELECT id FROM fee_plans WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, body.fee_plan_id]
    );
    if (!planOk.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found for this school");
    }

    const insertResult = await pool.query(
      `
        INSERT INTO fee_invoices (
          school_id,
          student_id,
          fee_plan_id,
          period_start,
          period_end,
          amount_due,
          amount_paid,
          due_date,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8::invoice_status)
        RETURNING
          id,
          school_id,
          student_id,
          fee_plan_id,
          period_start,
          period_end,
          amount_due,
          amount_paid,
          due_date,
          status,
          created_at
      `,
      [
        req.auth.schoolId,
        body.student_id,
        body.fee_plan_id,
        body.period_start,
        body.period_end,
        body.amount_due,
        body.due_date,
        body.status,
      ]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "finance.invoice.created",
      entityName: "fee_invoices",
      entityId: insertResult.rows[0].id,
      metadata: {
        student_id: body.student_id,
        fee_plan_id: body.fee_plan_id,
        amount_due: body.amount_due,
        due_date: body.due_date,
        status: body.status,
      },
    });

    return success(res, insertResult.rows[0], 201);
  })
);

// ---------------------------------------------------------------------------
// POST /fees/invoices/:invoiceId/payments — Record a payment (admin only)
// ---------------------------------------------------------------------------
router.post(
  "/invoices/:invoiceId/payments",
  requireAuth,
  requireRoles("school_admin", "accountant"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ invoiceId: z.string().uuid() }),
      req.params,
      "Invalid invoice id"
    );
    const body = parseSchema(createPaymentSchema, req.body, "Invalid payment create payload");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const invoiceResult = await client.query(
        `
          SELECT id, amount_due, amount_paid, status
          FROM fee_invoices
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [req.auth.schoolId, path.invoiceId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new AppError(404, "NOT_FOUND", "Invoice not found");
      }

      if (invoice.status === "cancelled") {
        throw new AppError(422, "VALIDATION_ERROR", "Cannot record payment on a cancelled invoice");
      }

      const currentAmountPaid = Number(invoice.amount_paid || 0);
      const currentAmountDue = Number(invoice.amount_due || 0);
      const remainingBalance = Number((currentAmountDue - currentAmountPaid).toFixed(2));

      if (remainingBalance <= 0) {
        throw new AppError(422, "VALIDATION_ERROR", "Invoice is already fully paid");
      }

      if (body.amount > remainingBalance) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Payment amount exceeds remaining balance",
          [{ field: "amount", issue: "exceeds_remaining_balance" }]
        );
      }

      const paymentResult = await client.query(
        `
          INSERT INTO fee_payments (
            school_id,
            invoice_id,
            amount,
            payment_date,
            method,
            reference_no,
            received_by_user_id,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id,
            school_id,
            invoice_id,
            amount,
            payment_date,
            method,
            reference_no,
            received_by_user_id,
            notes,
            created_at
        `,
        [
          req.auth.schoolId,
          path.invoiceId,
          body.amount,
          body.payment_date,
          body.method,
          body.reference_no || null,
          req.auth.userId,
          body.notes || null,
        ]
      );

      const newAmountPaid = currentAmountPaid + body.amount;
      const amountDue = currentAmountDue;

      let newStatus;
      if (newAmountPaid >= amountDue) {
        newStatus = "paid";
      } else if (newAmountPaid > 0) {
        newStatus = "partial";
      } else {
        newStatus = invoice.status;
      }

      await client.query(
        `
          UPDATE fee_invoices
          SET amount_paid = $1,
              status = $2::invoice_status
          WHERE id = $3
        `,
        [newAmountPaid, newStatus, path.invoiceId]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "finance.payment.recorded",
        entityName: "fee_payments",
        entityId: paymentResult.rows[0].id,
        metadata: {
          invoice_id: path.invoiceId,
          amount: body.amount,
          payment_date: body.payment_date,
          method: body.method,
          new_invoice_status: newStatus,
        },
      });

      return success(res, paymentResult.rows[0], 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------------------
// GET /fees/invoices/:invoiceId/payments — List payments for an invoice
// ---------------------------------------------------------------------------
router.get(
  "/invoices/:invoiceId/payments",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!canReadPayments(req.auth)) {
      throw new AppError(403, "FORBIDDEN", "No payment read permission for this role");
    }

    const path = parseSchema(
      z.object({ invoiceId: z.string().uuid() }),
      req.params,
      "Invalid invoice id"
    );
    const query = parseSchema(listPaymentsQuerySchema, req.query, "Invalid payments query");

    // Verify invoice exists and belongs to this school
    const invoiceResult = await pool.query(
      `
        SELECT id, student_id
        FROM fee_invoices
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.invoiceId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      throw new AppError(404, "NOT_FOUND", "Invoice not found");
    }

    // Parent can only see payments for their own children's invoices
    if (hasRole(req.auth, "parent") && !hasRole(req.auth, "school_admin")) {
      const parentCheck = await pool.query(
        `
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          WHERE ps.school_id = $1
            AND ps.student_id = $2
            AND p.school_id = $1
            AND p.user_id = $3
          LIMIT 1
        `,
        [req.auth.schoolId, invoice.student_id, req.auth.userId]
      );
      if (!parentCheck.rows[0]) {
        throw new AppError(403, "FORBIDDEN", "Parent cannot access payments for this invoice");
      }
    }

    const params = [req.auth.schoolId, path.invoiceId];
    const where = ["fp.school_id = $1", "fp.invoice_id = $2"];

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM fee_payments fp
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
          fp.id,
          fp.school_id,
          fp.invoice_id,
          fp.amount,
          fp.payment_date,
          fp.method,
          fp.reference_no,
          fp.received_by_user_id,
          fp.notes,
          fp.created_at
        FROM fee_payments fp
        WHERE ${whereClause}
        ORDER BY fp.payment_date DESC, fp.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const revealReferenceNo = canReadPaymentReference(req.auth);
    const rows = rowsResult.rows.map((row) => ({
      ...row,
      reference_no: revealReferenceNo ? row.reference_no : null,
    }));

    return success(
      res,
      rows,
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
// GET /fees/summary — Finance summary for leadership/finance
// ---------------------------------------------------------------------------
router.get(
  "/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (
      !hasRole(req.auth, "school_admin") &&
      !hasRole(req.auth, "principal") &&
      !hasRole(req.auth, "vice_principal") &&
      !hasRole(req.auth, "accountant")
    ) {
      throw new AppError(403, "FORBIDDEN", "No fee summary access for this role");
    }

    const query = parseSchema(feesSummaryQuerySchema, req.query, "Invalid fees summary query");
    assertDateRange({ dateFrom: query.date_from, dateTo: query.date_to });
    const params = [req.auth.schoolId];
    const where = ["fi.school_id = $1"];

    if (query.date_from) {
      params.push(query.date_from);
      where.push(`fi.due_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`fi.due_date <= $${params.length}`);
    }

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = fi.school_id
            AND fp.id = fi.fee_plan_id
            AND fp.academic_year_id = $${params.length}
        )
      `);
    }

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = fi.school_id
            AND fp.id = fi.fee_plan_id
            AND fp.classroom_id = $${params.length}
        )
      `);
    }

    const summaryResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_invoices,
          COUNT(*) FILTER (WHERE fi.status = 'draft'::invoice_status)::int AS draft_count,
          COUNT(*) FILTER (WHERE fi.status = 'issued'::invoice_status)::int AS issued_count,
          COUNT(*) FILTER (WHERE fi.status = 'partial'::invoice_status)::int AS partial_count,
          COUNT(*) FILTER (WHERE fi.status = 'paid'::invoice_status)::int AS paid_count,
          COUNT(*) FILTER (WHERE fi.status = 'overdue'::invoice_status)::int AS overdue_count,
          COUNT(*) FILTER (WHERE fi.status = 'cancelled'::invoice_status)::int AS cancelled_count,
          COALESCE(SUM(fi.amount_due), 0)::numeric AS total_due,
          COALESCE(SUM(fi.amount_paid), 0)::numeric AS total_paid,
          COALESCE(SUM(fi.amount_due - fi.amount_paid), 0)::numeric AS total_outstanding,
          COALESCE(
            SUM(
              CASE
                WHEN fi.amount_paid < fi.amount_due
                  AND fi.status IN (
                    'issued'::invoice_status,
                    'partial'::invoice_status,
                    'overdue'::invoice_status
                  )
                  AND fi.due_date < CURRENT_DATE
                THEN fi.amount_due - fi.amount_paid
                ELSE 0
              END
            ),
            0
          )::numeric AS overdue_amount
        FROM fee_invoices fi
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const defaultersResult = await pool.query(
      `
        SELECT COUNT(DISTINCT fi.student_id)::int AS defaulter_students
        FROM fee_invoices fi
        WHERE ${where.join(" AND ")}
          AND fi.amount_paid < fi.amount_due
          AND fi.status IN (
            'issued'::invoice_status,
            'partial'::invoice_status,
            'overdue'::invoice_status
          )
          AND fi.due_date < CURRENT_DATE
      `,
      params
    );

    const row = summaryResult.rows[0] || {};
    const summary = {
      generated_at: new Date().toISOString(),
      totals: {
        total_invoices: Number(row.total_invoices || 0),
        total_due: Number(row.total_due || 0),
        total_paid: Number(row.total_paid || 0),
        total_outstanding: Number(row.total_outstanding || 0),
        overdue_amount: Number(row.overdue_amount || 0),
        defaulter_students: Number(defaultersResult.rows[0]?.defaulter_students || 0),
      },
      status_breakdown: {
        draft_count: Number(row.draft_count || 0),
        issued_count: Number(row.issued_count || 0),
        partial_count: Number(row.partial_count || 0),
        paid_count: Number(row.paid_count || 0),
        overdue_count: Number(row.overdue_count || 0),
        cancelled_count: Number(row.cancelled_count || 0),
      },
    };

    return success(res, summary, 200);
  })
);

// ---------------------------------------------------------------------------
// GET /fees/defaulters — Defaulter students list for finance/leadership
// ---------------------------------------------------------------------------
router.get(
  "/defaulters",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (
      !hasRole(req.auth, "school_admin") &&
      !hasRole(req.auth, "accountant") &&
      !hasRole(req.auth, "principal") &&
      !hasRole(req.auth, "vice_principal")
    ) {
      throw new AppError(403, "FORBIDDEN", "No fee defaulters access for this role");
    }

    const query = parseSchema(defaultersQuerySchema, req.query, "Invalid fee defaulters query");
    const params = [req.auth.schoolId];
    const where = [
      "fi.school_id = $1",
      "fi.amount_paid < fi.amount_due",
      "fi.status IN ('issued'::invoice_status, 'partial'::invoice_status, 'overdue'::invoice_status)",
      "fi.due_date < CURRENT_DATE",
    ];

    if (query.min_outstanding > 0) {
      params.push(query.min_outstanding);
      where.push(`(fi.amount_due - fi.amount_paid) >= $${params.length}`);
    }

    if (query.min_days_overdue > 0) {
      params.push(query.min_days_overdue);
      where.push(`(CURRENT_DATE - fi.due_date) >= $${params.length}`);
    }

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = fi.school_id
            AND fp.id = fi.fee_plan_id
            AND fp.academic_year_id = $${params.length}
        )
      `);
    }

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = fi.school_id
            AND fp.id = fi.fee_plan_id
            AND fp.classroom_id = $${params.length}
        )
      `);
    }

    const whereClause = where.join(" AND ");
    const totalStudentsResult = await pool.query(
      `
        SELECT COUNT(DISTINCT fi.student_id)::int AS total
        FROM fee_invoices fi
        WHERE ${whereClause}
      `,
      params
    );

    const totalItems = totalStudentsResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          fi.student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          c.id AS classroom_id,
          c.grade_label,
          c.section_label,
          ss.id AS section_id,
          ss.name AS section_name,
          COUNT(fi.id)::int AS overdue_invoice_count,
          MIN(fi.due_date) AS oldest_due_date,
          MAX((CURRENT_DATE - fi.due_date))::int AS max_days_overdue,
          COALESCE(SUM(fi.amount_due - fi.amount_paid), 0)::numeric AS total_outstanding
        FROM fee_invoices fi
        JOIN students s
          ON s.id = fi.student_id
         AND s.school_id = fi.school_id
        LEFT JOIN student_enrollments se
          ON se.school_id = s.school_id
         AND se.student_id = s.id
         AND se.status = 'active'
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE ${whereClause}
        GROUP BY
          fi.student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          c.id,
          c.grade_label,
          c.section_label,
          ss.id,
          ss.name
        ORDER BY total_outstanding DESC, oldest_due_date ASC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const defaulters = rowsResult.rows.map((row) => ({
      student_id: row.student_id,
      student_code: row.student_code,
      student_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
      classroom: row.classroom_id
        ? {
            id: row.classroom_id,
            grade_label: row.grade_label,
            section_label: row.section_label,
            display_name: `${row.grade_label} - ${row.section_label}`,
          }
        : null,
      section: row.section_id
        ? {
            id: row.section_id,
            name: row.section_name,
          }
        : null,
      overdue_invoice_count: Number(row.overdue_invoice_count || 0),
      oldest_due_date: row.oldest_due_date,
      max_days_overdue: Number(row.max_days_overdue || 0),
      total_outstanding: Number(row.total_outstanding || 0),
    }));

    return success(res, defaulters, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

module.exports = router;
