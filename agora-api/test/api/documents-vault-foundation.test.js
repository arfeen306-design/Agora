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
const STUDENT_ID_ONE = "40000000-0000-0000-0000-000000000001";
const STUDENT_ID_TWO = "40000000-0000-0000-0000-000000000002";
const STAFF_PROFILE_ID = "b0000000-0000-0000-0000-000000000005";
const ACADEMIC_YEAR_ID = "50000000-0000-0000-0000-000000000001";
const FEE_PLAN_ID = "f0000000-0000-0000-0000-000000000901";
const FEE_INVOICE_ID = "f1000000-0000-0000-0000-000000000901";
const ADMISSION_APPLICATION_ID = "aa000000-0000-0000-0000-000000000901";

const USER_ID_ACCOUNTANT = "20000000-0000-0000-0000-000000000008";

function buildFileKey(ext = "pdf") {
  return `${SCHOOL_ID}/documents/${crypto.randomUUID()}.${ext}`;
}

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
  return response.body.data.access_token;
}

function authJson(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function seedDocumentScopeFixtures() {
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
      VALUES ($1, $2, $3, $4, 'Document Fee Plan', 10000, 10, TRUE)
      ON CONFLICT (id)
      DO UPDATE SET
        title = EXCLUDED.title,
        amount = EXCLUDED.amount,
        due_day = EXCLUDED.due_day,
        is_active = EXCLUDED.is_active
    `,
    [FEE_PLAN_ID, SCHOOL_ID, ACADEMIC_YEAR_ID, CLASSROOM_ID]
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        CURRENT_DATE - INTERVAL '35 days',
        CURRENT_DATE - INTERVAL '5 days',
        10000,
        0,
        CURRENT_DATE + INTERVAL '7 days',
        'issued'
      )
      ON CONFLICT (id)
      DO UPDATE SET
        amount_due = EXCLUDED.amount_due,
        amount_paid = EXCLUDED.amount_paid,
        due_date = EXCLUDED.due_date,
        status = EXCLUDED.status
    `,
    [FEE_INVOICE_ID, SCHOOL_ID, STUDENT_ID_ONE, FEE_PLAN_ID]
  );

  await pool.query(
    `
      INSERT INTO admission_applications (
        id,
        school_id,
        student_id,
        created_by_user_id,
        desired_grade_label,
        desired_section_label,
        desired_classroom_id,
        desired_academic_year_id,
        guardian_name,
        guardian_phone,
        guardian_email,
        current_status
      )
      VALUES (
        $1,
        $2,
        $3,
        '20000000-0000-0000-0000-000000000009',
        'Grade 7',
        'A',
        $4,
        $5,
        'Demo Guardian',
        '+923001234567',
        'guardian.documents@example.com',
        'applied'
      )
      ON CONFLICT (school_id, student_id)
      DO UPDATE SET
        desired_grade_label = EXCLUDED.desired_grade_label,
        desired_section_label = EXCLUDED.desired_section_label,
        desired_classroom_id = EXCLUDED.desired_classroom_id,
        desired_academic_year_id = EXCLUDED.desired_academic_year_id,
        guardian_name = EXCLUDED.guardian_name,
        guardian_phone = EXCLUDED.guardian_phone,
        guardian_email = EXCLUDED.guardian_email,
        current_status = EXCLUDED.current_status
    `,
    [ADMISSION_APPLICATION_ID, SCHOOL_ID, STUDENT_ID_TWO, CLASSROOM_ID, ACADEMIC_YEAR_ID]
  );
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_admissions_foundation.sql");
  await runSqlFile("database/migrations/20260308_document_vault_foundation.sql");
  await seedDocumentScopeFixtures();

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

test("teacher classroom document flow supports create/read/update/version and is audited", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const principalToken = await login("principal@agora.com", "principal123");

  const createResponse = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(teacherToken),
    body: JSON.stringify({
      title: "Grade 7 worksheet",
      description: "Classroom worksheet handout",
      file_key: buildFileKey(),
      file_name: "worksheet-week-2.pdf",
      file_size_bytes: 4096,
      mime_type: "application/pdf",
      category: "student_document",
      scope_type: "classroom",
      scope_id: CLASSROOM_ID,
      metadata: {
        subject: "Math",
      },
      access_rules: [{ access_type: "role", role_code: "teacher", can_view: true, can_download: true }],
    }),
  });

  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  const documentId = createResponse.body?.data?.id;
  assert.ok(documentId);

  const teacherGet = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherGet.status, 200, JSON.stringify(teacherGet.body));
  assert.equal(teacherGet.body?.data?.id, documentId);

  const updateResponse = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "PATCH",
    headers: authJson(principalToken),
    body: JSON.stringify({
      title: "Grade 7 worksheet (updated)",
      metadata: {
        subject: "Math",
        revision: 2,
      },
    }),
  });
  assert.equal(updateResponse.status, 200, JSON.stringify(updateResponse.body));
  assert.equal(updateResponse.body?.data?.title, "Grade 7 worksheet (updated)");

  const versionResponse = await jsonRequest(`/api/v1/documents/${documentId}/versions`, {
    method: "POST",
    headers: authJson(teacherToken),
    body: JSON.stringify({
      file_key: buildFileKey(),
      file_name: "worksheet-week-2-v2.pdf",
      file_size_bytes: 5120,
      mime_type: "application/pdf",
    }),
  });
  assert.equal(versionResponse.status, 201, JSON.stringify(versionResponse.body));
  assert.equal(versionResponse.body?.data?.version_no, 2);

  const detailAfterVersion = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(detailAfterVersion.status, 200, JSON.stringify(detailAfterVersion.body));
  assert.ok(Array.isArray(detailAfterVersion.body?.data?.versions));
  assert.equal(detailAfterVersion.body.data.versions[0]?.version_no, 2);
});

test("finance document visibility is role-scoped and download-url issuance is audited", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const accountantToken = await login("accountant@agora.com", "accounts123");

  const createResponse = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Fee receipt archive",
      description: "March receipts batch",
      file_key: buildFileKey(),
      file_name: "fees-march.csv",
      file_size_bytes: 2450,
      mime_type: "text/csv",
      category: "fee_receipt",
      scope_type: "finance",
      scope_id: FEE_INVOICE_ID,
      metadata: {
        month: "2026-03",
      },
      access_rules: [],
    }),
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  const documentId = createResponse.body?.data?.id;

  const teacherDenied = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherDenied.status, 403, JSON.stringify(teacherDenied.body));
  assert.equal(teacherDenied.body?.error?.code, "FORBIDDEN");

  const accountantAllowed = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantAllowed.status, 200, JSON.stringify(accountantAllowed.body));

  const downloadResponse = await jsonRequest(`/api/v1/documents/${documentId}/download-url`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(downloadResponse.status, 200, JSON.stringify(downloadResponse.body));
  assert.equal(downloadResponse.body?.data?.document_id, documentId);
  assert.ok(downloadResponse.body?.data?.download?.url);

  const events = await pool.query(
    `
      SELECT id
      FROM document_download_events
      WHERE school_id = $1
        AND document_id = $2
        AND downloaded_by_user_id = $3
      LIMIT 1
    `,
    [SCHOOL_ID, documentId, USER_ID_ACCOUNTANT]
  );
  assert.ok(events.rows[0]);
});

test("document listing supports category filter and include_archived toggle", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const createResponse = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Offer letter",
      description: "HR onboarding letter",
      file_key: buildFileKey("docx"),
      file_name: "offer-letter.docx",
      file_size_bytes: 3072,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      category: "appointment_letter",
      scope_type: "staff",
      scope_id: "b0000000-0000-0000-0000-000000000005",
      metadata: {},
      access_rules: [{ access_type: "role", role_code: "hr_admin", can_view: true, can_download: true }],
    }),
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  const documentId = createResponse.body?.data?.id;

  const filteredList = await jsonRequest("/api/v1/documents?category=appointment_letter&page=1&page_size=10", {
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(filteredList.status, 200, JSON.stringify(filteredList.body));
  assert.equal(filteredList.body?.success, true);
  assert.ok(Array.isArray(filteredList.body?.data));
  assert.ok(
    filteredList.body.data.some((item) => item.id === documentId),
    "Created document should appear in appointment_letter filter"
  );
  assert.ok(filteredList.body?.meta?.pagination);

  const archiveResponse = await jsonRequest(`/api/v1/documents/${documentId}`, {
    method: "PATCH",
    headers: authJson(adminToken),
    body: JSON.stringify({
      is_archived: true,
    }),
  });
  assert.equal(archiveResponse.status, 200, JSON.stringify(archiveResponse.body));
  assert.equal(archiveResponse.body?.data?.is_archived, true);

  const defaultList = await jsonRequest("/api/v1/documents?category=appointment_letter&page=1&page_size=10", {
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(defaultList.status, 200, JSON.stringify(defaultList.body));
  assert.equal(
    defaultList.body.data.some((item) => item.id === documentId),
    false,
    "Archived doc should be hidden by default"
  );

  const archivedList = await jsonRequest(
    "/api/v1/documents?category=appointment_letter&include_archived=true&page=1&page_size=10",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  assert.equal(archivedList.status, 200, JSON.stringify(archivedList.body));
  assert.equal(
    archivedList.body.data.some((item) => item.id === documentId),
    true,
    "Archived doc should appear with include_archived=true"
  );
});

test("student document endpoint enforces scope and leadership-only access rule updates", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const principalToken = await login("principal@agora.com", "principal123");
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const parentToken = await login("parent1@agora.com", "pass123");
  const studentToken = await login("student1@agora.com", "student123");

  const createResponse = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Midterm report card",
      description: "Student report card copy",
      file_key: buildFileKey("pdf"),
      file_name: "report-card.pdf",
      file_size_bytes: 2048,
      mime_type: "application/pdf",
      category: "report_card",
      scope_type: "student",
      scope_id: STUDENT_ID_ONE,
      metadata: {
        term: "midterm",
      },
      access_rules: [{ access_type: "role", role_code: "parent", can_view: true, can_download: true }],
    }),
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  const documentId = createResponse.body?.data?.id;
  assert.ok(documentId);

  const parentStudentDocs = await jsonRequest(`/api/v1/documents/student/${STUDENT_ID_ONE}?page=1&page_size=10`, {
    method: "GET",
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentStudentDocs.status, 200, JSON.stringify(parentStudentDocs.body));
  assert.ok(parentStudentDocs.body?.data?.some((row) => row.id === documentId));

  const studentForbidden = await jsonRequest(`/api/v1/documents/student/${STUDENT_ID_TWO}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentForbidden.status, 403, JSON.stringify(studentForbidden.body));

  const teacherAccessDenied = await jsonRequest(`/api/v1/documents/${documentId}/access`, {
    method: "POST",
    headers: authJson(teacherToken),
    body: JSON.stringify({
      access_rules: [{ access_type: "role", role_code: "teacher", can_view: true, can_download: true }],
    }),
  });
  assert.equal(teacherAccessDenied.status, 403, JSON.stringify(teacherAccessDenied.body));

  const principalAccessUpdate = await jsonRequest(`/api/v1/documents/${documentId}/access`, {
    method: "POST",
    headers: authJson(principalToken),
    body: JSON.stringify({
      access_rules: [{ access_type: "role", role_code: "student", can_view: true, can_download: false }],
    }),
  });
  assert.equal(principalAccessUpdate.status, 200, JSON.stringify(principalAccessUpdate.body));
  assert.equal(principalAccessUpdate.body?.data?.document_id, documentId);
  assert.equal(principalAccessUpdate.body?.data?.access_rules?.[0]?.role_code, "student");

  const archiveResponse = await jsonRequest(`/api/v1/documents/${documentId}/archive`, {
    method: "PATCH",
    headers: authJson(principalToken),
    body: JSON.stringify({ is_archived: true }),
  });
  assert.equal(archiveResponse.status, 200, JSON.stringify(archiveResponse.body));
  assert.equal(archiveResponse.body?.data?.is_archived, true);

  const defaultListAfterArchive = await jsonRequest(`/api/v1/documents/student/${STUDENT_ID_ONE}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(defaultListAfterArchive.status, 200, JSON.stringify(defaultListAfterArchive.body));
  assert.equal(defaultListAfterArchive.body?.data?.some((row) => row.id === documentId), false);

  const includeArchivedList = await jsonRequest(
    `/api/v1/documents/student/${STUDENT_ID_ONE}?include_archived=true&page=1&page_size=10`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(includeArchivedList.status, 200, JSON.stringify(includeArchivedList.body));
  assert.equal(includeArchivedList.body?.data?.some((row) => row.id === documentId), true);
});

test("document category rules and owner-linking block invalid scope usage", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const wrongCategoryScope = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Invalid appointment mapping",
      file_key: buildFileKey("pdf"),
      file_name: "invalid-appointment.pdf",
      file_size_bytes: 2000,
      mime_type: "application/pdf",
      category: "appointment_letter",
      scope_type: "student",
      scope_id: STUDENT_ID_ONE,
      access_rules: [],
    }),
  });
  assert.equal(wrongCategoryScope.status, 422, JSON.stringify(wrongCategoryScope.body));
  assert.equal(wrongCategoryScope.body?.error?.code, "VALIDATION_ERROR");

  const invalidFinanceOwner = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Invalid finance owner",
      file_key: buildFileKey("csv"),
      file_name: "invalid-finance.csv",
      file_size_bytes: 2000,
      mime_type: "text/csv",
      category: "fee_receipt",
      scope_type: "finance",
      scope_id: crypto.randomUUID(),
      access_rules: [],
    }),
  });
  assert.equal(invalidFinanceOwner.status, 422, JSON.stringify(invalidFinanceOwner.body));
  assert.equal(invalidFinanceOwner.body?.error?.code, "VALIDATION_ERROR");

  const admissionDocument = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Admission checklist",
      file_key: buildFileKey("pdf"),
      file_name: "admission-checklist.pdf",
      file_size_bytes: 2100,
      mime_type: "application/pdf",
      category: "admission_form",
      scope_type: "admission",
      scope_id: ADMISSION_APPLICATION_ID,
      access_rules: [],
    }),
  });
  assert.equal(admissionDocument.status, 201, JSON.stringify(admissionDocument.body));
});

test("owner scoped list and report endpoints provide expiry/download tracking", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const principalToken = await login("principal@agora.com", "principal123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");
  const accountantToken = await login("accountant@agora.com", "accounts123");

  const createStaffDoc = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Teacher appointment order",
      file_key: buildFileKey("pdf"),
      file_name: "appointment-order.pdf",
      file_size_bytes: 3200,
      mime_type: "application/pdf",
      category: "appointment_letter",
      scope_type: "staff",
      scope_id: STAFF_PROFILE_ID,
      expires_on: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      access_rules: [],
    }),
  });
  assert.equal(createStaffDoc.status, 201, JSON.stringify(createStaffDoc.body));

  const createAdmissionDoc = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "Applicant CNIC",
      file_key: buildFileKey("png"),
      file_name: "applicant-cnic.png",
      file_size_bytes: 2800,
      mime_type: "image/png",
      category: "identity_document",
      scope_type: "admission",
      scope_id: ADMISSION_APPLICATION_ID,
      expires_on: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      access_rules: [],
    }),
  });
  assert.equal(createAdmissionDoc.status, 201, JSON.stringify(createAdmissionDoc.body));

  const createFinanceDoc = await jsonRequest("/api/v1/documents", {
    method: "POST",
    headers: authJson(adminToken),
    body: JSON.stringify({
      title: "April fee register",
      file_key: buildFileKey("csv"),
      file_name: "april-fee-register.csv",
      file_size_bytes: 1500,
      mime_type: "text/csv",
      category: "fee_receipt",
      scope_type: "finance",
      scope_id: FEE_INVOICE_ID,
      access_rules: [],
    }),
  });
  assert.equal(createFinanceDoc.status, 201, JSON.stringify(createFinanceDoc.body));
  const financeDocumentId = createFinanceDoc.body?.data?.id;
  assert.ok(financeDocumentId);

  const scopeStaff = await jsonRequest(`/api/v1/documents/staff/${STAFF_PROFILE_ID}?page=1&page_size=10`, {
    method: "GET",
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(scopeStaff.status, 200, JSON.stringify(scopeStaff.body));
  assert.ok(scopeStaff.body?.data?.length >= 1);

  const scopeAdmission = await jsonRequest(
    `/api/v1/documents/admission/${ADMISSION_APPLICATION_ID}?page=1&page_size=10`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${frontDeskToken}` },
    }
  );
  assert.equal(scopeAdmission.status, 200, JSON.stringify(scopeAdmission.body));
  assert.ok(scopeAdmission.body?.data?.length >= 1);

  const scopeFinance = await jsonRequest(`/api/v1/documents/finance/${FEE_INVOICE_ID}?page=1&page_size=10`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(scopeFinance.status, 200, JSON.stringify(scopeFinance.body));
  assert.ok(scopeFinance.body?.data?.some((row) => row.id === financeDocumentId));

  const downloadResponse = await jsonRequest(`/api/v1/documents/${financeDocumentId}/download-url`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(downloadResponse.status, 200, JSON.stringify(downloadResponse.body));
  assert.ok(downloadResponse.body?.data?.download?.url);

  const expiryReport = await jsonRequest("/api/v1/documents/reports/expiry?status=all&within_days=30&page=1&page_size=20", {
    method: "GET",
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(expiryReport.status, 200, JSON.stringify(expiryReport.body));
  assert.ok(Array.isArray(expiryReport.body?.data));
  assert.ok(expiryReport.body?.meta?.summary);
  assert.ok(typeof expiryReport.body.meta.summary.expired_count === "number");

  const downloadReport = await jsonRequest("/api/v1/documents/reports/downloads?days=30&page=1&page_size=20", {
    method: "GET",
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(downloadReport.status, 200, JSON.stringify(downloadReport.body));
  assert.ok(downloadReport.body?.data?.some((row) => row.document_id === financeDocumentId));

  const downloadEvents = await jsonRequest(
    `/api/v1/documents/${financeDocumentId}/download-events?page=1&page_size=20`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(downloadEvents.status, 200, JSON.stringify(downloadEvents.body));
  assert.ok(downloadEvents.body?.data?.some((row) => row.downloaded_by_user_id === USER_ID_ACCOUNTANT));
});
