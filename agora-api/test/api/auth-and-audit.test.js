const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;
const deviceApiKey = process.env.ATTENDANCE_DEVICE_API_KEY || "dev-device-key";
const internalApiKey = process.env.INTERNAL_API_KEY || "dev-internal-key";

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = { raw: text };
  }

  return {
    status: response.status,
    headers: response.headers,
    body: data,
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
  assert.equal(result.body?.success, true);
  assert.ok(result.body?.data?.access_token);
  return result.body.data.access_token;
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Ensure push token table exists for Step 19 integration tests.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_device_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'fcm',
      platform TEXT NOT NULL,
      device_token TEXT NOT NULL,
      device_id TEXT,
      app_version TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (school_id, device_token)
    )
  `);
});

test.after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

test("health endpoint is up", async () => {
  const result = await jsonRequest("/api/v1/health");
  assert.equal(result.status, 200);
  assert.equal(result.body?.success, true);
  assert.equal(result.body?.data?.service, "agora-api");
  assert.equal(typeof result.body?.data?.db, "string");
});

test("auth me rejects without token", async () => {
  const result = await jsonRequest("/api/v1/auth/me");
  assert.equal(result.status, 401);
  assert.equal(result.body?.success, false);
});

test("auth login + me works with teacher account", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const me = await jsonRequest("/api/v1/auth/me", {
    headers: {
      Authorization: `Bearer ${teacherToken}`,
    },
  });

  assert.equal(me.status, 200);
  assert.equal(me.body?.success, true);
  assert.equal(me.body?.data?.email, "teacher1@agora.com");
  assert.ok(Array.isArray(me.body?.data?.roles));
  assert.ok(me.body.data.roles.includes("teacher"));
});

test("admin audit list is protected by RBAC", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const denied = await jsonRequest("/api/v1/admin/audit-logs", {
    headers: { Authorization: `Bearer ${teacherToken}` },
  });

  assert.equal(denied.status, 403);
  assert.equal(denied.body?.success, false);

  const adminToken = await login("admin@agora.com", "admin123");
  const allowed = await jsonRequest("/api/v1/admin/audit-logs?page=1&page_size=5", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(allowed.status, 200);
  assert.equal(allowed.body?.success, true);
  assert.ok(Array.isArray(allowed.body?.data));
});

test("write requests are logged and audit export works", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const uniqueTitle = `CI Audit Event ${crypto.randomUUID().slice(0, 8)}`;
  const createEvent = await jsonRequest("/api/v1/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title: uniqueTitle,
      description: "Created by API test suite",
      event_type: "general",
      starts_at: "2026-03-10T08:00:00Z",
      ends_at: "2026-03-10T09:00:00Z",
      target_scope: "school",
    }),
  });

  assert.equal(createEvent.status, 201, JSON.stringify(createEvent.body));
  assert.equal(createEvent.body?.success, true);

  const auditList = await jsonRequest("/api/v1/admin/audit-logs?action=POST&page=1&page_size=50", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(auditList.status, 200);
  assert.equal(auditList.body?.success, true);
  assert.ok(Array.isArray(auditList.body?.data));
  assert.ok(
    auditList.body.data.some(
      (row) => typeof row.action === "string" && row.action.includes("POST events")
    ),
    "Expected POST events action in audit logs"
  );

  const exportResponse = await fetch(`${baseUrl}/api/v1/admin/audit-logs/export?format=csv&max_rows=20`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const exportText = await exportResponse.text();

  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") || "", /text\/csv/);
  assert.match(
    exportText,
    /Created At,Actor Name,Actor Email,Action,Entity,Entity ID,Metadata/
  );
});

test("device ingest creates/updates attendance with API key auth", async () => {
  const denied = await jsonRequest("/api/v1/attendance/device-ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      school_code: "agora_demo",
      student_code: "STD-001",
      source: "rfid",
      scanner_id: "gate-a",
    }),
  });
  assert.equal(denied.status, 401);

  const accepted = await jsonRequest("/api/v1/attendance/device-ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Api-Key": deviceApiKey,
    },
    body: JSON.stringify({
      school_code: "agora_demo",
      student_code: "STD-001",
      source: "rfid",
      scanner_id: "gate-a",
      scanned_at: "2026-03-10T02:00:00Z",
    }),
  });

  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body?.success, true);
  assert.ok(["created", "updated"].includes(accepted.body?.data?.operation));
  assert.ok(["present", "late"].includes(accepted.body?.data?.attendance?.status));
  assert.equal(accepted.body?.data?.attendance?.source, "rfid");
  assert.equal(typeof accepted.body?.data?.notifications_queued, "number");
});

test("push token register/list/delete works", async () => {
  const parentToken = await login("parent1@agora.com", "pass123");
  const deviceToken = `fcm_token_${crypto.randomUUID().replace(/-/g, "")}`;

  const upsert = await jsonRequest("/api/v1/notifications/push-tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${parentToken}`,
    },
    body: JSON.stringify({
      provider: "fcm",
      platform: "android",
      device_token: deviceToken,
      device_id: "pixel-emulator",
      app_version: "1.0.0",
    }),
  });

  assert.equal(upsert.status, 200, JSON.stringify(upsert.body));
  assert.equal(upsert.body?.success, true);
  assert.equal(upsert.body?.data?.provider, "fcm");
  assert.equal(upsert.body?.data?.platform, "android");
  assert.ok(upsert.body?.data?.id);

  const tokenId = upsert.body.data.id;
  const list = await jsonRequest("/api/v1/notifications/push-tokens", {
    headers: { Authorization: `Bearer ${parentToken}` },
  });

  assert.equal(list.status, 200);
  assert.equal(list.body?.success, true);
  assert.ok(Array.isArray(list.body?.data));
  assert.ok(list.body.data.some((item) => item.id === tokenId));

  const remove = await jsonRequest(`/api/v1/notifications/push-tokens/${tokenId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${parentToken}` },
  });

  assert.equal(remove.status, 200);
  assert.equal(remove.body?.success, true);
  assert.equal(remove.body?.data?.ok, true);
});

test("tenant boundary blocks cross-school hints", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const result = await jsonRequest(
    "/api/v1/attendance?school_id=10000000-0000-0000-0000-000000000002",
    {
      headers: { Authorization: `Bearer ${teacherToken}` },
    }
  );

  assert.equal(result.status, 403);
  assert.equal(result.body?.success, false);
  assert.equal(result.body?.error?.code, "TENANT_SCOPE_MISMATCH");
});

test("internal observability metrics requires internal key", async () => {
  const denied = await jsonRequest("/api/v1/internal/observability/metrics");
  assert.equal(denied.status, 401);

  const allowed = await jsonRequest("/api/v1/internal/observability/metrics", {
    headers: { "X-Internal-Api-Key": internalApiKey },
  });

  assert.equal(allowed.status, 200);
  assert.equal(allowed.body?.success, true);
  assert.equal(allowed.body?.data?.service, "agora-api");
  assert.equal(typeof allowed.body?.data?.requests?.total, "number");
});

test("internal observability slo endpoint returns alert payload shape", async () => {
  const denied = await jsonRequest("/api/v1/internal/observability/slo");
  assert.equal(denied.status, 401);

  const allowed = await jsonRequest("/api/v1/internal/observability/slo", {
    headers: { "X-Internal-Api-Key": internalApiKey },
  });

  assert.equal(allowed.status, 200);
  assert.equal(allowed.body?.success, true);
  assert.equal(allowed.body?.data?.service, "agora-api");
  assert.equal(typeof allowed.body?.data?.slo?.target_availability_percent, "number");
  assert.equal(typeof allowed.body?.data?.workers?.notifications?.queued_count, "number");
  assert.ok(Array.isArray(allowed.body?.data?.alerts));
});
