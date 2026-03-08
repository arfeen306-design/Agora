const crypto = require("crypto");
const express = require("express");
const { z } = require("zod");

const config = require("../config");
const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rate-limit");
const { getRealtimeHub } = require("../realtime/hub");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const {
  listTeacherClassroomIds,
  ensureTeacherCanManageClassroom: ensureTeacherClassroomScope,
} = require("../utils/teacher-scope");

const router = express.Router();

const deviceIngestRateLimiter = createRateLimiter({
  name: "device_ingest",
  windowMs: config.rateLimit.deviceIngestWindowMs,
  max: config.rateLimit.deviceIngestMax,
  keyFn: (req) =>
    `${req.ip || "unknown"}:${String(req.header("X-Device-Api-Key") || "no-key").slice(0, 24)}`,
});

const attendanceStatusSchema = z.enum(["present", "absent", "late", "leave"]);

const listQuerySchema = z.object({
  student_id: z.string().uuid().optional(),
  classroom_id: z.string().uuid().optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: attendanceStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const bulkSchema = z.object({
  classroom_id: z.string().uuid(),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: attendanceStatusSchema,
        check_in_at: z.string().datetime().optional(),
        source: z.string().min(1).default("manual"),
        note: z.string().max(500).optional(),
      })
    )
    .min(1),
});

const patchSchema = z
  .object({
    status: attendanceStatusSchema.optional(),
    check_in_at: z.string().datetime().nullable().optional(),
    source: z.string().min(1).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
    path: ["body"],
  });

const deviceAttendanceSourceSchema = z.enum(["rfid", "qr", "face"]);

const deviceIngestSchema = z
  .object({
    school_code: z.string().trim().min(1).max(80),
    student_id: z.string().uuid().optional(),
    student_code: z.string().trim().min(1).max(80).optional(),
    classroom_id: z.string().uuid().optional(),
    source: deviceAttendanceSourceSchema,
    scanner_id: z.string().trim().min(1).max(120).optional(),
    scanned_at: z.string().datetime().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.student_id || data.student_code, {
    message: "student_id or student_code is required",
    path: ["student_id"],
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

function assertDateRange({ dateFrom, dateTo, fromField = "date_from", toField = "date_to" }) {
  if (!dateFrom || !dateTo) return;
  if (dateFrom > dateTo) {
    throw new AppError(422, "VALIDATION_ERROR", `${fromField} must be on or before ${toField}`, [
      { field: fromField, issue: "invalid_range" },
      { field: toField, issue: "invalid_range" },
    ]);
  }
}

function hasRole(auth, role) {
  return Array.isArray(auth?.roles) && auth.roles.includes(role);
}

function safeEquals(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireDeviceApiKey(req, _res, next) {
  const incoming = req.header("X-Device-Api-Key");
  const expected = config.attendanceDevice.apiKey;
  if (!incoming || !expected || !safeEquals(incoming, expected)) {
    return next(new AppError(401, "UNAUTHORIZED", "Invalid device API key"));
  }
  return next();
}

function ensureReadRole(auth) {
  if (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "teacher") ||
    hasRole(auth, "parent") ||
    hasRole(auth, "student")
  ) {
    return;
  }
  throw new AppError(403, "FORBIDDEN", "No attendance read permission for this role");
}

async function classroomExists(schoolId, classroomId) {
  const result = await pool.query(
    "SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1",
    [schoolId, classroomId]
  );
  return Boolean(result.rows[0]);
}

async function ensureTeacherCanManageClassroom({ auth, classroomId }) {
  if (hasRole(auth, "school_admin")) return;
  if (!hasRole(auth, "teacher")) {
    throw new AppError(403, "FORBIDDEN", "Only teacher/admin can modify attendance");
  }
  await ensureTeacherClassroomScope({
    schoolId: auth.schoolId,
    userId: auth.userId,
    classroomId,
    message: "Teacher is not assigned to this classroom",
  });
}

async function getSchoolByCode(schoolCode) {
  const result = await pool.query(
    `
      SELECT id, code, name, timezone
      FROM schools
      WHERE code = $1
        AND is_active = TRUE
      LIMIT 1
    `,
    [schoolCode]
  );
  return result.rows[0] || null;
}

async function getStudentByIdentifier({ schoolId, studentId, studentCode }) {
  if (studentId) {
    const byId = await pool.query(
      `
        SELECT id, student_code, first_name, last_name
        FROM students
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [schoolId, studentId]
    );
    return byId.rows[0] || null;
  }

  const byCode = await pool.query(
    `
      SELECT id, student_code, first_name, last_name
      FROM students
      WHERE school_id = $1
        AND student_code = $2
      LIMIT 1
    `,
    [schoolId, studentCode]
  );
  return byCode.rows[0] || null;
}

async function resolveClassroomForDeviceCheckin({ schoolId, studentId, classroomId }) {
  if (classroomId) {
    const result = await pool.query(
      `
        SELECT se.classroom_id
        FROM student_enrollments se
        WHERE se.school_id = $1
          AND se.student_id = $2
          AND se.classroom_id = $3
          AND se.status = 'active'
        LIMIT 1
      `,
      [schoolId, studentId, classroomId]
    );
    if (!result.rows[0]) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Student is not actively enrolled in provided classroom"
      );
    }
    return classroomId;
  }

  const activeEnrollment = await pool.query(
    `
      SELECT se.classroom_id
      FROM student_enrollments se
      JOIN academic_years ay ON ay.id = se.academic_year_id
      WHERE se.school_id = $1
        AND se.student_id = $2
        AND se.status = 'active'
        AND ay.school_id = se.school_id
        AND ay.is_current = TRUE
      ORDER BY se.created_at DESC
      LIMIT 1
    `,
    [schoolId, studentId]
  );

  if (!activeEnrollment.rows[0]) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "No active classroom enrollment found for student in current academic year"
    );
  }

  return activeEnrollment.rows[0].classroom_id;
}

async function computeAttendanceTiming({ scannedAtIso, schoolTimezone }) {
  const timingResult = await pool.query(
    `
      SELECT
        ($1::timestamptz AT TIME ZONE $2)::date::text AS attendance_date,
        (($1::timestamptz AT TIME ZONE $2)::time > $3::time) AS is_late
    `,
    [scannedAtIso, schoolTimezone, config.attendanceDevice.lateAfterLocalTime]
  );

  const row = timingResult.rows[0];
  return {
    attendanceDate: row.attendance_date,
    isLate: Boolean(row.is_late),
  };
}

async function queueParentAttendanceNotifications({
  db,
  schoolId,
  studentId,
  studentName,
  status,
  attendanceDate,
  checkInAt,
  source,
  scannerId,
  attendanceRecordId,
}) {
  const sql = db || pool;
  const parentUsersResult = await sql.query(
    `
      SELECT DISTINCT p.user_id
      FROM parent_students ps
      JOIN parents p ON p.id = ps.parent_id
      WHERE ps.school_id = $1
        AND ps.student_id = $2
    `,
    [schoolId, studentId]
  );

  if (parentUsersResult.rowCount === 0) {
    return [];
  }

  const parentUserIds = parentUsersResult.rows.map((row) => row.user_id);
  const title = `${studentName} checked in`;
  const body = `Attendance marked as ${status} on ${attendanceDate}.`;
  const channel = ["in_app", "push", "email", "sms"].includes(config.attendanceDevice.notificationChannel)
    ? config.attendanceDevice.notificationChannel
    : "push";

  const notificationInsert = await sql.query(
    `
      INSERT INTO notifications (
        school_id,
        user_id,
        title,
        body,
        channel,
        status,
        payload
      )
      SELECT
        $1,
        u.user_id,
        $2,
        $3,
        $4::notification_channel,
        'queued'::notification_status,
        $5::jsonb
      FROM UNNEST($6::uuid[]) AS u(user_id)
      RETURNING
        id,
        user_id,
        title,
        body,
        channel,
        status,
        payload,
        sent_at,
        read_at,
        created_at
    `,
    [
      schoolId,
      title,
      body,
      channel,
      JSON.stringify({
        source: "attendance_device",
        attendance_record_id: attendanceRecordId,
        student_id: studentId,
        attendance_date: attendanceDate,
        check_in_at: checkInAt,
        scanner_id: scannerId || null,
        capture_source: source,
        retry_count: 0,
        next_retry_at: null,
      }),
      parentUserIds,
    ]
  );

  return notificationInsert.rows;
}

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureReadRole(req.auth);
    const query = parseSchema(listQuerySchema, req.query, "Invalid attendance query");
    assertDateRange({ dateFrom: query.date_from, dateTo: query.date_to });

    const params = [req.auth.schoolId];
    const where = ["ar.school_id = $1"];

    if (query.student_id) {
      params.push(query.student_id);
      where.push(`ar.student_id = $${params.length}`);
    }
    if (query.classroom_id) {
      params.push(query.classroom_id);
      where.push(`ar.classroom_id = $${params.length}`);
    }
    if (query.date_from) {
      params.push(query.date_from);
      where.push(`ar.attendance_date >= $${params.length}`);
    }
    if (query.date_to) {
      params.push(query.date_to);
      where.push(`ar.attendance_date <= $${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`ar.status = $${params.length}::attendance_status`);
    }

    if (hasRole(req.auth, "school_admin")) {
      // full school scope
    } else if (hasRole(req.auth, "teacher")) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });
      if (teacherClassroomIds.length === 0) {
        where.push("1 = 0");
      } else {
        params.push(teacherClassroomIds);
        where.push(`ar.classroom_id = ANY($${params.length}::uuid[])`);
      }
    } else if (hasRole(req.auth, "parent")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM parent_students ps
          JOIN parents p ON p.id = ps.parent_id
          WHERE ps.school_id = ar.school_id
            AND ps.student_id = ar.student_id
            AND p.school_id = ar.school_id
            AND p.user_id = $${params.length}
        )
      `);
    } else if (hasRole(req.auth, "student")) {
      params.push(req.auth.userId);
      where.push(`
        EXISTS (
          SELECT 1
          FROM student_user_accounts sua
          JOIN students s ON s.id = sua.student_id
          WHERE sua.user_id = $${params.length}
            AND sua.student_id = ar.student_id
            AND s.school_id = ar.school_id
        )
      `);
    }

    const whereClause = where.join(" AND ");

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM attendance_records ar
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
          ar.id,
          ar.student_id,
          ar.classroom_id,
          ar.attendance_date,
          ar.status,
          ar.check_in_at,
          ar.source,
          ar.note
        FROM attendance_records ar
        WHERE ${whereClause}
        ORDER BY ar.attendance_date DESC, ar.created_at DESC
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
  "/bulk",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(bulkSchema, req.body, "Invalid attendance bulk payload");

    const classroomOk = await classroomExists(req.auth.schoolId, body.classroom_id);
    if (!classroomOk) {
      throw new AppError(404, "NOT_FOUND", "Classroom not found for this school");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: body.classroom_id,
    });

    const studentIds = [...new Set(body.entries.map((item) => item.student_id))];
    const studentsResult = await pool.query(
      "SELECT id FROM students WHERE school_id = $1 AND id = ANY($2::uuid[])",
      [req.auth.schoolId, studentIds]
    );
    if (studentsResult.rowCount !== studentIds.length) {
      throw new AppError(422, "VALIDATION_ERROR", "One or more students do not belong to this school");
    }

    const enrollmentResult = await pool.query(
      `
        SELECT se.student_id
        FROM student_enrollments se
        JOIN academic_years ay
          ON ay.id = se.academic_year_id
         AND ay.school_id = se.school_id
        WHERE se.school_id = $1
          AND se.classroom_id = $2
          AND se.status = 'active'
          AND ay.is_current = TRUE
          AND se.student_id = ANY($3::uuid[])
      `,
      [req.auth.schoolId, body.classroom_id, studentIds]
    );
    const enrolledIds = new Set(enrollmentResult.rows.map((row) => row.student_id));
    const notEnrolledIds = studentIds.filter((studentId) => !enrolledIds.has(studentId));
    if (notEnrolledIds.length > 0) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "One or more students are not actively enrolled in this classroom for the current academic year",
        notEnrolledIds.slice(0, 15).map((studentId) => ({
          field: "entries.student_id",
          issue: `not_enrolled:${studentId}`,
        }))
      );
    }

    const client = await pool.connect();
    let createdCount = 0;
    let updatedCount = 0;

    try {
      await client.query("BEGIN");

      for (const entry of body.entries) {
        const existing = await client.query(
          `
            SELECT id
            FROM attendance_records
            WHERE school_id = $1
              AND student_id = $2
              AND attendance_date = $3
            LIMIT 1
          `,
          [req.auth.schoolId, entry.student_id, body.attendance_date]
        );

        if (existing.rows[0]) {
          await client.query(
            `
              UPDATE attendance_records
              SET
                classroom_id = $1,
                status = $2::attendance_status,
                check_in_at = $3,
                source = $4,
                note = $5,
                recorded_by_user_id = $6
              WHERE id = $7
            `,
            [
              body.classroom_id,
              entry.status,
              entry.check_in_at || null,
              entry.source || "manual",
              entry.note || null,
              req.auth.userId,
              existing.rows[0].id,
            ]
          );
          updatedCount += 1;
        } else {
          await client.query(
            `
              INSERT INTO attendance_records (
                school_id,
                student_id,
                classroom_id,
                attendance_date,
                status,
                check_in_at,
                source,
                note,
                recorded_by_user_id
              )
              VALUES ($1, $2, $3, $4, $5::attendance_status, $6, $7, $8, $9)
            `,
            [
              req.auth.schoolId,
              entry.student_id,
              body.classroom_id,
              body.attendance_date,
              entry.status,
              entry.check_in_at || null,
              entry.source || "manual",
              entry.note || null,
              req.auth.userId,
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

router.post(
  "/device-ingest",
  deviceIngestRateLimiter,
  requireDeviceApiKey,
  asyncHandler(async (req, res) => {
    const body = parseSchema(deviceIngestSchema, req.body, "Invalid attendance device ingest payload");

    const school = await getSchoolByCode(body.school_code);
    if (!school) {
      throw new AppError(404, "NOT_FOUND", "School not found");
    }

    const student = await getStudentByIdentifier({
      schoolId: school.id,
      studentId: body.student_id,
      studentCode: body.student_code,
    });
    if (!student) {
      throw new AppError(404, "NOT_FOUND", "Student not found in this school");
    }

    const classroomId = await resolveClassroomForDeviceCheckin({
      schoolId: school.id,
      studentId: student.id,
      classroomId: body.classroom_id,
    });

    const checkInAt = body.scanned_at || new Date().toISOString();
    const timing = await computeAttendanceTiming({
      scannedAtIso: checkInAt,
      schoolTimezone: school.timezone || "Asia/Karachi",
    });
    const status = timing.isLate ? "late" : "present";

    const client = await pool.connect();
    let attendanceRecord = null;
    let operation = "created";

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `
          SELECT id
          FROM attendance_records
          WHERE school_id = $1
            AND student_id = $2
            AND attendance_date = $3
          LIMIT 1
        `,
        [school.id, student.id, timing.attendanceDate]
      );

      if (existing.rows[0]) {
        operation = "updated";
        const updateResult = await client.query(
          `
            UPDATE attendance_records
            SET
              classroom_id = $1,
              status = $2::attendance_status,
              check_in_at = $3::timestamptz,
              source = $4,
              note = $5,
              recorded_by_user_id = NULL
            WHERE id = $6
            RETURNING
              id,
              student_id,
              classroom_id,
              attendance_date,
              status,
              check_in_at,
              source,
              note
          `,
          [
            classroomId,
            status,
            checkInAt,
            body.source,
            body.note || `Captured by ${body.source.toUpperCase()} device`,
            existing.rows[0].id,
          ]
        );
        attendanceRecord = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `
            INSERT INTO attendance_records (
              school_id,
              student_id,
              classroom_id,
              attendance_date,
              status,
              check_in_at,
              source,
              note,
              recorded_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5::attendance_status, $6::timestamptz, $7, $8, NULL)
            RETURNING
              id,
              student_id,
              classroom_id,
              attendance_date,
              status,
              check_in_at,
              source,
              note
          `,
          [
            school.id,
            student.id,
            classroomId,
            timing.attendanceDate,
            status,
            checkInAt,
            body.source,
            body.note || `Captured by ${body.source.toUpperCase()} device`,
          ]
        );
        attendanceRecord = insertResult.rows[0];
      }

      const studentName = `${student.first_name}${student.last_name ? ` ${student.last_name}` : ""}`;
      const queuedNotifications = await queueParentAttendanceNotifications({
        db: client,
        schoolId: school.id,
        studentId: student.id,
        studentName,
        status,
        attendanceDate: timing.attendanceDate,
        checkInAt,
        source: body.source,
        scannerId: body.scanner_id,
        attendanceRecordId: attendanceRecord.id,
      });

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: school.id,
        actorUserId: null,
        action: "DEVICE_ATTENDANCE_INGEST",
        entityName: "attendance_records",
        entityId: attendanceRecord.id,
        metadata: {
          method: "POST",
          path: "attendance/device-ingest",
          school_code: school.code,
          student_id: student.id,
          student_code: student.student_code,
          source: body.source,
          scanner_id: body.scanner_id || null,
          attendance_date: timing.attendanceDate,
          operation,
          notification_count: queuedNotifications.length,
          request_id: res.locals.requestId || null,
        },
      });

      for (const notification of queuedNotifications) {
        getRealtimeHub().emitToUser(
          notification.user_id,
          "notification.new",
          { notification },
          { schoolId: school.id }
        );
      }

      return success(
        res,
        {
          operation,
          attendance: attendanceRecord,
          derived: {
            school_timezone: school.timezone || "Asia/Karachi",
            late_after_local_time: config.attendanceDevice.lateAfterLocalTime,
            is_late: timing.isLate,
          },
          notifications_queued: queuedNotifications.length,
          student: {
            id: student.id,
            student_code: student.student_code,
            first_name: student.first_name,
            last_name: student.last_name,
          },
        },
        200
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.patch(
  "/:attendanceId",
  requireAuth,
  requireRoles("school_admin", "teacher"),
  asyncHandler(async (req, res) => {
    const pathInput = parseSchema(
      z.object({
        attendanceId: z.string().uuid(),
      }),
      req.params,
      "Invalid attendance id"
    );
    const attendanceId = pathInput.attendanceId;
    const body = parseSchema(patchSchema, req.body, "Invalid attendance patch payload");

    const recordResult = await pool.query(
      `
        SELECT id, classroom_id
        FROM attendance_records
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
      `,
      [attendanceId, req.auth.schoolId]
    );
    const record = recordResult.rows[0];
    if (!record) {
      throw new AppError(404, "NOT_FOUND", "Attendance record not found");
    }

    await ensureTeacherCanManageClassroom({
      auth: req.auth,
      classroomId: record.classroom_id,
    });

    const setClauses = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      values.push(body.status);
      setClauses.push(`status = $${values.length}::attendance_status`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "check_in_at")) {
      values.push(body.check_in_at);
      setClauses.push(`check_in_at = $${values.length}::timestamptz`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "source")) {
      values.push(body.source);
      setClauses.push(`source = $${values.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(body, "note")) {
      values.push(body.note);
      setClauses.push(`note = $${values.length}`);
    }

    values.push(req.auth.userId);
    setClauses.push(`recorded_by_user_id = $${values.length}`);

    values.push(attendanceId);
    const updateResult = await pool.query(
      `
        UPDATE attendance_records
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
        RETURNING
          id,
          student_id,
          classroom_id,
          attendance_date,
          status,
          check_in_at,
          source,
          note
      `,
      values
    );

    return success(res, updateResult.rows[0], 200);
  })
);

module.exports = router;
