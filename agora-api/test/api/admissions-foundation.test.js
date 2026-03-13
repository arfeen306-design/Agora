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
const CLASSROOM_ID = "60000000-0000-0000-0000-000000000001";
const ACADEMIC_YEAR_ID = "50000000-0000-0000-0000-000000000001";

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

async function waitForAuditAction(action, entityId, attempts = 15) {
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
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260308_admissions_foundation.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");

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

test("admissions role guards and inquiry creation are enforced", async () => {
  const schoolAdminToken = await login("admin@agora.com", "admin123");
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");
  const accountantToken = await login("accountant@agora.com", "accounts123");
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const teacherPipelineDenied = await jsonRequest("/api/v1/admissions/pipeline", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherPipelineDenied.status, 403);

  const principalPipeline = await jsonRequest("/api/v1/admissions/pipeline", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principalPipeline.status, 200, JSON.stringify(principalPipeline.body));

  const vicePipeline = await jsonRequest("/api/v1/admissions/pipeline", {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(vicePipeline.status, 200, JSON.stringify(vicePipeline.body));

  const filteredPipeline = await jsonRequest(
    `/api/v1/admissions/pipeline?academic_year_id=${ACADEMIC_YEAR_ID}&date_from=2025-01-01&date_to=2030-01-01&limit_per_stage=10`,
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(filteredPipeline.status, 200, JSON.stringify(filteredPipeline.body));
  assert.equal(filteredPipeline.body?.success, true);
  assert.ok(filteredPipeline.body?.data?.stages);

  const invalidPipelineRange = await jsonRequest(
    "/api/v1/admissions/pipeline?date_from=2030-01-01&date_to=2025-01-01",
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(invalidPipelineRange.status, 422, JSON.stringify(invalidPipelineRange.body));

  const filteredApplications = await jsonRequest(
    `/api/v1/admissions/applications?academic_year_id=${ACADEMIC_YEAR_ID}&date_from=2025-01-01&date_to=2030-01-01&page=1&page_size=10`,
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(filteredApplications.status, 200, JSON.stringify(filteredApplications.body));
  assert.equal(filteredApplications.body?.success, true);

  const invalidApplicationsRange = await jsonRequest(
    "/api/v1/admissions/applications?date_from=2030-01-01&date_to=2025-01-01",
    {
      headers: { Authorization: `Bearer ${principalToken}` },
    }
  );
  assert.equal(invalidApplicationsRange.status, 422, JSON.stringify(invalidApplicationsRange.body));

  const accountantPipelineDenied = await jsonRequest("/api/v1/admissions/pipeline", {
    headers: { Authorization: `Bearer ${accountantToken}` },
  });
  assert.equal(accountantPipelineDenied.status, 403, JSON.stringify(accountantPipelineDenied.body));

  const teacherCannotCreate = await jsonRequest("/api/v1/admissions/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teacherToken}`,
    },
    body: JSON.stringify({
      first_name: "Denied",
      guardian_name: "Denied Guardian",
    }),
  });
  assert.equal(teacherCannotCreate.status, 403);

  const inquiry = await jsonRequest("/api/v1/admissions/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      first_name: "Admission",
      last_name: "Lead",
      guardian_name: "Waqar Hussain",
      guardian_phone: "+923001111111",
      guardian_email: `lead.${Date.now()}@example.com`,
      desired_grade_label: "Grade 7",
      desired_section_label: "A",
      desired_classroom_id: CLASSROOM_ID,
      desired_academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Walk-in inquiry",
    }),
  });
  assert.equal(inquiry.status, 201, JSON.stringify(inquiry.body));
  assert.equal(inquiry.body?.data?.student?.admission_status, "inquiry");
  assert.equal(await waitForAuditAction("admissions.inquiry.created", inquiry.body.data.application.id), true);

  const list = await jsonRequest("/api/v1/admissions/applications?status=inquiry&page=1&page_size=20", {
    headers: { Authorization: `Bearer ${schoolAdminToken}` },
  });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(
    list.body.data.some((row) => row.student_id === inquiry.body.data.student.id),
    "Newly created inquiry did not appear in applications list"
  );
});

test("admissions stage transitions and admit enrollment workflow work end-to-end", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const viceToken = await login("viceprincipal@agora.com", "vice123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");

  const created = await jsonRequest("/api/v1/admissions/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      first_name: "Workflow",
      last_name: "Candidate",
      guardian_name: "Ayesha Rahman",
      guardian_phone: "+923002222222",
      guardian_email: `workflow.${Date.now()}@example.com`,
      desired_grade_label: "Grade 7",
      desired_section_label: "A",
      desired_classroom_id: CLASSROOM_ID,
      desired_academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Pipeline transition test",
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const studentId = created.body.data.student.id;
  const applicationId = created.body.data.application.id;

  const toApplied = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      new_status: "applied",
      notes: "Form submitted",
    }),
  });
  assert.equal(toApplied.status, 200, JSON.stringify(toApplied.body));

  const toReview = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      new_status: "under_review",
      notes: "Documents verified",
    }),
  });
  assert.equal(toReview.status, 200, JSON.stringify(toReview.body));

  const frontDeskCannotAccept = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      new_status: "accepted",
      notes: "Front desk cannot approve",
    }),
  });
  assert.equal(frontDeskCannotAccept.status, 403);

  const principalAccept = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      new_status: "accepted",
      notes: "Approved by principal",
      desired_classroom_id: CLASSROOM_ID,
      desired_academic_year_id: ACADEMIC_YEAR_ID,
    }),
  });
  assert.equal(principalAccept.status, 200, JSON.stringify(principalAccept.body));
  assert.equal(await waitForAuditAction("admissions.stage.changed", applicationId), true);

  const admit = await jsonRequest(`/api/v1/admissions/${studentId}/admit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Enrollment completed",
    }),
  });
  assert.equal(admit.status, 200, JSON.stringify(admit.body));
  assert.equal(admit.body?.data?.new_status, "admitted");
  assert.equal(await waitForAuditAction("admissions.student.admitted", studentId), true);

  const detail = await jsonRequest(`/api/v1/admissions/applications/${studentId}`, {
    headers: { Authorization: `Bearer ${viceToken}` },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body?.data?.student?.admission_status, "admitted");
  assert.equal(detail.body?.data?.enrollment?.classroom_id, CLASSROOM_ID);
  assert.ok(
    Array.isArray(detail.body?.data?.history) &&
      detail.body.data.history.some((row) => row.to_status === "admitted"),
    "Expected admitted transition in history"
  );

  const cannotMoveAdmitted = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      new_status: "rejected",
      notes: "Should fail",
    }),
  });
  assert.equal(cannotMoveAdmitted.status, 422);

  const viceCannotAdmit = await jsonRequest(`/api/v1/admissions/${studentId}/admit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${viceToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Vice principal should not have direct admit permission",
    }),
  });
  assert.equal(viceCannotAdmit.status, 403, JSON.stringify(viceCannotAdmit.body));
});

test("admit endpoint returns validation error when roll number is already assigned", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");

  const created = await jsonRequest("/api/v1/admissions/inquiries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      first_name: "Roll",
      last_name: "Conflict",
      guardian_name: "Roll Conflict Guardian",
      guardian_phone: "+923003333333",
      guardian_email: `roll-conflict.${Date.now()}@example.com`,
      desired_grade_label: "Grade 7",
      desired_section_label: "A",
      desired_classroom_id: CLASSROOM_ID,
      desired_academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Roll conflict test",
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const studentId = created.body.data.student.id;

  const toApplied = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({ new_status: "applied", notes: "Applied" }),
  });
  assert.equal(toApplied.status, 200, JSON.stringify(toApplied.body));

  const toReview = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({ new_status: "under_review", notes: "Under review" }),
  });
  assert.equal(toReview.status, 200, JSON.stringify(toReview.body));

  const accepted = await jsonRequest(`/api/v1/admissions/${studentId}/stage`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${principalToken}`,
    },
    body: JSON.stringify({
      new_status: "accepted",
      desired_classroom_id: CLASSROOM_ID,
      desired_academic_year_id: ACADEMIC_YEAR_ID,
      notes: "Accepted by principal",
    }),
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  const admitConflict = await jsonRequest(`/api/v1/admissions/${studentId}/admit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${frontDeskToken}`,
    },
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      academic_year_id: ACADEMIC_YEAR_ID,
      roll_no: 1,
      notes: "Should conflict with existing roll number",
    }),
  });

  assert.equal(admitConflict.status, 422, JSON.stringify(admitConflict.body));
  assert.equal(admitConflict.body?.success, false);
  assert.equal(admitConflict.body?.error?.code, "VALIDATION_ERROR");
});
