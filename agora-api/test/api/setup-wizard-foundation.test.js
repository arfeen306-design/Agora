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

function authJson(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function waitForAudit(action, attempts = 25) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await pool.query(
      `
        SELECT id
        FROM audit_logs
        WHERE school_id = $1
          AND action = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [SCHOOL_ID, action]
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
  await runSqlFile("database/migrations/20260309_setup_wizard_foundation.sql");

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

test.beforeEach(async () => {
  await pool.query("DELETE FROM school_onboarding_launches WHERE school_id = $1", [SCHOOL_ID]);
  await pool.query("DELETE FROM school_onboarding_steps WHERE school_id = $1", [SCHOOL_ID]);
});

test("setup wizard status is role-gated and returns step progress", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const principalStatus = await jsonRequest("/api/v1/institution/setup-wizard/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${principalToken}` },
  });

  assert.equal(principalStatus.status, 200, JSON.stringify(principalStatus.body));
  assert.equal(principalStatus.body?.success, true);
  assert.ok(Array.isArray(principalStatus.body?.data?.steps));
  assert.equal(
    principalStatus.body?.data?.steps.length,
    principalStatus.body?.data?.total_steps,
    JSON.stringify(principalStatus.body)
  );

  const frontDeskStatus = await jsonRequest("/api/v1/institution/setup-wizard/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${frontDeskToken}` },
  });
  assert.equal(frontDeskStatus.status, 200, JSON.stringify(frontDeskStatus.body));

  const teacherDenied = await jsonRequest("/api/v1/institution/setup-wizard/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(teacherDenied.status, 403, JSON.stringify(teacherDenied.body));
  assert.equal(teacherDenied.body?.error?.code, "FORBIDDEN");
});

test("setup wizard step updates and launch workflow are validated and audited", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const initial = await jsonRequest("/api/v1/institution/setup-wizard/status", {
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(initial.status, 200, JSON.stringify(initial.body));

  const blockedLaunch = await jsonRequest("/api/v1/institution/setup-wizard/launch", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(blockedLaunch.status, 422, JSON.stringify(blockedLaunch.body));
  assert.equal(blockedLaunch.body?.error?.code, "VALIDATION_ERROR");

  const steps = initial.body?.data?.steps || [];
  for (const step of steps) {
    if (step.is_completed) continue;

    const markStep = await jsonRequest(`/api/v1/institution/setup-wizard/steps/${step.code}`, {
      method: "PATCH",
      headers: authJson(adminToken),
      body: JSON.stringify({
        is_completed: true,
        notes: `Completed ${step.code} for launch readiness`,
      }),
    });

    assert.equal(markStep.status, 200, JSON.stringify(markStep.body));
    assert.equal(markStep.body?.data?.step?.is_completed, true);
  }

  const launched = await jsonRequest("/api/v1/institution/setup-wizard/launch", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(launched.status, 200, JSON.stringify(launched.body));
  assert.equal(launched.body?.success, true);
  assert.ok(launched.body?.data?.launch?.launched_at);
  assert.equal(launched.body?.data?.status?.launch_ready, true);
  assert.equal(launched.body?.data?.status?.completed_steps, steps.length);

  const persisted = await pool.query(
    `
      SELECT launched_by_user_id
      FROM school_onboarding_launches
      WHERE school_id = $1
      LIMIT 1
    `,
    [SCHOOL_ID]
  );
  assert.ok(persisted.rows[0]);

  const stepAuditSeen = await waitForAudit("institution.setup_wizard.step.updated");
  const launchAuditSeen = await waitForAudit("institution.setup_wizard.launched");
  assert.equal(stepAuditSeen, true, "Expected setup step update audit event");
  assert.equal(launchAuditSeen, true, "Expected setup wizard launch audit event");
});
