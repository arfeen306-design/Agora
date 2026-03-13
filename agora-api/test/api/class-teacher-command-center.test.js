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
const SUBJECT_ID = "70000000-0000-0000-0000-000000000001";
const STUDENT_1 = "40000000-0000-0000-0000-000000000001";

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

async function binaryRequest(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    body: buffer,
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

async function latestReportCardForStudent(studentId) {
  const result = await pool.query(
    `
      SELECT id
      FROM report_cards
      WHERE school_id = $1
        AND classroom_id = $2
        AND student_id = $3
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [SCHOOL_ID, CLASSROOM_ID, studentId]
  );
  return result.rows[0]?.id || null;
}

async function listActiveStudentsInClassroom(classroomId, limit = 5) {
  const result = await pool.query(
    `
      SELECT se.student_id
      FROM student_enrollments se
      WHERE se.school_id = $1
        AND se.classroom_id = $2
        AND se.status = 'active'
      ORDER BY se.roll_no ASC NULLS LAST, se.created_at ASC
      LIMIT $3
    `,
    [SCHOOL_ID, classroomId, limit]
  );
  return result.rows.map((row) => row.student_id);
}

test.before(async () => {
  await runSqlFile("database/migrations/20260307_institution_foundation.sql");
  await runSqlFile("database/dev_seed.sql");
  await runSqlFile("database/migrations/20260307_institution_seed.sql");
  await runSqlFile("database/migrations/20260310_class_teacher_command_center.sql");
  await runSqlFile("database/migrations/20260313_report_card_subject_comments.sql");

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

test("teacher can access class teacher dashboard summary", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");

  const myClassroom = await jsonRequest("/api/v1/class-teacher/my-classroom", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });

  assert.equal(myClassroom.status, 200, JSON.stringify(myClassroom.body));
  assert.equal(myClassroom.body?.success, true);
  assert.equal(myClassroom.body?.data?.classroom?.id, CLASSROOM_ID);
  assert.equal(Number(myClassroom.body?.data?.student_count || 0) >= 2, true);
  assert.equal(Array.isArray(myClassroom.body?.data?.subjects), true);

  const students = await jsonRequest("/api/v1/class-teacher/students", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(students.status, 200, JSON.stringify(students.body));
  assert.equal(Array.isArray(students.body?.data), true);
  assert.equal(students.body.data.length >= 2, true);
});

test("exam terms + marks term filter + report cards flow works end to end", async () => {
  const teacherToken = await login("teacher1@agora.com", "teach123");
  const parentToken = await login("parent1@agora.com", "pass123");
  const studentToken = await login("student1@agora.com", "student123");
  const adminToken = await login("admin@agora.com", "admin123");
  const activeStudents = await listActiveStudentsInClassroom(CLASSROOM_ID, 2);
  assert.equal(activeStudents.length >= 1, true);

  const termName = `Monthly-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  const createTerm = await jsonRequest("/api/v1/exam-terms", {
    method: "POST",
    headers: authHeader(teacherToken),
    body: JSON.stringify({
      academic_year_id: "50000000-0000-0000-0000-000000000001",
      name: termName,
      term_type: "monthly",
      starts_on: "2026-01-10",
      ends_on: "2026-01-30",
    }),
  });
  assert.equal(createTerm.status, 201, JSON.stringify(createTerm.body));
  const examTermId = createTerm.body?.data?.id;
  assert.ok(examTermId);

  const createAssessment = await jsonRequest("/api/v1/assessments", {
    method: "POST",
    headers: authHeader(teacherToken),
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      subject_id: SUBJECT_ID,
      exam_term_id: examTermId,
      title: "Monthly Algebra Test",
      assessment_type: "monthly",
      max_marks: 30,
      assessment_date: "2026-01-15",
    }),
  });
  assert.equal(createAssessment.status, 201, JSON.stringify(createAssessment.body));
  const assessmentId = createAssessment.body?.data?.id;
  assert.ok(assessmentId);
  assert.equal(createAssessment.body?.data?.exam_term_id, examTermId);

  const scoreBulk = await jsonRequest(`/api/v1/assessments/${assessmentId}/scores/bulk`, {
    method: "POST",
    headers: authHeader(teacherToken),
    body: JSON.stringify({
      scores: [
        { student_id: activeStudents[0], marks_obtained: 27, remarks: "Great work" },
        ...(activeStudents[1]
          ? [{ student_id: activeStudents[1], marks_obtained: 20, remarks: "Needs revision" }]
          : []),
      ],
    }),
  });
  assert.equal(scoreBulk.status, 200, JSON.stringify(scoreBulk.body));
  assert.equal(Number(scoreBulk.body?.data?.created_count || 0) >= 1, true);

  const filteredAssessments = await jsonRequest(
    `/api/v1/assessments?classroom_id=${CLASSROOM_ID}&exam_term_id=${examTermId}&page=1&page_size=20`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${teacherToken}` },
    }
  );
  assert.equal(filteredAssessments.status, 200, JSON.stringify(filteredAssessments.body));
  assert.equal(filteredAssessments.body?.success, true);
  assert.equal(
    filteredAssessments.body?.data?.some(
      (row) => row.id === assessmentId && row.exam_term_id === examTermId
    ),
    true
  );

  const consolidated = await jsonRequest(
    `/api/v1/report-cards/consolidated?classroom_id=${CLASSROOM_ID}&exam_term_id=${examTermId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${teacherToken}` },
    }
  );
  assert.equal(consolidated.status, 200, JSON.stringify(consolidated.body));
  assert.equal(consolidated.body?.data?.summary?.student_count >= 2, true);

  const generated = await jsonRequest("/api/v1/report-cards/bulk-generate", {
    method: "POST",
    headers: authHeader(teacherToken),
    body: JSON.stringify({
      classroom_id: CLASSROOM_ID,
      exam_term_id: examTermId,
      remarks: "Generated by integration test",
    }),
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(Number(generated.body?.data?.generated_count || 0) >= 2, true);

  const history = await jsonRequest(
    `/api/v1/report-cards/history?classroom_id=${CLASSROOM_ID}&exam_term_id=${examTermId}&page=1&page_size=20`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${teacherToken}` },
    }
  );
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(history.body?.success, true);
  assert.equal(Array.isArray(history.body?.data?.items), true);
  assert.equal(Number(history.body?.data?.kpis?.total_cards || 0) >= 2, true);
  assert.equal(Array.isArray(history.body?.data?.kpis?.grade_distribution), true);
  assert.equal(Number(history.body?.meta?.pagination?.total_items || 0) >= 2, true);

  const reportCardId = await latestReportCardForStudent(STUDENT_1);
  assert.ok(reportCardId);

  const detail = await jsonRequest(`/api/v1/report-cards/${reportCardId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body?.data?.student?.id, STUDENT_1);
  assert.equal(Array.isArray(detail.body?.data?.subjects), true);

  const subjectCommentUpdate = await jsonRequest(`/api/v1/report-cards/${reportCardId}/subject-comments`, {
    method: "PATCH",
    headers: authHeader(teacherToken),
    body: JSON.stringify({
      comments: detail.body.data.subjects.slice(0, 1).map((subject) => ({
        report_card_subject_id: subject.id,
        comment_category: "good_better",
        teacher_comment: "Performs well and usually solves questions with clear working.",
      })),
    }),
  });
  assert.equal(subjectCommentUpdate.status, 200, JSON.stringify(subjectCommentUpdate.body));
  assert.equal(subjectCommentUpdate.body?.data?.updated_count, 1);

  const detailAfterComment = await jsonRequest(`/api/v1/report-cards/${reportCardId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(detailAfterComment.status, 200, JSON.stringify(detailAfterComment.body));
  assert.equal(detailAfterComment.body?.data?.subjects?.[0]?.comment_category, "good_better");
  assert.equal(
    detailAfterComment.body?.data?.subjects?.[0]?.teacher_comment,
    "Performs well and usually solves questions with clear working."
  );

  const dashboardAfterComment = await jsonRequest("/api/v1/class-teacher/my-classroom", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(dashboardAfterComment.status, 200, JSON.stringify(dashboardAfterComment.body));
  assert.equal(Array.isArray(dashboardAfterComment.body?.data?.subject_comment_completion), true);
  assert.equal(
    dashboardAfterComment.body?.data?.subject_comment_completion?.some(
      (row) => row.subject_id === SUBJECT_ID && Number(row.completion_percentage) > 0
    ),
    true
  );
  assert.equal(Array.isArray(dashboardAfterComment.body?.data?.subject_comment_completion_trend), true);
  assert.equal(
    dashboardAfterComment.body?.data?.subject_comment_completion_trend?.some(
      (row) => row.exam_term_id === examTermId && Number(row.completion_percentage) > 0
    ),
    true
  );

  const missingCommentHistory = await jsonRequest(
    `/api/v1/report-cards/history?classroom_id=${CLASSROOM_ID}&exam_term_id=${examTermId}&subject_id=${SUBJECT_ID}&comment_status=missing&page=1&page_size=20`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${teacherToken}` },
    }
  );
  assert.equal(missingCommentHistory.status, 200, JSON.stringify(missingCommentHistory.body));
  assert.equal(
    missingCommentHistory.body?.data?.items?.some((item) => item.id === reportCardId),
    false
  );

  const publish = await jsonRequest(`/api/v1/report-cards/${reportCardId}/publish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  assert.equal(publish.body?.data?.status, "published");

  const parentView = await jsonRequest(`/api/v1/report-cards/${reportCardId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentView.status, 200, JSON.stringify(parentView.body));
  assert.equal(parentView.body?.data?.student?.id, STUDENT_1);
  assert.equal(parentView.body?.data?.subjects?.[0]?.comment_category, "good_better");
  assert.equal(
    parentView.body?.data?.subjects?.[0]?.teacher_comment,
    "Performs well and usually solves questions with clear working."
  );

  const parentFamilyHistory = await jsonRequest("/api/v1/report-cards/mine/history?page=1&page_size=10", {
    method: "GET",
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(parentFamilyHistory.status, 200, JSON.stringify(parentFamilyHistory.body));
  assert.equal(parentFamilyHistory.body?.success, true);
  assert.equal(Array.isArray(parentFamilyHistory.body?.data?.items), true);
  assert.equal(
    parentFamilyHistory.body?.data?.items?.some((item) => item.id === reportCardId && item.student_id === STUDENT_1),
    true
  );

  const studentFamilyHistory = await jsonRequest("/api/v1/report-cards/mine/history?page=1&page_size=10", {
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(studentFamilyHistory.status, 200, JSON.stringify(studentFamilyHistory.body));
  assert.equal(studentFamilyHistory.body?.success, true);
  assert.equal(studentFamilyHistory.body?.data?.students?.length, 1);
  assert.equal(studentFamilyHistory.body?.data?.students?.[0]?.id, STUDENT_1);
  assert.equal(
    studentFamilyHistory.body?.data?.items?.every((item) => item.student_id === STUDENT_1),
    true
  );

  const parentHistory = await jsonRequest(
    `/api/v1/report-cards/history?classroom_id=${CLASSROOM_ID}&exam_term_id=${examTermId}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${parentToken}` },
    }
  );
  assert.equal(parentHistory.status, 403, JSON.stringify(parentHistory.body));

  const pdf = await binaryRequest(`/api/v1/report-cards/${reportCardId}/pdf`, {
    method: "GET",
    headers: { Authorization: `Bearer ${parentToken}` },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString("ascii"), "%PDF");

  const unpublish = await jsonRequest(`/api/v1/report-cards/${reportCardId}/unpublish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(unpublish.status, 200, JSON.stringify(unpublish.body));
  assert.equal(unpublish.body?.data?.status, "draft");

  const createScale = await jsonRequest("/api/v1/grading-scales", {
    method: "POST",
    headers: authHeader(adminToken),
    body: JSON.stringify({
      name: `Custom-${Date.now()}`,
      is_default: false,
      bands: [
        { grade: "A", min_percentage: 80, max_percentage: 100, sort_order: 1 },
        { grade: "B", min_percentage: 60, max_percentage: 79.99, sort_order: 2 },
        { grade: "C", min_percentage: 0, max_percentage: 59.99, sort_order: 3 },
      ],
    }),
  });
  assert.equal(createScale.status, 201, JSON.stringify(createScale.body));

  const listScales = await jsonRequest("/api/v1/grading-scales?include_bands=true", {
    method: "GET",
    headers: { Authorization: `Bearer ${teacherToken}` },
  });
  assert.equal(listScales.status, 200, JSON.stringify(listScales.body));
  assert.equal(Array.isArray(listScales.body?.data), true);
  assert.equal(listScales.body.data.length >= 1, true);
});
