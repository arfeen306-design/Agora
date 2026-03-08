const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const {
  listTeacherClassroomIds,
  ensureTeacherCanManageClassroom: ensureTeacherClassroomScope,
} = require("../utils/teacher-scope");

const router = express.Router();

const listAssessmentsQuerySchema = z.object({
  classroom_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().optional(),
  assessment_type: z.string().trim().min(1).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createAssessmentSchema = z.object({
  classroom_id: z.string().uuid(),
  subject_id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  assessment_type: z.string().trim().min(1).max(60),
  max_marks: z.number().positive(),
  assessment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateAssessmentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    assessment_type: z.string().trim().min(1).max(60).optional(),
    max_marks: z.number().positive().optional(),
    assessment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    subject_id: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const bulkScoresSchema = z.object({
  scores: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        marks_obtained: z.number().min(0),
        remarks: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .min(1),
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

function ensureMarksReadRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "headmistress") ||
    hasRole(auth, "teacher") ||
    hasRole(auth, "parent") ||
    hasRole(auth, "student")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No marks read permission for this role");
}

async function classroomExists(schoolId, classroomId) {
  const result = await pool.query(
    "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
    [schoolId, classroomId]
  );
  return Boolean(result.rows[0]);
}

async function subjectExists(schoolId, subjectId) {
  const result = await pool.query("SELECT id FROM subjects WHERE school_id = $1 AND id = $2 LIMIT 1", [
    schoolId,
    subjectId,
  ]);
  return Boolean(result.rows[0]);
}

async function ensureTeacherCanManageClassroom({ auth, classroomId }) {
  if (hasRole(auth, "school_admin")) return;
  if (!hasRole(auth, "teacher")) {
    throw new AppError(403, "FORBIDDEN", "Only teacher/admin can manage assessments");
  }
  await ensureTeacherClassroomScope({
    schoolId: auth.schoolId,
    userId: auth.userId,
    classroomId,
    message: "Teacher is not assigned to this classroom",
  });
}

async function getAssessmentById({ schoolId, assessmentId }) {
  const result = await pool.query(
    `
      SELECT
        id,
        school_id,
        classroom_id,
        subject_id,
        title,
        assessment_type,
        max_marks,
        assessment_date,
        created_by_user_id
      FROM assessments
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, assessmentId]
  );
  return result.rows[0] || null;
}

async function ensureStudentVisibleToRole({ auth, studentId }) {
  if (hasRole(auth, "school_admin")) return;
  if (hasRole(auth, "principal") || hasRole(auth, "vice_principal")) return;

  if (hasRole(auth, "headmistress")) {
    const result = await pool.query(
      `
        SELECT 1
        FROM student_enrollments se
        JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        WHERE se.school_id = $1
          AND se.student_id = $2
          AND se.status = 'active'
          AND c.section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = se.school_id
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
          )
        LIMIT 1
      `,
      [auth.schoolId, studentId, auth.userId]
    );
    if (!result.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Headmistress cannot access this student's marks");
    }
    return;
  }

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
    if (teacherClassroomIds.length === 0) {
      throw new AppError(403, "FORBIDDEN", "Teacher cannot access this student's marks");
    }

    const result = await pool.query(
      `
        SELECT 1
        FROM student_enrollments se
        WHERE se.school_id = $1
          AND se.student_id = $2
          AND se.status = 'active'
          AND se.classroom_id = ANY($3::uuid[])
        LIMIT 1
      `,
      [auth.schoolId, studentId, teacherClassroomIds]
    );
    if (!result.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Teacher cannot access this student's marks");
    }
    return;
  }

  if (hasRole(auth, "parent")) {
    const result = await pool.query(
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
      [auth.schoolId, studentId, auth.userId]
    );
    if (!result.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Parent cannot access this student's marks");
    }
    return;
  }

  if (hasRole(auth, "student")) {
    const result = await pool.query(
      `
        SELECT 1
        FROM student_user_accounts sua
        JOIN students s ON s.id = sua.student_id
        WHERE sua.user_id = $1
          AND sua.student_id = $2
          AND s.school_id = $3
        LIMIT 1
      `,
      [auth.userId, studentId, auth.schoolId]
    );
    if (!result.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "Student can only access own marks");
    }
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No marks permission for this role");
}

router.get(
  "/assessments",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureMarksReadRole(req.auth);
    const query = parseSchema(listAssessmentsQuerySchema, req.query, "Invalid assessments query");

    const params = [req.auth.schoolId];
    const where = ["a.school_id = $1"];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`a.classroom_id = $${params.length}`);
    }
    if (query.subject_id) {
      params.push(query.subject_id);
      where.push(`a.subject_id = $${params.length}`);
    }
    if (query.assessment_type) {
      params.push(query.assessment_type);
      where.push(`a.assessment_type = $${params.length}`);
    }
    if (query.date_from) {
      params.push(query.date_from);
      where.push(`a.assessment_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`a.assessment_date <= $${params.length}`);
    }

    if (
      hasRole(req.auth, "school_admin") ||
      hasRole(req.auth, "principal") ||
      hasRole(req.auth, "vice_principal")
    ) {
      // full school scope
    } else if (hasRole(req.auth, "headmistress")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM classrooms c
          WHERE c.school_id = a.school_id
            AND c.id = a.classroom_id
            AND c.section_id IN (
              SELECT ss.id
              FROM school_sections ss
              WHERE ss.school_id = a.school_id
                AND (
                  ss.head_user_id = $${params.length}
                  OR ss.coordinator_user_id = $${params.length}
                  OR EXISTS (
                    SELECT 1
                    FROM staff_profiles sp
                    WHERE sp.school_id = ss.school_id
                      AND sp.user_id = $${params.length}
                      AND sp.primary_section_id = ss.id
                  )
                )
            )
        )
      `);
    } else if (hasRole(req.auth, "teacher")) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`a.classroom_id = ANY($${params.length}::uuid[])`);
      }
    } else if (hasRole(req.auth, "parent")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          JOIN student_enrollments se ON se.student_id = ps.student_id
          WHERE ps.school_id = a.school_id
            AND p.school_id = a.school_id
            AND p.user_id = $${params.length}
            AND se.school_id = a.school_id
            AND se.classroom_id = a.classroom_id
            AND se.status = 'active'
        )
      `);
    } else if (hasRole(req.auth, "student")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM student_user_accounts sua
          JOIN student_enrollments se ON se.student_id = sua.student_id
          JOIN students s ON s.id = sua.student_id
          WHERE sua.user_id = $${params.length}
            AND s.school_id = a.school_id
            AND se.school_id = a.school_id
            AND se.classroom_id = a.classroom_id
            AND se.status = 'active'
        )
      `);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM assessments a
        WHERE ${whereClause}
      `,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rowsResult = await pool.query(
      `
        SELECT
          a.id,
          a.classroom_id,
          a.subject_id,
          a.title,
          a.assessment_type,
          a.max_marks,
          a.assessment_date,
          a.created_by_user_id
        FROM assessments a
        WHERE ${whereClause}
        ORDER BY a.assessment_date DESC NULLS LAST, a.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(
      res,
      rowsResult.rows,
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
  "/assessments",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createAssessmentSchema, req.body, "Invalid assessment create payload");

    const classroomOk = await classroomExists(req.auth.schoolId, body.classroom_id);
    if (!classroomOk) {
      throw new AppError(404, "NOT_FOUND", "Classroom not found for this school");
    }
    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: body.classroom_id,
    });

    if (body.subject_id) {
      const subjectOk = await subjectExists(req.auth.schoolId, body.subject_id);
      if (!subjectOk) {
        throw new AppError(404, "NOT_FOUND", "Subject not found for this school");
      }
    }

    const insertResult = await pool.query(
      `
        INSERT INTO assessments (
          school_id,
          classroom_id,
          subject_id,
          title,
          assessment_type,
          max_marks,
          assessment_date,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING
          id,
          classroom_id,
          subject_id,
          title,
          assessment_type,
          max_marks,
          assessment_date,
          created_by_user_id
      `,
      [
        req.auth.schoolId,
        body.classroom_id,
        body.subject_id || null,
        body.title,
        body.assessment_type,
        body.max_marks,
        body.assessment_date || null,
        req.auth.userId,
      ]
    );

    return success(res, insertResult.rows[0], 201);
  })
);

router.patch(
  "/assessments/:assessmentId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ assessmentId: z.string().uuid() }),
      req.params,
      "Invalid assessment id"
    );
    const body = parseSchema(updateAssessmentSchema, req.body, "Invalid assessment patch payload");

    const assessment = await getAssessmentById({
      schoolId: req.auth.schoolId,
      assessmentId: path.assessmentId,
    });
    if (!assessment) {
      throw new AppError(404, "NOT_FOUND", "Assessment not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: assessment.classroom_id,
    });

    if (Object.prototype.hasOwnProperty.call(body, "subject_id") && body.subject_id) {
      const subjectOk = await subjectExists(req.auth.schoolId, body.subject_id);
      if (!subjectOk) {
        throw new AppError(404, "NOT_FOUND", "Subject not found for this school");
      }
    }

    const setClauses = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      values.push(body.title);
      setClauses.push(`title = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "assessment_type")) {
      values.push(body.assessment_type);
      setClauses.push(`assessment_type = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "max_marks")) {
      values.push(body.max_marks);
      setClauses.push(`max_marks = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "assessment_date")) {
      values.push(body.assessment_date);
      setClauses.push(`assessment_date = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "subject_id")) {
      values.push(body.subject_id);
      setClauses.push(`subject_id = $${values.length}`);
    }

    values.push(path.assessmentId);
    const updateResult = await pool.query(
      `
        UPDATE assessments
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          classroom_id,
          subject_id,
          title,
          assessment_type,
          max_marks,
          assessment_date,
          created_by_user_id
      `,
      values
    );

    return success(res, updateResult.rows[0], 200);
  })
);

router.post(
  "/assessments/:assessmentId/scores/bulk",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ assessmentId: z.string().uuid() }),
      req.params,
      "Invalid assessment id"
    );
    const body = parseSchema(bulkScoresSchema, req.body, "Invalid bulk scores payload");

    const assessment = await getAssessmentById({
      schoolId: req.auth.schoolId,
      assessmentId: path.assessmentId,
    });
    if (!assessment) {
      throw new AppError(404, "NOT_FOUND", "Assessment not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: assessment.classroom_id,
    });

    for (const score of body.scores) {
      if (score.marks_obtained > Number(assessment.max_marks)) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          `marks_obtained cannot exceed max_marks (${assessment.max_marks})`,
          [{ field: "marks_obtained", issue: "exceeds_max_marks" }]
        );
      }
    }

    const studentIds = [...new Set(body.scores.map((s) => s.student_id))];
    const studentsResult = await pool.query(
      `
        SELECT s.id
        FROM students s
        WHERE s.school_id = $1
          AND s.id = ANY($2::uuid[])
      `,
      [req.auth.schoolId, studentIds]
    );
    if (studentsResult.rowCount !== studentIds.length) {
      throw new AppError(422, "VALIDATION_ERROR", "One or more students do not belong to this school");
    }

    const enrollmentResult = await pool.query(
      `
        SELECT se.student_id
        FROM student_enrollments se
        WHERE se.school_id = $1
          AND se.classroom_id = $2
          AND se.status = 'active'
          AND se.student_id = ANY($3::uuid[])
      `,
      [req.auth.schoolId, assessment.classroom_id, studentIds]
    );
    const enrolledIds = new Set(enrollmentResult.rows.map((row) => row.student_id));
    for (const studentId of studentIds) {
      if (!enrolledIds.has(studentId)) {
        throw new AppError(422, "VALIDATION_ERROR", "One or more students are not enrolled in this class");
      }
    }

    const client = await pool.connect();
    let createdCount = 0;
    let updatedCount = 0;
    try {
      await client.query("BEGIN");

      for (const score of body.scores) {
        const existing = await client.query(
          `
            SELECT id
            FROM assessment_scores
            WHERE school_id = $1
              AND assessment_id = $2
              AND student_id = $3
            LIMIT 1
          `,
          [req.auth.schoolId, path.assessmentId, score.student_id]
        );

        if (existing.rows[0]) {
          await client.query(
            `
              UPDATE assessment_scores
              SET
                marks_obtained = $1,
                remarks = $2
              WHERE id = $3
            `,
            [score.marks_obtained, score.remarks || null, existing.rows[0].id]
          );
          updatedCount += 1;
        } else {
          await client.query(
            `
              INSERT INTO assessment_scores (
                school_id,
                assessment_id,
                student_id,
                marks_obtained,
                remarks
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              req.auth.schoolId,
              path.assessmentId,
              score.student_id,
              score.marks_obtained,
              score.remarks || null,
            ]
          );
          createdCount += 1;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return success(res, { created_count: createdCount, updated_count: updatedCount }, 200);
  })
);

router.get(
  "/students/:studentId/marks/summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureMarksReadRole(req.auth);
    const path = parseSchema(z.object({ studentId: z.string().uuid() }), req.params, "Invalid student id");

    const studentResult = await pool.query(
      "SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, path.studentId]
    );
    if (!studentResult.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }

    await ensureStudentVisibleToRole({
      auth: req.auth,
      studentId: path.studentId,
    });

    const overallResult = await pool.query(
      `
        SELECT
          COALESCE(
            ROUND(AVG((sc.marks_obtained / a.max_marks) * 100)::numeric, 2),
            0
          ) AS overall_average
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id
        WHERE sc.school_id = $1
          AND sc.student_id = $2
      `,
      [req.auth.schoolId, path.studentId]
    );

    const subjectsResult = await pool.query(
      `
        SELECT
          a.subject_id,
          COALESCE(sub.name, 'Unknown') AS subject_name,
          ROUND(AVG((sc.marks_obtained / a.max_marks) * 100)::numeric, 2) AS average
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id
        LEFT JOIN subjects sub ON sub.id = a.subject_id
        WHERE sc.school_id = $1
          AND sc.student_id = $2
        GROUP BY a.subject_id, sub.name
        ORDER BY subject_name ASC
      `,
      [req.auth.schoolId, path.studentId]
    );

    const trendResult = await pool.query(
      `
        SELECT
          COALESCE(TO_CHAR(a.assessment_date, 'YYYY-MM-DD'), a.title) AS label,
          ROUND(((sc.marks_obtained / a.max_marks) * 100)::numeric, 2) AS average
        FROM assessment_scores sc
        JOIN assessments a ON a.id = sc.assessment_id
        WHERE sc.school_id = $1
          AND sc.student_id = $2
        ORDER BY a.assessment_date ASC NULLS LAST, a.created_at ASC
        LIMIT 100
      `,
      [req.auth.schoolId, path.studentId]
    );

    return success(
      res,
      {
        student_id: path.studentId,
        overall_average: Number(overallResult.rows[0]?.overall_average || 0),
        subject_averages: subjectsResult.rows.map((row) => ({
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          average: Number(row.average),
        })),
        trend: trendResult.rows.map((row) => ({
          label: row.label,
          average: Number(row.average),
        })),
      },
      200
    );
  })
);

module.exports = router;
