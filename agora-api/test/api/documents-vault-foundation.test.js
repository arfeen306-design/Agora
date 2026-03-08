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

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260308_document_vault_foundation.sql");

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
      scope_id: crypto.randomUUID(),
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
