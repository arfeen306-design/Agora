const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { buildPdfBuffer } = require("../utils/report-export");

const router = express.Router();

const HR_PROFILE_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"];
const HR_PROFILE_MANAGE_ROLES = ["school_admin", "hr_admin"];
const PAYROLL_VIEW_ROLES = ["school_admin", "principal", "hr_admin", "accountant"];
const PAYROLL_MANAGE_ROLES = ["school_admin", "hr_admin", "accountant"];
const ADJUSTMENT_MANAGE_ROLES = ["school_admin", "hr_admin", "principal"];

const componentSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount: z.coerce.number().min(0),
});

const staffPathSchema = z.object({
  staffId: z.string().uuid(),
});

const periodPathSchema = z.object({
  periodId: z.string().uuid(),
});

const payrollRecordPathSchema = z.object({
  recordId: z.string().uuid(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(20),
});

const salaryStructuresQuerySchema = z.object({
  include_inactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createSalaryStructureSchema = z.object({
  effective_from: z.string().date(),
  base_salary: z.coerce.number().min(0),
  allowances: z.array(componentSchema).max(50).default([]),
  deductions: z.array(componentSchema).max(50).default([]),
  bonuses: z.array(componentSchema).max(50).default([]),
  provident_fund: z.coerce.number().min(0).default(0),
  gop_fund: z.coerce.number().min(0).default(0),
  currency_code: z.string().trim().min(3).max(8).default("PKR"),
  notes: z.string().trim().max(2000).optional(),
});

const createAdjustmentSchema = z
  .object({
    adjustment_type: z.enum(["increment", "allowance", "deduction", "bonus", "one_time"]),
    amount: z.coerce.number().positive(),
    is_recurring: z.boolean().default(false),
    effective_on: z.string().date(),
    expires_on: z.string().date().optional(),
    reason: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(2000).optional(),
    status: z.enum(["pending", "approved", "rejected"]).default("approved"),
  })
  .superRefine((data, ctx) => {
    if (data.expires_on && data.expires_on < data.effective_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expires_on must be on or after effective_on",
        path: ["expires_on"],
      });
    }
  });

const listAdjustmentsQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  adjustment_type: z.enum(["increment", "allowance", "deduction", "bonus", "one_time"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createPayrollPeriodSchema = z
  .object({
    period_label: z.string().trim().min(2).max(120),
    period_start: z.string().date(),
    period_end: z.string().date(),
  })
  .superRefine((data, ctx) => {
    if (data.period_end < data.period_start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "period_end must be on or after period_start",
        path: ["period_end"],
      });
    }
  });

const listPayrollPeriodsQuerySchema = z.object({
  status: z.enum(["draft", "generated", "closed", "paid"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const listPayrollRecordsQuerySchema = z.object({
  payroll_period_id: z.string().uuid().optional(),
  staff_profile_id: z.string().uuid().optional(),
  payment_status: z.enum(["pending", "paid", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const updatePayrollPaymentSchema = z.object({
  payment_status: z.enum(["pending", "paid", "cancelled"]),
  paid_on: z.string().date().optional(),
  payment_method: z.string().trim().min(2).max(60).optional(),
  finance_notes: z.string().trim().max(2000).optional(),
});

const updateHrProfileSchema = z
  .object({
    designation: z.string().trim().max(120).optional(),
    department: z.string().trim().max(120).optional(),
    employment_type: z.string().trim().max(80).optional(),
    contract_type: z.string().trim().max(80).optional(),
    joining_date: z.string().date().optional(),
    confirmation_date: z.string().date().nullable().optional(),
    reporting_manager_user_id: z.string().uuid().nullable().optional(),
    work_location: z.string().trim().max(120).nullable().optional(),
    bank_account_title: z.string().trim().max(160).nullable().optional(),
    bank_account_number: z.string().trim().max(80).nullable().optional(),
    bank_name: z.string().trim().max(160).nullable().optional(),
    tax_identifier: z.string().trim().max(120).nullable().optional(),
    emergency_contact_name: z.string().trim().max(120).nullable().optional(),
    emergency_contact_phone: z.string().trim().max(60).nullable().optional(),
    employment_status: z.string().trim().min(1).max(40).optional(),
    status_change_reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one HR profile field is required",
    path: ["body"],
  });

const upsertAttendanceLogSchema = z.object({
  attendance_date: z.string().date(),
  check_in_at: z.string().datetime().optional(),
  check_out_at: z.string().datetime().optional(),
  status: z.enum(["present", "absent", "late", "leave"]).default("present"),
  note: z.string().trim().max(500).optional(),
});

const createLeaveRecordSchema = z
  .object({
    leave_type: z.string().trim().min(2).max(60).default("casual"),
    starts_on: z.string().date(),
    ends_on: z.string().date(),
    total_days: z.coerce.number().positive().max(365).optional(),
    status: z.enum(["pending", "approved", "rejected", "cancelled"]).default("approved"),
    reason: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ends_on < data.starts_on) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ends_on must be on or after starts_on",
        path: ["ends_on"],
      });
    }
  });

const attendanceSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const hrDashboardSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const salarySlipQuerySchema = z.object({
  format: z.enum(["json", "pdf"]).default("json"),
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

function hasAnyRole(auth, roles) {
  return roles.some((role) => hasRole(auth, role));
}

function toMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

function sumComponents(items) {
  if (!Array.isArray(items)) return 0;
  return toMoney(items.reduce((sum, item) => sum + Number(item?.amount || 0), 0));
}

function normalizeComponents(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    label: String(item.label || "Component").trim(),
    amount: toMoney(item.amount),
  }));
}

function safeMonthRange(monthValue) {
  if (!monthValue) {
    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      label: `${year}-${String(month + 1).padStart(2, "0")}`,
    };
  }

  const [year, month] = monthValue.split("-").map((chunk) => Number(chunk));
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: monthValue,
  };
}

async function getStaffProfileById(schoolId, staffId, client = pool) {
  const result = await client.query(
    `
      SELECT
        sp.*,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        u.is_active,
        u.last_login_at,
        rm.first_name AS reporting_manager_first_name,
        rm.last_name AS reporting_manager_last_name,
        rm.email AS reporting_manager_email,
        ss.name AS primary_section_name,
        ss.code AS primary_section_code
      FROM staff_profiles sp
      JOIN users u
        ON u.id = sp.user_id
       AND u.school_id = sp.school_id
      LEFT JOIN users rm
        ON rm.id = sp.reporting_manager_user_id
      LEFT JOIN school_sections ss
        ON ss.id = sp.primary_section_id
       AND ss.school_id = sp.school_id
      WHERE sp.school_id = $1
        AND sp.id = $2
      LIMIT 1
    `,
    [schoolId, staffId]
  );

  return result.rows[0] || null;
}

async function getStaffProfileByUserId(schoolId, userId, client = pool) {
  const result = await client.query(
    `
      SELECT id
      FROM staff_profiles
      WHERE school_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );

  return result.rows[0]?.id || null;
}

function canViewSensitiveFinance(auth) {
  return hasAnyRole(auth, ["school_admin", "hr_admin"]);
}

function canViewPayroll(auth, recordUserId = null) {
  if (hasAnyRole(auth, PAYROLL_VIEW_ROLES)) return true;
  return Boolean(recordUserId) && recordUserId === auth.userId;
}

function auditEvent({ auth, action, entityName, entityId, metadata = {} }) {
  fireAndForgetAuditLog({
    schoolId: auth.schoolId,
    actorUserId: auth.userId,
    action,
    entityName,
    entityId,
    metadata,
  });
}

function assertOwnOrRoleAccess(auth, allowedRoles, ownerUserId, message = "Insufficient role permissions") {
  if (hasAnyRole(auth, allowedRoles)) return;
  if (ownerUserId && auth.userId === ownerUserId) return;
  throw new AppError(403, "FORBIDDEN", message);
}

async function listStaffPayrollRecords({
  schoolId,
  staffProfileId,
  periodId,
  paymentStatus,
  page,
  pageSize,
  client = pool,
}) {
  const params = [schoolId];
  const where = ["pr.school_id = $1"];

  if (staffProfileId) {
    params.push(staffProfileId);
    where.push(`pr.staff_profile_id = $${params.length}`);
  }

  if (periodId) {
    params.push(periodId);
    where.push(`pr.payroll_period_id = $${params.length}`);
  }

  if (paymentStatus) {
    params.push(paymentStatus);
    where.push(`pr.payment_status = $${params.length}`);
  }

  const whereClause = where.join(" AND ");
  const countResult = await client.query(
    `
      SELECT COUNT(*)::int AS total
      FROM payroll_records pr
      WHERE ${whereClause}
    `,
    params
  );

  const totalItems = Number(countResult.rows[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const offset = (page - 1) * pageSize;

  const listParams = [...params, pageSize, offset];
  const rows = await client.query(
    `
      SELECT
        pr.id,
        pr.payroll_period_id,
        pr.staff_profile_id,
        pr.salary_structure_id,
        pr.base_salary,
        pr.allowances_total,
        pr.deductions_total,
        pr.bonus_total,
        pr.provident_fund,
        pr.gop_fund,
        pr.gross_salary,
        pr.net_salary,
        pr.breakdown_json,
        pr.payment_status,
        pr.paid_on,
        pr.payment_method,
        pr.finance_notes,
        pr.generated_at,
        pr.created_at,
        pr.updated_at,
        pp.period_label,
        pp.period_start,
        pp.period_end,
        sp.user_id,
        sp.staff_code,
        sp.designation,
        u.first_name,
        u.last_name,
        u.email
      FROM payroll_records pr
      JOIN payroll_periods pp
        ON pp.id = pr.payroll_period_id
       AND pp.school_id = pr.school_id
      JOIN staff_profiles sp
        ON sp.id = pr.staff_profile_id
       AND sp.school_id = pr.school_id
      JOIN users u
        ON u.id = sp.user_id
       AND u.school_id = sp.school_id
      WHERE ${whereClause}
      ORDER BY pp.period_start DESC, u.first_name ASC
      LIMIT $${listParams.length - 1}
      OFFSET $${listParams.length}
    `,
    listParams
  );

  return {
    rows: rows.rows,
    pagination: {
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
    },
  };
}

async function fetchAttendanceSummary({ schoolId, staffProfileId, monthRange, client = pool }) {
  const result = await client.query(
    `
      SELECT
        COUNT(*)::int AS total_days,
        COUNT(*) FILTER (WHERE status = 'present')::int AS present_days,
        COUNT(*) FILTER (WHERE status = 'late')::int AS late_days,
        COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_days,
        COUNT(*) FILTER (WHERE status = 'leave')::int AS leave_days,
        MIN(check_in_at) AS first_check_in,
        MAX(check_out_at) AS last_check_out
      FROM staff_attendance_logs sal
      WHERE sal.school_id = $1
        AND sal.staff_profile_id = $2
        AND sal.attendance_date BETWEEN $3 AND $4
    `,
    [schoolId, staffProfileId, monthRange.start, monthRange.end]
  );

  const row = result.rows[0] || {};
  return {
    month: monthRange.label,
    date_from: monthRange.start,
    date_to: monthRange.end,
    total_days: Number(row.total_days || 0),
    present_days: Number(row.present_days || 0),
    late_days: Number(row.late_days || 0),
    absent_days: Number(row.absent_days || 0),
    leave_days: Number(row.leave_days || 0),
    first_check_in: row.first_check_in,
    last_check_out: row.last_check_out,
  };
}

async function fetchLeaveSummary({ schoolId, staffProfileId, monthRange, client = pool }) {
  const result = await client.query(
    `
      SELECT
        COUNT(*)::int AS total_requests,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_requests,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_requests,
        COALESCE(SUM(total_days) FILTER (WHERE status = 'approved'), 0)::numeric AS approved_days
      FROM staff_leave_records slr
      WHERE slr.school_id = $1
        AND slr.staff_profile_id = $2
        AND slr.starts_on <= $4
        AND slr.ends_on >= $3
    `,
    [schoolId, staffProfileId, monthRange.start, monthRange.end]
  );

  const row = result.rows[0] || {};
  return {
    month: monthRange.label,
    total_requests: Number(row.total_requests || 0),
    approved_requests: Number(row.approved_requests || 0),
    pending_requests: Number(row.pending_requests || 0),
    approved_days: toMoney(row.approved_days || 0),
  };
}

async function resolveApplicableSalaryStructure({ schoolId, staffProfileId, periodStart, periodEnd, client }) {
  const result = await client.query(
    `
      SELECT
        sss.*
      FROM staff_salary_structures sss
      WHERE sss.school_id = $1
        AND sss.staff_profile_id = $2
        AND sss.is_active = TRUE
        AND sss.effective_from <= $4
        AND (sss.effective_to IS NULL OR sss.effective_to >= $3)
      ORDER BY sss.effective_from DESC, sss.created_at DESC
      LIMIT 1
    `,
    [schoolId, staffProfileId, periodStart, periodEnd]
  );

  return result.rows[0] || null;
}

async function resolveApprovedAdjustments({ schoolId, staffProfileId, periodStart, periodEnd, client }) {
  const result = await client.query(
    `
      SELECT
        id,
        adjustment_type,
        amount,
        is_recurring,
        effective_on,
        expires_on,
        reason,
        notes
      FROM staff_salary_adjustments
      WHERE school_id = $1
        AND staff_profile_id = $2
        AND status = 'approved'
        AND effective_on <= $4
        AND (expires_on IS NULL OR expires_on >= $3)
      ORDER BY effective_on ASC, created_at ASC
    `,
    [schoolId, staffProfileId, periodStart, periodEnd]
  );

  return result.rows;
}

function computePayrollFromStructure({ structure, adjustments, periodStart, periodEnd }) {
  const allowances = normalizeComponents(structure.allowances_json);
  const deductions = normalizeComponents(structure.deductions_json);
  const bonuses = normalizeComponents(structure.bonuses_json);

  const oneTimeWithinPeriod = (dateValue) => dateValue >= periodStart && dateValue <= periodEnd;

  for (const adjustment of adjustments) {
    const item = {
      label: adjustment.reason || adjustment.adjustment_type,
      amount: toMoney(adjustment.amount),
    };

    const applies = adjustment.is_recurring || oneTimeWithinPeriod(String(adjustment.effective_on).slice(0, 10));
    if (!applies) continue;

    if (adjustment.adjustment_type === "deduction") {
      deductions.push(item);
    } else if (adjustment.adjustment_type === "bonus") {
      bonuses.push(item);
    } else {
      // increment / allowance / one_time default into allowances
      allowances.push(item);
    }
  }

  const baseSalary = toMoney(structure.base_salary);
  const allowancesTotal = sumComponents(allowances);
  const deductionsTotal = sumComponents(deductions);
  const bonusTotal = sumComponents(bonuses);
  const providentFund = toMoney(structure.provident_fund);
  const gopFund = toMoney(structure.gop_fund);
  const grossSalary = toMoney(baseSalary + allowancesTotal + bonusTotal);
  const netSalary = toMoney(grossSalary - deductionsTotal - providentFund - gopFund);

  return {
    baseSalary,
    allowances,
    deductions,
    bonuses,
    allowancesTotal,
    deductionsTotal,
    bonusTotal,
    providentFund,
    gopFund,
    grossSalary,
    netSalary,
  };
}

async function loadPayrollRecordWithStaff({ schoolId, recordId, client = pool }) {
  const result = await client.query(
    `
      SELECT
        pr.*,
        pp.period_label,
        pp.period_start,
        pp.period_end,
        sp.user_id,
        sp.staff_code,
        sp.designation,
        sp.department,
        u.first_name,
        u.last_name,
        u.email
      FROM payroll_records pr
      JOIN payroll_periods pp
        ON pp.id = pr.payroll_period_id
       AND pp.school_id = pr.school_id
      JOIN staff_profiles sp
        ON sp.id = pr.staff_profile_id
       AND sp.school_id = pr.school_id
      JOIN users u
        ON u.id = sp.user_id
       AND u.school_id = sp.school_id
      WHERE pr.school_id = $1
        AND pr.id = $2
      LIMIT 1
    `,
    [schoolId, recordId]
  );

  return result.rows[0] || null;
}

async function ensurePayrollRecordVisible({ auth, recordId }) {
  const row = await loadPayrollRecordWithStaff({ schoolId: auth.schoolId, recordId });
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Payroll record not found");
  }

  if (!canViewPayroll(auth, row.user_id)) {
    throw new AppError(403, "FORBIDDEN", "No payroll visibility for this role");
  }

  return row;
}

router.get(
  "/people/hr/dashboard/summary",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "hr_admin", "accountant"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(hrDashboardSummaryQuerySchema, req.query, "Invalid HR dashboard summary query");
    const monthRange = safeMonthRange(query.month);

    const summary = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM staff_profiles sp WHERE sp.school_id = $1 AND sp.employment_status = 'active') AS active_staff,
          (SELECT COUNT(*)::int FROM payroll_periods pp WHERE pp.school_id = $1 AND pp.status IN ('draft', 'generated')) AS open_payroll_periods,
          (SELECT COUNT(*)::int FROM staff_salary_adjustments ssa WHERE ssa.school_id = $1 AND ssa.status = 'pending') AS pending_adjustments,
          (SELECT COUNT(*)::int FROM staff_leave_records slr WHERE slr.school_id = $1 AND slr.status = 'pending') AS pending_leave_requests,
          (
            SELECT COALESCE(SUM(pr.net_salary), 0)::numeric
            FROM payroll_records pr
            JOIN payroll_periods pp
              ON pp.id = pr.payroll_period_id
             AND pp.school_id = pr.school_id
            WHERE pr.school_id = $1
              AND pp.period_start <= $3
              AND pp.period_end >= $2
          ) AS current_month_net_payroll,
          (
            SELECT COUNT(DISTINCT sal.staff_profile_id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = $1
              AND sal.attendance_date = CURRENT_DATE
              AND sp.employment_status = 'active'
          ) AS staff_marked_today,
          (
            SELECT COUNT(DISTINCT sal.staff_profile_id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = $1
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'present'
              AND sp.employment_status = 'active'
          ) AS staff_present_today,
          (
            SELECT COUNT(DISTINCT sal.staff_profile_id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = $1
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'late'
              AND sp.employment_status = 'active'
          ) AS staff_late_today,
          (
            SELECT COUNT(DISTINCT sal.staff_profile_id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = $1
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'absent'
              AND sp.employment_status = 'active'
          ) AS staff_absent_today,
          (
            SELECT COUNT(DISTINCT sal.staff_profile_id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = $1
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'leave'
              AND sp.employment_status = 'active'
          ) AS staff_leave_today
      `,
      [req.auth.schoolId, monthRange.start, monthRange.end]
    );

    const activeStaff = Number(summary.rows[0]?.active_staff || 0);
    const markedStaff = Number(summary.rows[0]?.staff_marked_today || 0);

    return success(res, {
      month: monthRange.label,
      active_staff: activeStaff,
      open_payroll_periods: Number(summary.rows[0]?.open_payroll_periods || 0),
      pending_adjustments: Number(summary.rows[0]?.pending_adjustments || 0),
      pending_leave_requests: Number(summary.rows[0]?.pending_leave_requests || 0),
      current_month_net_payroll: toMoney(summary.rows[0]?.current_month_net_payroll || 0),
      staff_attendance_today: {
        total_active_staff: activeStaff,
        marked_staff: markedStaff,
        unmarked_staff: Math.max(0, activeStaff - markedStaff),
        present_count: Number(summary.rows[0]?.staff_present_today || 0),
        late_count: Number(summary.rows[0]?.staff_late_today || 0),
        absent_count: Number(summary.rows[0]?.staff_absent_today || 0),
        leave_count: Number(summary.rows[0]?.staff_leave_today || 0),
      },
    });
  })
);

router.get(
  "/people/hr/staff/:staffId/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    assertOwnOrRoleAccess(
      req.auth,
      HR_PROFILE_VIEW_ROLES,
      profile.user_id,
      "No HR profile visibility for this role"
    );

    const canSeeSensitive = canViewSensitiveFinance(req.auth) || profile.user_id === req.auth.userId;

    const latestSalary = await pool.query(
      `
        SELECT
          id,
          effective_from,
          effective_to,
          base_salary,
          provident_fund,
          gop_fund,
          currency_code,
          is_active,
          created_at
        FROM staff_salary_structures
        WHERE school_id = $1
          AND staff_profile_id = $2
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1
      `,
      [req.auth.schoolId, path.staffId]
    );

    const latestPayroll = await pool.query(
      `
        SELECT
          pr.id,
          pr.net_salary,
          pr.gross_salary,
          pr.payment_status,
          pr.paid_on,
          pp.period_label,
          pp.period_start,
          pp.period_end
        FROM payroll_records pr
        JOIN payroll_periods pp
          ON pp.id = pr.payroll_period_id
         AND pp.school_id = pr.school_id
        WHERE pr.school_id = $1
          AND pr.staff_profile_id = $2
        ORDER BY pp.period_start DESC
        LIMIT 1
      `,
      [req.auth.schoolId, path.staffId]
    );

    const monthRange = safeMonthRange();
    const attendanceSummary = await fetchAttendanceSummary({
      schoolId: req.auth.schoolId,
      staffProfileId: path.staffId,
      monthRange,
    });
    const leaveSummary = await fetchLeaveSummary({
      schoolId: req.auth.schoolId,
      staffProfileId: path.staffId,
      monthRange,
    });

    return success(res, {
      profile: {
        ...profile,
        bank_account_title: canSeeSensitive ? profile.bank_account_title : null,
        bank_account_number: canSeeSensitive ? profile.bank_account_number : null,
        bank_name: canSeeSensitive ? profile.bank_name : null,
        tax_identifier: canSeeSensitive ? profile.tax_identifier : null,
      },
      latest_salary_structure: latestSalary.rows[0] || null,
      latest_payroll_record: latestPayroll.rows[0] || null,
      attendance_summary: attendanceSummary,
      leave_summary: leaveSummary,
    });
  })
);

router.patch(
  "/people/hr/staff/:staffId/profile",
  requireAuth,
  requireRoles(...HR_PROFILE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const body = parseSchema(updateHrProfileSchema, req.body, "Invalid HR profile update payload");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await getStaffProfileById(req.auth.schoolId, path.staffId, client);
      if (!existing) {
        throw new AppError(404, "NOT_FOUND", "Staff profile not found");
      }

      if (body.reporting_manager_user_id) {
        const manager = await client.query(
          `
            SELECT id
            FROM users
            WHERE school_id = $1
              AND id = $2
            LIMIT 1
          `,
          [req.auth.schoolId, body.reporting_manager_user_id]
        );
        if (!manager.rows[0]) {
          throw new AppError(422, "VALIDATION_ERROR", "reporting_manager_user_id must belong to this school");
        }
      }

      const setClauses = [];
      const values = [req.auth.schoolId, path.staffId];

      const push = (column, value) => {
        values.push(value);
        setClauses.push(`${column} = $${values.length}`);
      };

      const fieldMap = {
        designation: "designation",
        department: "department",
        employment_type: "employment_type",
        contract_type: "contract_type",
        joining_date: "joining_date",
        confirmation_date: "confirmation_date",
        reporting_manager_user_id: "reporting_manager_user_id",
        work_location: "work_location",
        bank_account_title: "bank_account_title",
        bank_account_number: "bank_account_number",
        bank_name: "bank_name",
        tax_identifier: "tax_identifier",
        emergency_contact_name: "emergency_contact_name",
        emergency_contact_phone: "emergency_contact_phone",
        employment_status: "employment_status",
      };

      for (const [key, column] of Object.entries(fieldMap)) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          push(column, body[key]);
        }
      }

      push("updated_at", new Date().toISOString());

      const updated = await client.query(
        `
          UPDATE staff_profiles
          SET ${setClauses.join(", ")}
          WHERE school_id = $1
            AND id = $2
          RETURNING *
        `,
        values
      );

      if (!updated.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Staff profile not found");
      }

      if (
        Object.prototype.hasOwnProperty.call(body, "employment_status") &&
        body.employment_status !== existing.employment_status
      ) {
        await client.query(
          `
            INSERT INTO staff_status_history (
              school_id,
              staff_profile_id,
              previous_status,
              next_status,
              reason,
              changed_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            req.auth.schoolId,
            path.staffId,
            existing.employment_status,
            body.employment_status,
            body.status_change_reason || null,
            req.auth.userId,
          ]
        );
      }

      await client.query("COMMIT");

      auditEvent({
        auth: req.auth,
        action: "hr.staff_profile.updated",
        entityName: "staff_profiles",
        entityId: path.staffId,
        metadata: {
          changed_fields: Object.keys(body),
          previous_employment_status: existing.employment_status,
          next_employment_status: body.employment_status || existing.employment_status,
        },
      });

      return success(res, updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/hr/staff/:staffId/salary-structures",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const query = parseSchema(salaryStructuresQuerySchema, req.query, "Invalid salary structures query");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    assertOwnOrRoleAccess(
      req.auth,
      HR_PROFILE_VIEW_ROLES,
      profile.user_id,
      "No salary structure visibility for this role"
    );

    const params = [req.auth.schoolId, path.staffId];
    const where = ["sss.school_id = $1", "sss.staff_profile_id = $2"];
    if (!query.include_inactive) {
      where.push("sss.is_active = TRUE");
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM staff_salary_structures sss
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          sss.*
        FROM staff_salary_structures sss
        WHERE ${where.join(" AND ")}
        ORDER BY sss.effective_from DESC, sss.created_at DESC
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
  "/people/hr/staff/:staffId/salary-structures",
  requireAuth,
  requireRoles("school_admin", "hr_admin"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const body = parseSchema(createSalaryStructureSchema, req.body, "Invalid salary structure payload");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const profile = await getStaffProfileById(req.auth.schoolId, path.staffId, client);
      if (!profile) {
        throw new AppError(404, "NOT_FOUND", "Staff profile not found");
      }

      const overlap = await client.query(
        `
          UPDATE staff_salary_structures
          SET
            effective_to = GREATEST(effective_from, $3::date - INTERVAL '1 day')::date,
            is_active = FALSE,
            updated_at = NOW()
          WHERE school_id = $1
            AND staff_profile_id = $2
            AND is_active = TRUE
            AND effective_from < $3
            AND (effective_to IS NULL OR effective_to >= $3)
          RETURNING id
        `,
        [req.auth.schoolId, path.staffId, body.effective_from]
      );

      const created = await client.query(
        `
          INSERT INTO staff_salary_structures (
            school_id,
            staff_profile_id,
            effective_from,
            base_salary,
            allowances_json,
            deductions_json,
            bonuses_json,
            provident_fund,
            gop_fund,
            currency_code,
            notes,
            created_by_user_id,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, TRUE)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          path.staffId,
          body.effective_from,
          toMoney(body.base_salary),
          JSON.stringify(normalizeComponents(body.allowances)),
          JSON.stringify(normalizeComponents(body.deductions)),
          JSON.stringify(normalizeComponents(body.bonuses)),
          toMoney(body.provident_fund),
          toMoney(body.gop_fund),
          body.currency_code,
          body.notes || null,
          req.auth.userId,
        ]
      );

      await client.query("COMMIT");

      auditEvent({
        auth: req.auth,
        action: "finance.salary_structure.created",
        entityName: "staff_salary_structures",
        entityId: created.rows[0].id,
        metadata: {
          staff_profile_id: path.staffId,
          effective_from: body.effective_from,
          base_salary: toMoney(body.base_salary),
          replaced_structure_count: overlap.rowCount,
        },
      });

      return success(res, created.rows[0], 201);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") {
        throw new AppError(409, "CONFLICT", "Salary structure conflicts with existing effective period");
      }
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/hr/staff/:staffId/adjustments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const query = parseSchema(listAdjustmentsQuerySchema, req.query, "Invalid adjustments query");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    assertOwnOrRoleAccess(
      req.auth,
      HR_PROFILE_VIEW_ROLES,
      profile.user_id,
      "No salary adjustment visibility for this role"
    );

    const params = [req.auth.schoolId, path.staffId];
    const where = ["ssa.school_id = $1", "ssa.staff_profile_id = $2"];

    if (query.status) {
      params.push(query.status);
      where.push(`ssa.status = $${params.length}`);
    }

    if (query.adjustment_type) {
      params.push(query.adjustment_type);
      where.push(`ssa.adjustment_type = $${params.length}`);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM staff_salary_adjustments ssa
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          ssa.*,
          au.first_name AS approved_by_first_name,
          au.last_name AS approved_by_last_name,
          cu.first_name AS created_by_first_name,
          cu.last_name AS created_by_last_name
        FROM staff_salary_adjustments ssa
        LEFT JOIN users au
          ON au.id = ssa.approved_by_user_id
        LEFT JOIN users cu
          ON cu.id = ssa.created_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ssa.effective_on DESC, ssa.created_at DESC
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
  "/people/hr/staff/:staffId/adjustments",
  requireAuth,
  requireRoles(...ADJUSTMENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const body = parseSchema(createAdjustmentSchema, req.body, "Invalid salary adjustment payload");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    const created = await pool.query(
      `
        INSERT INTO staff_salary_adjustments (
          school_id,
          staff_profile_id,
          adjustment_type,
          amount,
          is_recurring,
          effective_on,
          expires_on,
          reason,
          notes,
          status,
          approved_by_user_id,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        path.staffId,
        body.adjustment_type,
        toMoney(body.amount),
        body.is_recurring,
        body.effective_on,
        body.expires_on || null,
        body.reason || null,
        body.notes || null,
        body.status,
        body.status === "approved" ? req.auth.userId : null,
        req.auth.userId,
      ]
    );

    auditEvent({
      auth: req.auth,
      action: "finance.salary_adjustment.created",
      entityName: "staff_salary_adjustments",
      entityId: created.rows[0].id,
      metadata: {
        staff_profile_id: path.staffId,
        adjustment_type: body.adjustment_type,
        amount: toMoney(body.amount),
        status: body.status,
      },
    });

    return success(res, created.rows[0], 201);
  })
);

router.post(
  "/people/hr/staff/:staffId/attendance-logs",
  requireAuth,
  requireRoles("school_admin", "hr_admin"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const body = parseSchema(upsertAttendanceLogSchema, req.body, "Invalid staff attendance payload");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    const saved = await pool.query(
      `
        INSERT INTO staff_attendance_logs (
          school_id,
          staff_profile_id,
          attendance_date,
          check_in_at,
          check_out_at,
          status,
          note,
          recorded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (school_id, staff_profile_id, attendance_date)
        DO UPDATE SET
          check_in_at = EXCLUDED.check_in_at,
          check_out_at = EXCLUDED.check_out_at,
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          recorded_by_user_id = EXCLUDED.recorded_by_user_id,
          updated_at = NOW()
        RETURNING *
      `,
      [
        req.auth.schoolId,
        path.staffId,
        body.attendance_date,
        body.check_in_at || null,
        body.check_out_at || null,
        body.status,
        body.note || null,
        req.auth.userId,
      ]
    );

    auditEvent({
      auth: req.auth,
      action: "hr.staff_attendance.upserted",
      entityName: "staff_attendance_logs",
      entityId: saved.rows[0].id,
      metadata: {
        staff_profile_id: path.staffId,
        attendance_date: body.attendance_date,
        status: body.status,
      },
    });

    return success(res, saved.rows[0], 201);
  })
);

router.post(
  "/people/hr/staff/:staffId/leave-records",
  requireAuth,
  requireRoles("school_admin", "hr_admin", "principal"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(staffPathSchema, req.params, "Invalid staff id");
    const body = parseSchema(createLeaveRecordSchema, req.body, "Invalid leave record payload");

    const profile = await getStaffProfileById(req.auth.schoolId, path.staffId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found");
    }

    const defaultDays =
      body.total_days ||
      Math.max(
        1,
        Math.floor(
          (new Date(`${body.ends_on}T00:00:00Z`).getTime() - new Date(`${body.starts_on}T00:00:00Z`).getTime()) /
            (24 * 3600 * 1000)
        ) + 1
      );

    const created = await pool.query(
      `
        INSERT INTO staff_leave_records (
          school_id,
          staff_profile_id,
          leave_type,
          starts_on,
          ends_on,
          total_days,
          status,
          reason,
          approved_by_user_id,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        path.staffId,
        body.leave_type,
        body.starts_on,
        body.ends_on,
        toMoney(defaultDays),
        body.status,
        body.reason || null,
        body.status === "approved" ? req.auth.userId : null,
        req.auth.userId,
      ]
    );

    auditEvent({
      auth: req.auth,
      action: "hr.staff_leave.created",
      entityName: "staff_leave_records",
      entityId: created.rows[0].id,
      metadata: {
        staff_profile_id: path.staffId,
        leave_type: body.leave_type,
        starts_on: body.starts_on,
        ends_on: body.ends_on,
        status: body.status,
      },
    });

    return success(res, created.rows[0], 201);
  })
);

router.get(
  "/people/hr/payroll/periods",
  requireAuth,
  requireRoles(...PAYROLL_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listPayrollPeriodsQuerySchema, req.query, "Invalid payroll periods query");

    const params = [req.auth.schoolId];
    const where = ["pp.school_id = $1"];

    if (query.status) {
      params.push(query.status);
      where.push(`pp.status = $${params.length}`);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM payroll_periods pp
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          pp.*,
          gu.first_name AS generated_by_first_name,
          gu.last_name AS generated_by_last_name,
          (
            SELECT COUNT(*)::int
            FROM payroll_records pr
            WHERE pr.school_id = pp.school_id
              AND pr.payroll_period_id = pp.id
          ) AS payroll_record_count,
          (
            SELECT COALESCE(SUM(pr.net_salary), 0)::numeric
            FROM payroll_records pr
            WHERE pr.school_id = pp.school_id
              AND pr.payroll_period_id = pp.id
          ) AS net_payroll_total
        FROM payroll_periods pp
        LEFT JOIN users gu
          ON gu.id = pp.generated_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY pp.period_start DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(
      res,
      rows.rows.map((row) => ({
        ...row,
        net_payroll_total: toMoney(row.net_payroll_total || 0),
      })),
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

router.post(
  "/people/hr/payroll/periods",
  requireAuth,
  requireRoles(...PAYROLL_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createPayrollPeriodSchema, req.body, "Invalid payroll period payload");
    let created;
    try {
      created = await pool.query(
        `
          INSERT INTO payroll_periods (
            school_id,
            period_label,
            period_start,
            period_end,
            status
          )
          VALUES ($1, $2, $3, $4, 'draft')
          RETURNING *
        `,
        [req.auth.schoolId, body.period_label, body.period_start, body.period_end]
      );
    } catch (error) {
      if (error?.code === "23505") {
        throw new AppError(
          409,
          "CONFLICT",
          "Payroll period already exists for the selected date range"
        );
      }
      throw error;
    }

    auditEvent({
      auth: req.auth,
      action: "finance.payroll_period.created",
      entityName: "payroll_periods",
      entityId: created.rows[0].id,
      metadata: {
        period_label: body.period_label,
        period_start: body.period_start,
        period_end: body.period_end,
      },
    });

    return success(res, created.rows[0], 201);
  })
);

router.post(
  "/people/hr/payroll/periods/:periodId/generate",
  requireAuth,
  requireRoles(...PAYROLL_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(periodPathSchema, req.params, "Invalid period id");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const periodResult = await client.query(
        `
          SELECT *
          FROM payroll_periods
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [req.auth.schoolId, path.periodId]
      );

      const period = periodResult.rows[0];
      if (!period) {
        throw new AppError(404, "NOT_FOUND", "Payroll period not found");
      }

      const staffRows = await client.query(
        `
          SELECT
            sp.id,
            sp.user_id,
            sp.staff_code,
            sp.designation,
            u.first_name,
            u.last_name
          FROM staff_profiles sp
          JOIN users u
            ON u.id = sp.user_id
           AND u.school_id = sp.school_id
          WHERE sp.school_id = $1
            AND sp.employment_status = 'active'
            AND u.is_active = TRUE
          ORDER BY u.first_name ASC, u.last_name ASC NULLS LAST
        `,
        [req.auth.schoolId]
      );

      let generatedCount = 0;
      let skippedCount = 0;

      for (const staff of staffRows.rows) {
        const structure = await resolveApplicableSalaryStructure({
          schoolId: req.auth.schoolId,
          staffProfileId: staff.id,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          client,
        });

        if (!structure) {
          skippedCount += 1;
          continue;
        }

        const adjustments = await resolveApprovedAdjustments({
          schoolId: req.auth.schoolId,
          staffProfileId: staff.id,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          client,
        });

        const calc = computePayrollFromStructure({
          structure,
          adjustments,
          periodStart: period.period_start,
          periodEnd: period.period_end,
        });

        await client.query(
          `
            INSERT INTO payroll_records (
              school_id,
              payroll_period_id,
              staff_profile_id,
              salary_structure_id,
              base_salary,
              allowances_total,
              deductions_total,
              bonus_total,
              provident_fund,
              gop_fund,
              gross_salary,
              net_salary,
              breakdown_json,
              payment_status,
              generated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              $10,
              $11,
              $12,
              $13::jsonb,
              'pending',
              NOW()
            )
            ON CONFLICT (payroll_period_id, staff_profile_id)
            DO UPDATE SET
              salary_structure_id = EXCLUDED.salary_structure_id,
              base_salary = EXCLUDED.base_salary,
              allowances_total = EXCLUDED.allowances_total,
              deductions_total = EXCLUDED.deductions_total,
              bonus_total = EXCLUDED.bonus_total,
              provident_fund = EXCLUDED.provident_fund,
              gop_fund = EXCLUDED.gop_fund,
              gross_salary = EXCLUDED.gross_salary,
              net_salary = EXCLUDED.net_salary,
              breakdown_json = EXCLUDED.breakdown_json,
              payment_status = 'pending',
              generated_at = NOW(),
              updated_at = NOW()
          `,
          [
            req.auth.schoolId,
            path.periodId,
            staff.id,
            structure.id,
            calc.baseSalary,
            calc.allowancesTotal,
            calc.deductionsTotal,
            calc.bonusTotal,
            calc.providentFund,
            calc.gopFund,
            calc.grossSalary,
            calc.netSalary,
            JSON.stringify({
              allowances: calc.allowances,
              deductions: calc.deductions,
              bonuses: calc.bonuses,
              adjustments,
              currency_code: structure.currency_code,
            }),
          ]
        );

        generatedCount += 1;
      }

      await client.query(
        `
          UPDATE payroll_periods
          SET
            status = 'generated',
            generated_by_user_id = $3,
            generated_at = NOW(),
            updated_at = NOW()
          WHERE school_id = $1
            AND id = $2
        `,
        [req.auth.schoolId, path.periodId, req.auth.userId]
      );

      await client.query("COMMIT");

      auditEvent({
        auth: req.auth,
        action: "finance.payroll.generated",
        entityName: "payroll_periods",
        entityId: path.periodId,
        metadata: {
          generated_records: generatedCount,
          skipped_staff_without_structure: skippedCount,
        },
      });

      return success(res, {
        payroll_period_id: path.periodId,
        generated_records: generatedCount,
        skipped_staff_without_structure: skippedCount,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/people/hr/payroll/records",
  requireAuth,
  requireRoles(...PAYROLL_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listPayrollRecordsQuerySchema, req.query, "Invalid payroll records query");

    const data = await listStaffPayrollRecords({
      schoolId: req.auth.schoolId,
      staffProfileId: query.staff_profile_id,
      periodId: query.payroll_period_id,
      paymentStatus: query.payment_status,
      page: query.page,
      pageSize: query.page_size,
    });

    return success(res, data.rows, 200, {
      pagination: data.pagination,
    });
  })
);

router.get(
  "/people/hr/payroll/records/:recordId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(payrollRecordPathSchema, req.params, "Invalid payroll record id");
    const row = await ensurePayrollRecordVisible({ auth: req.auth, recordId: path.recordId });

    auditEvent({
      auth: req.auth,
      action: "finance.payroll.record.viewed",
      entityName: "payroll_records",
      entityId: row.id,
      metadata: {
        viewed_as_self: row.user_id === req.auth.userId,
      },
    });

    return success(res, row);
  })
);

router.patch(
  "/people/hr/payroll/records/:recordId/payment",
  requireAuth,
  requireRoles(...PAYROLL_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(payrollRecordPathSchema, req.params, "Invalid payroll record id");
    const body = parseSchema(updatePayrollPaymentSchema, req.body, "Invalid payroll payment payload");

    if (body.payment_status === "paid" && (!body.paid_on || !body.payment_method)) {
      throw new AppError(422, "VALIDATION_ERROR", "paid_on and payment_method are required when payment_status is paid");
    }

    const updated = await pool.query(
      `
        UPDATE payroll_records
        SET
          payment_status = $3,
          paid_on = $4,
          payment_method = $5,
          finance_notes = $6,
          updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
        RETURNING *
      `,
      [
        req.auth.schoolId,
        path.recordId,
        body.payment_status,
        body.payment_status === "paid" ? body.paid_on : null,
        body.payment_status === "paid" ? body.payment_method : null,
        body.finance_notes || null,
      ]
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Payroll record not found");
    }

    auditEvent({
      auth: req.auth,
      action: "finance.payroll.payment_updated",
      entityName: "payroll_records",
      entityId: path.recordId,
      metadata: {
        payment_status: body.payment_status,
        paid_on: body.payment_status === "paid" ? body.paid_on : null,
        payment_method: body.payment_status === "paid" ? body.payment_method : null,
      },
    });

    return success(res, updated.rows[0]);
  })
);

router.get(
  "/people/hr/payroll/records/:recordId/salary-slip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(payrollRecordPathSchema, req.params, "Invalid payroll record id");
    const query = parseSchema(salarySlipQuerySchema, req.query, "Invalid salary slip query");

    const row = await ensurePayrollRecordVisible({ auth: req.auth, recordId: path.recordId });

    auditEvent({
      auth: req.auth,
      action: "finance.payroll.salary_slip.viewed",
      entityName: "payroll_records",
      entityId: row.id,
      metadata: {
        format: query.format,
        viewed_as_self: row.user_id === req.auth.userId,
      },
    });

    if (query.format === "pdf") {
      const columns = [
        { key: "label", label: "Item" },
        { key: "value", label: "Value" },
      ];
      const records = [
        { label: "Staff", value: `${row.first_name} ${row.last_name || ""}`.trim() },
        { label: "Staff Code", value: row.staff_code || "" },
        { label: "Designation", value: row.designation || "" },
        { label: "Period", value: `${row.period_label} (${row.period_start} to ${row.period_end})` },
        { label: "Base Salary", value: String(toMoney(row.base_salary)) },
        { label: "Allowances", value: String(toMoney(row.allowances_total)) },
        { label: "Bonuses", value: String(toMoney(row.bonus_total)) },
        { label: "Deductions", value: String(toMoney(row.deductions_total)) },
        { label: "Provident Fund", value: String(toMoney(row.provident_fund)) },
        { label: "GOP Fund", value: String(toMoney(row.gop_fund)) },
        { label: "Gross Salary", value: String(toMoney(row.gross_salary)) },
        { label: "Net Salary", value: String(toMoney(row.net_salary)) },
        { label: "Payment Status", value: row.payment_status },
      ];

      const buffer = await buildPdfBuffer({
        title: "Agora Salary Slip",
        subtitle: `${row.period_label} | ${row.first_name} ${row.last_name || ""}`.trim(),
        columns,
        rows: records,
      });

      const fileName = `agora_salary_slip_${row.staff_code || row.staff_profile_id}_${row.period_start}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      return res.status(200).send(buffer);
    }

    return success(res, {
      payroll_record: row,
      salary_slip: {
        base_salary: toMoney(row.base_salary),
        allowances_total: toMoney(row.allowances_total),
        bonus_total: toMoney(row.bonus_total),
        deductions_total: toMoney(row.deductions_total),
        provident_fund: toMoney(row.provident_fund),
        gop_fund: toMoney(row.gop_fund),
        gross_salary: toMoney(row.gross_salary),
        net_salary: toMoney(row.net_salary),
      },
    });
  })
);

router.get(
  "/people/hr/me/overview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found for this user");
    }

    const profile = await getStaffProfileById(req.auth.schoolId, staffProfileId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found for this user");
    }

    const monthRange = safeMonthRange();

    const [attendanceSummary, leaveSummary, salaryResult, adjustmentsResult, payrollHistory, docsResult] = await Promise.all([
      fetchAttendanceSummary({
        schoolId: req.auth.schoolId,
        staffProfileId,
        monthRange,
      }),
      fetchLeaveSummary({
        schoolId: req.auth.schoolId,
        staffProfileId,
        monthRange,
      }),
      pool.query(
        `
          SELECT *
          FROM staff_salary_structures
          WHERE school_id = $1
            AND staff_profile_id = $2
            AND is_active = TRUE
          ORDER BY effective_from DESC, created_at DESC
          LIMIT 1
        `,
        [req.auth.schoolId, staffProfileId]
      ),
      pool.query(
        `
          SELECT
            id,
            adjustment_type,
            amount,
            is_recurring,
            effective_on,
            expires_on,
            reason,
            notes,
            status,
            approved_by_user_id,
            created_at
          FROM staff_salary_adjustments
          WHERE school_id = $1
            AND staff_profile_id = $2
          ORDER BY effective_on DESC, created_at DESC
          LIMIT 20
        `,
        [req.auth.schoolId, staffProfileId]
      ),
      listStaffPayrollRecords({
        schoolId: req.auth.schoolId,
        staffProfileId,
        page: 1,
        pageSize: 24,
      }),
      pool.query(
        `
          SELECT
            id,
            category,
            document_name,
            file_url,
            expires_on,
            is_active,
            created_at
          FROM staff_hr_documents
          WHERE school_id = $1
            AND staff_profile_id = $2
            AND is_active = TRUE
          ORDER BY created_at DESC
          LIMIT 100
        `,
        [req.auth.schoolId, staffProfileId]
      ),
    ]);

    return success(res, {
      profile,
      attendance_summary: attendanceSummary,
      leave_summary: leaveSummary,
      current_salary_structure: salaryResult.rows[0] || null,
      adjustments: adjustmentsResult.rows,
      payroll_history: payrollHistory.rows,
      payroll_pagination: payrollHistory.pagination,
      documents: docsResult.rows,
    });
  })
);

router.get(
  "/people/hr/me/attendance-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(attendanceSummaryQuerySchema, req.query, "Invalid attendance summary query");
    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found for this user");
    }

    const monthRange = safeMonthRange(query.month);
    const attendance = await fetchAttendanceSummary({
      schoolId: req.auth.schoolId,
      staffProfileId,
      monthRange,
    });
    const leave = await fetchLeaveSummary({
      schoolId: req.auth.schoolId,
      staffProfileId,
      monthRange,
    });

    return success(res, {
      attendance,
      leave,
    });
  })
);

router.get(
  "/people/hr/me/payroll-records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseSchema(listQuerySchema, req.query, "Invalid payroll list query");
    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) {
      throw new AppError(404, "NOT_FOUND", "Staff profile not found for this user");
    }

    const records = await listStaffPayrollRecords({
      schoolId: req.auth.schoolId,
      staffProfileId,
      page: query.page,
      pageSize: query.page_size,
    });

    return success(res, records.rows, 200, {
      pagination: records.pagination,
    });
  })
);

router.get(
  "/people/hr/me/payroll-records/:recordId/salary-slip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(payrollRecordPathSchema, req.params, "Invalid payroll record id");
    const query = parseSchema(salarySlipQuerySchema, req.query, "Invalid salary slip query");

    const row = await ensurePayrollRecordVisible({ auth: req.auth, recordId: path.recordId });
    if (row.user_id !== req.auth.userId) {
      throw new AppError(403, "FORBIDDEN", "You can access only your own salary slip");
    }

    auditEvent({
      auth: req.auth,
      action: "finance.payroll.salary_slip.viewed",
      entityName: "payroll_records",
      entityId: row.id,
      metadata: {
        format: query.format,
        viewed_as_self: true,
      },
    });

    if (query.format === "pdf") {
      const columns = [
        { key: "label", label: "Item" },
        { key: "value", label: "Value" },
      ];
      const rows = [
        { label: "Period", value: `${row.period_label} (${row.period_start} to ${row.period_end})` },
        { label: "Base Salary", value: String(toMoney(row.base_salary)) },
        { label: "Allowances", value: String(toMoney(row.allowances_total)) },
        { label: "Bonuses", value: String(toMoney(row.bonus_total)) },
        { label: "Deductions", value: String(toMoney(row.deductions_total)) },
        { label: "Provident Fund", value: String(toMoney(row.provident_fund)) },
        { label: "GOP Fund", value: String(toMoney(row.gop_fund)) },
        { label: "Gross Salary", value: String(toMoney(row.gross_salary)) },
        { label: "Net Salary", value: String(toMoney(row.net_salary)) },
        { label: "Payment Status", value: row.payment_status },
      ];

      const buffer = await buildPdfBuffer({
        title: "Agora Salary Slip",
        subtitle: `${row.period_label}`,
        columns,
        rows,
      });

      const fileName = `agora_my_salary_slip_${row.period_start}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      return res.status(200).send(buffer);
    }

    return success(res, row);
  })
);

// ─── Teacher / Staff Leave Self-Service ─────────────────────────────

const SELF_SERVICE_ROLES = ["teacher", "school_admin", "hr_admin", "principal", "vice_principal", "accountant"];

const selfLeaveRequestSchema = z.object({
  leave_type: z.enum(["casual", "sick", "annual", "maternity", "paternity", "unpaid", "other"]).default("casual"),
  starts_on: z.string().date(),
  ends_on: z.string().date(),
  total_days: z.coerce.number().positive().max(365).optional(),
  reason: z.string().trim().max(2000).optional(),
}).superRefine((data, ctx) => {
  if (data.ends_on < data.starts_on) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ends_on must be on or after starts_on", path: ["ends_on"] });
  }
});

const leaveRequestListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const leaveApprovalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  review_notes: z.string().trim().max(1000).optional(),
});

const leaveRequestPathSchema = z.object({ requestId: z.string().uuid() });

// GET /people/hr/my/leave-balance
router.get(
  "/people/hr/my/leave-balance",
  requireAuth,
  requireRoles(...SELF_SERVICE_ROLES),
  asyncHandler(async (req, res) => {
    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) throw new AppError(404, "NOT_FOUND", "Staff profile not found");

    const result = await pool.query(
      `
        SELECT
          leave_type,
          COUNT(*)::int AS total_requests,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
          COALESCE(SUM(total_days) FILTER (WHERE status = 'approved'), 0)::numeric AS approved_days
        FROM leave_requests
        WHERE school_id = $1 AND staff_profile_id = $2
          AND starts_on >= DATE_TRUNC('year', CURRENT_DATE)
        GROUP BY leave_type
        ORDER BY leave_type
      `,
      [req.auth.schoolId, staffProfileId]
    );
    return success(res, result.rows);
  })
);

// POST /people/hr/my/leave-requests
router.post(
  "/people/hr/my/leave-requests",
  requireAuth,
  requireRoles(...SELF_SERVICE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(selfLeaveRequestSchema, req.body, "Invalid leave request");

    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) throw new AppError(404, "NOT_FOUND", "Staff profile not found");

    // Calculate total days if not provided
    const totalDays = body.total_days || Math.max(1,
      Math.ceil((new Date(body.ends_on) - new Date(body.starts_on)) / (1000 * 60 * 60 * 24)) + 1
    );

    const result = await pool.query(
      `
        INSERT INTO leave_requests (school_id, staff_profile_id, user_id, leave_type, starts_on, ends_on, total_days, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [req.auth.schoolId, staffProfileId, req.auth.userId, body.leave_type, body.starts_on, body.ends_on, totalDays, body.reason || null]
    );

    auditEvent({
      auth: req.auth,
      action: "hr.leave_request.created",
      entityName: "leave_requests",
      entityId: result.rows[0].id,
      metadata: { leave_type: body.leave_type, starts_on: body.starts_on, ends_on: body.ends_on },
    });

    return success(res, result.rows[0], 201);
  })
);

// GET /people/hr/my/leave-requests
router.get(
  "/people/hr/my/leave-requests",
  requireAuth,
  requireRoles(...SELF_SERVICE_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(leaveRequestListQuery, req.query);

    const staffProfileId = await getStaffProfileByUserId(req.auth.schoolId, req.auth.userId);
    if (!staffProfileId) throw new AppError(404, "NOT_FOUND", "Staff profile not found");

    const params = [req.auth.schoolId, staffProfileId];
    const where = ["lr.school_id = $1", "lr.staff_profile_id = $2"];

    if (query.status) { params.push(query.status); where.push(`lr.status = $${params.length}`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leave_requests lr WHERE ${where.join(" AND ")}`, params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT lr.*,
          ru.first_name AS reviewed_by_first_name, ru.last_name AS reviewed_by_last_name
        FROM leave_requests lr
        LEFT JOIN users ru ON ru.id = lr.reviewed_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY lr.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// DELETE /people/hr/my/leave-requests/:requestId
router.delete(
  "/people/hr/my/leave-requests/:requestId",
  requireAuth,
  requireRoles(...SELF_SERVICE_ROLES),
  asyncHandler(async (req, res) => {
    const { requestId } = parseSchema(leaveRequestPathSchema, req.params);

    const result = await pool.query(
      `
        UPDATE leave_requests
        SET status = 'cancelled', updated_at = NOW()
        WHERE school_id = $1 AND id = $2 AND user_id = $3 AND status = 'pending'
        RETURNING id
      `,
      [req.auth.schoolId, requestId, req.auth.userId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Pending leave request not found");
    return success(res, { cancelled: true });
  })
);

// PATCH /people/hr/leave-requests/:requestId/approve
router.patch(
  "/people/hr/leave-requests/:requestId/approve",
  requireAuth,
  requireRoles("school_admin", "hr_admin", "principal"),
  asyncHandler(async (req, res) => {
    const { requestId } = parseSchema(leaveRequestPathSchema, req.params);
    const body = parseSchema(leaveApprovalSchema, req.body, "Invalid approval");

    const result = await pool.query(
      `
        UPDATE leave_requests
        SET status = $3, reviewed_by_user_id = $4, reviewed_at = NOW(),
            review_notes = $5, updated_at = NOW()
        WHERE school_id = $1 AND id = $2 AND status = 'pending'
        RETURNING *
      `,
      [req.auth.schoolId, requestId, body.status, req.auth.userId, body.review_notes || null]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Pending leave request not found");

    auditEvent({
      auth: req.auth,
      action: `hr.leave_request.${body.status}`,
      entityName: "leave_requests",
      entityId: requestId,
      metadata: { status: body.status, review_notes: body.review_notes },
    });

    return success(res, result.rows[0]);
  })
);

module.exports = router;

