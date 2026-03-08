const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");

const router = express.Router();

const ADMISSION_STATUSES = [
  "inquiry",
  "applied",
  "under_review",
  "test_scheduled",
  "accepted",
  "rejected",
  "admitted",
  "waitlisted",
];

const STAGE_ORDER = [
  "inquiry",
  "applied",
  "under_review",
  "test_scheduled",
  "accepted",
  "waitlisted",
  "rejected",
  "admitted",
];

const TRANSITION_ROLES = {
  "inquiry->applied": ["front_desk", "school_admin"],
  "applied->under_review": ["front_desk", "school_admin"],
  "under_review->test_scheduled": ["school_admin", "principal", "vice_principal"],
  "under_review->accepted": ["school_admin", "principal", "vice_principal"],
  "under_review->rejected": ["school_admin", "principal", "vice_principal"],
  "under_review->waitlisted": ["school_admin", "principal", "vice_principal"],
  "test_scheduled->accepted": ["school_admin", "principal", "vice_principal"],
  "test_scheduled->rejected": ["school_admin", "principal", "vice_principal"],
  "waitlisted->accepted": ["school_admin", "principal", "vice_principal"],
  "waitlisted->rejected": ["school_admin", "principal", "vice_principal"],
  "accepted->admitted": ["school_admin", "front_desk"],
};

const stageSchema = z.enum(ADMISSION_STATUSES);

const pipelineQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  limit_per_stage: z.coerce.number().int().min(1).max(60).default(20),
});

const listApplicationsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: stageSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const studentPathSchema = z.object({
  studentId: z.string().uuid(),
});

const createInquirySchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional(),
  guardian_name: z.string().trim().min(1).max(160),
  guardian_phone: z.string().trim().max(60).optional(),
  guardian_email: z.string().trim().email().optional(),
  inquiry_source: z.string().trim().max(120).optional(),
  desired_grade_label: z.string().trim().max(80).optional(),
  desired_section_label: z.string().trim().max(80).optional(),
  desired_classroom_id: z.string().uuid().optional(),
  desired_academic_year_id: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
});

const stageChangeSchema = z.object({
  new_status: stageSchema,
  notes: z.string().trim().max(2000).optional(),
  desired_classroom_id: z.string().uuid().optional(),
  desired_academic_year_id: z.string().uuid().optional(),
});

const admitSchema = z.object({
  classroom_id: z.string().uuid(),
  academic_year_id: z.string().uuid().optional(),
  roll_no: z.coerce.number().int().min(1).max(9999).optional(),
  notes: z.string().trim().max(2000).optional(),
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

function hasAnyRole(auth, allowedRoles) {
  return allowedRoles.some((role) => hasRole(auth, role));
}

async function ensureClassroomInSchool(schoolId, classroomId) {
  if (!classroomId) return null;
  const row = await pool.query(
    `
      SELECT id, academic_year_id
      FROM classrooms
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "desired_classroom_id must belong to this school");
  }
  return row.rows[0];
}

async function ensureAcademicYearInSchool(schoolId, academicYearId, fieldName = "desired_academic_year_id") {
  if (!academicYearId) return null;
  const row = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
        AND id = $2
      LIMIT 1
    `,
    [schoolId, academicYearId]
  );
  if (!row.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
  return row.rows[0];
}

async function generateInquiryCode(client, schoolId) {
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const partA = String(Math.floor(1000 + Math.random() * 9000));
    const partB = String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `INQ-${year}-${partA}${partB}`;
    const exists = await client.query(
      `
        SELECT 1
        FROM students
        WHERE school_id = $1
          AND student_code = $2
        LIMIT 1
      `,
      [schoolId, candidate]
    );
    if (!exists.rows[0]) return candidate;
  }
  throw new AppError(500, "INTERNAL_SERVER_ERROR", "Unable to generate unique inquiry code");
}

async function getApplicationByStudent({ schoolId, studentId }) {
  const row = await pool.query(
    `
      SELECT
        s.id AS student_id,
        s.student_code,
        s.first_name,
        s.last_name,
        s.admission_status,
        s.status AS student_status,
        s.admission_date,
        s.created_at AS student_created_at,
        aa.id AS application_id,
        aa.inquiry_source,
        aa.desired_grade_label,
        aa.desired_section_label,
        aa.desired_classroom_id,
        aa.desired_academic_year_id,
        aa.guardian_name,
        aa.guardian_phone,
        aa.guardian_email,
        aa.notes,
        aa.stage_notes,
        aa.current_status,
        aa.approved_by_user_id,
        aa.approved_at,
        aa.rejected_by_user_id,
        aa.rejected_at,
        aa.admitted_by_user_id,
        aa.admitted_at,
        aa.created_by_user_id,
        aa.created_at AS application_created_at,
        aa.updated_at AS application_updated_at
      FROM students s
      LEFT JOIN admission_applications aa
        ON aa.school_id = s.school_id
       AND aa.student_id = s.id
      WHERE s.school_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    [schoolId, studentId]
  );
  return row.rows[0] || null;
}

function ensureTransitionPermission(auth, fromStatus, toStatus) {
  const key = `${fromStatus}->${toStatus}`;
  const allowedRoles = TRANSITION_ROLES[key];
  if (!allowedRoles) {
    throw new AppError(422, "VALIDATION_ERROR", `Transition ${fromStatus} -> ${toStatus} is not allowed`);
  }
  if (!hasAnyRole(auth, allowedRoles)) {
    throw new AppError(403, "FORBIDDEN", `Role is not allowed to transition ${fromStatus} -> ${toStatus}`);
  }
}

async function ensureApplicationRow(client, { schoolId, studentId, actorUserId }) {
  const existing = await client.query(
    `
      SELECT
        aa.id,
        aa.current_status,
        s.admission_status,
        s.first_name,
        s.last_name
      FROM students s
      LEFT JOIN admission_applications aa
        ON aa.school_id = s.school_id
       AND aa.student_id = s.id
      WHERE s.school_id = $1
        AND s.id = $2
      LIMIT 1
    `,
    [schoolId, studentId]
  );
  const row = existing.rows[0];
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Admission application not found");
  }

  if (row.id) {
    return {
      applicationId: row.id,
      currentStatus: row.current_status || row.admission_status || "inquiry",
      studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    };
  }

  const created = await client.query(
    `
      INSERT INTO admission_applications (
        school_id,
        student_id,
        created_by_user_id,
        updated_by_user_id,
        guardian_name,
        current_status
      )
      VALUES ($1, $2, $3, $3, $4, $5)
      RETURNING id, current_status
    `,
    [schoolId, studentId, actorUserId, [row.first_name, row.last_name].filter(Boolean).join(" ").trim(), row.admission_status || "inquiry"]
  );

  return {
    applicationId: created.rows[0].id,
    currentStatus: created.rows[0].current_status,
    studentName: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
  };
}

router.get(
  "/admissions/pipeline",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "front_desk"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(pipelineQuerySchema, req.query, "Invalid admissions pipeline query");

    const params = [req.auth.schoolId, ADMISSION_STATUSES];
    let where = `
      s.school_id = $1
      AND s.admission_status = ANY($2::text[])
    `;

    if (query.search) {
      params.push(`%${query.search}%`);
      where += `
        AND (
          s.student_code ILIKE $${params.length}
          OR s.first_name ILIKE $${params.length}
          OR COALESCE(s.last_name, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_name, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_phone, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_email, '') ILIKE $${params.length}
        )
      `;
    }

    const rows = await pool.query(
      `
        SELECT
          s.id AS student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.admission_status,
          s.created_at,
          aa.guardian_name,
          aa.guardian_phone,
          aa.guardian_email,
          aa.desired_grade_label,
          aa.desired_section_label,
          aa.current_status
        FROM students s
        LEFT JOIN admission_applications aa
          ON aa.school_id = s.school_id
         AND aa.student_id = s.id
        WHERE ${where}
        ORDER BY s.created_at DESC
      `,
      params
    );

    const grouped = {};
    for (const stage of STAGE_ORDER) {
      grouped[stage] = {
        count: 0,
        students: [],
      };
    }

    for (const row of rows.rows) {
      const stage = row.admission_status || "inquiry";
      if (!grouped[stage]) {
        grouped[stage] = {
          count: 0,
          students: [],
        };
      }
      grouped[stage].count += 1;
      if (grouped[stage].students.length < query.limit_per_stage) {
        grouped[stage].students.push({
          student_id: row.student_id,
          student_code: row.student_code,
          first_name: row.first_name,
          last_name: row.last_name,
          admission_status: row.admission_status,
          guardian_name: row.guardian_name,
          guardian_phone: row.guardian_phone,
          guardian_email: row.guardian_email,
          desired_grade_label: row.desired_grade_label,
          desired_section_label: row.desired_section_label,
          created_at: row.created_at,
        });
      }
    }

    const total = rows.rowCount;
    const activeFunnelCount = rows.rows.filter((row) => !["admitted", "rejected"].includes(row.admission_status)).length;
    const admittedCount = grouped.admitted?.count || 0;
    const rejectedCount = grouped.rejected?.count || 0;
    const decisionBase = admittedCount + rejectedCount;
    const conversionRate = decisionBase > 0 ? Number((admittedCount / decisionBase).toFixed(4)) : 0;

    return success(
      res,
      {
        stages: grouped,
        summary: {
          total,
          total_active: activeFunnelCount,
          admitted_count: admittedCount,
          rejected_count: rejectedCount,
          conversion_rate: conversionRate,
        },
      },
      200
    );
  })
);

router.get(
  "/admissions/applications",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "front_desk"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listApplicationsQuerySchema, req.query, "Invalid admissions applications query");

    const params = [req.auth.schoolId];
    const where = ["s.school_id = $1"];

    if (query.status) {
      params.push(query.status);
      where.push(`s.admission_status = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          s.student_code ILIKE $${params.length}
          OR s.first_name ILIKE $${params.length}
          OR COALESCE(s.last_name, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_name, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_phone, '') ILIKE $${params.length}
          OR COALESCE(aa.guardian_email, '') ILIKE $${params.length}
        )
      `);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM students s
        LEFT JOIN admission_applications aa
          ON aa.school_id = s.school_id
         AND aa.student_id = s.id
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          s.id AS student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          s.admission_status,
          s.status AS student_status,
          s.admission_date,
          s.created_at,
          aa.id AS application_id,
          aa.guardian_name,
          aa.guardian_phone,
          aa.guardian_email,
          aa.inquiry_source,
          aa.desired_grade_label,
          aa.desired_section_label,
          aa.stage_notes,
          aa.updated_at AS application_updated_at
        FROM students s
        LEFT JOIN admission_applications aa
          ON aa.school_id = s.school_id
         AND aa.student_id = s.id
        WHERE ${where.join(" AND ")}
        ORDER BY s.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    return success(
      res,
      rows.rows,
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
  "/admissions/applications/:studentId",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "front_desk"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");
    const application = await getApplicationByStudent({
      schoolId: req.auth.schoolId,
      studentId: path.studentId,
    });

    if (!application) {
      throw new AppError(404, "NOT_FOUND", "Admission application not found");
    }

    const history = await pool.query(
      `
        SELECT
          ase.id,
          ase.from_status,
          ase.to_status,
          ase.notes,
          ase.created_at,
          ase.changed_by_user_id,
          u.first_name AS changed_by_first_name,
          u.last_name AS changed_by_last_name
        FROM admission_stage_events ase
        LEFT JOIN users u
          ON u.id = ase.changed_by_user_id
         AND u.school_id = ase.school_id
        WHERE ase.school_id = $1
          AND ase.student_id = $2
        ORDER BY ase.created_at DESC
      `,
      [req.auth.schoolId, path.studentId]
    );

    const enrollment = await pool.query(
      `
        SELECT
          se.classroom_id,
          se.academic_year_id,
          se.roll_no,
          se.status,
          se.joined_on,
          c.grade_label,
          c.section_label,
          c.classroom_code,
          ay.name AS academic_year_name
        FROM student_enrollments se
        LEFT JOIN classrooms c
          ON c.id = se.classroom_id
         AND c.school_id = se.school_id
        LEFT JOIN academic_years ay
          ON ay.id = se.academic_year_id
         AND ay.school_id = se.school_id
        WHERE se.school_id = $1
          AND se.student_id = $2
        ORDER BY se.joined_on DESC NULLS LAST, se.created_at DESC
        LIMIT 1
      `,
      [req.auth.schoolId, path.studentId]
    );

    return success(
      res,
      {
        student: {
          student_id: application.student_id,
          student_code: application.student_code,
          first_name: application.first_name,
          last_name: application.last_name,
          admission_status: application.admission_status,
          student_status: application.student_status,
          admission_date: application.admission_date,
          created_at: application.student_created_at,
        },
        application: {
          application_id: application.application_id,
          inquiry_source: application.inquiry_source,
          guardian_name: application.guardian_name,
          guardian_phone: application.guardian_phone,
          guardian_email: application.guardian_email,
          desired_grade_label: application.desired_grade_label,
          desired_section_label: application.desired_section_label,
          desired_classroom_id: application.desired_classroom_id,
          desired_academic_year_id: application.desired_academic_year_id,
          notes: application.notes,
          stage_notes: application.stage_notes,
          current_status: application.current_status || application.admission_status,
          approved_by_user_id: application.approved_by_user_id,
          approved_at: application.approved_at,
          rejected_by_user_id: application.rejected_by_user_id,
          rejected_at: application.rejected_at,
          admitted_by_user_id: application.admitted_by_user_id,
          admitted_at: application.admitted_at,
          created_by_user_id: application.created_by_user_id,
          created_at: application.application_created_at,
          updated_at: application.application_updated_at,
        },
        enrollment: enrollment.rows[0] || null,
        history: history.rows,
      },
      200
    );
  })
);

router.post(
  "/admissions/inquiries",
  requireAuth,
  requireRoles("school_admin", "front_desk"),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createInquirySchema, req.body, "Invalid inquiry create payload");
    const desiredClassroom = await ensureClassroomInSchool(req.auth.schoolId, body.desired_classroom_id || null);
    await ensureAcademicYearInSchool(req.auth.schoolId, body.desired_academic_year_id || null);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const studentCode = await generateInquiryCode(client, req.auth.schoolId);

      const studentInsert = await client.query(
        `
          INSERT INTO students (
            school_id,
            student_code,
            first_name,
            last_name,
            admission_date,
            status,
            admission_status,
            notes
          )
          VALUES ($1, $2, $3, $4, CURRENT_DATE, 'inactive', 'inquiry', $5)
          RETURNING
            id,
            student_code,
            first_name,
            last_name,
            admission_status,
            status,
            admission_date,
            created_at
        `,
        [req.auth.schoolId, studentCode, body.first_name, body.last_name || null, body.notes || null]
      );

      const student = studentInsert.rows[0];
      const applicationInsert = await client.query(
        `
          INSERT INTO admission_applications (
            school_id,
            student_id,
            created_by_user_id,
            updated_by_user_id,
            inquiry_source,
            desired_grade_label,
            desired_section_label,
            desired_classroom_id,
            desired_academic_year_id,
            guardian_name,
            guardian_phone,
            guardian_email,
            notes,
            current_status
          )
          VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'inquiry')
          RETURNING *
        `,
        [
          req.auth.schoolId,
          student.id,
          req.auth.userId,
          body.inquiry_source || null,
          body.desired_grade_label || null,
          body.desired_section_label || null,
          body.desired_classroom_id || null,
          body.desired_academic_year_id || (desiredClassroom?.academic_year_id || null),
          body.guardian_name,
          body.guardian_phone || null,
          body.guardian_email || null,
          body.notes || null,
        ]
      );
      const application = applicationInsert.rows[0];

      await client.query(
        `
          INSERT INTO admission_stage_events (
            school_id,
            application_id,
            student_id,
            from_status,
            to_status,
            changed_by_user_id,
            notes
          )
          VALUES ($1, $2, $3, NULL, 'inquiry', $4, $5)
        `,
        [req.auth.schoolId, application.id, student.id, req.auth.userId, body.notes || "Inquiry created"]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "admissions.inquiry.created",
        entityName: "admission_applications",
        entityId: application.id,
        metadata: {
          student_id: student.id,
          student_code: student.student_code,
          admission_status: student.admission_status,
          desired_grade_label: application.desired_grade_label,
          guardian_name: application.guardian_name,
        },
      });

      return success(
        res,
        {
          student,
          application,
        },
        201
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
  "/admissions/:studentId/stage",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "front_desk"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");
    const body = parseSchema(stageChangeSchema, req.body, "Invalid stage update payload");
    if (body.new_status === "admitted") {
      throw new AppError(422, "VALIDATION_ERROR", "Use /admissions/:studentId/admit to complete admission");
    }

    const desiredClassroom = await ensureClassroomInSchool(req.auth.schoolId, body.desired_classroom_id || null);
    await ensureAcademicYearInSchool(req.auth.schoolId, body.desired_academic_year_id || null);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const appRow = await ensureApplicationRow(client, {
        schoolId: req.auth.schoolId,
        studentId: path.studentId,
        actorUserId: req.auth.userId,
      });

      const currentStatus = appRow.currentStatus;
      if (currentStatus === body.new_status) {
        throw new AppError(422, "VALIDATION_ERROR", "Application is already in the requested stage");
      }
      if (currentStatus === "admitted") {
        throw new AppError(422, "VALIDATION_ERROR", "Admitted student cannot be moved to another stage");
      }

      ensureTransitionPermission(req.auth, currentStatus, body.new_status);

      await client.query(
        `
          UPDATE students
          SET admission_status = $1,
              updated_at = NOW()
          WHERE school_id = $2
            AND id = $3
        `,
        [body.new_status, req.auth.schoolId, path.studentId]
      );

      const setFragments = ["current_status = $1", "updated_by_user_id = $2", "updated_at = NOW()"];
      const values = [body.new_status, req.auth.userId, req.auth.schoolId, path.studentId];
      let idx = values.length + 1;

      if (Object.prototype.hasOwnProperty.call(body, "desired_classroom_id")) {
        setFragments.push(`desired_classroom_id = $${idx}`);
        values.push(body.desired_classroom_id || null);
        idx += 1;
      }
      if (Object.prototype.hasOwnProperty.call(body, "desired_academic_year_id")) {
        setFragments.push(`desired_academic_year_id = $${idx}`);
        values.push(body.desired_academic_year_id || null);
        idx += 1;
      } else if (desiredClassroom?.academic_year_id) {
        setFragments.push(`desired_academic_year_id = $${idx}`);
        values.push(desiredClassroom.academic_year_id);
        idx += 1;
      }
      if (Object.prototype.hasOwnProperty.call(body, "notes")) {
        setFragments.push(`stage_notes = $${idx}`);
        values.push(body.notes || null);
        idx += 1;
      }

      if (body.new_status === "accepted") {
        setFragments.push(`approved_by_user_id = $${idx}`);
        values.push(req.auth.userId);
        idx += 1;
        setFragments.push(`approved_at = NOW()`);
      }
      if (body.new_status === "rejected") {
        setFragments.push(`rejected_by_user_id = $${idx}`);
        values.push(req.auth.userId);
        idx += 1;
        setFragments.push(`rejected_at = NOW()`);
      }

      await client.query(
        `
          UPDATE admission_applications
          SET ${setFragments.join(", ")}
          WHERE school_id = $3
            AND student_id = $4
        `,
        values
      );

      await client.query(
        `
          INSERT INTO admission_stage_events (
            school_id,
            application_id,
            student_id,
            from_status,
            to_status,
            changed_by_user_id,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          req.auth.schoolId,
          appRow.applicationId,
          path.studentId,
          currentStatus,
          body.new_status,
          req.auth.userId,
          body.notes || null,
        ]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "admissions.stage.changed",
        entityName: "admission_applications",
        entityId: appRow.applicationId,
        metadata: {
          student_id: path.studentId,
          old_status: currentStatus,
          new_status: body.new_status,
          notes: body.notes || null,
        },
      });

      return success(
        res,
        {
          student_id: path.studentId,
          application_id: appRow.applicationId,
          old_status: currentStatus,
          new_status: body.new_status,
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

router.post(
  "/admissions/:studentId/admit",
  requireAuth,
  requireRoles("school_admin", "front_desk"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(studentPathSchema, req.params, "Invalid student id");
    const body = parseSchema(admitSchema, req.body, "Invalid admission payload");

    const classroom = await ensureClassroomInSchool(req.auth.schoolId, body.classroom_id);
    let academicYearId = body.academic_year_id || classroom?.academic_year_id || null;
    if (!academicYearId) {
      throw new AppError(422, "VALIDATION_ERROR", "academic_year_id is required");
    }
    await ensureAcademicYearInSchool(req.auth.schoolId, academicYearId, "academic_year_id");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const appRow = await ensureApplicationRow(client, {
        schoolId: req.auth.schoolId,
        studentId: path.studentId,
        actorUserId: req.auth.userId,
      });
      if (appRow.currentStatus !== "accepted") {
        throw new AppError(422, "VALIDATION_ERROR", "Only accepted applicants can be admitted");
      }
      ensureTransitionPermission(req.auth, "accepted", "admitted");

      if (body.roll_no) {
        const rollConflict = await client.query(
          `
            SELECT student_id
            FROM student_enrollments
            WHERE school_id = $1
              AND classroom_id = $2
              AND academic_year_id = $3
              AND roll_no = $4
              AND student_id <> $5
            LIMIT 1
          `,
          [req.auth.schoolId, body.classroom_id, academicYearId, body.roll_no, path.studentId]
        );

        if (rollConflict.rows[0]) {
          throw new AppError(
            422,
            "VALIDATION_ERROR",
            "Roll number is already assigned in this classroom for the selected academic year",
            [{ field: "roll_no", issue: "already_assigned" }]
          );
        }
      }

      let enrollmentResult;
      try {
        enrollmentResult = await client.query(
          `
            INSERT INTO student_enrollments (
              school_id,
              student_id,
              classroom_id,
              academic_year_id,
              roll_no,
              status,
              joined_on
            )
            VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_DATE)
            ON CONFLICT (school_id, student_id, academic_year_id)
            DO UPDATE SET
              classroom_id = EXCLUDED.classroom_id,
              roll_no = COALESCE(EXCLUDED.roll_no, student_enrollments.roll_no),
              status = 'active',
              joined_on = COALESCE(student_enrollments.joined_on, CURRENT_DATE),
              updated_at = NOW()
            RETURNING
              school_id,
              student_id,
              classroom_id,
              academic_year_id,
              roll_no,
              status,
              joined_on
          `,
          [req.auth.schoolId, path.studentId, body.classroom_id, academicYearId, body.roll_no || null]
        );
      } catch (error) {
        if (error?.code === "23505") {
          if (String(error.constraint || "").includes("roll_no")) {
            throw new AppError(
              422,
              "VALIDATION_ERROR",
              "Roll number is already assigned in this classroom for the selected academic year",
              [{ field: "roll_no", issue: "already_assigned" }]
            );
          }

          if (String(error.constraint || "").includes("classroom_id_academic_year_id")) {
            throw new AppError(
              422,
              "VALIDATION_ERROR",
              "Enrollment conflict for selected classroom and academic year",
              [{ field: "classroom_id", issue: "enrollment_conflict" }]
            );
          }
        }
        throw error;
      }

      await client.query(
        `
          UPDATE students
          SET admission_status = 'admitted',
              status = 'active',
              admission_date = COALESCE(admission_date, CURRENT_DATE),
              updated_at = NOW()
          WHERE school_id = $1
            AND id = $2
        `,
        [req.auth.schoolId, path.studentId]
      );

      await client.query(
        `
          UPDATE admission_applications
          SET current_status = 'admitted',
              desired_classroom_id = $1,
              desired_academic_year_id = $2,
              admitted_by_user_id = $3,
              admitted_at = NOW(),
              stage_notes = COALESCE($4, stage_notes),
              updated_by_user_id = $3,
              updated_at = NOW()
          WHERE school_id = $5
            AND student_id = $6
        `,
        [body.classroom_id, academicYearId, req.auth.userId, body.notes || null, req.auth.schoolId, path.studentId]
      );

      await client.query(
        `
          INSERT INTO admission_stage_events (
            school_id,
            application_id,
            student_id,
            from_status,
            to_status,
            changed_by_user_id,
            notes
          )
          VALUES ($1, $2, $3, 'accepted', 'admitted', $4, $5)
        `,
        [req.auth.schoolId, appRow.applicationId, path.studentId, req.auth.userId, body.notes || "Applicant admitted and enrolled"]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "admissions.student.admitted",
        entityName: "students",
        entityId: path.studentId,
        metadata: {
          application_id: appRow.applicationId,
          classroom_id: body.classroom_id,
          academic_year_id: academicYearId,
          roll_no: body.roll_no || null,
        },
      });

      return success(
        res,
        {
          student_id: path.studentId,
          application_id: appRow.applicationId,
          enrollment: enrollmentResult.rows[0],
          new_status: "admitted",
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

module.exports = router;
