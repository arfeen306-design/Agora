const bcrypt = require("bcryptjs");
const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { buildCsvBuffer } = require("../utils/report-export");
const {
  STUDENT_IMPORT_FIELDS,
  buildFieldMapping,
  normalizeLookupToken,
  normalizeStudentImportRow,
  parseTabularFile,
} = require("../utils/import-engine");

const router = express.Router();

const IMPORT_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "front_desk",
  "hr_admin",
];
const IMPORT_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "hr_admin"];

const previewStudentImportSchema = z.object({
  import_type: z.enum(["students"]).default("students"),
  source_format: z.enum(["csv", "xlsx", "xls"]).optional(),
  source_file_name: z.string().trim().min(1).max(255),
  file_base64: z.string().min(30),
  mapping: z.record(z.string().trim().min(1).max(255)).optional(),
  default_academic_year_id: z.string().uuid().optional(),
});

const executeImportSchema = z
  .object({
    create_parent_accounts: z.boolean().default(true),
  })
  .default({
    create_parent_accounts: true,
  });

const listImportJobsQuerySchema = z.object({
  import_type: z.enum(["students"]).default("students"),
  status: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const importErrorsQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(100),
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

function sanitizeSummary(summary) {
  const copy = { ...(summary || {}) };
  delete copy.rows_payload;
  return copy;
}

function normalizeClassroomKey(gradeLabel, sectionLabel) {
  return `${normalizeLookupToken(gradeLabel)}|${normalizeLookupToken(sectionLabel)}`;
}

function splitName(name) {
  const clean = String(name || "").trim();
  if (!clean) {
    return {
      first_name: "Guardian",
      last_name: null,
    };
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_name: null,
    };
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function normalizePhone(input) {
  const clean = String(input || "").trim();
  return clean || null;
}

function normalizeEmail(input) {
  const clean = String(input || "").trim().toLowerCase();
  return clean || null;
}

async function resolveAcademicYear(schoolId, requestedYearId) {
  if (requestedYearId) {
    const row = await pool.query(
      `
        SELECT id
        FROM academic_years
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [schoolId, requestedYearId]
    );
    if (!row.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "default_academic_year_id is not part of this school");
    }
    return row.rows[0].id;
  }

  const current = await pool.query(
    `
      SELECT id
      FROM academic_years
      WHERE school_id = $1
      ORDER BY is_current DESC, starts_on DESC
      LIMIT 1
    `,
    [schoolId]
  );

  if (!current.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", "No academic year found for school");
  }

  return current.rows[0].id;
}

async function listClassroomRows(schoolId, academicYearId) {
  const rows = await pool.query(
    `
      SELECT id, grade_label, section_label
      FROM classrooms
      WHERE school_id = $1
        AND academic_year_id = $2
        AND is_active = TRUE
    `,
    [schoolId, academicYearId]
  );
  return rows.rows;
}

async function getParentRoleId(client) {
  const role = await client.query(
    `
      SELECT id
      FROM roles
      WHERE code = 'parent'
      LIMIT 1
    `
  );
  if (!role.rows[0]) {
    throw new AppError(500, "INTERNAL_SERVER_ERROR", "Parent role is not configured");
  }
  return role.rows[0].id;
}

async function ensureParentForStudent({
  client,
  schoolId,
  row,
  parentRoleId,
  defaultPasswordHash,
}) {
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.mobile_number) || normalizePhone(row.whatsapp_number);
  const whatsapp = normalizePhone(row.whatsapp_number);
  const fallbackDigits = String(phone || "").replace(/\D+/g, "");
  const fallbackEmail = `guardian.${fallbackDigits || row.student_code.toLowerCase()}.${schoolId.slice(0, 8)}@agora.local`;
  const targetEmail = email || fallbackEmail;

  const existingUser = await client.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND (
          LOWER(email) = LOWER($2)
          OR ($3::text IS NOT NULL AND phone = $3)
          OR ($4::text IS NOT NULL AND phone = $4)
        )
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [schoolId, targetEmail, phone, whatsapp]
  );

  let userId = existingUser.rows[0]?.id || null;
  if (!userId) {
    const guardianName = splitName(row.father_name);
    try {
      const created = await client.query(
        `
          INSERT INTO users (
            school_id,
            email,
            phone,
            password_hash,
            first_name,
            last_name,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, TRUE)
          RETURNING id
        `,
        [
          schoolId,
          targetEmail,
          phone,
          defaultPasswordHash,
          guardianName.first_name,
          guardianName.last_name,
        ]
      );
      userId = created.rows[0].id;
    } catch (error) {
      if (error && error.code === "23505") {
        const retried = await client.query(
          `
            SELECT id
            FROM users
            WHERE school_id = $1
              AND (
                LOWER(email) = LOWER($2)
                OR ($3::text IS NOT NULL AND phone = $3)
              )
            LIMIT 1
          `,
          [schoolId, targetEmail, phone]
        );
        userId = retried.rows[0]?.id || null;
      } else {
        throw error;
      }
    }
  }

  if (!userId) {
    throw new AppError(500, "INTERNAL_SERVER_ERROR", "Failed to resolve parent account");
  }

  await client.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userId, parentRoleId]
  );

  const parentProfile = await client.query(
    `
      INSERT INTO parents (
        school_id,
        user_id,
        guardian_name,
        father_name,
        mother_name,
        whatsapp_number,
        address_line,
        preferred_channel
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_app'::notification_channel)
      ON CONFLICT (user_id)
      DO UPDATE SET
        guardian_name = COALESCE(EXCLUDED.guardian_name, parents.guardian_name),
        father_name = COALESCE(EXCLUDED.father_name, parents.father_name),
        mother_name = COALESCE(EXCLUDED.mother_name, parents.mother_name),
        whatsapp_number = COALESCE(EXCLUDED.whatsapp_number, parents.whatsapp_number),
        address_line = COALESCE(EXCLUDED.address_line, parents.address_line),
        updated_at = NOW()
      RETURNING id
    `,
    [
      schoolId,
      userId,
      row.father_name || null,
      row.father_name || null,
      row.mother_name || null,
      whatsapp,
      row.address_line || null,
    ]
  );

  return parentProfile.rows[0].id;
}

router.post(
  "/people/imports/students/preview",
  requireAuth,
  requireRoles(...IMPORT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(
      previewStudentImportSchema,
      req.body,
      "Invalid student import preview payload"
    );

    let parsed;
    try {
      parsed = parseTabularFile({
        fileBase64: body.file_base64,
        sourceFormat: body.source_format,
        sourceFileName: body.source_file_name,
      });
    } catch (error) {
      throw new AppError(422, "VALIDATION_ERROR", error.message || "Unable to parse import file");
    }

    if (!parsed.rows.length) {
      throw new AppError(422, "VALIDATION_ERROR", "No data rows found for import");
    }

    const fieldMapping = buildFieldMapping({
      headers: parsed.headers,
      normalizedHeaders: parsed.normalizedHeaders,
      providedMapping: body.mapping || {},
    });
    const mappedIndexes = Object.fromEntries(
      Object.entries(fieldMapping).map(([field, config]) => [field, config.index])
    );

    const requiredFieldGaps = STUDENT_IMPORT_FIELDS.filter((field) => field.required).filter(
      (field) => !fieldMapping[field.key]
    );

    const academicYearId = await resolveAcademicYear(req.auth.schoolId, body.default_academic_year_id);
    const classroomRows = await listClassroomRows(req.auth.schoolId, academicYearId);
    const classroomByKey = new Map(
      classroomRows.map((row) => [normalizeClassroomKey(row.grade_label, row.section_label), row.id])
    );

    const parsedRows = [];
    const parseErrors = [];
    const seenStudentCodes = new Set();

    for (let i = 0; i < parsed.rows.length; i += 1) {
      const rowNumber = i + 2;
      const row = parsed.rows[i];
      const normalizedResult = normalizeStudentImportRow({
        row,
        rowNumber,
        mapping: mappedIndexes,
      });

      if (normalizedResult.errors.length > 0) {
        parseErrors.push(...normalizedResult.errors);
        continue;
      }

      const normalized = normalizedResult.normalized;
      const classKey = normalizeClassroomKey(normalized.class_label, normalized.section_label);
      const classroomId = classroomByKey.get(classKey);

      if (!classroomId) {
        parseErrors.push({
          row_number: rowNumber,
          field_name: "class_label",
          issue: `Classroom not found for "${normalized.class_label} / ${normalized.section_label}" in selected academic year`,
          raw_value: `${normalized.class_label} / ${normalized.section_label}`,
        });
        continue;
      }

      if (seenStudentCodes.has(normalized.student_code)) {
        parseErrors.push({
          row_number: rowNumber,
          field_name: "student_code",
          issue: "Duplicate student_code in uploaded file",
          raw_value: normalized.student_code,
        });
        continue;
      }
      seenStudentCodes.add(normalized.student_code);

      parsedRows.push({
        ...normalized,
        classroom_id: classroomId,
        academic_year_id: academicYearId,
      });
    }

    const incomingStudentCodes = [...new Set(parsedRows.map((row) => row.student_code))];
    if (incomingStudentCodes.length > 0) {
      const existing = await pool.query(
        `
          SELECT student_code
          FROM students
          WHERE school_id = $1
            AND student_code = ANY($2::text[])
        `,
        [req.auth.schoolId, incomingStudentCodes]
      );

      const existingCodes = new Set(existing.rows.map((row) => row.student_code));
      if (existingCodes.size > 0) {
        const validRows = [];
        for (const row of parsedRows) {
          if (existingCodes.has(row.student_code)) {
            parseErrors.push({
              row_number: row.row_number,
              field_name: "student_code",
              issue: "student_code already exists in school records",
              raw_value: row.student_code,
            });
          } else {
            validRows.push(row);
          }
        }
        parsedRows.length = 0;
        parsedRows.push(...validRows);
      }
    }

    for (const missing of requiredFieldGaps) {
      parseErrors.push({
        row_number: 1,
        field_name: missing.key,
        issue: "Required column is not mapped",
        raw_value: "",
      });
    }

    const totalRows = parsed.rows.length;
    const validRows = requiredFieldGaps.length > 0 ? [] : parsedRows;
    const invalidRows = totalRows - validRows.length;
    const status =
      validRows.length === 0
        ? "failed"
        : invalidRows > 0
          ? "validated_with_errors"
          : "validated";

    const mappingPayload = {
      fields: Object.fromEntries(
        Object.entries(fieldMapping).map(([field, config]) => [field, config.header])
      ),
      headers: parsed.headers,
    };
    const summaryPayload = {
      import_type: "students",
      required_fields: STUDENT_IMPORT_FIELDS.filter((field) => field.required).map((field) => field.key),
      preview_rows: validRows.slice(0, 15),
      rows_payload: validRows,
      error_count: parseErrors.length,
      academic_year_id: academicYearId,
    };

    const createdJob = await pool.query(
      `
        INSERT INTO import_jobs (
          school_id,
          created_by_user_id,
          import_type,
          source_format,
          source_file_name,
          status,
          total_rows,
          valid_rows,
          invalid_rows,
          mapping,
          summary
        )
        VALUES ($1, $2, 'students', $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
        RETURNING id, school_id, created_by_user_id, import_type, source_format, source_file_name, status, total_rows, valid_rows, invalid_rows, mapping, summary, created_at, updated_at
      `,
      [
        req.auth.schoolId,
        req.auth.userId,
        parsed.sourceFormat,
        body.source_file_name,
        status,
        totalRows,
        validRows.length,
        invalidRows,
        JSON.stringify(mappingPayload),
        JSON.stringify(summaryPayload),
      ]
    );

    if (parseErrors.length > 0) {
      for (const issue of parseErrors) {
        await pool.query(
          `
            INSERT INTO import_errors (
              job_id,
              row_number,
              field_name,
              issue,
              raw_value
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            createdJob.rows[0].id,
            issue.row_number,
            issue.field_name || null,
            issue.issue,
            issue.raw_value || null,
          ]
        );
      }
    }

    return success(
      res,
      {
        ...createdJob.rows[0],
        summary: sanitizeSummary(createdJob.rows[0].summary),
        detected_headers: parsed.headers,
        field_mapping: mappingPayload.fields,
        preview_rows: validRows.slice(0, 15),
        errors: parseErrors.slice(0, 100),
      },
      200
    );
  })
);

router.post(
  "/people/imports/jobs/:jobId/execute",
  requireAuth,
  requireRoles(...IMPORT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(executeImportSchema, req.body || {}, "Invalid import execute payload");
    const path = parseSchema(
      z.object({ jobId: z.string().uuid() }),
      req.params,
      "Invalid import job id"
    );

    const existingJob = await pool.query(
      `
        SELECT *
        FROM import_jobs
        WHERE school_id = $1
          AND id = $2
          AND import_type = 'students'
        LIMIT 1
      `,
      [req.auth.schoolId, path.jobId]
    );

    if (!existingJob.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Import job not found");
    }

    const job = existingJob.rows[0];
    const summary = job.summary || {};
    const rowsPayload = Array.isArray(summary.rows_payload) ? summary.rows_payload : [];

    if (rowsPayload.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "This import job has no valid rows to import");
    }
    if (String(job.status).startsWith("completed")) {
      return success(
        res,
        {
          job_id: job.id,
          status: job.status,
          imported_count: summary.imported_count || 0,
          failed_count: summary.execution_error_count || 0,
        },
        200
      );
    }

    const client = await pool.connect();
    const runtimeErrors = [];
    let importedCount = 0;
    const defaultPasswordHash = await bcrypt.hash("ChangeMe123!", 10);

    try {
      await client.query("BEGIN");
      const parentRoleId = body.create_parent_accounts ? await getParentRoleId(client) : null;

      for (const row of rowsPayload) {
        const rowNumber = Number(row.row_number) || 0;
        const savepoint = `sp_import_${rowNumber}`;
        await client.query(`SAVEPOINT ${savepoint}`);

        try {
          const createdStudent = await client.query(
            `
              INSERT INTO students (
                school_id,
                student_code,
                first_name,
                last_name,
                date_of_birth,
                gender,
                admission_date,
                status,
                admission_status,
                emergency_contact_name,
                emergency_contact_phone,
                notes
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'admitted', $8, $9, $10)
              RETURNING id, student_code
            `,
            [
              req.auth.schoolId,
              row.student_code,
              row.first_name,
              row.last_name || null,
              row.date_of_birth || null,
              row.gender || null,
              row.admission_date,
              row.father_name || null,
              row.emergency_contact || row.mobile_number || null,
              row.notes || null,
            ]
          );

          const studentId = createdStudent.rows[0].id;

          await client.query(
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
              VALUES ($1, $2, $3, $4, $5, 'active', $6)
              ON CONFLICT (school_id, student_id, academic_year_id)
              DO UPDATE SET
                classroom_id = EXCLUDED.classroom_id,
                roll_no = COALESCE(EXCLUDED.roll_no, student_enrollments.roll_no),
                status = 'active',
                joined_on = COALESCE(student_enrollments.joined_on, EXCLUDED.joined_on),
                updated_at = NOW()
            `,
            [
              req.auth.schoolId,
              studentId,
              row.classroom_id,
              row.academic_year_id,
              row.roll_no || null,
              row.admission_date || null,
            ]
          );

          if (body.create_parent_accounts) {
            const parentId = await ensureParentForStudent({
              client,
              schoolId: req.auth.schoolId,
              row,
              parentRoleId,
              defaultPasswordHash,
            });

            await client.query(
              `
                INSERT INTO parent_students (
                  school_id,
                  parent_id,
                  student_id,
                  relation_type,
                  is_primary
                )
                VALUES ($1, $2, $3, $4, TRUE)
                ON CONFLICT (parent_id, student_id)
                DO UPDATE SET
                  relation_type = EXCLUDED.relation_type,
                  is_primary = EXCLUDED.is_primary
              `,
              [req.auth.schoolId, parentId, studentId, row.guardian_relation || "guardian"]
            );
          }

          importedCount += 1;
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          runtimeErrors.push({
            row_number: rowNumber,
            field_name: "row",
            issue: error.message || "Failed to import row",
            raw_value: row.student_code || null,
          });

          await client.query(
            `
              INSERT INTO import_errors (
                job_id,
                row_number,
                field_name,
                issue,
                raw_value
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [job.id, rowNumber, "row", error.message || "Failed to import row", row.student_code || null]
          );
        }
      }

      const executionErrorCount = runtimeErrors.length;
      const finalStatus =
        importedCount === 0
          ? "failed"
          : executionErrorCount > 0
            ? "completed_with_errors"
            : "completed";

      const finalSummary = {
        ...summary,
        imported_count: importedCount,
        execution_error_count: executionErrorCount,
        execution_errors_preview: runtimeErrors.slice(0, 50),
        executed_at: new Date().toISOString(),
      };

      const updated = await client.query(
        `
          UPDATE import_jobs
          SET
            status = $3,
            valid_rows = $4,
            invalid_rows = $5,
            summary = $6::jsonb,
            updated_at = NOW()
          WHERE school_id = $1
            AND id = $2
          RETURNING id, status, total_rows, valid_rows, invalid_rows, summary, updated_at
        `,
        [
          req.auth.schoolId,
          job.id,
          finalStatus,
          importedCount,
          Number(job.invalid_rows || 0) + executionErrorCount,
          JSON.stringify(finalSummary),
        ]
      );

      await client.query("COMMIT");

      return success(
        res,
        {
          ...updated.rows[0],
          summary: sanitizeSummary(updated.rows[0].summary),
          imported_count: importedCount,
          failed_count: executionErrorCount,
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

router.get(
  "/people/imports/jobs",
  requireAuth,
  requireRoles(...IMPORT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listImportJobsQuerySchema, req.query, "Invalid import jobs query");

    const params = [req.auth.schoolId, query.import_type];
    const where = ["ij.school_id = $1", "ij.import_type = $2"];

    if (query.status) {
      params.push(query.status);
      where.push(`ij.status = $${params.length}`);
    }

    const count = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM import_jobs ij
        WHERE ${where.join(" AND ")}
      `,
      params
    );

    const totalItems = count.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          ij.id,
          ij.school_id,
          ij.created_by_user_id,
          ij.import_type,
          ij.source_format,
          ij.source_file_name,
          ij.status,
          ij.total_rows,
          ij.valid_rows,
          ij.invalid_rows,
          ij.mapping,
          ij.summary,
          ij.created_at,
          ij.updated_at,
          u.first_name AS created_by_first_name,
          u.last_name AS created_by_last_name,
          u.email AS created_by_email
        FROM import_jobs ij
        LEFT JOIN users u
          ON u.id = ij.created_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ij.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

    const data = rows.rows.map((row) => ({
      ...row,
      summary: sanitizeSummary(row.summary),
    }));

    return success(res, data, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

router.get(
  "/people/imports/jobs/:jobId",
  requireAuth,
  requireRoles(...IMPORT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(z.object({ jobId: z.string().uuid() }), req.params, "Invalid import job id");

    const row = await pool.query(
      `
        SELECT
          ij.id,
          ij.school_id,
          ij.created_by_user_id,
          ij.import_type,
          ij.source_format,
          ij.source_file_name,
          ij.status,
          ij.total_rows,
          ij.valid_rows,
          ij.invalid_rows,
          ij.mapping,
          ij.summary,
          ij.created_at,
          ij.updated_at,
          (
            SELECT COUNT(*)::int
            FROM import_errors ie
            WHERE ie.job_id = ij.id
          ) AS error_rows
        FROM import_jobs ij
        WHERE ij.school_id = $1
          AND ij.id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.jobId]
    );

    if (!row.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Import job not found");
    }

    return success(
      res,
      {
        ...row.rows[0],
        summary: sanitizeSummary(row.rows[0].summary),
      },
      200
    );
  })
);

router.get(
  "/people/imports/jobs/:jobId/errors",
  requireAuth,
  requireRoles(...IMPORT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(z.object({ jobId: z.string().uuid() }), req.params, "Invalid import job id");
    const query = parseSchema(importErrorsQuerySchema, req.query, "Invalid import errors query");

    const job = await pool.query(
      `
        SELECT id, import_type, source_file_name
        FROM import_jobs
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, path.jobId]
    );

    if (!job.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Import job not found");
    }

    const offset = (query.page - 1) * query.page_size;
    const totalResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM import_errors
        WHERE job_id = $1
      `,
      [path.jobId]
    );
    const totalItems = Number(totalResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));

    const rows = await pool.query(
      `
        SELECT id, row_number, field_name, issue, raw_value, created_at
        FROM import_errors
        WHERE job_id = $1
        ORDER BY row_number ASC, created_at ASC
        LIMIT $2
        OFFSET $3
      `,
      [path.jobId, query.page_size, offset]
    );

    if (query.format === "csv") {
      const buffer = buildCsvBuffer({
        columns: [
          { key: "row_number", label: "row_number" },
          { key: "field_name", label: "field_name" },
          { key: "issue", label: "issue" },
          { key: "raw_value", label: "raw_value" },
          { key: "created_at", label: "created_at" },
        ],
        rows: rows.rows,
      });

      const date = new Date().toISOString().slice(0, 10);
      const fileName = `agora_import_errors_${date}.csv`;
      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "imports.errors.exported",
        entityName: "import_errors",
        entityId: path.jobId,
        metadata: {
          import_job_id: path.jobId,
          format: "csv",
          page: query.page,
          page_size: query.page_size,
          total_items: totalItems,
          row_count: rows.rows.length,
        },
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.status(200).send(buffer);
    }

    return success(res, rows.rows, 200, {
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total_items: totalItems,
        total_pages: totalPages,
      },
    });
  })
);

module.exports = router;
