const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;

const SCHOOL_ID = "10000000-0000-0000-0000-000000000001";
const STAFF_PROFILE_TEACHER = "b0000000-0000-0000-0000-000000000005";
const STAFF_PROFILE_PRINCIPAL = "b0000000-0000-0000-0000-000000000001";
const USER_ID_ADMIN = "20000000-0000-0000-0000-000000000001";
const USER_ID_TEACHER = "20000000-0000-0000-0000-000000000002";

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
}

async function jsonRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = { raw: text };
  }

  return {
    status: response.status,
    body: data,
    headers: response.headers,
  };
}

async function login(email, password) {
  const response = await jsonRequest("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      school_code: "agora_demo",
      email,
      password,
    }),
  });

  assert.equal(response.status, 200, `Login failed for ${email}: ${JSON.stringify(response.body)}`);
  assert.equal(response.body?.success, true);
  return response.body.data.access_token;
}

function authHeader(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function plusDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDate(value) {
  return value.toISOString().slice(0, 10);
}

function buildPayrollPeriodWindow() {
  const base = new Date();
  // Keep a deterministic but moving window to avoid unique collisions across reruns.
  const start = plusDays(base, -45);
  const end = plusDays(base, -16);
  return {
    start: toDate(start),
    end: toDate(end),
    label: `Payroll-${toDate(start)}-${toDate(end)}`,
  };
}

async function resolvePayrollPeriodIdByRange({ periodStart, periodEnd }) {
  const row = await pool.query(
    `
      SELECT id
      FROM payroll_periods
      WHERE school_id = $1
        AND period_start = $2
        AND period_end = $3
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [SCHOOL_ID, periodStart, periodEnd]
  );
  return row.rows[0]?.id || null;
}

async function waitForAudit(action, entityId, actorUserId, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await pool.query(
      `
        SELECT id
        FROM audit_logs
        WHERE school_id = $1
          AND action = $2
          AND entity_id = $3
          AND actor_user_id = $4
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [SCHOOL_ID, action, entityId, actorUserId]
    );
    if (row.rows[0]) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_hr_payroll_foundation.sql");

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

test("teacher cannot manage salary structures but can use own HR self-service", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const denied = await jsonRequest(
    `/api/v1/people/hr/staff/${STAFF_PROFILE_TEACHER}/salary-structures`,
    {
      method: "POST",
      headers: authHeader(teacherToken),
      body: JSON.stringify({
        effective_from: toDate(plusDays(new Date(), -60)),
        base_salary: 50000,
        allowances: [{ label: "Transport", amount: 3000 }],
        deductions: [],
        bonuses: [],
        provident_fund: 2000,
        gop_fund: 1000,
      }),
    }
  );

  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(denied.body?.error?.code, "FORBIDDEN");

  const selfOverview = await jsonRequest("/api/v1/people/hr/me/overview", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${teacherToken}`,
    },
  });

  assert.equal(selfOverview.status, 200, JSON.stringify(selfOverview.body));
  assert.equal(selfOverview.body?.success, true);
  assert.equal(selfOverview.body?.data?.profile?.user_id, USER_ID_TEACHER);
});

test("school_admin can generate payroll and teacher can only access own payroll records", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const structureTeacher = await jsonRequest(
    `/api/v1/people/hr/staff/${STAFF_PROFILE_TEACHER}/salary-structures`,
    {
      method: "POST",
      headers: authHeader(adminToken),
      body: JSON.stringify({
        effective_from: toDate(plusDays(new Date(), -90)),
        base_salary: 85000,
        allowances: [{ label: "House Rent", amount: 12000 }],
        deductions: [{ label: "Tax", amount: 3000 }],
        bonuses: [{ label: "Performance", amount: 2000 }],
        provident_fund: 2500,
        gop_fund: 1000,
        notes: "Teacher structure seed for payroll",
      }),
    }
  );
  assert.equal(structureTeacher.status, 201, JSON.stringify(structureTeacher.body));

  const structurePrincipal = await jsonRequest(
    `/api/v1/people/hr/staff/${STAFF_PROFILE_PRINCIPAL}/salary-structures`,
    {
      method: "POST",
      headers: authHeader(adminToken),
      body: JSON.stringify({
        effective_from: toDate(plusDays(new Date(), -120)),
        base_salary: 150000,
        allowances: [{ label: "Leadership", amount: 30000 }],
        deductions: [{ label: "Tax", amount: 12000 }],
        bonuses: [],
        provident_fund: 6000,
        gop_fund: 2500,
        notes: "Principal structure seed for payroll",
      }),
    }
  );
  assert.equal(structurePrincipal.status, 201, JSON.stringify(structurePrincipal.body));

  const periodWindow = buildPayrollPeriodWindow();
  const createPeriod = await jsonRequest("/api/v1/people/hr/payroll/periods", {
    method: "POST",
    headers: authHeader(adminToken),
    body: JSON.stringify({
      period_label: periodWindow.label,
      period_start: periodWindow.start,
      period_end: periodWindow.end,
    }),
  });
  assert.ok([201, 409].includes(createPeriod.status), JSON.stringify(createPeriod.body));

  let periodId = createPeriod.body?.data?.id || null;
  if (!periodId) {
    periodId = await resolvePayrollPeriodIdByRange({
      periodStart: periodWindow.start,
      periodEnd: periodWindow.end,
    });
  }
  assert.ok(periodId);

  const generated = await jsonRequest(`/api/v1/people/hr/payroll/periods/${periodId}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.ok(Number(generated.body?.data?.generated_records || 0) >= 2);

  const listRecords = await jsonRequest("/api/v1/people/hr/payroll/records?page=1&page_size=100", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRecords.status, 200, JSON.stringify(listRecords.body));
  assert.equal(listRecords.body?.success, true);
  const records = listRecords.body?.data || [];
  assert.ok(Array.isArray(records));

  const teacherRecord = records.find((row) => row.staff_profile_id === STAFF_PROFILE_TEACHER);
  const principalRecord = records.find((row) => row.staff_profile_id === STAFF_PROFILE_PRINCIPAL);
  assert.ok(teacherRecord, "Expected a payroll record for seeded teacher");
  assert.ok(principalRecord, "Expected a payroll record for seeded principal");

  const teacherSelfRecords = await jsonRequest("/api/v1/people/hr/me/payroll-records?page=1&page_size=50", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${teacherToken}`,
    },
  });
  assert.equal(teacherSelfRecords.status, 200, JSON.stringify(teacherSelfRecords.body));
  const ownIds = (teacherSelfRecords.body?.data || []).map((row) => row.id);
  assert.ok(ownIds.includes(teacherRecord.id), "Teacher self-service should include own payroll record");
  assert.equal(
    ownIds.includes(principalRecord.id),
    false,
    "Teacher self-service must not include another staff payroll record"
  );

  const deniedOtherRecord = await jsonRequest(`/api/v1/people/hr/payroll/records/${principalRecord.id}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${teacherToken}`,
    },
  });
  assert.equal(deniedOtherRecord.status, 403, JSON.stringify(deniedOtherRecord.body));
  assert.equal(deniedOtherRecord.body?.error?.code, "FORBIDDEN");
});

test("payroll payment update is audited", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const listRecords = await jsonRequest("/api/v1/people/hr/payroll/records?page=1&page_size=20", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(listRecords.status, 200, JSON.stringify(listRecords.body));
  const target = (listRecords.body?.data || []).find((row) => row.staff_profile_id === STAFF_PROFILE_TEACHER);
  assert.ok(target, "Expected a teacher payroll record for payment update test");

  const paidOn = toDate(new Date());
  const updatePayment = await jsonRequest(`/api/v1/people/hr/payroll/records/${target.id}/payment`, {
    method: "PATCH",
    headers: authHeader(adminToken),
    body: JSON.stringify({
      payment_status: "paid",
      paid_on: paidOn,
      payment_method: "bank_transfer",
      finance_notes: "Payment released by finance test",
    }),
  });
  assert.equal(updatePayment.status, 200, JSON.stringify(updatePayment.body));
  assert.equal(updatePayment.body?.data?.payment_status, "paid");

  const hasAudit = await waitForAudit(
    "finance.payroll.payment_updated",
    target.id,
    USER_ID_ADMIN
  );
  assert.equal(hasAudit, true, "Expected payroll payment update audit event");
});
