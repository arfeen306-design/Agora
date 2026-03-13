const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { ensureTeacherCanManageClassroom } = require("../utils/teacher-scope");
const { buildReportCardPdfBuffer } = require("../services/report-card-pdf");

const router = express.Router();

const consolidatedQuerySchema = z.object({
  classroom_id: z.string().uuid(),
  exam_term_id: z.string().uuid(),
});

const historyQuerySchema = z.object({
  classroom_id: z.string().uuid(),
  exam_term_id: z.string().uuid(),
  subject_id: z.string().uuid().optional(),
  status: z.enum(["draft", "published"]).optional(),
  comment_status: z.enum(["missing", "completed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

const familyHistoryQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(12),
});

const generateSchema = z.object({
  classroom_id: z.string().uuid(),
  exam_term_id: z.string().uuid(),
  student_id: z.string().uuid().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

const bulkGenerateSchema = z.object({
  classroom_id: z.string().uuid(),
  exam_term_id: z.string().uuid(),
  remarks: z.string().trim().max(2000).optional(),
});

const bulkPublishSchema = z.object({
  classroom_id: z.string().uuid(),
  exam_term_id: z.string().uuid(),
});

const subjectCommentCategoryValues = [
  "extraordinary",
  "good_better",
  "average",
  "below_average",
  "at_risk",
];

const updateSubjectCommentsSchema = z.object({
  comments: z.array(
    z.object({
      report_card_subject_id: z.string().uuid(),
      comment_category: z.enum(subjectCommentCategoryValues).nullable().optional(),
      teacher_comment: z.string().trim().max(600).nullable().optional(),
    })
  ).min(1).max(50),
});

const pathSchema = z.object({
  reportCardId: z.string().uuid(),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      message,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        issue: issue.message,
      }))
    );
  }
  return parsed.data;
}

function hasRole(auth, role) {
  return Array.isArray(auth?.roles) && auth.roles.includes(role);
}

function hasAnyRole(auth, roles) {
  return roles.some((role) => hasRole(auth, role));
}

async function ensureClassroomInSchool({ schoolId, classroomId }) {
  const row = await pool.query(
    `
      SELECT
        c.id,
        c.school_id,
        c.grade_label,
        c.section_label,
        c.classroom_code,
        c.academic_year_id,
        c.section_id
      FROM classrooms c
      WHERE c.school_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );
  if (!row.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Classroom not found");
  }
  return row.rows[0];
}

async function ensureExamTermInSchool({ schoolId, examTermId }) {
  const row = await pool.query(
    `
      SELECT
        et.id,
        et.school_id,
        et.academic_year_id,
        et.name,
        et.term_type,
        et.starts_on,
        et.ends_on,
        et.is_locked
      FROM exam_terms et
      WHERE et.school_id = $1
        AND et.id = $2
      LIMIT 1
    `,
    [schoolId, examTermId]
  );
  if (!row.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Exam term not found");
  }
  return row.rows[0];
}

async function ensureClassroomManageAccess({ auth, classroom }) {
  if (hasAnyRole(auth, ["school_admin", "principal", "vice_principal"])) return;

  if (hasRole(auth, "headmistress")) {
    const row = await pool.query(
      `
        SELECT 1
        FROM school_sections ss
        WHERE ss.school_id = $1
          AND ss.id = $2
          AND (
            ss.head_user_id = $3
            OR ss.coordinator_user_id = $3
            OR EXISTS (
              SELECT 1
              FROM staff_profiles sp
              WHERE sp.school_id = ss.school_id
                AND sp.user_id = $3
                AND sp.primary_section_id = ss.id
            )
          )
        LIMIT 1
      `,
      [auth.schoolId, classroom.section_id, auth.userId]
    );
    if (row.rows[0]) return;
    throw new AppError(403, "FORBIDDEN", "Headmistress cannot manage this classroom");
  }

  if (hasRole(auth, "teacher")) {
    await ensureTeacherCanManageClassroom({
      schoolId: auth.schoolId,
      userId: auth.userId,
      classroomId: classroom.id,
      message: "Teacher is not assigned to this classroom",
    });
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No report card manage permission for this role");
}

async function ensureReportCardVisible({ auth, reportCard }) {
  if (hasAnyRole(auth, ["school_admin", "principal", "vice_principal"])) return;

  if (hasRole(auth, "headmistress")) {
    const row = await pool.query(
      `
        SELECT 1
        FROM classrooms c
        JOIN school_sections ss ON ss.id = c.section_id AND ss.school_id = c.school_id
        WHERE c.school_id = $1
          AND c.id = $2
          AND (
            ss.head_user_id = $3
            OR ss.coordinator_user_id = $3
            OR EXISTS (
              SELECT 1
              FROM staff_profiles sp
              WHERE sp.school_id = ss.school_id
                AND sp.user_id = $3
                AND sp.primary_section_id = ss.id
            )
          )
        LIMIT 1
      `,
      [auth.schoolId, reportCard.classroom_id, auth.userId]
    );
    if (!row.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Headmistress cannot access this report card");
    }
    return;
  }

  if (hasRole(auth, "teacher")) {
    await ensureTeacherCanManageClassroom({
      schoolId: auth.schoolId,
      userId: auth.userId,
      classroomId: reportCard.classroom_id,
      message: "Teacher cannot access this report card",
    });
    return;
  }

  if (hasRole(auth, "parent")) {
    const row = await pool.query(
      `
        SELECT 1
        FROM parent_students ps
        JOIN parents p ON p.id = ps.parent_id
        WHERE ps.school_id = $1
          AND ps.student_id = $2
          AND p.school_id = $1
          AND p.user_id = $3
        LIMIT 1
      `,
      [auth.schoolId, reportCard.student_id, auth.userId]
    );
    if (!row.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Parent cannot access this report card");
    }
    return;
  }

  if (hasRole(auth, "student")) {
    const row = await pool.query(
      `
        SELECT 1
        FROM student_user_accounts sua
        JOIN students s ON s.id = sua.student_id
        WHERE sua.user_id = $1
          AND sua.student_id = $2
          AND s.school_id = $3
        LIMIT 1
      `,
      [auth.userId, reportCard.student_id, auth.schoolId]
    );
    if (!row.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Student can only access own report card");
    }
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No report card visibility for this role");
}

async function getDefaultGradingScaleWithBands({ schoolId }) {
  const scaleResult = await pool.query(
    `
      SELECT id, name, is_default
      FROM grading_scales
      WHERE school_id = $1
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `,
    [schoolId]
  );
  const scale = scaleResult.rows[0] || null;
  if (!scale) {
    throw new AppError(422, "VALIDATION_ERROR", "No grading scale configured for this school");
  }

  const bandsResult = await pool.query(
    `
      SELECT grade, min_percentage, max_percentage, gpa_points, sort_order
      FROM grading_scale_bands
      WHERE grading_scale_id = $1
      ORDER BY sort_order ASC, min_percentage DESC
    `,
    [scale.id]
  );

  if (bandsResult.rows.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Selected grading scale has no bands");
  }

  return {
    scale,
    bands: bandsResult.rows,
  };
}

function resolveGrade(percentage, bands) {
  if (percentage === null || percentage === undefined || Number.isNaN(Number(percentage))) return null;
  const value = Number(percentage);
  const band = bands.find((row) => value >= Number(row.min_percentage) && value <= Number(row.max_percentage));
  return band?.grade || null;
}

async function buildConsolidatedData({ schoolId, classroomId, examTermId }) {
  const [studentsResult, subjectsResult, assessmentsPerSubject, scoresResult, scoreCountResult] = await Promise.all([
    pool.query(
      `
        SELECT
          s.id AS student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          se.roll_no
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
        WHERE se.school_id = $1
          AND se.classroom_id = $2
          AND se.status = 'active'
        ORDER BY se.roll_no ASC NULLS LAST, s.first_name ASC
      `,
      [schoolId, classroomId]
    ),
    pool.query(
      `
        SELECT DISTINCT
          sub.id AS subject_id,
          sub.name AS subject_name,
          sub.code AS subject_code
        FROM subjects sub
        WHERE sub.school_id = $1
          AND sub.id IN (
            SELECT cs.subject_id
            FROM classroom_subjects cs
            WHERE cs.school_id = $1
              AND cs.classroom_id = $2
            UNION
            SELECT a.subject_id
            FROM assessments a
            WHERE a.school_id = $1
              AND a.classroom_id = $2
              AND a.exam_term_id = $3
              AND a.subject_id IS NOT NULL
          )
        ORDER BY sub.name ASC
      `,
      [schoolId, classroomId, examTermId]
    ),
    pool.query(
      `
        SELECT
          a.subject_id,
          COUNT(*)::int AS assessment_count
        FROM assessments a
        WHERE a.school_id = $1
          AND a.classroom_id = $2
          AND a.exam_term_id = $3
          AND a.subject_id IS NOT NULL
        GROUP BY a.subject_id
      `,
      [schoolId, classroomId, examTermId]
    ),
    pool.query(
      `
        SELECT
          sc.student_id,
          a.subject_id,
          SUM(sc.marks_obtained)::numeric(10,2) AS marks_obtained,
          SUM(a.max_marks)::numeric(10,2) AS max_marks,
          COUNT(sc.id)::int AS score_entries
        FROM assessments a
        JOIN assessment_scores sc
          ON sc.school_id = a.school_id
         AND sc.assessment_id = a.id
        WHERE a.school_id = $1
          AND a.classroom_id = $2
          AND a.exam_term_id = $3
          AND a.subject_id IS NOT NULL
        GROUP BY sc.student_id, a.subject_id
      `,
      [schoolId, classroomId, examTermId]
    ),
    pool.query(
      `
        SELECT COUNT(*)::int AS total_scores
        FROM assessments a
        JOIN assessment_scores sc
          ON sc.school_id = a.school_id
         AND sc.assessment_id = a.id
        WHERE a.school_id = $1
          AND a.classroom_id = $2
          AND a.exam_term_id = $3
      `,
      [schoolId, classroomId, examTermId]
    ),
  ]);

  const assessmentCountBySubject = new Map(
    assessmentsPerSubject.rows.map((row) => [row.subject_id, Number(row.assessment_count)])
  );

  const scoreByStudentSubject = new Map();
  for (const row of scoresResult.rows) {
    scoreByStudentSubject.set(`${row.student_id}:${row.subject_id}`, row);
  }

  const students = studentsResult.rows.map((student) => {
    const subjects = subjectsResult.rows.map((subject) => {
      const score = scoreByStudentSubject.get(`${student.student_id}:${subject.subject_id}`);
      const expectedEntries = assessmentCountBySubject.get(subject.subject_id) || 0;
      const gotEntries = Number(score?.score_entries || 0);
      const maxMarks = Number(score?.max_marks || 0);
      const marksObtained = Number(score?.marks_obtained || 0);
      const percentage = maxMarks > 0 ? Number(((marksObtained / maxMarks) * 100).toFixed(2)) : null;

      return {
        subject_id: subject.subject_id,
        subject_name: subject.subject_name,
        subject_code: subject.subject_code,
        marks_obtained: marksObtained,
        max_marks: maxMarks,
        percentage,
        expected_entries: expectedEntries,
        entered_entries: gotEntries,
        is_complete: expectedEntries > 0 ? gotEntries >= expectedEntries : false,
      };
    });

    return {
      student_id: student.student_id,
      student_code: student.student_code,
      full_name: `${student.first_name}${student.last_name ? ` ${student.last_name}` : ""}`.trim(),
      roll_no: student.roll_no,
      subjects,
    };
  });

  const assessmentCount = assessmentsPerSubject.rows.reduce((sum, row) => sum + Number(row.assessment_count || 0), 0);
  const expectedScores = studentsResult.rows.length * assessmentCount;
  const enteredScores = Number(scoreCountResult.rows[0]?.total_scores || 0);

  return {
    students,
    subjects: subjectsResult.rows,
    summary: {
      student_count: studentsResult.rows.length,
      subject_count: subjectsResult.rows.length,
      assessment_count: assessmentCount,
      expected_scores: expectedScores,
      entered_scores: enteredScores,
      completion_percentage: expectedScores > 0 ? Math.round((enteredScores / expectedScores) * 100) : 0,
    },
  };
}

async function generateReportCards({ auth, body }) {
  const classroom = await ensureClassroomInSchool({
    schoolId: auth.schoolId,
    classroomId: body.classroom_id,
  });
  const examTerm = await ensureExamTermInSchool({
    schoolId: auth.schoolId,
    examTermId: body.exam_term_id,
  });
  if (classroom.academic_year_id !== examTerm.academic_year_id) {
    throw new AppError(422, "VALIDATION_ERROR", "Exam term does not belong to classroom academic year");
  }

  await ensureClassroomManageAccess({
    auth,
    classroom,
  });

  const [grading, consolidated] = await Promise.all([
    getDefaultGradingScaleWithBands({ schoolId: auth.schoolId }),
    buildConsolidatedData({
      schoolId: auth.schoolId,
      classroomId: body.classroom_id,
      examTermId: body.exam_term_id,
    }),
  ]);

  const students = body.student_id
    ? consolidated.students.filter((row) => row.student_id === body.student_id)
    : consolidated.students;

  if (students.length === 0) {
    throw new AppError(404, "NOT_FOUND", "No eligible students found for report card generation");
  }

  const attendanceParams = [auth.schoolId, body.classroom_id, students.map((row) => row.student_id)];
  let attendanceDateClause = "";
  if (examTerm.starts_on) {
    attendanceParams.push(examTerm.starts_on);
    attendanceDateClause += ` AND ar.attendance_date >= $${attendanceParams.length}`;
  }
  if (examTerm.ends_on) {
    attendanceParams.push(examTerm.ends_on);
    attendanceDateClause += ` AND ar.attendance_date <= $${attendanceParams.length}`;
  }

  const attendanceResult = await pool.query(
    `
      SELECT
        ar.student_id,
        COUNT(*) FILTER (WHERE ar.status IN ('present', 'late'))::int AS attendance_present,
        COUNT(*)::int AS attendance_total
      FROM attendance_records ar
      WHERE ar.school_id = $1
        AND ar.classroom_id = $2
        AND ar.student_id = ANY($3::uuid[])
        ${attendanceDateClause}
      GROUP BY ar.student_id
    `,
    attendanceParams
  );
  const attendanceByStudent = new Map(attendanceResult.rows.map((row) => [row.student_id, row]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const generatedCards = [];

    for (const student of students) {
      const totalMarksObtained = student.subjects.reduce((sum, row) => sum + Number(row.marks_obtained || 0), 0);
      const totalMaxMarks = student.subjects.reduce((sum, row) => sum + Number(row.max_marks || 0), 0);
      const percentage = totalMaxMarks > 0 ? Number(((totalMarksObtained / totalMaxMarks) * 100).toFixed(2)) : null;
      const grade = resolveGrade(percentage, grading.bands);
      const attendance = attendanceByStudent.get(student.student_id);

      const reportCardResult = await client.query(
        `
          INSERT INTO report_cards (
            school_id,
            student_id,
            classroom_id,
            exam_term_id,
            grading_scale_id,
            total_marks_obtained,
            total_max_marks,
            percentage,
            grade,
            attendance_present,
            attendance_total,
            remarks,
            status,
            generated_at,
            generated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', NOW(), $13)
          ON CONFLICT (school_id, student_id, exam_term_id)
          DO UPDATE SET
            classroom_id = EXCLUDED.classroom_id,
            grading_scale_id = EXCLUDED.grading_scale_id,
            total_marks_obtained = EXCLUDED.total_marks_obtained,
            total_max_marks = EXCLUDED.total_max_marks,
            percentage = EXCLUDED.percentage,
            grade = EXCLUDED.grade,
            attendance_present = EXCLUDED.attendance_present,
            attendance_total = EXCLUDED.attendance_total,
            remarks = EXCLUDED.remarks,
            generated_at = NOW(),
            generated_by_user_id = EXCLUDED.generated_by_user_id,
            updated_at = NOW()
          RETURNING *
        `,
        [
          auth.schoolId,
          student.student_id,
          body.classroom_id,
          body.exam_term_id,
          grading.scale.id,
          totalMarksObtained,
          totalMaxMarks,
          percentage,
          grade,
          Number(attendance?.attendance_present || 0),
          Number(attendance?.attendance_total || 0),
          body.remarks || null,
          auth.userId,
        ]
      );

      const reportCard = reportCardResult.rows[0];

      await client.query("DELETE FROM report_card_subjects WHERE report_card_id = $1", [reportCard.id]);

      for (let index = 0; index < student.subjects.length; index += 1) {
        const row = student.subjects[index];
        await client.query(
          `
            INSERT INTO report_card_subjects (
              report_card_id,
              subject_id,
              subject_name,
              marks_obtained,
              max_marks,
              percentage,
              grade,
              sort_order
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            reportCard.id,
            row.subject_id,
            row.subject_name,
            row.marks_obtained,
            row.max_marks,
            row.percentage,
            resolveGrade(row.percentage, grading.bands),
            index,
          ]
        );
      }

      generatedCards.push(reportCard);
    }

    await client.query("COMMIT");

    fireAndForgetAuditLog({
      schoolId: auth.schoolId,
      actorUserId: auth.userId,
      action: "report_cards.generated",
      entityName: "report_cards",
      entityId: null,
      metadata: {
        classroom_id: body.classroom_id,
        exam_term_id: body.exam_term_id,
        generated_count: generatedCards.length,
      },
    });

    return {
      generated_count: generatedCards.length,
      report_cards: generatedCards.map((row) => ({
        id: row.id,
        student_id: row.student_id,
        status: row.status,
        percentage: row.percentage !== null ? Number(row.percentage) : null,
        grade: row.grade,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getReportCardById({ schoolId, reportCardId }) {
  const row = await pool.query(
    `
      SELECT
        rc.id,
        rc.school_id,
        rc.student_id,
        rc.classroom_id,
        rc.exam_term_id,
        rc.grading_scale_id,
        rc.total_marks_obtained,
        rc.total_max_marks,
        rc.percentage,
        rc.grade,
        rc.attendance_present,
        rc.attendance_total,
        rc.remarks,
        rc.status,
        rc.generated_at,
        rc.published_at,
        rc.generated_by_user_id,
        s.student_code,
        s.first_name,
        s.last_name,
        c.grade_label,
        c.section_label,
        c.classroom_code,
        et.name AS exam_term_name,
        et.term_type AS exam_term_type,
        et.starts_on AS term_starts_on,
        et.ends_on AS term_ends_on,
        gs.name AS grading_scale_name
      FROM report_cards rc
      JOIN students s ON s.id = rc.student_id AND s.school_id = rc.school_id
      JOIN classrooms c ON c.id = rc.classroom_id AND c.school_id = rc.school_id
      JOIN exam_terms et ON et.id = rc.exam_term_id AND et.school_id = rc.school_id
      LEFT JOIN grading_scales gs ON gs.id = rc.grading_scale_id
      WHERE rc.school_id = $1
        AND rc.id = $2
      LIMIT 1
    `,
    [schoolId, reportCardId]
  );
  return row.rows[0] || null;
}

async function resolveFamilyVisibleStudents({ auth, requestedStudentId }) {
  if (hasRole(auth, "parent")) {
    const result = await pool.query(
      `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name
        FROM parent_students ps
        JOIN parents p
          ON p.id = ps.parent_id
         AND p.school_id = ps.school_id
        JOIN students s
          ON s.id = ps.student_id
         AND s.school_id = ps.school_id
        WHERE ps.school_id = $1
          AND p.user_id = $2
        ORDER BY s.first_name ASC, s.last_name ASC, s.student_code ASC
      `,
      [auth.schoolId, auth.userId]
    );

    const students = result.rows;
    if (!students.length) return [];

    if (requestedStudentId) {
      const matched = students.find((row) => row.id === requestedStudentId);
      if (!matched) {
        throw new AppError(403, "FORBIDDEN", "Parent can only access linked student report cards");
      }
      return [matched];
    }

    return students;
  }

  if (hasRole(auth, "student")) {
    const result = await pool.query(
      `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name
        FROM student_user_accounts sua
        JOIN students s
          ON s.id = sua.student_id
         AND s.school_id = $2
        WHERE sua.user_id = $1
        LIMIT 1
      `,
      [auth.userId, auth.schoolId]
    );
    const student = result.rows[0] || null;
    if (!student) return [];
    if (requestedStudentId && requestedStudentId !== student.id) {
      throw new AppError(403, "FORBIDDEN", "Student can only access own report cards");
    }
    return [student];
  }

  throw new AppError(403, "FORBIDDEN", "No report card family visibility for this role");
}

router.get(
  "/mine/history",
  requireAuth,
  requireRoles("parent", "student"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(familyHistoryQuerySchema, req.query, "Invalid family report card history query");
    const visibleStudents = await resolveFamilyVisibleStudents({
      auth: req.auth,
      requestedStudentId: query.student_id,
    });

    if (!visibleStudents.length) {
      return success(
        res,
        {
          students: [],
          items: [],
          summary: {
            total_cards: 0,
            average_percentage: 0,
            latest_published_at: null,
          },
        },
        200,
        {
          pagination: {
            page: query.page,
            page_size: query.page_size,
            total_items: 0,
            total_pages: 1,
          },
        }
      );
    }

    const studentIds = visibleStudents.map((row) => row.id);
    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total_items
        FROM report_cards rc
        WHERE rc.school_id = $1
          AND rc.status = 'published'
          AND rc.student_id = ANY($2::uuid[])
      `,
      [req.auth.schoolId, studentIds]
    );
    const totalItems = Number(totalResult.rows[0]?.total_items || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const [itemsResult, summaryResult] = await Promise.all([
      pool.query(
        `
          SELECT
            rc.id,
            rc.student_id,
            rc.status,
            rc.percentage,
            rc.grade,
            rc.attendance_present,
            rc.attendance_total,
            rc.generated_at,
            rc.published_at,
            s.student_code,
            s.first_name,
            s.last_name,
            c.grade_label,
            c.section_label,
            c.classroom_code,
            et.id AS exam_term_id,
            et.name AS exam_term_name,
            et.term_type AS exam_term_type
          FROM report_cards rc
          JOIN students s
            ON s.id = rc.student_id
           AND s.school_id = rc.school_id
          JOIN classrooms c
            ON c.id = rc.classroom_id
           AND c.school_id = rc.school_id
          JOIN exam_terms et
            ON et.id = rc.exam_term_id
           AND et.school_id = rc.school_id
          WHERE rc.school_id = $1
            AND rc.status = 'published'
            AND rc.student_id = ANY($2::uuid[])
          ORDER BY COALESCE(rc.published_at, rc.generated_at) DESC, et.ends_on DESC NULLS LAST
          LIMIT $3
          OFFSET $4
        `,
        [req.auth.schoolId, studentIds, query.page_size, offset]
      ),
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_cards,
            COALESCE(AVG(rc.percentage), 0)::numeric(7,2) AS average_percentage,
            MAX(rc.published_at) AS latest_published_at
          FROM report_cards rc
          WHERE rc.school_id = $1
            AND rc.status = 'published'
            AND rc.student_id = ANY($2::uuid[])
        `,
        [req.auth.schoolId, studentIds]
      ),
    ]);

    const summaryRow = summaryResult.rows[0] || {
      total_cards: 0,
      average_percentage: 0,
      latest_published_at: null,
    };

    const items = itemsResult.rows.map((row) => {
      const attendanceTotal = Number(row.attendance_total || 0);
      const attendancePresent = Number(row.attendance_present || 0);
      return {
        id: row.id,
        student_id: row.student_id,
        student_code: row.student_code,
        student_name: `${row.first_name}${row.last_name ? ` ${row.last_name}` : ""}`.trim(),
        classroom_label: `${row.grade_label || ""}${row.section_label ? `-${row.section_label}` : ""}`.trim(),
        classroom_code: row.classroom_code,
        exam_term: {
          id: row.exam_term_id,
          name: row.exam_term_name,
          term_type: row.exam_term_type,
        },
        percentage: row.percentage !== null ? Number(row.percentage) : null,
        grade: row.grade,
        attendance_present: attendancePresent,
        attendance_total: attendanceTotal,
        attendance_rate: attendanceTotal > 0 ? Number(((attendancePresent / attendanceTotal) * 100).toFixed(2)) : null,
        generated_at: row.generated_at,
        published_at: row.published_at,
        status: row.status,
      };
    });

    return success(
      res,
      {
        students: visibleStudents.map((row) => ({
          id: row.id,
          student_code: row.student_code,
          full_name: `${row.first_name}${row.last_name ? ` ${row.last_name}` : ""}`.trim(),
        })),
        items,
        summary: {
          total_cards: Number(summaryRow.total_cards || 0),
          average_percentage: Number(summaryRow.average_percentage || 0),
          latest_published_at: summaryRow.latest_published_at,
        },
      },
      200,
      {
        pagination: {
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          total_pages: totalPages,
        },
      }
    );
  })
);

router.get(
  "/consolidated",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(consolidatedQuerySchema, req.query, "Invalid consolidated report query");

    const classroom = await ensureClassroomInSchool({
      schoolId: req.auth.schoolId,
      classroomId: query.classroom_id,
    });
    const examTerm = await ensureExamTermInSchool({
      schoolId: req.auth.schoolId,
      examTermId: query.exam_term_id,
    });
    if (classroom.academic_year_id !== examTerm.academic_year_id) {
      throw new AppError(422, "VALIDATION_ERROR", "Exam term does not belong to classroom academic year");
    }

    await ensureClassroomManageAccess({
      auth: req.auth,
      classroom,
    });

    const consolidated = await buildConsolidatedData({
      schoolId: req.auth.schoolId,
      classroomId: query.classroom_id,
      examTermId: query.exam_term_id,
    });

    return success(
      res,
      {
        classroom: {
          id: classroom.id,
          grade_label: classroom.grade_label,
          section_label: classroom.section_label,
          classroom_code: classroom.classroom_code,
        },
        exam_term: {
          id: examTerm.id,
          name: examTerm.name,
          term_type: examTerm.term_type,
          starts_on: examTerm.starts_on,
          ends_on: examTerm.ends_on,
          is_locked: examTerm.is_locked,
        },
        ...consolidated,
      },
      200
    );
  })
);

router.get(
  "/history",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(historyQuerySchema, req.query, "Invalid report card history query");

    const classroom = await ensureClassroomInSchool({
      schoolId: req.auth.schoolId,
      classroomId: query.classroom_id,
    });
    const examTerm = await ensureExamTermInSchool({
      schoolId: req.auth.schoolId,
      examTermId: query.exam_term_id,
    });
    if (classroom.academic_year_id !== examTerm.academic_year_id) {
      throw new AppError(422, "VALIDATION_ERROR", "Exam term does not belong to classroom academic year");
    }

    await ensureClassroomManageAccess({
      auth: req.auth,
      classroom,
    });

    const whereParts = ["rc.school_id = $1", "rc.classroom_id = $2", "rc.exam_term_id = $3"];
    const whereParams = [req.auth.schoolId, query.classroom_id, query.exam_term_id];
    if (query.status) {
      whereParts.push(`rc.status = $${whereParams.length + 1}`);
      whereParams.push(query.status);
    }
    if (query.subject_id) {
      whereParts.push(
        `EXISTS (
          SELECT 1
          FROM report_card_subjects rcs_filter
          WHERE rcs_filter.report_card_id = rc.id
            AND rcs_filter.subject_id = $${whereParams.length + 1}
        )`
      );
      whereParams.push(query.subject_id);
    }
    if (query.comment_status) {
      const comparator =
        query.comment_status === "missing"
          ? "NULLIF(TRIM(COALESCE(rcs_filter.teacher_comment, '')), '') IS NULL"
          : "NULLIF(TRIM(COALESCE(rcs_filter.teacher_comment, '')), '') IS NOT NULL";
      const subjectCommentFilterSql = query.subject_id
        ? `AND rcs_filter.subject_id = $${whereParams.length + 1}`
        : "";
      whereParts.push(
        `EXISTS (
          SELECT 1
          FROM report_card_subjects rcs_filter
          WHERE rcs_filter.report_card_id = rc.id
            ${subjectCommentFilterSql}
            AND ${comparator}
        )`
      );
      if (query.subject_id) {
        whereParams.push(query.subject_id);
      }
    }
    const whereSql = whereParts.join(" AND ");

    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total_items
        FROM report_cards rc
        WHERE ${whereSql}
      `,
      whereParams
    );
    const totalItems = Number(totalResult.rows[0]?.total_items || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const [itemsResult, kpiResult, gradeDistributionResult] = await Promise.all([
      pool.query(
        `
          SELECT
            rc.id,
            rc.student_id,
            rc.status,
            rc.percentage,
            rc.grade,
            rc.attendance_present,
            rc.attendance_total,
            rc.generated_at,
            rc.published_at,
            rc.updated_at,
            s.student_code,
            s.first_name,
            s.last_name,
            enr.roll_no
          FROM report_cards rc
          JOIN students s
            ON s.id = rc.student_id
           AND s.school_id = rc.school_id
          LEFT JOIN LATERAL (
            SELECT se.roll_no
            FROM student_enrollments se
            WHERE se.school_id = rc.school_id
              AND se.student_id = rc.student_id
              AND se.classroom_id = rc.classroom_id
            ORDER BY
              CASE WHEN se.status = 'active' THEN 0 ELSE 1 END,
              se.joined_on DESC NULLS LAST,
              se.created_at DESC
            LIMIT 1
          ) enr ON TRUE
          WHERE ${whereSql}
          ORDER BY enr.roll_no ASC NULLS LAST, s.first_name ASC, s.last_name ASC
          LIMIT $${whereParams.length + 1}
          OFFSET $${whereParams.length + 2}
        `,
        [...whereParams, query.page_size, offset]
      ),
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_cards,
            COUNT(*) FILTER (WHERE rc.status = 'published')::int AS published_cards,
            COUNT(*) FILTER (WHERE rc.status = 'draft')::int AS draft_cards,
            COALESCE(AVG(rc.percentage), 0)::numeric(7,2) AS avg_percentage,
            COALESCE(
              AVG(
                CASE
                  WHEN rc.attendance_total > 0
                    THEN (rc.attendance_present::numeric / rc.attendance_total::numeric) * 100
                  ELSE NULL
                END
              ),
              0
            )::numeric(7,2) AS avg_attendance_rate
          FROM report_cards rc
          WHERE ${whereSql}
        `,
        whereParams
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(TRIM(rc.grade), ''), 'Ungraded') AS grade,
            COUNT(*)::int AS count
          FROM report_cards rc
          WHERE ${whereSql}
          GROUP BY COALESCE(NULLIF(TRIM(rc.grade), ''), 'Ungraded')
          ORDER BY
            CASE WHEN COALESCE(NULLIF(TRIM(rc.grade), ''), 'Ungraded') = 'Ungraded' THEN 1 ELSE 0 END,
            COALESCE(NULLIF(TRIM(rc.grade), ''), 'Ungraded')
        `,
        whereParams
      ),
    ]);

    const kpiRow = kpiResult.rows[0] || {
      total_cards: 0,
      published_cards: 0,
      draft_cards: 0,
      avg_percentage: 0,
      avg_attendance_rate: 0,
    };

    const items = itemsResult.rows.map((row) => {
      const attendanceTotal = Number(row.attendance_total || 0);
      const attendancePresent = Number(row.attendance_present || 0);
      return {
        id: row.id,
        student_id: row.student_id,
        student_code: row.student_code,
        student_name: `${row.first_name}${row.last_name ? ` ${row.last_name}` : ""}`.trim(),
        roll_no: row.roll_no,
        status: row.status,
        percentage: row.percentage !== null ? Number(row.percentage) : null,
        grade: row.grade,
        attendance_present: attendancePresent,
        attendance_total: attendanceTotal,
        attendance_rate: attendanceTotal > 0 ? Number(((attendancePresent / attendanceTotal) * 100).toFixed(2)) : null,
        generated_at: row.generated_at,
        published_at: row.published_at,
        updated_at: row.updated_at,
      };
    });

    return success(
      res,
      {
        classroom: {
          id: classroom.id,
          grade_label: classroom.grade_label,
          section_label: classroom.section_label,
          classroom_code: classroom.classroom_code,
        },
        exam_term: {
          id: examTerm.id,
          name: examTerm.name,
          term_type: examTerm.term_type,
          starts_on: examTerm.starts_on,
          ends_on: examTerm.ends_on,
          is_locked: examTerm.is_locked,
        },
        items,
        kpis: {
          total_cards: Number(kpiRow.total_cards || 0),
          published_cards: Number(kpiRow.published_cards || 0),
          draft_cards: Number(kpiRow.draft_cards || 0),
          average_percentage: Number(kpiRow.avg_percentage || 0),
          average_attendance_rate: Number(kpiRow.avg_attendance_rate || 0),
          grade_distribution: gradeDistributionResult.rows.map((row) => {
            const count = Number(row.count || 0);
            return {
              grade: row.grade,
              count,
              percentage: totalItems > 0 ? Number(((count / totalItems) * 100).toFixed(2)) : 0,
            };
          }),
        },
      },
      200,
      {
        pagination: {
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          total_pages: totalPages,
        },
      }
    );
  })
);

router.post(
  "/generate",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(generateSchema, req.body, "Invalid report card generate payload");
    const generated = await generateReportCards({
      auth: req.auth,
      body,
    });
    return success(res, generated, 200);
  })
);

router.post(
  "/bulk-generate",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(bulkGenerateSchema, req.body, "Invalid bulk report card generate payload");
    const generated = await generateReportCards({
      auth: req.auth,
      body,
    });
    return success(res, generated, 200);
  })
);

router.get(
  "/:reportCardId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(pathSchema, req.params, "Invalid report card id");

    const reportCard = await getReportCardById({
      schoolId: req.auth.schoolId,
      reportCardId: path.reportCardId,
    });
    if (!reportCard) {
      throw new AppError(404, "NOT_FOUND", "Report card not found");
    }

    await ensureReportCardVisible({
      auth: req.auth,
      reportCard,
    });

    const subjectsResult = await pool.query(
      `
        SELECT
          id,
          subject_id,
          subject_name,
          marks_obtained,
          max_marks,
          percentage,
          grade,
          comment_category,
          teacher_comment,
          sort_order
        FROM report_card_subjects
        WHERE report_card_id = $1
        ORDER BY sort_order ASC, subject_name ASC
      `,
      [reportCard.id]
    );

    return success(
      res,
      {
        id: reportCard.id,
        student: {
          id: reportCard.student_id,
          student_code: reportCard.student_code,
          first_name: reportCard.first_name,
          last_name: reportCard.last_name,
          full_name: `${reportCard.first_name}${reportCard.last_name ? ` ${reportCard.last_name}` : ""}`.trim(),
        },
        classroom: {
          id: reportCard.classroom_id,
          grade_label: reportCard.grade_label,
          section_label: reportCard.section_label,
          classroom_code: reportCard.classroom_code,
        },
        exam_term: {
          id: reportCard.exam_term_id,
          name: reportCard.exam_term_name,
          term_type: reportCard.exam_term_type,
          starts_on: reportCard.term_starts_on,
          ends_on: reportCard.term_ends_on,
        },
        grading_scale: {
          id: reportCard.grading_scale_id,
          name: reportCard.grading_scale_name,
        },
        summary: {
          total_marks_obtained: reportCard.total_marks_obtained !== null ? Number(reportCard.total_marks_obtained) : null,
          total_max_marks: reportCard.total_max_marks !== null ? Number(reportCard.total_max_marks) : null,
          percentage: reportCard.percentage !== null ? Number(reportCard.percentage) : null,
          grade: reportCard.grade,
          attendance_present: reportCard.attendance_present,
          attendance_total: reportCard.attendance_total,
          remarks: reportCard.remarks,
          status: reportCard.status,
          generated_at: reportCard.generated_at,
          published_at: reportCard.published_at,
        },
        subjects: subjectsResult.rows.map((row) => ({
          ...row,
          marks_obtained: Number(row.marks_obtained || 0),
          max_marks: Number(row.max_marks || 0),
          percentage: row.percentage !== null ? Number(row.percentage) : null,
        })),
      },
      200
    );
  })
);

router.patch(
  "/:reportCardId/subject-comments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(pathSchema, req.params, "Invalid report card id");
    const body = parseSchema(
      updateSubjectCommentsSchema,
      req.body,
      "Invalid report card subject comments payload"
    );

    const reportCard = await getReportCardById({
      schoolId: req.auth.schoolId,
      reportCardId: path.reportCardId,
    });
    if (!reportCard) {
      throw new AppError(404, "NOT_FOUND", "Report card not found");
    }

    const classroom = await ensureClassroomInSchool({
      schoolId: req.auth.schoolId,
      classroomId: reportCard.classroom_id,
    });

    await ensureClassroomManageAccess({
      auth: req.auth,
      classroom,
    });

    const subjectIds = [...new Set(body.comments.map((row) => row.report_card_subject_id))];
    const existingSubjects = await pool.query(
      `
        SELECT id
        FROM report_card_subjects
        WHERE report_card_id = $1
          AND id = ANY($2::uuid[])
      `,
      [reportCard.id, subjectIds]
    );

    if (existingSubjects.rows.length !== subjectIds.length) {
      throw new AppError(404, "NOT_FOUND", "One or more report card subjects were not found");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of body.comments) {
        await client.query(
          `
            UPDATE report_card_subjects
            SET
              comment_category = $2,
              teacher_comment = $3
            WHERE report_card_id = $1
              AND id = $4
          `,
          [
            reportCard.id,
            item.comment_category || null,
            item.teacher_comment || null,
            item.report_card_subject_id,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "report_cards.subject_comments_updated",
      entityName: "report_cards",
      entityId: reportCard.id,
      metadata: {
        updated_count: body.comments.length,
        categories: [...new Set(body.comments.map((item) => item.comment_category).filter(Boolean))],
      },
    });

    return success(
      res,
      {
        id: reportCard.id,
        updated_count: body.comments.length,
      },
      200
    );
  })
);

router.get(
  "/:reportCardId/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const path = parseSchema(pathSchema, req.params, "Invalid report card id");
    const reportCard = await getReportCardById({
      schoolId: req.auth.schoolId,
      reportCardId: path.reportCardId,
    });
    if (!reportCard) {
      throw new AppError(404, "NOT_FOUND", "Report card not found");
    }

    await ensureReportCardVisible({
      auth: req.auth,
      reportCard,
    });

    const [subjectsResult, bandsResult, schoolResult, enrollResult] = await Promise.all([
      pool.query(
        `
          SELECT subject_name, marks_obtained, max_marks, percentage, grade, comment_category, teacher_comment
          FROM report_card_subjects
          WHERE report_card_id = $1
          ORDER BY sort_order ASC, subject_name ASC
        `,
        [reportCard.id]
      ),
      pool.query(
        `
          SELECT grade, min_percentage, max_percentage, gpa_points, sort_order
          FROM grading_scale_bands
          WHERE grading_scale_id = $1
          ORDER BY sort_order ASC, min_percentage DESC
        `,
        [reportCard.grading_scale_id]
      ),
      pool.query("SELECT name FROM schools WHERE id = $1 LIMIT 1", [req.auth.schoolId]),
      pool.query(
        `
          SELECT roll_no
          FROM student_enrollments
          WHERE school_id = $1
            AND student_id = $2
            AND classroom_id = $3
          ORDER BY joined_on DESC, created_at DESC
          LIMIT 1
        `,
        [req.auth.schoolId, reportCard.student_id, reportCard.classroom_id]
      ),
    ]);

    const pdfBuffer = await buildReportCardPdfBuffer({
      school: {
        name: schoolResult.rows[0]?.name,
      },
      student: {
        full_name: `${reportCard.first_name}${reportCard.last_name ? ` ${reportCard.last_name}` : ""}`.trim(),
        student_code: reportCard.student_code,
        roll_no: enrollResult.rows[0]?.roll_no || null,
      },
      classroom: {
        label: `${reportCard.grade_label || ""}${reportCard.section_label ? `-${reportCard.section_label}` : ""}`.trim(),
      },
      term: {
        name: reportCard.exam_term_name,
        term_type: reportCard.exam_term_type,
      },
      summary: {
        total_marks_obtained: reportCard.total_marks_obtained,
        total_max_marks: reportCard.total_max_marks,
        percentage: reportCard.percentage,
        grade: reportCard.grade,
        attendance_present: reportCard.attendance_present,
        attendance_total: reportCard.attendance_total,
        remarks: reportCard.remarks,
      },
      subjects: subjectsResult.rows.map((row) => ({
        ...row,
        marks_obtained: Number(row.marks_obtained || 0),
        max_marks: Number(row.max_marks || 0),
        percentage: row.percentage !== null ? Number(row.percentage) : null,
      })),
      gradingScaleName: reportCard.grading_scale_name,
      gradingBands: bandsResult.rows,
    });

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "report_cards.pdf_downloaded",
      entityName: "report_cards",
      entityId: reportCard.id,
      metadata: {
        student_id: reportCard.student_id,
      },
    });

    const fileName = `agora_report_card_${reportCard.student_code || reportCard.student_id}_${reportCard.exam_term_name || "term"}.pdf`
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_.-]/g, "");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(pdfBuffer);
  })
);

async function updateReportCardStatus({ req, res, status }) {
  const path = parseSchema(pathSchema, req.params, "Invalid report card id");
  const reportCard = await getReportCardById({
    schoolId: req.auth.schoolId,
    reportCardId: path.reportCardId,
  });
  if (!reportCard) {
    throw new AppError(404, "NOT_FOUND", "Report card not found");
  }

  const classroom = await ensureClassroomInSchool({
    schoolId: req.auth.schoolId,
    classroomId: reportCard.classroom_id,
  });
  await ensureClassroomManageAccess({
    auth: req.auth,
    classroom,
  });

  const updated = await pool.query(
    `
      UPDATE report_cards
      SET
        status = $1,
        published_at = CASE WHEN $1 = 'published' THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE school_id = $2
        AND id = $3
      RETURNING *
    `,
    [status, req.auth.schoolId, reportCard.id]
  );

  fireAndForgetAuditLog({
    schoolId: req.auth.schoolId,
    actorUserId: req.auth.userId,
    action: status === "published" ? "report_cards.published" : "report_cards.unpublished",
    entityName: "report_cards",
    entityId: reportCard.id,
    metadata: {
      classroom_id: reportCard.classroom_id,
      exam_term_id: reportCard.exam_term_id,
      student_id: reportCard.student_id,
    },
  });

  return success(
    res,
    {
      id: updated.rows[0].id,
      status: updated.rows[0].status,
      published_at: updated.rows[0].published_at,
    },
    200
  );
}

router.patch(
  "/:reportCardId/publish",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => updateReportCardStatus({ req, res, status: "published" }))
);

router.patch(
  "/:reportCardId/unpublish",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => updateReportCardStatus({ req, res, status: "draft" }))
);

router.post(
  "/bulk-publish",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(bulkPublishSchema, req.body, "Invalid bulk publish payload");

    const classroom = await ensureClassroomInSchool({
      schoolId: req.auth.schoolId,
      classroomId: body.classroom_id,
    });
    await ensureClassroomManageAccess({
      auth: req.auth,
      classroom,
    });

    const updated = await pool.query(
      `
        UPDATE report_cards
        SET
          status = 'published',
          published_at = NOW(),
          updated_at = NOW()
        WHERE school_id = $1
          AND classroom_id = $2
          AND exam_term_id = $3
        RETURNING id
      `,
      [req.auth.schoolId, body.classroom_id, body.exam_term_id]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "report_cards.bulk_published",
      entityName: "report_cards",
      entityId: null,
      metadata: {
        classroom_id: body.classroom_id,
        exam_term_id: body.exam_term_id,
        published_count: updated.rowCount,
      },
    });

    return success(
      res,
      {
        updated_count: updated.rowCount,
      },
      200
    );
  })
);

module.exports = router;
