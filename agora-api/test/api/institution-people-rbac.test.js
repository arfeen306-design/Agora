const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = require("../../src/app");
const pool = require("../../src/db");

let server;
let baseUrl;
const SCHOOL_ID = "10000000-0000-0000-0000-000000000001";

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

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
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

test("institution profile endpoint returns school setup details", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const profile = await jsonRequest("/api/v1/institution/profile", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body?.success, true);
  assert.equal(profile.body?.data?.code, "agora_demo");
  assert.equal(typeof profile.body?.data?.active_sections, "number");
  assert.ok(Object.prototype.hasOwnProperty.call(profile.body?.data || {}, "attendance_rules"));
});

test("school admin can create and list sections", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const code = `SEC${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const created = await jsonRequest("/api/v1/institution/sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `Section ${code}`,
      code,
      section_type: "middle",
      display_order: 90,
      announcements_enabled: true,
      is_active: true,
    }),
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body?.success, true);

  const list = await jsonRequest(`/api/v1/institution/sections?search=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body?.success, true);
  assert.ok(Array.isArray(list.body?.data));
  assert.ok(list.body.data.some((row) => row.code === code));
});

test("people staff create/list works and creates teacher linkage", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  let created = null;
  let staffCode = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `teacher.${suffix}@agora.com`;
    staffCode = `EMP-T-${suffix.toUpperCase()}`;
    const phone = `+9200${suffix.replace(/[^0-9]/g, "").padEnd(8, "7").slice(0, 8)}`;

    created = await jsonRequest("/api/v1/people/staff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        first_name: "Test",
        last_name: "Teacher",
        email,
        phone,
        temporary_password: "TempPass123!",
        roles: ["teacher"],
        staff_code: staffCode,
        staff_type: "teacher",
        designation: "Science Teacher",
        joining_date: "2026-01-10",
        employment_status: "active",
      }),
    });

    if (created.status === 201) break;
    assert.equal(created.status, 409, JSON.stringify(created.body));
  }

  assert.ok(created);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body?.success, true);
  assert.equal(created.body?.data?.staff?.staff_code, staffCode);
  assert.equal(
    await waitForAuditAction("people.staff.created", created.body?.data?.staff?.id),
    true
  );

  const listed = await jsonRequest(`/api/v1/people/staff?search=${encodeURIComponent(staffCode)}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body?.success, true);
  assert.ok(Array.isArray(listed.body?.data));

  const row = listed.body.data.find((item) => item.staff_code === staffCode);
  assert.ok(row);
  assert.ok(Array.isArray(row.roles));
  assert.ok(row.roles.includes("teacher"));

  const patched = await jsonRequest(`/api/v1/people/staff/${row.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      designation: "Senior Science Teacher",
      joining_date: "2026-02-15",
      roles: ["teacher"],
    }),
  });

  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body?.success, true);
  assert.equal(await waitForAuditAction("people.staff.updated", row.id), true);

  const projection = await pool.query(
    `
      SELECT employee_code, designation, joined_on::text AS joined_on
      FROM teachers
      WHERE school_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [SCHOOL_ID, row.user_id]
  );

  assert.ok(projection.rows[0], "Expected teacher projection row for staff teacher");
  assert.equal(projection.rows[0].employee_code, staffCode);
  assert.equal(projection.rows[0].designation, "Senior Science Teacher");
  assert.equal(projection.rows[0].joined_on, "2026-02-15");
});

test("import errors endpoint returns nested pagination and export is audited", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const jobId = crypto.randomUUID();

  await pool.query(
    `
      INSERT INTO import_jobs (
        id, school_id, created_by_user_id, import_type, source_format, source_file_name, status, total_rows, valid_rows, invalid_rows
      )
      VALUES ($1, $2, $3, 'students', 'csv', 'students.csv', 'failed', 2, 0, 2)
    `,
    [jobId, SCHOOL_ID, "20000000-0000-0000-0000-000000000001"]
  );

  await pool.query(
    `
      INSERT INTO import_errors (job_id, row_number, field_name, issue, raw_value)
      VALUES
        ($1, 1, 'student_code', 'duplicate student_code', 'STU-001'),
        ($1, 2, 'class_label', 'unknown class label', 'Grade-99')
    `,
    [jobId]
  );

  const errorsPage = await jsonRequest(`/api/v1/people/imports/jobs/${jobId}/errors?page=1&page_size=1`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(errorsPage.status, 200, JSON.stringify(errorsPage.body));
  assert.equal(errorsPage.body?.success, true);
  assert.ok(Array.isArray(errorsPage.body?.data));
  assert.equal(errorsPage.body?.data?.length, 1);
  assert.equal(errorsPage.body?.meta?.pagination?.page, 1);
  assert.equal(errorsPage.body?.meta?.pagination?.page_size, 1);
  assert.equal(errorsPage.body?.meta?.pagination?.total_items, 2);
  assert.equal(errorsPage.body?.meta?.pagination?.total_pages, 2);

  const exportResponse = await fetch(
    `${baseUrl}/api/v1/people/imports/jobs/${jobId}/errors?format=csv&page=1&page_size=5`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-type") || "", /text\/csv/);
  const csvBody = await exportResponse.text();
  assert.match(csvBody, /row_number/);

  assert.equal(await waitForAuditAction("imports.errors.exported", jobId), true);
});

test("rbac delegation create/list/revoke flow works", async () => {
  const adminToken = await login("admin@agora.com", "admin123");

  const selfDelegationDenied = await jsonRequest("/api/v1/rbac/delegations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      granted_to_user_id: "20000000-0000-0000-0000-000000000001",
      permission_code: "people.students.view",
      scope_type: "school",
      grant_reason: "Should be denied",
    }),
  });

  assert.equal(selfDelegationDenied.status, 422, JSON.stringify(selfDelegationDenied.body));
  assert.equal(selfDelegationDenied.body?.success, false);

  const created = await jsonRequest("/api/v1/rbac/delegations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      granted_to_user_id: "20000000-0000-0000-0000-000000000006",
      permission_code: "people.students.view",
      scope_type: "school",
      grant_reason: "Vice principal can monitor admissions funnel",
    }),
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body?.success, true);
  assert.equal(created.body?.data?.permission_code, "people.students.view");

  const delegationId = created.body.data.id;
  assert.equal(await waitForAuditAction("security.delegation.created", delegationId), true);

  const list = await jsonRequest("/api/v1/rbac/delegations?active_only=true&page_size=50", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body?.success, true);
  assert.ok(Array.isArray(list.body?.data));
  assert.ok(list.body.data.some((row) => row.id === delegationId));

  const revoked = await jsonRequest(`/api/v1/rbac/delegations/${delegationId}/revoke`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body?.success, true);
  assert.equal(revoked.body?.data?.is_active, false);
  assert.equal(await waitForAuditAction("security.delegation.revoked", delegationId), true);
});

test("people students create endpoint works with enrollment and parent link", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();

  const created = await jsonRequest("/api/v1/people/students", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      student_code: `STD-${suffix}`,
      first_name: "New",
      last_name: "Student",
      admission_date: "2026-01-12",
      classroom_id: "60000000-0000-0000-0000-000000000001",
      parent_user_id: "20000000-0000-0000-0000-000000000003",
      relation_type: "father",
      is_primary_parent: true,
    }),
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body?.success, true);
  assert.equal(created.body?.data?.parent_linked, true);
  assert.equal(
    await waitForAuditAction("people.student.created", created.body?.data?.student?.id),
    true
  );

  const listed = await jsonRequest(`/api/v1/people/students?search=${encodeURIComponent(`STD-${suffix}`)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body?.success, true);
  assert.ok(Array.isArray(listed.body?.data));
  assert.ok(listed.body.data.some((row) => row.student_code === `STD-${suffix}`));
});

test("people students create supports inline parent creation in one admission payload", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const studentCode = `STD-INLINE-${suffix}`;
  const parentEmail = `inline.parent.${suffix.toLowerCase()}@agora.com`;

  const created = await jsonRequest("/api/v1/people/students", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      student_code: studentCode,
      first_name: "Inline",
      last_name: "Student",
      admission_date: "2026-01-14",
      classroom_id: "60000000-0000-0000-0000-000000000001",
      parent: {
        first_name: "Inline",
        last_name: "Parent",
        email: parentEmail,
        phone: `+9230${suffix.replace(/[^0-9]/g, "").padEnd(8, "5").slice(0, 8)}`,
        relation_type: "father",
        is_primary: true,
      },
    }),
  });

  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body?.success, true);
  assert.equal(created.body?.data?.parent_linked, true);
  assert.ok(created.body?.data?.parent_id);

  const parentList = await jsonRequest(`/api/v1/people/parents?search=${encodeURIComponent(parentEmail)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(parentList.status, 200, JSON.stringify(parentList.body));
  assert.equal(parentList.body?.success, true);
  assert.ok(Array.isArray(parentList.body?.data));
  assert.ok(parentList.body.data.some((row) => row.email === parentEmail));

  const studentList = await jsonRequest(`/api/v1/people/students?search=${encodeURIComponent(studentCode)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.equal(studentList.status, 200, JSON.stringify(studentList.body));
  assert.equal(studentList.body?.success, true);
  assert.ok(studentList.body.data.some((row) => row.student_code === studentCode));
});

test("student bulk import preview and execute flow works", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const studentCode = `IMP-${suffix}`;
  const parentEmail = `bulk.parent.${suffix.toLowerCase()}@agora.com`;

  const csvRows = [
    [
      "student code",
      "student full name",
      "class",
      "section",
      "date of birth",
      "father name",
      "mother name",
      "whatsapp number",
      "mobile number",
      "email",
      "address",
      "admission date",
      "guardian relation",
      "emergency contact",
      "notes",
    ],
    [
      studentCode,
      "Imported Student",
      "Grade 7",
      "A",
      "2014-01-11",
      "Imran Khan",
      "Sana Khan",
      "+923001112233",
      "+923009998877",
      parentEmail,
      "Model Town",
      "2026-01-20",
      "father",
      "+923001110000",
      "Imported via test",
    ],
  ];

  const csvText = `${csvRows.map((row) => row.join(",")).join("\n")}\n`;
  const fileBase64 = Buffer.from(csvText, "utf8").toString("base64");

  const preview = await jsonRequest("/api/v1/people/imports/students/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      source_file_name: `students-${suffix}.csv`,
      source_format: "csv",
      file_base64: fileBase64,
      import_type: "students",
      default_academic_year_id: "50000000-0000-0000-0000-000000000001",
    }),
  });

  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body?.success, true);
  assert.equal(preview.body?.data?.valid_rows, 1);
  assert.equal(preview.body?.data?.invalid_rows, 0);
  assert.ok(preview.body?.data?.id);

  const execute = await jsonRequest(
    `/api/v1/people/imports/jobs/${preview.body.data.id}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        create_parent_accounts: true,
      }),
    }
  );

  assert.equal(execute.status, 200, JSON.stringify(execute.body));
  assert.equal(execute.body?.success, true);
  assert.equal(execute.body?.data?.imported_count, 1);
  assert.match(String(execute.body?.data?.status || ""), /^completed/);

  const listed = await jsonRequest(`/api/v1/people/students?search=${encodeURIComponent(studentCode)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body?.success, true);
  assert.ok(Array.isArray(listed.body?.data));
  assert.ok(listed.body.data.some((row) => row.student_code === studentCode));
});

test("staff bulk import preview and execute flow works", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const staffCode = `EMP-IMP-${suffix}`;
  const staffEmail = `import.staff.${suffix.toLowerCase()}@agora.com`;
  const staffPhone = `+9230${suffix.replace(/[^0-9]/g, "").padEnd(8, "7").slice(0, 8)}`;
  const section = await pool.query(
    `
      SELECT code
      FROM school_sections
      WHERE school_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [SCHOOL_ID]
  );
  const sectionCode = section.rows[0]?.code || "";

  const csvRows = [
    [
      "staff code",
      "first name",
      "last name",
      "email",
      "phone",
      "staff type",
      "role code",
      "designation",
      "joining date",
      "employment status",
      "primary section code",
    ],
    [
      staffCode,
      "Imported",
      "Teacher",
      staffEmail,
      staffPhone,
      "teacher",
      "teacher",
      "Math Teacher",
      "2026-02-01",
      "active",
      sectionCode,
    ],
  ];

  const csvText = `${csvRows.map((row) => row.join(",")).join("\n")}\n`;
  const fileBase64 = Buffer.from(csvText, "utf8").toString("base64");

  const preview = await jsonRequest("/api/v1/people/imports/staff/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      source_file_name: `staff-${suffix}.csv`,
      source_format: "csv",
      file_base64: fileBase64,
      import_type: "staff",
    }),
  });

  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body?.success, true);
  assert.equal(preview.body?.data?.valid_rows, 1);
  assert.equal(preview.body?.data?.invalid_rows, 0);
  assert.ok(preview.body?.data?.id);

  const execute = await jsonRequest(
    `/api/v1/people/imports/jobs/${preview.body.data.id}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    }
  );

  assert.equal(execute.status, 200, JSON.stringify(execute.body));
  assert.equal(execute.body?.success, true);
  assert.equal(execute.body?.data?.imported_count, 1);
  assert.match(String(execute.body?.data?.status || ""), /^completed/);

  const listed = await jsonRequest(`/api/v1/people/staff?search=${encodeURIComponent(staffCode)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body?.success, true);
  assert.ok(Array.isArray(listed.body?.data));
  assert.ok(listed.body.data.some((row) => row.staff_code === staffCode));
});

test("parent bulk import preview and execute flow works", async () => {
  const adminToken = await login("admin@agora.com", "admin123");
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const parentEmail = `import.parent.${suffix.toLowerCase()}@agora.com`;
  const parentPhone = `+9230${suffix.replace(/[^0-9]/g, "").padEnd(8, "8").slice(0, 8)}`;
  const parentWhatsapp = `+9231${suffix.replace(/[^0-9]/g, "").padEnd(8, "9").slice(0, 8)}`;
  const student = await pool.query(
    `
      SELECT student_code
      FROM students
      WHERE school_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [SCHOOL_ID]
  );
  const studentCode = student.rows[0]?.student_code;
  assert.ok(studentCode);

  const csvRows = [
    [
      "parent full name",
      "email",
      "phone",
      "whatsapp number",
      "student codes",
      "relation",
      "preferred channel",
    ],
    [
      "Imported Parent",
      parentEmail,
      parentPhone,
      parentWhatsapp,
      studentCode,
      "father",
      "in_app",
    ],
  ];

  const csvText = `${csvRows.map((row) => row.join(",")).join("\n")}\n`;
  const fileBase64 = Buffer.from(csvText, "utf8").toString("base64");

  const preview = await jsonRequest("/api/v1/people/imports/parents/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      source_file_name: `parents-${suffix}.csv`,
      source_format: "csv",
      file_base64: fileBase64,
      import_type: "parents",
    }),
  });

  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body?.success, true);
  assert.equal(preview.body?.data?.valid_rows, 1);
  assert.equal(preview.body?.data?.invalid_rows, 0);
  assert.ok(preview.body?.data?.id);

  const execute = await jsonRequest(
    `/api/v1/people/imports/jobs/${preview.body.data.id}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    }
  );

  assert.equal(execute.status, 200, JSON.stringify(execute.body));
  assert.equal(execute.body?.success, true);
  assert.equal(execute.body?.data?.imported_count, 1);
  assert.match(String(execute.body?.data?.status || ""), /^completed/);

  const listed = await jsonRequest(`/api/v1/people/parents?search=${encodeURIComponent(parentEmail)}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body?.success, true);
  assert.ok(Array.isArray(listed.body?.data));
  assert.ok(listed.body.data.some((row) => row.email === parentEmail));
});

test("headmistress section dashboard returns section-scoped detail payload", async () => {
  const hmToken = await login("hm.middle@agora.com", "hm123");

  const response = await jsonRequest("/api/v1/institution/dashboards/section?include_detail=true", {
    headers: {
      Authorization: `Bearer ${hmToken}`,
    },
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body?.success, true);
  assert.ok(Array.isArray(response.body?.data?.sections));
  assert.ok(response.body.data.sections.length >= 1);
  assert.ok(response.body.data.sections.every((row) => row.section_id === "a0000000-0000-0000-0000-000000000003"));

  const detail = response.body?.data?.selected_section_detail;
  assert.ok(detail);
  assert.equal(detail.section.section_id, "a0000000-0000-0000-0000-000000000003");
  assert.ok(Array.isArray(detail.class_attendance));
  assert.ok(Array.isArray(detail.late_absent_students));
  assert.ok(Array.isArray(detail.upcoming_events));
  assert.ok(Array.isArray(detail.announcements));
});

test("headmistress cannot request section detail outside assigned scope", async () => {
  const hmToken = await login("hm.middle@agora.com", "hm123");

  const response = await jsonRequest(
    "/api/v1/institution/dashboards/section?include_detail=true&section_id=a0000000-0000-0000-0000-000000000001",
    {
      headers: {
        Authorization: `Bearer ${hmToken}`,
      },
    }
  );

  assert.equal(response.status, 404, JSON.stringify(response.body));
  assert.equal(response.body?.success, false);
  assert.equal(response.body?.error?.code, "NOT_FOUND");
});
