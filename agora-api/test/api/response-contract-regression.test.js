const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;

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
  };
}

async function runSqlFile(relativePathFromRepoRoot) {
  const file = path.resolve(__dirname, "../../../", relativePathFromRepoRoot);
  const sql = await fs.readFile(file, "utf8");
  await pool.query(sql);
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
  assert.ok(result.body?.data?.access_token);
  return result.body.data.access_token;
}

function assertSuccessEnvelope(payload) {
  assert.equal(payload?.success, true, `Expected success envelope: ${JSON.stringify(payload)}`);
  assert.ok(payload?.meta, "Expected meta object");
  assert.equal(typeof payload.meta.request_id, "string");
  assert.ok(payload.meta.request_id.length > 0);
}

function assertErrorEnvelope(payload) {
  assert.equal(payload?.success, false, `Expected error envelope: ${JSON.stringify(payload)}`);
  assert.ok(payload?.error, "Expected error object");
  assert.equal(typeof payload.error.code, "string");
  assert.equal(typeof payload.error.message, "string");
  assert.ok(payload?.meta, "Expected meta object");
  assert.equal(typeof payload.meta.request_id, "string");
}

function assertNestedPagination(meta, expectedPage, expectedPageSize) {
  assert.ok(meta, "Expected meta");
  assert.ok(meta.pagination, "Expected meta.pagination");
  assert.equal(meta.total_items, undefined, "Flat meta.total_items must not be returned");
  assert.equal(meta.total_pages, undefined, "Flat meta.total_pages must not be returned");

  assert.equal(meta.pagination.page, expectedPage);
  assert.equal(meta.pagination.page_size, expectedPageSize);
  assert.equal(typeof meta.pagination.total_items, "number");
  assert.equal(typeof meta.pagination.total_pages, "number");
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
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

test("success envelope and nested pagination are consistent across key paginated endpoints", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const frontDeskToken = await login("frontdesk1@agora.com", "front123");

  const parents = await jsonRequest("/api/v1/people/parents?page=1&page_size=5", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(parents.status, 200, JSON.stringify(parents.body));
  assertSuccessEnvelope(parents.body);
  assert.ok(Array.isArray(parents.body.data));
  assertNestedPagination(parents.body.meta, 1, 5);

  const admissions = await jsonRequest("/api/v1/admissions/applications?page=1&page_size=5", {
    headers: { Authorization: `Bearer ${frontDeskToken}` },
  });
  assert.equal(admissions.status, 200, JSON.stringify(admissions.body));
  assertSuccessEnvelope(admissions.body);
  assert.ok(Array.isArray(admissions.body.data));
  assertNestedPagination(admissions.body.meta, 1, 5);
});

test("success envelope is consistent on leadership dashboards", async () => {
  const principalToken = await login("principal@agora.com", "principal123");
  const hmToken = await login("hm.middle@agora.com", "hm123");

  const principal = await jsonRequest("/api/v1/institution/dashboards/principal", {
    headers: { Authorization: `Bearer ${principalToken}` },
  });
  assert.equal(principal.status, 200, JSON.stringify(principal.body));
  assertSuccessEnvelope(principal.body);
  assert.equal(typeof principal.body.data, "object");

  const section = await jsonRequest("/api/v1/institution/dashboards/section", {
    headers: { Authorization: `Bearer ${hmToken}` },
  });
  assert.equal(section.status, 200, JSON.stringify(section.body));
  assertSuccessEnvelope(section.body);
  assert.equal(typeof section.body.data, "object");
});

test("error envelope is consistent for validation and auth failures", async () => {
  const accountantToken = await login("accountant@agora.com", "accounts123");

  const validationFailure = await jsonRequest(
    "/api/v1/fees/summary?date_from=2026-03-15&date_to=2026-03-01",
    {
      headers: { Authorization: `Bearer ${accountantToken}` },
    }
  );
  assert.equal(validationFailure.status, 422, JSON.stringify(validationFailure.body));
  assertErrorEnvelope(validationFailure.body);
  assert.equal(validationFailure.body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(validationFailure.body.error.details));

  const authFailure = await jsonRequest("/api/v1/people/parents?page=1&page_size=5");
  assert.equal(authFailure.status, 401, JSON.stringify(authFailure.body));
  assertErrorEnvelope(authFailure.body);
  assert.equal(authFailure.body.error.code, "UNAUTHORIZED");
});
