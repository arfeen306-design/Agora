const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const {
    ensureBoard,
    addBoardRow,
    addBoardColumn,
    updateBoardCell,
} = require("../services/classroom-manual-timetable");

const router = express.Router();

const subjectTeacherAssignmentSchema = z.object({
    subject_id: z.string().uuid(),
    teacher_user_id: z.string().uuid(),
    periods_per_week: z.coerce.number().int().min(0).max(50).default(0),
    lesson_duration: z.coerce.number().int().min(1).max(4).default(1),
    lesson_priority: z.coerce.number().int().min(1).max(10).default(5),
    is_timetable_locked: z.boolean().default(false),
});

const subjectTeacherPatchSchema = z
    .object({
        teacher_user_id: z.string().uuid().optional(),
        periods_per_week: z.coerce.number().int().min(0).max(50).optional(),
        lesson_duration: z.coerce.number().int().min(1).max(4).optional(),
        lesson_priority: z.coerce.number().int().min(1).max(10).optional(),
        is_timetable_locked: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one field is required",
        path: ["body"],
    });

const timetableRowSchema = z.object({
    classroom_id: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(40),
    day_of_week: z.coerce.number().int().min(1).max(7).nullable().optional(),
});

const timetableColumnSchema = z.object({
    classroom_id: z.string().uuid().optional(),
    label: z.string().trim().min(1).max(40),
    starts_at: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    ends_at: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

const timetableCellPathSchema = z.object({
    cellId: z.string().uuid(),
});

const timetableCellSchema = z
    .object({
        classroom_id: z.string().uuid().optional(),
        subject_id: z.string().uuid().nullable().optional(),
        teacher_id: z.string().uuid().nullable().optional(),
        title: z.string().trim().max(80).nullable().optional(),
        subtitle: z.string().trim().max(120).nullable().optional(),
        room_number: z.string().trim().max(40).nullable().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
        color_hex: z.string().trim().regex(/^#?[0-9A-Fa-f]{6}$/).nullable().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
        message: "At least one field is required",
        path: ["body"],
    });

// --- Helpers ---

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

/**
 * Get the classroom where this teacher is the homeroom (class) teacher.
 * Returns the classroom row or null.
 */
async function getHomeroomClassroom(schoolId, userId) {
    const result = await pool.query(
        `
      SELECT
        c.id,
        c.grade_label,
        c.section_label,
        c.classroom_code,
        c.academic_year_id,
        ay.name AS academic_year_name,
        c.capacity,
        c.homeroom_teacher_id
      FROM classrooms c
      JOIN teachers t ON t.id = c.homeroom_teacher_id AND t.school_id = c.school_id
      JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
      WHERE c.school_id = $1
        AND t.user_id = $2
        AND ay.is_current = TRUE
        AND COALESCE(c.is_active, TRUE) = TRUE
      LIMIT 1
    `,
        [schoolId, userId]
    );
    return result.rows[0] || null;
}

async function resolveEditableClassroomId(auth, requestedClassroomId) {
    if (hasRole(auth, "teacher") && !hasRole(auth, "school_admin") && !hasRole(auth, "principal") && !hasRole(auth, "vice_principal") && !hasRole(auth, "headmistress")) {
        const classroom = await getHomeroomClassroom(auth.schoolId, auth.userId);
        if (!classroom) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }
        if (requestedClassroomId && requestedClassroomId !== classroom.id) {
            throw new AppError(403, "FORBIDDEN", "Teachers can manage only their own homeroom timetable");
        }
        return classroom.id;
    }

    if (!requestedClassroomId) {
        const classroom = await getHomeroomClassroom(auth.schoolId, auth.userId);
        if (classroom) return classroom.id;
        throw new AppError(422, "VALIDATION_ERROR", "classroom_id is required for leadership timetable edits");
    }

    return requestedClassroomId;
}

async function assertTimetableCellRefs({ schoolId, classroomId, subjectId, teacherId }) {
    if (!subjectId && !teacherId) return;

    if (subjectId) {
        const subjectResult = await pool.query(
            `
              SELECT id
              FROM subjects
              WHERE school_id = $1
                AND id = $2
              LIMIT 1
            `,
            [schoolId, subjectId]
        );
        if (!subjectResult.rows[0]) {
            throw new AppError(422, "VALIDATION_ERROR", "subject_id must belong to this school");
        }
    }

    if (teacherId) {
        const teacherResult = await pool.query(
            `
              SELECT id
              FROM teachers
              WHERE school_id = $1
                AND id = $2
              LIMIT 1
            `,
            [schoolId, teacherId]
        );
        if (!teacherResult.rows[0]) {
            throw new AppError(422, "VALIDATION_ERROR", "teacher_id must belong to this school");
        }
    }

    const mappingResult = await pool.query(
        `
          SELECT id
          FROM classroom_subjects
          WHERE school_id = $1
            AND classroom_id = $2
            AND ($3::uuid IS NULL OR subject_id = $3)
            AND ($4::uuid IS NULL OR teacher_id = $4)
          LIMIT 1
        `,
        [schoolId, classroomId, subjectId || null, teacherId || null]
    );

    if (!mappingResult.rows[0]) {
        throw new AppError(
            422,
            "VALIDATION_ERROR",
            "The selected subject or teacher is not mapped to this classroom"
        );
    }
}

// --- Routes ---

// GET /class-teacher/my-classroom
// Returns the classroom this teacher is class teacher of, along with summary stats.
router.get(
    "/my-classroom",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);

        if (!classroom) {
            return success(res, {
                classroom: null,
                message: "You are not assigned as class teacher for any active classroom this academic year.",
            }, 200);
        }

        // Student count
        const studentCountResult = await pool.query(
            `
        SELECT COUNT(*)::int AS total
        FROM student_enrollments se
        WHERE se.school_id = $1
          AND se.classroom_id = $2
          AND se.status = 'active'
      `,
            [req.auth.schoolId, classroom.id]
        );

        // Attendance today
        const today = new Date().toISOString().slice(0, 10);
        const attendanceResult = await pool.query(
            `
        SELECT
          COUNT(*) FILTER (WHERE ar.status = 'present')::int AS present_count,
          COUNT(*) FILTER (WHERE ar.status = 'absent')::int AS absent_count,
          COUNT(*) FILTER (WHERE ar.status = 'late')::int AS late_count,
          COUNT(*) FILTER (WHERE ar.status = 'leave')::int AS leave_count,
          COUNT(*)::int AS total_marked
        FROM attendance_records ar
        WHERE ar.school_id = $1
          AND ar.classroom_id = $2
          AND ar.attendance_date = $3
      `,
            [req.auth.schoolId, classroom.id, today]
        );

        // Assigned subjects + teachers
        const subjectsResult = await pool.query(
            `
        SELECT
          cs.id AS classroom_subject_id,
          cs.subject_id,
          s.name AS subject_name,
          s.code AS subject_code,
          cs.teacher_id,
          cs.periods_per_week,
          cs.lesson_duration,
          cs.lesson_priority,
          cs.is_timetable_locked,
          tu.id AS teacher_user_id,
          tu.first_name AS teacher_first_name,
          tu.last_name AS teacher_last_name
        FROM classroom_subjects cs
        JOIN subjects s ON s.id = cs.subject_id
        LEFT JOIN teachers t ON t.id = cs.teacher_id AND t.school_id = cs.school_id
        LEFT JOIN users tu ON tu.id = t.user_id AND tu.school_id = cs.school_id
        WHERE cs.school_id = $1
          AND cs.classroom_id = $2
        ORDER BY s.name ASC
      `,
            [req.auth.schoolId, classroom.id]
        );

        // Exam terms for this academic year
        const termsResult = await pool.query(
            `
        SELECT id, name, term_type, is_locked, starts_on, ends_on
        FROM exam_terms
        WHERE school_id = $1
          AND academic_year_id = $2
        ORDER BY starts_on ASC NULLS LAST, created_at ASC
      `,
            [req.auth.schoolId, classroom.academic_year_id]
        );

        // Marks completion per term
        const marksCompletionResult = await pool.query(
            `
        SELECT
          et.id AS exam_term_id,
          et.name AS term_name,
          COUNT(DISTINCT a.id)::int AS assessment_count,
          COUNT(DISTINCT sc.id)::int AS score_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se2
            WHERE se2.school_id = $1
              AND se2.classroom_id = $2
              AND se2.status = 'active'
          ) * COUNT(DISTINCT a.id)::int AS expected_scores
        FROM exam_terms et
        LEFT JOIN assessments a
          ON a.exam_term_id = et.id
          AND a.school_id = $1
          AND a.classroom_id = $2
        LEFT JOIN assessment_scores sc
          ON sc.assessment_id = a.id
          AND sc.school_id = $1
        WHERE et.school_id = $1
          AND et.academic_year_id = $3
        GROUP BY et.id, et.name
        ORDER BY et.starts_on ASC NULLS LAST
      `,
            [req.auth.schoolId, classroom.id, classroom.academic_year_id]
        );

        const latestReportCardTermResult = await pool.query(
            `
        SELECT et.id, et.name, et.starts_on, et.ends_on
        FROM exam_terms et
        JOIN report_cards rc
          ON rc.exam_term_id = et.id
         AND rc.school_id = $1
         AND rc.classroom_id = $2
        WHERE et.school_id = $1
          AND et.academic_year_id = $3
        GROUP BY et.id, et.name, et.starts_on, et.ends_on
        ORDER BY et.starts_on DESC NULLS LAST, et.ends_on DESC NULLS LAST, et.name DESC
        LIMIT 1
      `,
            [req.auth.schoolId, classroom.id, classroom.academic_year_id]
        );

        const latestExamTerm =
            latestReportCardTermResult.rows[0] || termsResult.rows[termsResult.rows.length - 1] || null;
        let subjectCommentCompletion = [];
        let subjectCommentCompletionTrend = [];
        if (latestExamTerm) {
            const subjectCommentResult = await pool.query(
                `
        WITH latest_report_cards AS (
          SELECT rc.id
          FROM report_cards rc
          WHERE rc.school_id = $1
            AND rc.classroom_id = $2
            AND rc.exam_term_id = $3
        ),
        latest_report_card_count AS (
          SELECT COUNT(*)::int AS total_cards
          FROM latest_report_cards
        )
        SELECT
          cs.subject_id,
          s.name AS subject_name,
          (SELECT total_cards FROM latest_report_card_count) AS total_cards,
          COUNT(rcs.id)::int AS subject_rows,
          COUNT(*) FILTER (
            WHERE NULLIF(TRIM(COALESCE(rcs.teacher_comment, '')), '') IS NOT NULL
          )::int AS commented_rows
        FROM classroom_subjects cs
        JOIN subjects s ON s.id = cs.subject_id
        LEFT JOIN latest_report_cards lrc ON TRUE
        LEFT JOIN report_card_subjects rcs
          ON rcs.report_card_id = lrc.id
         AND (
           (rcs.subject_id IS NOT NULL AND rcs.subject_id = cs.subject_id)
           OR (rcs.subject_id IS NULL AND LOWER(rcs.subject_name) = LOWER(s.name))
         )
        WHERE cs.school_id = $1
          AND cs.classroom_id = $2
        GROUP BY cs.subject_id, s.name
        ORDER BY s.name ASC
      `,
                [req.auth.schoolId, classroom.id, latestExamTerm.id]
            );

            subjectCommentCompletion = subjectCommentResult.rows.map((row) => {
                const totalCards = Number(row.total_cards || 0);
                const commentedRows = Number(row.commented_rows || 0);
                return {
                    subject_id: row.subject_id,
                    subject_name: row.subject_name,
                    exam_term_id: latestExamTerm.id,
                    term_name: latestExamTerm.name,
                    total_cards: totalCards,
                    commented_rows: commentedRows,
                    completion_percentage: totalCards > 0 ? Math.round((commentedRows / totalCards) * 100) : 0,
                };
            });
        }

        const subjectCount = subjectsResult.rows.length;
        if (subjectCount > 0) {
            const subjectCommentTrendResult = await pool.query(
                `
        SELECT
          et.id AS exam_term_id,
          et.name AS term_name,
          et.term_type,
          et.starts_on,
          COUNT(DISTINCT rc.id)::int AS total_cards,
          COUNT(rcs.id) FILTER (
            WHERE NULLIF(TRIM(COALESCE(rcs.teacher_comment, '')), '') IS NOT NULL
          )::int AS commented_rows
        FROM exam_terms et
        LEFT JOIN report_cards rc
          ON rc.school_id = $1
         AND rc.classroom_id = $2
         AND rc.exam_term_id = et.id
        LEFT JOIN report_card_subjects rcs
          ON rcs.report_card_id = rc.id
        WHERE et.school_id = $1
          AND et.academic_year_id = $3
        GROUP BY et.id, et.name, et.term_type, et.starts_on
        ORDER BY et.starts_on ASC NULLS LAST, et.name ASC
      `,
                [req.auth.schoolId, classroom.id, classroom.academic_year_id]
            );

            subjectCommentCompletionTrend = subjectCommentTrendResult.rows.map((row) => {
                const totalCards = Number(row.total_cards || 0);
                const commentedRows = Number(row.commented_rows || 0);
                const expectedRows = totalCards * subjectCount;
                return {
                    exam_term_id: row.exam_term_id,
                    term_name: row.term_name,
                    term_type: row.term_type,
                    total_cards: totalCards,
                    commented_rows: commentedRows,
                    expected_rows: expectedRows,
                    completion_percentage: expectedRows > 0 ? Math.round((commentedRows / expectedRows) * 100) : 0,
                };
            });
        }

        return success(res, {
            classroom: {
                id: classroom.id,
                grade_label: classroom.grade_label,
                section_label: classroom.section_label,
                classroom_code: classroom.classroom_code,
                academic_year_id: classroom.academic_year_id,
                academic_year_name: classroom.academic_year_name,
                capacity: classroom.capacity,
            },
            student_count: studentCountResult.rows[0]?.total || 0,
            attendance_today: attendanceResult.rows[0] || {
                present_count: 0,
                absent_count: 0,
                late_count: 0,
                leave_count: 0,
                total_marked: 0,
            },
            subjects: subjectsResult.rows,
            exam_terms: termsResult.rows,
            marks_completion: marksCompletionResult.rows.map((row) => ({
                exam_term_id: row.exam_term_id,
                term_name: row.term_name,
                assessment_count: row.assessment_count,
                score_count: row.score_count,
                expected_scores: row.expected_scores,
                completion_percentage:
                    row.expected_scores > 0
                        ? Math.round((row.score_count / row.expected_scores) * 100)
                        : 0,
            })),
            subject_comment_completion: subjectCommentCompletion,
            subject_comment_completion_trend: subjectCommentCompletionTrend,
        }, 200);
    })
);

// GET /class-teacher/students

router.get(
    "/timetable",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const classroomId = await resolveEditableClassroomId(req.auth, req.query.classroom_id);
        const board = await ensureBoard({
            schoolId: req.auth.schoolId,
            classroomId,
            actorUserId: req.auth.userId,
        });

        return success(res, board, 200);
    })
);

router.post(
    "/timetable/rows",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const body = parseSchema(timetableRowSchema, req.body, "Invalid timetable row payload");
        const classroomId = await resolveEditableClassroomId(req.auth, body.classroom_id);
        const board = await addBoardRow({
            schoolId: req.auth.schoolId,
            classroomId,
            label: body.label,
            dayOfWeek: body.day_of_week || null,
            actorUserId: req.auth.userId,
        });

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "academics.classroom_timetable.row_created",
            entityName: "classroom_weekly_timetable_rows",
            metadata: {
                classroom_id: classroomId,
                label: body.label,
                day_of_week: body.day_of_week || null,
            },
        });

        return success(res, board, 201);
    })
);

router.post(
    "/timetable/columns",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const body = parseSchema(timetableColumnSchema, req.body, "Invalid timetable column payload");
        const classroomId = await resolveEditableClassroomId(req.auth, body.classroom_id);
        const board = await addBoardColumn({
            schoolId: req.auth.schoolId,
            classroomId,
            label: body.label,
            startsAt: body.starts_at || null,
            endsAt: body.ends_at || null,
            actorUserId: req.auth.userId,
        });

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "academics.classroom_timetable.column_created",
            entityName: "classroom_weekly_timetable_columns",
            metadata: {
                classroom_id: classroomId,
                label: body.label,
                starts_at: body.starts_at || null,
                ends_at: body.ends_at || null,
            },
        });

        return success(res, board, 201);
    })
);

router.patch(
    "/timetable/cells/:cellId",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const path = parseSchema(timetableCellPathSchema, req.params, "Invalid timetable cell id");
        const body = parseSchema(timetableCellSchema, req.body, "Invalid timetable cell payload");
        const classroomId = await resolveEditableClassroomId(req.auth, body.classroom_id);

        await assertTimetableCellRefs({
            schoolId: req.auth.schoolId,
            classroomId,
            subjectId: body.subject_id || null,
            teacherId: body.teacher_id || null,
        });

        const board = await updateBoardCell({
            schoolId: req.auth.schoolId,
            classroomId,
            cellId: path.cellId,
            subjectId: body.subject_id || null,
            teacherId: body.teacher_id || null,
            title: body.title || null,
            subtitle: body.subtitle || null,
            roomNumber: body.room_number || null,
            notes: body.notes || null,
            colorHex: body.color_hex ? (body.color_hex.startsWith("#") ? body.color_hex : `#${body.color_hex}`) : null,
            actorUserId: req.auth.userId,
        });

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "academics.classroom_timetable.cell_updated",
            entityName: "classroom_weekly_timetable_cells",
            entityId: path.cellId,
            metadata: {
                classroom_id: classroomId,
                updated_fields: Object.keys(body),
            },
        });

        return success(res, board, 200);
    })
);


// List students enrolled in the class teacher's homeroom classroom.
router.get(
    "/students",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);

        if (!classroom) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }

        const result = await pool.query(
            `
        SELECT
          s.id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.gender,
          s.date_of_birth,
          se.roll_no,
          sua.user_id AS student_user_id
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
        LEFT JOIN student_user_accounts sua ON sua.student_id = s.id
        WHERE se.school_id = $1
          AND se.classroom_id = $2
          AND se.status = 'active'
        ORDER BY se.roll_no ASC NULLS LAST, s.first_name ASC
      `,
            [req.auth.schoolId, classroom.id]
        );

        return success(res, result.rows, 200);
    })
);

// GET /class-teacher/subject-teachers
// List subjects and their assigned teachers for the class teacher's classroom.
router.get(
    "/subject-teachers",
    requireAuth,
    requireRoles("school_admin", "principal", "vice_principal", "headmistress", "teacher"),
    asyncHandler(async (req, res) => {
        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);

        if (!classroom) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }

        const result = await pool.query(
            `
        SELECT
          cs.id AS classroom_subject_id,
          cs.subject_id,
          s.name AS subject_name,
          s.code AS subject_code,
          cs.teacher_id,
          cs.periods_per_week,
          cs.lesson_duration,
          cs.lesson_priority,
          cs.is_timetable_locked,
          tu.id AS teacher_user_id,
          tu.first_name AS teacher_first_name,
          tu.last_name AS teacher_last_name,
          t.designation AS teacher_designation,
          t.employee_code AS teacher_employee_code
        FROM classroom_subjects cs
        JOIN subjects s ON s.id = cs.subject_id
        LEFT JOIN teachers t ON t.id = cs.teacher_id AND t.school_id = cs.school_id
        LEFT JOIN users tu ON tu.id = t.user_id AND tu.school_id = cs.school_id
        WHERE cs.school_id = $1
          AND cs.classroom_id = $2
        ORDER BY s.name ASC
      `,
            [req.auth.schoolId, classroom.id]
        );

        return success(res, result.rows, 200);
    })
);

// POST /class-teacher/subject-teachers
// Assign a teacher to a subject in the class teacher's classroom.
router.post(
    "/subject-teachers",
    requireAuth,
    requireRoles("school_admin", "principal", "teacher"),
    asyncHandler(async (req, res) => {
        const body = parseSchema(
            subjectTeacherAssignmentSchema,
            req.body,
            "Invalid subject-teacher assignment payload"
        );

        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);

        // Allow admin/principal to manage any classroom — for teachers, enforce homeroom
        if (!classroom && hasRole(req.auth, "teacher")) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }

        // If admin/principal, they need to specify classroom_id (for future extension)
        const classroomId = classroom?.id;
        if (!classroomId) {
            throw new AppError(403, "FORBIDDEN", "Cannot determine classroom for assignment");
        }

        // Verify subject exists
        const subjectResult = await pool.query(
            "SELECT id FROM subjects WHERE school_id = $1 AND id = $2 LIMIT 1",
            [req.auth.schoolId, body.subject_id]
        );
        if (!subjectResult.rows[0]) {
            throw new AppError(404, "NOT_FOUND", "Subject not found for this school");
        }

        // Verify teacher exists
        const teacherResult = await pool.query(
            `
        SELECT t.id AS teacher_id
        FROM teachers t
        JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
        WHERE t.school_id = $1
          AND t.user_id = $2
        LIMIT 1
      `,
            [req.auth.schoolId, body.teacher_user_id]
        );
        if (!teacherResult.rows[0]) {
            throw new AppError(404, "NOT_FOUND", "Teacher not found for this school");
        }

        const teacherId = teacherResult.rows[0].teacher_id;

        // Upsert into classroom_subjects
        const result = await pool.query(
            `
        INSERT INTO classroom_subjects (
          school_id,
          classroom_id,
          subject_id,
          teacher_id,
          periods_per_week,
          lesson_duration,
          lesson_priority,
          is_timetable_locked
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (school_id, classroom_id, subject_id)
        DO UPDATE SET
          teacher_id = EXCLUDED.teacher_id,
          periods_per_week = EXCLUDED.periods_per_week,
          lesson_duration = EXCLUDED.lesson_duration,
          lesson_priority = EXCLUDED.lesson_priority,
          is_timetable_locked = EXCLUDED.is_timetable_locked
        RETURNING
          id,
          school_id,
          classroom_id,
          subject_id,
          teacher_id,
          periods_per_week,
          lesson_duration,
          lesson_priority,
          is_timetable_locked
      `,
            [
                req.auth.schoolId,
                classroomId,
                body.subject_id,
                teacherId,
                body.periods_per_week,
                body.lesson_duration,
                body.lesson_priority,
                body.is_timetable_locked,
            ]
        );

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "class_teacher.subject_teacher_assigned",
            entityName: "classroom_subjects",
            entityId: result.rows[0].id,
            metadata: {
                classroom_id: classroomId,
                subject_id: body.subject_id,
                teacher_id: teacherId,
                periods_per_week: body.periods_per_week,
                lesson_duration: body.lesson_duration,
                lesson_priority: body.lesson_priority,
                is_timetable_locked: body.is_timetable_locked,
            },
        });

        return success(res, result.rows[0], 201);
    })
);

// PATCH /class-teacher/subject-teachers/:classroomSubjectId
// Update lesson load / teacher assignment for a classroom subject.
router.patch(
    "/subject-teachers/:classroomSubjectId",
    requireAuth,
    requireRoles("school_admin", "principal", "teacher"),
    asyncHandler(async (req, res) => {
        const classroomSubjectId = parseSchema(
            z.object({ classroomSubjectId: z.string().uuid() }),
            req.params,
            "Invalid classroom subject id"
        ).classroomSubjectId;
        const body = parseSchema(
            subjectTeacherPatchSchema,
            req.body,
            "Invalid subject-teacher patch payload"
        );

        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);
        if (!classroom && hasRole(req.auth, "teacher")) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }

        const existing = await pool.query(
            `
        SELECT
          cs.id,
          cs.classroom_id,
          cs.subject_id,
          cs.teacher_id,
          cs.periods_per_week,
          cs.lesson_duration,
          cs.lesson_priority,
          cs.is_timetable_locked
        FROM classroom_subjects cs
        WHERE cs.school_id = $1
          AND cs.id = $2
        LIMIT 1
      `,
            [req.auth.schoolId, classroomSubjectId]
        );

        if (!existing.rows[0]) {
            throw new AppError(404, "NOT_FOUND", "Subject-teacher assignment not found");
        }

        if (hasRole(req.auth, "teacher") && !hasRole(req.auth, "school_admin")) {
            if (existing.rows[0].classroom_id !== classroom?.id) {
                throw new AppError(403, "FORBIDDEN", "You can only manage your own class subjects");
            }
        }

        let teacherId = existing.rows[0].teacher_id;
        if (body.teacher_user_id) {
            const teacherResult = await pool.query(
                `
          SELECT t.id AS teacher_id
          FROM teachers t
          JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
          WHERE t.school_id = $1
            AND t.user_id = $2
          LIMIT 1
        `,
                [req.auth.schoolId, body.teacher_user_id]
            );
            if (!teacherResult.rows[0]) {
                throw new AppError(404, "NOT_FOUND", "Teacher not found for this school");
            }
            teacherId = teacherResult.rows[0].teacher_id;
        }

        const updated = await pool.query(
            `
        UPDATE classroom_subjects
        SET
          teacher_id = $3,
          periods_per_week = COALESCE($4, periods_per_week),
          lesson_duration = COALESCE($5, lesson_duration),
          lesson_priority = COALESCE($6, lesson_priority),
          is_timetable_locked = COALESCE($7, is_timetable_locked)
        WHERE school_id = $1
          AND id = $2
        RETURNING
          id,
          school_id,
          classroom_id,
          subject_id,
          teacher_id,
          periods_per_week,
          lesson_duration,
          lesson_priority,
          is_timetable_locked
      `,
            [
                req.auth.schoolId,
                classroomSubjectId,
                teacherId,
                body.periods_per_week ?? null,
                body.lesson_duration ?? null,
                body.lesson_priority ?? null,
                Object.prototype.hasOwnProperty.call(body, "is_timetable_locked")
                    ? body.is_timetable_locked
                    : null,
            ]
        );

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "class_teacher.subject_teacher_updated",
            entityName: "classroom_subjects",
            entityId: classroomSubjectId,
            metadata: {
                classroom_id: existing.rows[0].classroom_id,
                subject_id: existing.rows[0].subject_id,
                teacher_id: teacherId,
                updated_fields: Object.keys(body),
                periods_per_week: updated.rows[0]?.periods_per_week,
                lesson_duration: updated.rows[0]?.lesson_duration,
                lesson_priority: updated.rows[0]?.lesson_priority,
                is_timetable_locked: updated.rows[0]?.is_timetable_locked,
            },
        });

        return success(res, updated.rows[0], 200);
    })
);

// DELETE /class-teacher/subject-teachers/:classroomSubjectId
// Remove a subject-teacher assignment from the class teacher's classroom.
router.delete(
    "/subject-teachers/:classroomSubjectId",
    requireAuth,
    requireRoles("school_admin", "principal", "teacher"),
    asyncHandler(async (req, res) => {
        const csId = parseSchema(
            z.object({ classroomSubjectId: z.string().uuid() }),
            req.params
        ).classroomSubjectId;

        const classroom = await getHomeroomClassroom(req.auth.schoolId, req.auth.userId);
        if (!classroom && hasRole(req.auth, "teacher")) {
            throw new AppError(403, "FORBIDDEN", "You are not assigned as class teacher for any active classroom");
        }

        const existing = await pool.query(
            `
        SELECT id, classroom_id
        FROM classroom_subjects
        WHERE school_id = $1 AND id = $2
        LIMIT 1
      `,
            [req.auth.schoolId, csId]
        );
        if (!existing.rows[0]) {
            throw new AppError(404, "NOT_FOUND", "Subject-teacher assignment not found");
        }

        // If teacher, ensure it's their homeroom classroom
        if (hasRole(req.auth, "teacher") && !hasRole(req.auth, "school_admin")) {
            if (existing.rows[0].classroom_id !== classroom?.id) {
                throw new AppError(403, "FORBIDDEN", "You can only manage your own class subjects");
            }
        }

        await pool.query("DELETE FROM classroom_subjects WHERE id = $1", [csId]);

        fireAndForgetAuditLog({
            schoolId: req.auth.schoolId,
            actorUserId: req.auth.userId,
            action: "class_teacher.subject_teacher_unassigned",
            entityName: "classroom_subjects",
            entityId: csId,
            metadata: {
                classroom_id: existing.rows[0].classroom_id,
            },
        });

        return success(res, { deleted: true }, 200);
    })
);

module.exports = router;
