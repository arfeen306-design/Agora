const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;

const SCHOOL_ID = "10000000-0000-0000-0000-000000000001";
const CLASSROOM_ID = "60000000-0000-0000-0000-000000000001";
const ACADEMIC_YEAR_CURRENT = "50000000-0000-0000-0000-000000000001";
const ACADEMIC_YEAR_ALT = "50000000-0000-0000-0000-000000000002";
const STUDENT_1 = "40000000-0000-0000-0000-000000000001";
const STUDENT_2 = "40000000-0000-0000-0000-000000000002";
const STUDENT_3 = "40000000-0000-0000-0000-000000000003";

const FEE_PLAN_ID = "f0000000-0000-0000-0000-000000000001";
const FEE_INVOICE_1 = "f1000000-0000-0000-0000-000000000001";
const FEE_INVOICE_2 = "f1000000-0000-0000-0000-000000000002";
const FEE_INVOICE_3 = "f1000000-0000-0000-0000-000000000003";
const FEE_PAYMENT_1 = "f2000000-0000-0000-0000-000000000001";

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = { raw: text };
  }

  return {
    status: response.status,
    body: data,
    headers: response.headers,
  };
}

async function login(email, password) {
  const result = await jsonRequest("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_code: "agora_demo",
      email,
      password,
    }),
  });

  assert.equal(result.status, 200, `Login failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.access_token;
}

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
}

async function seedPhaseAFixtures() {
  await pool.query(
    `
      INSERT INTO academic_years (
        id,
        school_id,
        name,
        starts_on,
        ends_on,
        is_current
      )
      VALUES ($1, $2, '2026-2027', '2026-08-01', '2027-06-30', FALSE)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        starts_on = EXCLUDED.starts_on,
        ends_on = EXCLUDED.ends_on
    `,
    [ACADEMIC_YEAR_ALT, SCHOOL_ID]
  );

  await pool.query(
    `
      UPDATE academic_years
      SET is_current = CASE WHEN id = $2 THEN TRUE WHEN id = $3 THEN FALSE ELSE is_current END,
          updated_at = NOW()
      WHERE school_id = $1
        AND id IN ($2, $3)
    `,
    [SCHOOL_ID, ACADEMIC_YEAR_CURRENT, ACADEMIC_YEAR_ALT]
  );

  await pool.query(
    `
      INSERT INTO students (
        id,
        school_id,
        student_code,
        first_name,
        last_name,
        admission_date,
        status,
        admission_status
      )
      VALUES ($1, $2, 'STD-003', 'Unlinked', 'Student', '2025-08-01', 'active', 'admitted')
      ON CONFLICT (id)
      DO NOTHING
    `,
    [STUDENT_3, SCHOOL_ID]
  );

  await pool.query(
    `
      INSERT INTO student_enrollments (
        school_id,
        student_id,
        classroom_id,
        academic_year_id,
        roll_no,
        status,
        joined_on
      )
      VALUES ($1, $2, $3, $4, 3, 'active', '2025-08-01')
      ON CONFLICT (school_id, student_id, academic_year_id)
      DO NOTHING
    `,
    [SCHOOL_ID, STUDENT_3, CLASSROOM_ID, ACADEMIC_YEAR_CURRENT]
  );

  await pool.query(
    `
      INSERT INTO fee_plans (
        id,
        school_id,
        academic_year_id,
        classroom_id,
        title,
        amount,
        due_day,
        is_active
      )
      VALUES ($1, $2, $3, $4, 'Standard Monthly Plan', 12000, 10, TRUE)
      ON CONFLICT (id)
      DO UPDATE SET
        title = EXCLUDED.title,
        amount = EXCLUDED.amount,
        due_day = EXCLUDED.due_day,
        is_active = EXCLUDED.is_active
    `,
    [FEE_PLAN_ID, SCHOOL_ID, ACADEMIC_YEAR_CURRENT, CLASSROOM_ID]
  );

  await pool.query(
    `
      INSERT INTO fee_invoices (
        id,
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
      VALUES
        (
          $1,
          $4,
          $5,
          $8,
          CURRENT_DATE - INTERVAL '35 days',
          CURRENT_DATE - INTERVAL '5 days',
          12000,
          4000,
          CURRENT_DATE - INTERVAL '7 days',
          'partial'
        ),
        (
          $2,
          $4,
          $6,
          $8,
          CURRENT_DATE - INTERVAL '35 days',
          CURRENT_DATE - INTERVAL '5 days',
          12000,
          12000,
          CURRENT_DATE - INTERVAL '6 days',
          'paid'
        ),
        (
          $3,
          $4,
          $7,
          $8,
          CURRENT_DATE - INTERVAL '35 days',
          CURRENT_DATE - INTERVAL '5 days',
          12000,
          0,
          CURRENT_DATE - INTERVAL '12 days',
          'overdue'
        )
      ON CONFLICT (id)
      DO UPDATE SET
        amount_due = EXCLUDED.amount_due,
        amount_paid = EXCLUDED.amount_paid,
        due_date = EXCLUDED.due_date,
        status = EXCLUDED.status
    `,
    [FEE_INVOICE_1, FEE_INVOICE_2, FEE_INVOICE_3, SCHOOL_ID, STUDENT_1, STUDENT_2, STUDENT_3, FEE_PLAN_ID]
  );

  await pool.query(
    `
      INSERT INTO fee_payments (
        id,
        school_id,
        invoice_id,
        amount,
        payment_date,
        method,
        reference_no,
        received_by_user_id,
        notes
      )
      VALUES (
        $1,
        $2,
        $3,
        4000,
        CURRENT_DATE - INTERVAL '10 days',
        'bank',
        'BANK-REF-001',
        '20000000-0000-0000-0000-000000000001',
        'Seeded payment'
      )
      ON CONFLICT (id)
      DO UPDATE SET
        reference_no = EXCLUDED.reference_no,
        amount = EXCLUDED.amount
    `,
    [FEE_PAYMENT_1, SCHOOL_ID, FEE_INVOICE_1]
  );
}

async function waitForAuditAction(action, entityId, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await pool.query(
      `
        SELECT id
        FROM audit_logs
        WHERE school_id = $1
          AND action = $2
          AND entity_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [SCHOOL_ID, action, entityId]
    );
    if (row.rows[0]) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function getUserIdByEmail(email) {
  const result = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
    `,
    [SCHOOL_ID, email]
  );
  return result.rows[0]?.id || null;
}

async function waitForAuditActionByActor(action, actorUserId, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await pool.query(
      `
        SELECT id
        FROM audit_logs
        WHERE school_id = $1
          AND action = $2
          AND actor_user_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [SCHOOL_ID, action, actorUserId]
    );
    if (row.rows[0]) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await seedPhaseAFixtures();

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("fees role matrix is enforced and parent invoices stay scoped", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const accountantToken = await login("accountant@agora.com", "accounts123");
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const parentToken = await login("parent1@agora.com", "pass123");

  const principalPlans = await jsonRequest("/api/v1/fees/plans?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalPlans.status, 200, JSON.stringify(principalPlans.body));

  const vicePlans = await jsonRequest("/api/v1/fees/plans?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(vicePlans.status, 200, JSON.stringify(vicePlans.body));

  const teacherPlans = await jsonRequest("/api/v1/fees/plans?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherPlans.status, 403);

  const principalCannotCreate = await jsonRequest("/api/v1/fees/plans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      academic_year_id: ACADEMIC_YEAR_CURRENT,
      classroom_id: CLASSROOM_ID,
      title: "Principal Should Not Create",
      amount: 10000,
      due_day: 15,
      is_active: true,
    }),
  });
  assert.equal(principalCannotCreate.status, 403);

  const accountantPlan = await jsonRequest("/api/v1/fees/plans", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      academic_year_id: ACADEMIC_YEAR_CURRENT,
      classroom_id: CLASSROOM_ID,
      title: `Accountant Plan ${crypto.randomUUID().slice(0, 6)}`,
      amount: 9500,
      due_day: 12,
      is_active: true,
    }),
  });
  assert.equal(accountantPlan.status, 201, JSON.stringify(accountantPlan.body));

  const parentInvoices = await jsonRequest("/api/v1/fees/invoices?page=1&page_size=50", {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentInvoices.status, 200, JSON.stringify(parentInvoices.body));
  assert.ok(Array.isArray(parentInvoices.body?.data));
  assert.ok(
    parentInvoices.body.data.every(
      (row) => row.student_id === STUDENT_1 || row.student_id === STUDENT_2
    ),
    "Parent invoice list leaked an unlinked student"
  );

  const viceInvoices = await jsonRequest("/api/v1/fees/invoices?page=1&page_size=50", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(viceInvoices.status, 200, JSON.stringify(viceInvoices.body));

  const viceInvoicesByAcademicYear = await jsonRequest(
    `/api/v1/fees/invoices?page=1&page_size=50&academic_year_id=${ACADEMIC_YEAR_CURRENT}`,
    {
      headers: { Authorization: `Bearer ${viceToken}` },
    }
  );
  assert.equal(viceInvoicesByAcademicYear.status, 200, JSON.stringify(viceInvoicesByAcademicYear.body));

  const invalidInvoiceListRange = await jsonRequest(
    "/api/v1/fees/invoices?page=1&page_size=20&date_from=2026-03-10&date_to=2026-03-01",
    {
      headers: { Authorization: `Bearer ${viceToken}` },
    }
  );
  assert.equal(invalidInvoiceListRange.status, 422, JSON.stringify(invalidInvoiceListRange.body));

  const invalidInvoiceRange = await jsonRequest("/api/v1/fees/invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      fee_plan_id: FEE_PLAN_ID,
      period_start: "2026-02-01",
      period_end: "2026-01-31",
      amount_due: 12000,
      due_date: "2026-03-25",
      status: "issued",
    }),
  });
  assert.equal(invalidInvoiceRange.status, 422, JSON.stringify(invalidInvoiceRange.body));

  const createdInvoice = await jsonRequest("/api/v1/fees/invoices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      student_id: STUDENT_1,
      fee_plan_id: FEE_PLAN_ID,
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      amount_due: 12000,
      due_date: "2026-03-25",
      status: "issued",
    }),
  });
  assert.equal(createdInvoice.status, 201, JSON.stringify(createdInvoice.body));
  const invoiceId = createdInvoice.body.data.id;

  const payment = await jsonRequest(`/api/v1/fees/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      amount: 1500,
      payment_date: "2026-03-01",
      method: "bank",
      reference_no: "BANK-XYZ-998",
      notes: "Partial payment",
    }),
  });
  assert.equal(payment.status, 201, JSON.stringify(payment.body));
  assert.equal(
    await waitForAuditAction("finance.payment.recorded", payment.body?.data?.id),
    true
  );

  const overPayment = await jsonRequest(`/api/v1/fees/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountantToken}`,
    },
    body: JSON.stringify({
      amount: 20000,
      payment_date: "2026-03-02",
      method: "bank",
      reference_no: "BANK-OVER-001",
      notes: "Should fail because amount exceeds remaining balance",
    }),
  });
  assert.equal(overPayment.status, 422, JSON.stringify(overPayment.body));
  assert.equal(overPayment.body?.error?.code, "VALIDATION_ERROR");

  const principalPayments = await jsonRequest(`/api/v1/fees/invoices/${invoiceId}/payments`, {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalPayments.status, 200, JSON.stringify(principalPayments.body));
  assert.equal(principalPayments.body.data[0]?.reference_no, null);

  const accountantPayments = await jsonRequest(`/api/v1/fees/invoices/${invoiceId}/payments`, {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantPayments.status, 200, JSON.stringify(accountantPayments.body));
  assert.equal(accountantPayments.body.data[0]?.reference_no, "BANK-XYZ-998");
});

test("fees summary and defaulters endpoints enforce leadership and finance visibility", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const accountantToken = await login("accountant@agora.com", "accounts123");
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const principalSummary = await jsonRequest("/api/v1/fees/summary", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalSummary.status, 200, JSON.stringify(principalSummary.body));
  assert.equal(typeof principalSummary.body?.data?.totals?.defaulter_students, "number");

  const accountantSummary = await jsonRequest("/api/v1/fees/summary", {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantSummary.status, 200, JSON.stringify(accountantSummary.body));

  const viceSummary = await jsonRequest("/api/v1/fees/summary", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(viceSummary.status, 200, JSON.stringify(viceSummary.body));

  const invalidSummaryDateRange = await jsonRequest(
    "/api/v1/fees/summary?date_from=2026-03-10&date_to=2026-03-01",
    {
      headers: { Authorization: `Bearer ${accountantToken}` },
    }
  );
  assert.equal(invalidSummaryDateRange.status, 422, JSON.stringify(invalidSummaryDateRange.body));

  const defaulters = await jsonRequest("/api/v1/fees/defaulters?page=1&page_size=50", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(defaulters.status, 200, JSON.stringify(defaulters.body));
  assert.ok(
    defaulters.body.data.some((row) => row.student_id === STUDENT_3),
    "Expected unlinked student with overdue invoices in defaulters list"
  );

  const teacherDenied = await jsonRequest("/api/v1/fees/defaulters", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherDenied.status, 403);
});

test("reports role matrix and scoping rules are aligned", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const hmToken = await login("hm.middle@agora.com", "hm123");
  const accountantToken = await login("accountant@agora.com", "accounts123");
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const parentToken = await login("parent1@agora.com", "pass123");
  const principalUserId = await getUserIdByEmail("principal@agora.com");
  assert.ok(principalUserId);

  const principalAttendance = await jsonRequest("/api/v1/reports/attendance/summary", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalAttendance.status, 200, JSON.stringify(principalAttendance.body));

  const viceAttendance = await jsonRequest("/api/v1/reports/attendance/summary", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(viceAttendance.status, 200, JSON.stringify(viceAttendance.body));

  const hmAttendance = await jsonRequest("/api/v1/reports/attendance/summary", {
    headers: { Authorization: `Bearer ${hmToken}` },
  });
  assert.equal(hmAttendance.status, 200, JSON.stringify(hmAttendance.body));

  const accountantDeniedAcademic = await jsonRequest("/api/v1/reports/attendance/summary", {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantDeniedAcademic.status, 403);

  const accountantFees = await jsonRequest("/api/v1/reports/fees/summary", {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantFees.status, 200, JSON.stringify(accountantFees.body));

  const teacherFeesDenied = await jsonRequest("/api/v1/reports/fees/summary", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherFeesDenied.status, 403);

  const principalFeesExport = await fetch(`${baseUrl}/api/v1/reports/fees/export?format=csv`, {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalFeesExport.status, 200);
  assert.match(principalFeesExport.headers.get("content-type") || "", /text\/csv/);
  assert.equal(await waitForAuditActionByActor("reports.data.exported", principalUserId), true);

  const accountantFeesExport = await fetch(`${baseUrl}/api/v1/reports/fees/export?format=csv`, {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantFeesExport.status, 200);
  assert.match(accountantFeesExport.headers.get("content-type") || "", /text\/csv/);

  const parentAcademic = await jsonRequest("/api/v1/reports/homework/summary", {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentAcademic.status, 200, JSON.stringify(parentAcademic.body));

  const principalExecutiveOverview = await jsonRequest("/api/v1/reports/executive/overview", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalExecutiveOverview.status, 200, JSON.stringify(principalExecutiveOverview.body));
  assert.ok(principalExecutiveOverview.body?.data?.kpis);

  const principalExecutiveFiltered = await jsonRequest(
    `/api/v1/reports/executive/overview?academic_year_id=${ACADEMIC_YEAR_CURRENT}&date_from=2025-08-01&date_to=2026-12-31&trend_points=8`,
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(principalExecutiveFiltered.status, 200, JSON.stringify(principalExecutiveFiltered.body));
  assert.equal(principalExecutiveFiltered.body?.data?.window?.date_from, "2025-08-01");
  assert.equal(principalExecutiveFiltered.body?.data?.window?.date_to, "2026-12-31");

  const invalidExecutiveRange = await jsonRequest(
    "/api/v1/reports/executive/overview?date_from=2026-12-31&date_to=2026-01-01",
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(invalidExecutiveRange.status, 422, JSON.stringify(invalidExecutiveRange.body));

  const teacherExecutiveDenied = await jsonRequest("/api/v1/reports/executive/overview", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherExecutiveDenied.status, 403, JSON.stringify(teacherExecutiveDenied.body));
});

test("marks endpoints allow leadership read access with role scoping", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const hmToken = await login("hm.middle@agora.com", "hm123");
  const accountantToken = await login("accountant@agora.com", "accounts123");

  const principalAssessments = await jsonRequest("/api/v1/assessments?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalAssessments.status, 200, JSON.stringify(principalAssessments.body));

  const viceAssessments = await jsonRequest("/api/v1/assessments?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(viceAssessments.status, 200, JSON.stringify(viceAssessments.body));

  const hmAssessments = await jsonRequest("/api/v1/assessments?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${hmToken}` },
  });
  assert.equal(hmAssessments.status, 200, JSON.stringify(hmAssessments.body));

  const principalStudentSummary = await jsonRequest(`/api/v1/students/${STUDENT_1}/marks/summary`, {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalStudentSummary.status, 200, JSON.stringify(principalStudentSummary.body));

  const hmStudentSummary = await jsonRequest(`/api/v1/students/${STUDENT_1}/marks/summary`, {
    headers: { Authorization: `Bearer ${hmToken}` },
  });
  assert.equal(hmStudentSummary.status, 200, JSON.stringify(hmStudentSummary.body));

  const accountantDenied = await jsonRequest("/api/v1/assessments?page=1&page_size=20", {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantDenied.status, 403);
});

test("people detail endpoints, parent CRUD, timeline, and academic summary work with scoping", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const principalToken = await login("principal@agora.com", "principal123");
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const parentToken = await login("parent1@agora.com", "pass123");
  const studentToken = await login("student1@agora.com", "student123");

  const staffDetail = await jsonRequest("/api/v1/people/staff/b0000000-0000-0000-0000-000000000005", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(staffDetail.status, 200, JSON.stringify(staffDetail.body));
  assert.equal(staffDetail.body?.data?.staff_code, "EMP-TC-001");

  const studentDetail = await jsonRequest(`/api/v1/people/students/${STUDENT_1}`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(studentDetail.status, 200, JSON.stringify(studentDetail.body));
  assert.ok(typeof studentDetail.body?.data?.student?.student_code === "string");
  assert.match(studentDetail.body?.data?.student?.student_code, /^STD-/);

  const parentCannotSeeUnlinkedStudent = await jsonRequest(`/api/v1/people/students/${STUDENT_3}`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentCannotSeeUnlinkedStudent.status, 403);

  const newParentEmail = `phasea.parent.${crypto.randomUUID().slice(0, 8)}@agora.com`;
  const randomPhone = `+9230${Math.floor(10000000 + Math.random() * 90000000)}`;
  const createdParent = await jsonRequest("/api/v1/people/parents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      first_name: "PhaseA",
      last_name: "Guardian",
      email: newParentEmail,
      phone: randomPhone,
      temporary_password: "Guardian123!",
      guardian_name: "PhaseA Guardian",
      father_name: "PhaseA Father",
      mother_name: "PhaseA Mother",
      whatsapp_number: randomPhone,
      address_line: "Model Town Lahore",
      linked_students: [
        {
          student_id: STUDENT_1,
          relation_type: "father",
          is_primary: true,
        },
      ],
    }),
  });
  assert.equal(createdParent.status, 201, JSON.stringify(createdParent.body));
  const parentId = createdParent.body.data.id;
  assert.equal(await waitForAuditAction("people.parent.created", parentId), true);

  const parentList = await jsonRequest("/api/v1/people/parents?search=PhaseA&page=1&page_size=10", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(parentList.status, 200, JSON.stringify(parentList.body));
  assert.ok(parentList.body.data.some((row) => row.id === parentId));

  const parentProfile = await jsonRequest(`/api/v1/people/parents/${parentId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(parentProfile.status, 200, JSON.stringify(parentProfile.body));
  assert.equal(parentProfile.body?.data?.linked_students?.length, 1);

  const updatedParent = await jsonRequest(`/api/v1/people/parents/${parentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      guardian_name: "PhaseA Guardian Updated",
      linked_students: [
        {
          student_id: STUDENT_2,
          relation_type: "guardian",
          is_primary: true,
        },
      ],
    }),
  });
  assert.equal(updatedParent.status, 200, JSON.stringify(updatedParent.body));
  assert.equal(updatedParent.body?.data?.guardian_name, "PhaseA Guardian Updated");
  assert.equal(await waitForAuditAction("people.parent.updated", parentId), true);

  const timeline = await jsonRequest(`/api/v1/people/students/${STUDENT_1}/timeline`, {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(timeline.status, 200, JSON.stringify(timeline.body));
  assert.ok(Array.isArray(timeline.body?.data?.events));

  const studentSummary = await jsonRequest(`/api/v1/people/students/${STUDENT_1}/academic-summary`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentSummary.status, 200, JSON.stringify(studentSummary.body));
  assert.ok(studentSummary.body?.data?.fee_summary);

  const teacherSummary = await jsonRequest(`/api/v1/people/students/${STUDENT_1}/academic-summary`, {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherSummary.status, 200, JSON.stringify(teacherSummary.body));
  assert.equal(teacherSummary.body?.data?.fee_summary, null);

  const parentLinkedStudents = await jsonRequest("/api/v1/people/me/students", {
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentLinkedStudents.status, 200, JSON.stringify(parentLinkedStudents.body));
  assert.ok(Array.isArray(parentLinkedStudents.body?.data));
  assert.ok(parentLinkedStudents.body.data.some((row) => row.id === STUDENT_1));
  assert.ok(parentLinkedStudents.body.data.every((row) => typeof row.full_name === "string"));

  const studentSelfLinked = await jsonRequest("/api/v1/people/me/students", {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentSelfLinked.status, 200, JSON.stringify(studentSelfLinked.body));
  assert.ok(Array.isArray(studentSelfLinked.body?.data));
  assert.ok(studentSelfLinked.body.data.length >= 1);
  assert.ok(studentSelfLinked.body.data.some((row) => row.id === STUDENT_1));

  const teacherSelfLinkedDenied = await jsonRequest("/api/v1/people/me/students", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherSelfLinkedDenied.status, 403, JSON.stringify(teacherSelfLinkedDenied.body));
});

test("academic year activation keeps exactly one current year and is audited", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const activate = await jsonRequest(`/api/v1/institution/academic-years/${ACADEMIC_YEAR_ALT}/activate`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(activate.status, 200, JSON.stringify(activate.body));
  assert.equal(activate.body?.data?.activated?.id, ACADEMIC_YEAR_ALT);
  assert.equal(activate.body?.data?.activated?.is_current, true);

  const current = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND is_current = TRUE
      ORDER BY updated_at DESC
    `,
    [SCHOOL_ID]
  );
  assert.equal(current.rowCount, 1);
  assert.equal(current.rows[0].id, ACADEMIC_YEAR_ALT);

  const audited = await waitForAuditAction("institution.academic_year.activated", ACADEMIC_YEAR_ALT);
  assert.equal(audited, true);

  const restore = await jsonRequest(
    `/api/v1/institution/academic-years/${ACADEMIC_YEAR_CURRENT}/activate`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  assert.equal(restore.status, 200, JSON.stringify(restore.body));
});

test("tenant safety holds for people student profile detail", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  await pool.query(
    `
      INSERT INTO schools (id, code, name, timezone, is_active)
      VALUES ('10000000-0000-0000-0000-000000000099', 'agora_other', 'Other School', 'Asia/Karachi', TRUE)
      ON CONFLICT (id) DO NOTHING
    `
  );
  await pool.query(
    `
      INSERT INTO students (
        id,
        school_id,
        student_code,
        first_name,
        last_name,
        status
      )
      VALUES (
        '40000000-0000-0000-0000-000000009999',
        '10000000-0000-0000-0000-000000000099',
        'OTHER-001',
        'Other',
        'Tenant',
        'active'
      )
      ON CONFLICT (id) DO NOTHING
    `
  );

  const crossSchool = await jsonRequest("/api/v1/people/students/40000000-0000-0000-0000-000000009999", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(crossSchool.status, 404);
});
