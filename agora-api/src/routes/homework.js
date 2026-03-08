const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const {
  getTeacherIdentityByUser,
  listTeacherClassroomIds,
  ensureTeacherCanManageClassroom: ensureTeacherClassroomScope,
} = require("../utils/teacher-scope");

const router = express.Router();

const submissionStatusSchema = z.enum(["assigned", "submitted", "reviewed", "missing"]);

const listHomeworkQuerySchema = z.object({
  classroom_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().optional(),
  due_from: z.string().datetime().optional(),
  due_to: z.string().datetime().optional(),
  published: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createHomeworkSchema = z.object({
  classroom_id: z.string().uuid(),
  subject_id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  due_at: z.string().datetime().optional(),
  attachment_urls: z.array(z.string().url()).default([]),
  is_published: z.boolean().default(true),
});

const updateHomeworkSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    due_at: z.string().datetime().nullable().optional(),
    attachment_urls: z.array(z.string().url()).optional(),
    is_published: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const listSubmissionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const createSubmissionSchema = z.object({
  student_id: z.string().uuid(),
  status: submissionStatusSchema,
  attachment_urls: z.array(z.string().url()).default([]),
});

const updateSubmissionSchema = z
  .object({
    status: submissionStatusSchema.optional(),
    score: z.number().min(0).max(100).nullable().optional(),
    feedback: z.string().trim().max(5000).nullable().optional(),
    graded_at: z.string().datetime().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
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

function ensureHomeworkReadRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "teacher") ||
    hasRole(auth, "parent") ||
    hasRole(auth, "student")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No homework read permission for this role");
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
    throw new AppError(403, "FORBIDDEN", "Only teacher/admin can manage homework");
  }
  await ensureTeacherClassroomScope({
    schoolId: auth.schoolId,
    userId: auth.userId,
    classroomId,
    message: "Teacher is not assigned to this classroom",
  });
}

async function getHomeworkById({ homeworkId, schoolId }) {
  const result = await pool.query(
    `
      SELECT
        id,
        school_id,
        classroom_id,
        subject_id,
        teacher_id,
        title,
        description,
        assigned_at,
        due_at,
        attachment_urls,
        is_published
      FROM homework
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
    `,
    [homeworkId, schoolId]
  );
  return result.rows[0] || null;
}

async function ensureStudentMappedToUser({ schoolId, userId, studentId }) {
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
    [userId, studentId, schoolId]
  );
  return Boolean(result.rows[0]);
}

async function ensureStudentInClassroom({ schoolId, studentId, classroomId }) {
  const result = await pool.query(
    `
      SELECT 1
      FROM student_enrollments se
      WHERE se.school_id = $1
        AND se.student_id = $2
        AND se.classroom_id = $3
        AND se.status = 'active'
      LIMIT 1
    `,
    [schoolId, studentId, classroomId]
  );
  return Boolean(result.rows[0]);
}

async function ensureSubmissionWriteAccess({ auth, homework, studentId }) {
  if (hasRole(auth, "school_admin")) return;
  if (hasRole(auth, "teacher")) {
    await ensureTeacherCanManageClassroom({ auth, classroomId: homework.classroom_id });
    return;
  }
  if (hasRole(auth, "student")) {
    const mapped = await ensureStudentMappedToUser({
      schoolId: auth.schoolId,
      userId: auth.userId,
      studentId,
    });
    if (!mapped) {
      throw new AppError(403, "FORBIDDEN", "Student can only submit for own account");
    }
    const enrolled = await ensureStudentInClassroom({
      schoolId: auth.schoolId,
      studentId,
      classroomId: homework.classroom_id,
    });
    if (!enrolled) {
      throw new AppError(403, "FORBIDDEN", "Student is not enrolled in this classroom");
    }
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No submission write permission for this role");
}

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureHomeworkReadRole(req.auth);
    const query = parseSchema(listHomeworkQuerySchema, req.query, "Invalid homework query");

    const params = [req.auth.schoolId];
    const where = ["h.school_id = $1"];

    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`h.classroom_id = $${params.length}`);
    }
    if (query.subject_id) {
      params.push(query.subject_id);
      where.push(`h.subject_id = $${params.length}`);
    }
    if (query.due_from) {
      params.push(query.due_from);
      where.push(`h.due_at >= $${params.length}::timestamptz`);
    }
    if (query.due_to) {
      params.push(query.due_to);
      where.push(`h.due_at <= $${params.length}::timestamptz`);
    }

    if (hasRole(req.auth, "school_admin")) {
      if (Object.prototype.hasOwnProperty.call(query, "published")) {
        params.push(query.published);
        where.push(`h.is_published = $${params.length}`);
      }
    } else if (hasRole(req.auth, "teacher")) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`h.classroom_id = ANY($${params.length}::uuid[])`);
      }
      if (Object.prototype.hasOwnProperty.call(query, "published")) {
        params.push(query.published);
        where.push(`h.is_published = $${params.length}`);
      }
    } else if (hasRole(req.auth, "parent")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          JOIN student_enrollments se ON se.student_id = ps.student_id
          WHERE ps.school_id = h.school_id
            AND p.school_id = h.school_id
            AND p.user_id = $${params.length}
            AND se.school_id = h.school_id
            AND se.classroom_id = h.classroom_id
            AND se.status = 'active'
        )
      `);
      if (Object.prototype.hasOwnProperty.call(query, "published")) {
        params.push(query.published);
        where.push(`h.is_published = $${params.length}`);
      } else {
        where.push("h.is_published = TRUE");
      }
    } else if (hasRole(req.auth, "student")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM student_user_accounts sua
          JOIN student_enrollments se ON se.student_id = sua.student_id
          JOIN students s ON s.id = sua.student_id
          WHERE sua.user_id = $${params.length}
            AND s.school_id = h.school_id
            AND se.school_id = h.school_id
            AND se.classroom_id = h.classroom_id
            AND se.status = 'active'
        )
      `);
      if (Object.prototype.hasOwnProperty.call(query, "published")) {
        params.push(query.published);
        where.push(`h.is_published = $${params.length}`);
      } else {
        where.push("h.is_published = TRUE");
      }
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM homework h
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
          h.id,
          h.classroom_id,
          h.subject_id,
          h.teacher_id,
          h.title,
          h.description,
          h.assigned_at,
          h.due_at,
          h.attachment_urls,
          h.is_published
        FROM homework h
        WHERE ${whereClause}
        ORDER BY h.assigned_at DESC, h.created_at DESC
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
  "/",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createHomeworkSchema, req.body, "Invalid homework create payload");

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

    let teacherId = null;
    if (hasRole(req.auth, "teacher")) {
      const teacherIdentity = await getTeacherIdentityByUser({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      teacherId = teacherIdentity.teacherId;
      if (!teacherId) {
        throw new AppError(403, "FORBIDDEN", "Teacher profile is missing");
      }
    }

    const insertResult = await pool.query(
      `
        INSERT INTO homework (
          school_id,
          classroom_id,
          subject_id,
          teacher_id,
          title,
          description,
          due_at,
          attachment_urls,
          is_published
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb, $9)
        RETURNING
          id,
          classroom_id,
          subject_id,
          teacher_id,
          title,
          description,
          assigned_at,
          due_at,
          attachment_urls,
          is_published
      `,
      [
        req.auth.schoolId,
        body.classroom_id,
        body.subject_id || null,
        teacherId,
        body.title,
        body.description || null,
        body.due_at || null,
        JSON.stringify(body.attachment_urls || []),
        body.is_published,
      ]
    );

    return success(res, insertResult.rows[0], 201);
  })
);

router.patch(
  "/:homeworkId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(z.object({ homeworkId: z.string().uuid() }), req.params, "Invalid homework id");
    const body = parseSchema(updateHomeworkSchema, req.body, "Invalid homework patch payload");

    const homework = await getHomeworkById({
      homeworkId: path.homeworkId,
      schoolId: req.auth.schoolId,
    });
    if (!homework) {
      throw new AppError(404, "NOT_FOUND", "Homework not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: homework.classroom_id,
    });

    const setClauses = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      values.push(body.title);
      setClauses.push(`title = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "description")) {
      values.push(body.description);
      setClauses.push(`description = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "due_at")) {
      values.push(body.due_at);
      setClauses.push(`due_at = $${values.length}::timestamptz`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "attachment_urls")) {
      values.push(JSON.stringify(body.attachment_urls));
      setClauses.push(`attachment_urls = $${values.length}::jsonb`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "is_published")) {
      values.push(body.is_published);
      setClauses.push(`is_published = $${values.length}`);
    }

    values.push(path.homeworkId);
    const updateResult = await pool.query(
      `
        UPDATE homework
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          classroom_id,
          subject_id,
          teacher_id,
          title,
          description,
          assigned_at,
          due_at,
          attachment_urls,
          is_published
      `,
      values
    );

    return success(res, updateResult.rows[0], 200);
  })
);

router.delete(
  "/:homeworkId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(z.object({ homeworkId: z.string().uuid() }), req.params, "Invalid homework id");

    const homework = await getHomeworkById({
      homeworkId: path.homeworkId,
      schoolId: req.auth.schoolId,
    });
    if (!homework) {
      throw new AppError(404, "NOT_FOUND", "Homework not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: homework.classroom_id,
    });

    await pool.query("DELETE FROM homework WHERE id = $1", [path.homeworkId]);
    return success(res, { ok: true }, 200);
  })
);

router.get(
  "/:homeworkId/submissions",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureHomeworkReadRole(req.auth);
    const path = parseSchema(z.object({ homeworkId: z.string().uuid() }), req.params, "Invalid homework id");
    const query = parseSchema(listSubmissionQuerySchema, req.query, "Invalid submissions query");

    const homework = await getHomeworkById({
      homeworkId: path.homeworkId,
      schoolId: req.auth.schoolId,
    });
    if (!homework) {
      throw new AppError(404, "NOT_FOUND", "Homework not found");
    }

    const params = [req.auth.schoolId, path.homeworkId];
    const where = ["hs.school_id = $1", "hs.homework_id = $2"];

    if (hasRole(req.auth, "school_admin")) {
      // full access
    } else if (hasRole(req.auth, "teacher")) {
      await ensureTeacherCanManageClassroom({
        auth: req.auth,
        classroomId: homework.classroom_id,
      });
    } else if (hasRole(req.auth, "parent")) {
      if (!homework.is_published) {
        throw new AppError(403, "FORBIDDEN", "Homework is not published");
      }
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          WHERE ps.school_id = hs.school_id
            AND ps.student_id = hs.student_id
            AND p.school_id = hs.school_id
            AND p.user_id = $${params.length}
        )
      `);
    } else if (hasRole(req.auth, "student")) {
      if (!homework.is_published) {
        throw new AppError(403, "FORBIDDEN", "Homework is not published");
      }
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM student_user_accounts sua
          JOIN students s ON s.id = sua.student_id
          WHERE sua.user_id = $${params.length}
            AND sua.student_id = hs.student_id
            AND s.school_id = hs.school_id
        )
      `);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM homework_submissions hs
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
          hs.id,
          hs.homework_id,
          hs.student_id,
          hs.status,
          hs.submitted_at,
          hs.graded_at,
          hs.score,
          hs.feedback,
          hs.attachment_urls
        FROM homework_submissions hs
        WHERE ${whereClause}
        ORDER BY hs.created_at DESC
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
  "/:homeworkId/submissions",
  requireAuth,
  requireRoles("school_admin", "teacher", "student"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(z.object({ homeworkId: z.string().uuid() }), req.params, "Invalid homework id");
    const body = parseSchema(createSubmissionSchema, req.body, "Invalid submission payload");

    const homework = await getHomeworkById({
      homeworkId: path.homeworkId,
      schoolId: req.auth.schoolId,
    });
    if (!homework) {
      throw new AppError(404, "NOT_FOUND", "Homework not found");
    }

    await ensureSubmissionWriteAccess({
      auth: req.auth,
      homework,
      studentId: body.student_id,
    });

    const studentOk = await pool.query(
      "SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, body.student_id]
    );
    if (!studentOk.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Student not found in this school");
    }

    const enrolled = await ensureStudentInClassroom({
      schoolId: req.auth.schoolId,
      studentId: body.student_id,
      classroomId: homework.classroom_id,
    });
    if (!enrolled) {
      throw new AppError(422, "VALIDATION_ERROR", "Student is not enrolled in homework classroom");
    }

    const shouldSetSubmittedAt = body.status === "submitted";
    const upsertResult = await pool.query(
      `
        INSERT INTO homework_submissions (
          school_id,
          homework_id,
          student_id,
          status,
          submitted_at,
          attachment_urls
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::homework_submission_status,
          $5::timestamptz,
          $6::jsonb
        )
        ON CONFLICT (school_id, homework_id, student_id)
        DO UPDATE SET
          status = EXCLUDED.status,
          attachment_urls = EXCLUDED.attachment_urls,
          submitted_at = CASE
            WHEN EXCLUDED.status = 'submitted'::homework_submission_status
              THEN COALESCE(homework_submissions.submitted_at, NOW())
            ELSE homework_submissions.submitted_at
          END
        RETURNING
          id,
          homework_id,
          student_id,
          status,
          submitted_at,
          graded_at,
          score,
          feedback,
          attachment_urls
      `,
      [
        req.auth.schoolId,
        path.homeworkId,
        body.student_id,
        body.status,
        shouldSetSubmittedAt ? new Date().toISOString() : null,
        JSON.stringify(body.attachment_urls || []),
      ]
    );

    return success(res, upsertResult.rows[0], 201);
  })
);

router.patch(
  "/submissions/:submissionId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(
      z.object({ submissionId: z.string().uuid() }),
      req.params,
      "Invalid submission id"
    );
    const body = parseSchema(updateSubmissionSchema, req.body, "Invalid submission patch payload");

    const submissionResult = await pool.query(
      `
        SELECT
          hs.id,
          hs.homework_id,
          hs.student_id,
          hs.status,
          hs.score,
          hs.feedback,
          hs.graded_at,
          h.classroom_id,
          h.school_id
        FROM homework_submissions hs
        JOIN homework h ON h.id = hs.homework_id
        WHERE hs.id = $1
          AND hs.school_id = $2
        LIMIT 1
      `,
      [path.submissionId, req.auth.schoolId]
    );
    const submission = submissionResult.rows[0];
    if (!submission) {
      throw new AppError(404, "NOT_FOUND", "Submission not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: submission.classroom_id,
    });

    const setClauses = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      values.push(body.status);
      setClauses.push(`status = $${values.length}::homework_submission_status`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "score")) {
      values.push(body.score);
      setClauses.push(`score = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "feedback")) {
      values.push(body.feedback);
      setClauses.push(`feedback = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "graded_at")) {
      values.push(body.graded_at);
      setClauses.push(`graded_at = $${values.length}::timestamptz`);
    }

    values.push(path.submissionId);
    const updateResult = await pool.query(
      `
        UPDATE homework_submissions
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          homework_id,
          student_id,
          status,
          submitted_at,
          graded_at,
          score,
          feedback,
          attachment_urls
      `,
      values
    );

    return success(res, updateResult.rows[0], 200);
  })
);

module.exports = router;
