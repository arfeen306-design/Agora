const express = require("express");
const { z } = require("zod");

const config = require("../config");
const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { createDownloadTarget } = require("../utils/storage");
const { listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const DOCUMENT_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "front_desk",
  "hr_admin",
  "accountant",
  "parent",
  "student",
];

const DOCUMENT_MANAGE_ROLES = [
  "school_admin",
  "principal",
  "teacher",
  "front_desk",
  "hr_admin",
  "accountant",
];

const DOCUMENT_CATEGORIES = [
  "hr_document",
  "salary_slip",
  "appointment_letter",
  "contract",
  "policy_document",
  "circular",
  "student_document",
  "admission_form",
  "report_card",
  "fee_receipt",
  "certificate",
  "identity_document",
  "medical_record",
  "official_letter",
  "other",
];

const DOCUMENT_SCOPE_TYPES = ["school", "student", "staff", "classroom", "parent", "admission", "finance"];

const listDocumentsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  scope_type: z.enum(DOCUMENT_SCOPE_TYPES).optional(),
  scope_id: z.string().uuid().optional(),
  include_archived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const accessRuleSchema = z
  .object({
    access_type: z.enum(["role", "user"]),
    role_code: z.string().trim().min(2).max(40).optional(),
    user_id: z.string().uuid().optional(),
    can_view: z.boolean().default(true),
    can_download: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.access_type === "role") {
      if (!data.role_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "role_code is required when access_type is role",
          path: ["role_code"],
        });
      }
      if (data.user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "user_id must be omitted when access_type is role",
          path: ["user_id"],
        });
      }
    } else {
      if (!data.user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "user_id is required when access_type is user",
          path: ["user_id"],
        });
      }
      if (data.role_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "role_code must be omitted when access_type is user",
          path: ["role_code"],
        });
      }
    }
  });

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  file_key: z.string().trim().min(8).max(1024),
  file_name: z.string().trim().min(1).max(255),
  file_size_bytes: z.coerce.number().int().min(0).max(1024 * 1024 * 100),
  mime_type: z.string().trim().min(3).max(150),
  category: z.enum(DOCUMENT_CATEGORIES),
  scope_type: z.enum(DOCUMENT_SCOPE_TYPES),
  scope_id: z.string().uuid().nullable().optional(),
  expires_on: z.string().date().nullable().optional(),
  metadata: z.record(z.any()).default({}),
  access_rules: z.array(accessRuleSchema).max(50).default([]),
});

const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    scope_type: z.enum(DOCUMENT_SCOPE_TYPES).optional(),
    scope_id: z.string().uuid().nullable().optional(),
    expires_on: z.string().date().nullable().optional(),
    is_archived: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
    access_rules: z.array(accessRuleSchema).max(50).optional(),
  })
  .strict();

const documentPathSchema = z.object({
  documentId: z.string().uuid(),
});

const createDocumentVersionSchema = z.object({
  file_key: z.string().trim().min(8).max(1024),
  file_name: z.string().trim().min(1).max(255),
  file_size_bytes: z.coerce.number().int().min(0).max(1024 * 1024 * 100),
  mime_type: z.string().trim().min(3).max(150),
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
  return Array.isArray(auth?.roles) && roles.some((role) => auth.roles.includes(role));
}

function isLeadership(auth) {
  return hasAnyRole(auth, ["school_admin", "principal", "vice_principal"]);
}

function isSchoolAdmin(auth) {
  return hasRole(auth, "school_admin");
}

function normalizeScopeId(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertFileKeyBelongsToSchool(fileKey, schoolId) {
  const expectedPrefix = `${schoolId}/`;
  if (!String(fileKey).startsWith(expectedPrefix)) {
    throw new AppError(422, "VALIDATION_ERROR", "file_key must belong to your school namespace");
  }
}

function getBaseUrl(req) {
  if (config.storage.publicBaseUrl) return config.storage.publicBaseUrl;
  return `${req.protocol}://${req.get("host")}`;
}

async function ensureScopeEntityExists({ schoolId, scopeType, scopeId, client }) {
  if (scopeType === "school") return;
  if (!scopeId) {
    throw new AppError(422, "VALIDATION_ERROR", "scope_id is required for this scope_type");
  }

  const db = client || pool;
  if (scopeType === "student") {
    const row = await db.query(
      `SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1`,
      [schoolId, scopeId]
    );
    if (!row.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id student not found in this school");
    }
    return;
  }
  if (scopeType === "staff") {
    const row = await db.query(
      `SELECT id FROM staff_profiles WHERE school_id = $1 AND id = $2 LIMIT 1`,
      [schoolId, scopeId]
    );
    if (!row.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id staff not found in this school");
    }
    return;
  }
  if (scopeType === "classroom") {
    const row = await db.query(
      `SELECT id FROM classrooms WHERE school_id = $1 AND id = $2 LIMIT 1`,
      [schoolId, scopeId]
    );
    if (!row.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id classroom not found in this school");
    }
    return;
  }
  if (scopeType === "parent") {
    const row = await db.query(
      `SELECT id FROM parents WHERE school_id = $1 AND id = $2 LIMIT 1`,
      [schoolId, scopeId]
    );
    if (!row.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "scope_id parent not found in this school");
    }
    return;
  }
}

async function getParentLinkedStudentIds({ schoolId, userId, client = null }) {
  const db = client || pool;
  const rows = await db.query(
    `
      SELECT ps.student_id
      FROM parents p
      JOIN parent_students ps
        ON ps.parent_id = p.id
       AND ps.school_id = p.school_id
      WHERE p.school_id = $1
        AND p.user_id = $2
    `,
    [schoolId, userId]
  );
  return rows.rows.map((row) => row.student_id);
}

async function getStudentIdByUser({ schoolId, userId, client = null }) {
  const db = client || pool;
  const row = await db.query(
    `
      SELECT sua.student_id
      FROM student_user_accounts sua
      JOIN students s
        ON s.id = sua.student_id
      WHERE s.school_id = $1
        AND sua.user_id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );
  return row.rows[0]?.student_id || null;
}

async function getHeadmistressSectionIds({ schoolId, userId, client = null }) {
  const db = client || pool;
  const rows = await db.query(
    `
      SELECT id
      FROM school_sections
      WHERE school_id = $1
        AND (
          head_user_id = $2
          OR coordinator_user_id = $2
        )
    `,
    [schoolId, userId]
  );
  return rows.rows.map((row) => row.id);
}

async function getScopeContext(auth) {
  const context = {
    teacherClassroomIds: [],
    parentStudentIds: [],
    studentId: null,
    headmistressSectionIds: [],
  };

  if (hasRole(auth, "teacher")) {
    context.teacherClassroomIds = await listTeacherClassroomIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
  }

  if (hasRole(auth, "parent")) {
    context.parentStudentIds = await getParentLinkedStudentIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
  }

  if (hasRole(auth, "student")) {
    context.studentId = await getStudentIdByUser({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
  }

  if (hasRole(auth, "headmistress")) {
    context.headmistressSectionIds = await getHeadmistressSectionIds({
      schoolId: auth.schoolId,
      userId: auth.userId,
    });
  }

  return context;
}

function applyRoleScopedWhere({ auth, where, params, context }) {
  if (isLeadership(auth)) return;

  const ruleClause = (permissionType) => `
    EXISTS (
      SELECT 1
      FROM document_access_rules dar
      WHERE dar.school_id = d.school_id
        AND dar.document_id = d.id
        AND (
          (dar.access_type = 'user' AND dar.user_id = $${params.length + 1} AND dar.${permissionType} = TRUE)
          OR (dar.access_type = 'role' AND dar.role_code = ANY($${params.length + 2}::text[]) AND dar.${permissionType} = TRUE)
        )
    )
  `;

  if (hasRole(auth, "teacher")) {
    params.push(auth.userId, auth.roles, context.teacherClassroomIds || []);
    where.push(`
      (
        d.uploaded_by_user_id = $${params.length - 2}
        OR ${ruleClause("can_view")}
        OR (
          d.scope_type = 'classroom'
          AND d.scope_id = ANY($${params.length}::uuid[])
        )
        OR (
          d.scope_type = 'student'
          AND EXISTS (
            SELECT 1
            FROM student_enrollments se
            WHERE se.school_id = d.school_id
              AND se.student_id = d.scope_id
              AND se.status = 'active'
              AND se.classroom_id = ANY($${params.length}::uuid[])
          )
        )
      )
    `);
    return;
  }

  if (hasRole(auth, "headmistress")) {
    params.push(auth.userId, auth.roles, context.headmistressSectionIds || []);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR (
          d.scope_type = 'classroom'
          AND EXISTS (
            SELECT 1
            FROM classrooms c
            WHERE c.school_id = d.school_id
              AND c.id = d.scope_id
              AND c.section_id = ANY($${params.length}::uuid[])
          )
        )
        OR (
          d.scope_type = 'student'
          AND EXISTS (
            SELECT 1
            FROM student_enrollments se
            JOIN classrooms c
              ON c.school_id = se.school_id
             AND c.id = se.classroom_id
            WHERE se.school_id = d.school_id
              AND se.student_id = d.scope_id
              AND se.status = 'active'
              AND c.section_id = ANY($${params.length}::uuid[])
          )
        )
      )
    `);
    return;
  }

  if (hasRole(auth, "parent")) {
    params.push(auth.userId, auth.roles, context.parentStudentIds || []);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR (
          d.scope_type = 'student'
          AND d.scope_id = ANY($${params.length}::uuid[])
        )
      )
    `);
    return;
  }

  if (hasRole(auth, "student")) {
    params.push(auth.userId, auth.roles, context.studentId);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR (
          d.scope_type = 'student'
          AND d.scope_id = $${params.length}::uuid
        )
      )
    `);
    return;
  }

  if (hasRole(auth, "hr_admin")) {
    params.push(auth.userId, auth.roles);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR d.scope_type = 'staff'
        OR d.category IN ('hr_document', 'salary_slip', 'appointment_letter', 'contract', 'policy_document')
      )
    `);
    return;
  }

  if (hasRole(auth, "accountant")) {
    params.push(auth.userId, auth.roles);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR d.scope_type = 'finance'
        OR d.category IN ('fee_receipt', 'salary_slip')
      )
    `);
    return;
  }

  if (hasRole(auth, "front_desk")) {
    params.push(auth.userId, auth.roles);
    where.push(`
      (
        ${ruleClause("can_view")}
        OR d.scope_type = 'admission'
        OR d.category IN ('admission_form', 'identity_document', 'certificate')
      )
    `);
    return;
  }

  throw new AppError(403, "FORBIDDEN", "No document vault read permission for this role");
}

async function assertManageScopeAllowed({ auth, scopeType, scopeId, category, context }) {
  if (isLeadership(auth)) return;

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = context.teacherClassroomIds || [];
    if (scopeType === "classroom" && teacherClassroomIds.includes(scopeId)) return;
    if (scopeType === "student") {
      const inScope = await pool.query(
        `
          SELECT 1
          FROM student_enrollments se
          WHERE se.school_id = $1
            AND se.student_id = $2
            AND se.status = 'active'
            AND se.classroom_id = ANY($3::uuid[])
          LIMIT 1
        `,
        [auth.schoolId, scopeId, teacherClassroomIds]
      );
      if (inScope.rows[0]) return;
    }
    throw new AppError(403, "FORBIDDEN", "Teacher can manage documents only for assigned classrooms/students");
  }

  if (hasRole(auth, "front_desk")) {
    if (scopeType === "admission" || category === "admission_form") return;
    throw new AppError(403, "FORBIDDEN", "Front desk can manage admission-related documents only");
  }

  if (hasRole(auth, "hr_admin")) {
    if (
      scopeType === "staff" ||
      ["hr_document", "salary_slip", "appointment_letter", "contract", "policy_document"].includes(category)
    ) {
      return;
    }
    throw new AppError(403, "FORBIDDEN", "HR admin can manage HR/staff documents only");
  }

  if (hasRole(auth, "accountant")) {
    if (scopeType === "finance" || ["fee_receipt", "salary_slip"].includes(category)) return;
    throw new AppError(403, "FORBIDDEN", "Accountant can manage finance-related documents only");
  }

  throw new AppError(403, "FORBIDDEN", "No document vault manage permission for this role");
}

function assertDocumentManagePermission({ auth, row, context }) {
  if (isSchoolAdmin(auth) || hasRole(auth, "principal")) return;
  if (row.uploaded_by_user_id && row.uploaded_by_user_id === auth.userId) return;

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = context.teacherClassroomIds || [];
    if (row.scope_type === "classroom" && teacherClassroomIds.includes(row.scope_id)) return;
    throw new AppError(403, "FORBIDDEN", "Teacher cannot modify this document");
  }

  if (hasRole(auth, "front_desk")) {
    if (row.scope_type === "admission" || row.category === "admission_form") return;
    throw new AppError(403, "FORBIDDEN", "Front desk cannot modify this document");
  }

  if (hasRole(auth, "hr_admin")) {
    if (
      row.scope_type === "staff" ||
      ["hr_document", "salary_slip", "appointment_letter", "contract", "policy_document"].includes(row.category)
    ) {
      return;
    }
    throw new AppError(403, "FORBIDDEN", "HR admin cannot modify this document");
  }

  if (hasRole(auth, "accountant")) {
    if (row.scope_type === "finance" || ["fee_receipt", "salary_slip"].includes(row.category)) return;
    throw new AppError(403, "FORBIDDEN", "Accountant cannot modify this document");
  }

  throw new AppError(403, "FORBIDDEN", "No document vault manage permission for this role");
}

async function ensureDocumentReadable({ auth, documentId, context, permissionType = "can_view", client = null }) {
  const db = client || pool;
  const row = await db.query(
    `
      SELECT d.*
      FROM documents d
      WHERE d.school_id = $1
        AND d.id = $2
      LIMIT 1
    `,
    [auth.schoolId, documentId]
  );
  const document = row.rows[0];
  if (!document) {
    throw new AppError(404, "NOT_FOUND", "Document not found");
  }

  if (isLeadership(auth)) return document;

  const access = await db.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM document_access_rules dar
        WHERE dar.school_id = $1
          AND dar.document_id = $2
          AND (
            (dar.access_type = 'user' AND dar.user_id = $3 AND dar.${permissionType} = TRUE)
            OR (dar.access_type = 'role' AND dar.role_code = ANY($4::text[]) AND dar.${permissionType} = TRUE)
          )
      ) AS allowed
    `,
    [auth.schoolId, documentId, auth.userId, auth.roles]
  );
  if (access.rows[0]?.allowed) return document;

  if (hasRole(auth, "teacher")) {
    const teacherClassroomIds = context.teacherClassroomIds || [];
    if (document.uploaded_by_user_id === auth.userId) return document;
    if (document.scope_type === "classroom" && teacherClassroomIds.includes(document.scope_id)) return document;
    if (document.scope_type === "student" && teacherClassroomIds.length > 0) {
      const inScope = await db.query(
        `
          SELECT 1
          FROM student_enrollments se
          WHERE se.school_id = $1
            AND se.student_id = $2
            AND se.status = 'active'
            AND se.classroom_id = ANY($3::uuid[])
          LIMIT 1
        `,
        [auth.schoolId, document.scope_id, teacherClassroomIds]
      );
      if (inScope.rows[0]) return document;
    }
  }

  if (hasRole(auth, "headmistress")) {
    const sectionIds = context.headmistressSectionIds || [];
    if (sectionIds.length > 0) {
      const inScope = await db.query(
        `
          SELECT 1
          FROM classrooms c
          LEFT JOIN student_enrollments se
            ON se.school_id = c.school_id
           AND se.classroom_id = c.id
           AND se.status = 'active'
          WHERE c.school_id = $1
            AND c.section_id = ANY($2::uuid[])
            AND (
              ( $3 = 'classroom' AND c.id = $4::uuid )
              OR ( $3 = 'student' AND se.student_id = $4::uuid )
            )
          LIMIT 1
        `,
        [auth.schoolId, sectionIds, document.scope_type, document.scope_id]
      );
      if (inScope.rows[0]) return document;
    }
  }

  if (hasRole(auth, "parent")) {
    const studentIds = context.parentStudentIds || [];
    if (document.scope_type === "student" && studentIds.includes(document.scope_id)) {
      return document;
    }
  }

  if (hasRole(auth, "student")) {
    if (context.studentId && document.scope_type === "student" && document.scope_id === context.studentId) {
      return document;
    }
  }

  if (hasRole(auth, "hr_admin")) {
    if (
      document.scope_type === "staff" ||
      ["hr_document", "salary_slip", "appointment_letter", "contract", "policy_document"].includes(document.category)
    ) {
      return document;
    }
  }

  if (hasRole(auth, "accountant")) {
    if (document.scope_type === "finance" || ["fee_receipt", "salary_slip"].includes(document.category)) {
      return document;
    }
  }

  if (hasRole(auth, "front_desk")) {
    if (document.scope_type === "admission" || document.category === "admission_form") return document;
  }

  throw new AppError(403, "FORBIDDEN", "No access to this document");
}

async function replaceDocumentAccessRules({ client, schoolId, documentId, rules }) {
  await client.query(
    `
      DELETE FROM document_access_rules
      WHERE school_id = $1
        AND document_id = $2
    `,
    [schoolId, documentId]
  );

  for (const rule of rules || []) {
    await client.query(
      `
        INSERT INTO document_access_rules (
          school_id,
          document_id,
          access_type,
          role_code,
          user_id,
          can_view,
          can_download
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        schoolId,
        documentId,
        rule.access_type,
        rule.role_code || null,
        rule.user_id || null,
        rule.can_view,
        rule.can_download,
      ]
    );
  }
}

router.get(
  "/documents/categories",
  requireAuth,
  requireRoles(...DOCUMENT_VIEW_ROLES),
  asyncHandler(async (_req, res) => {
    return success(
      res,
      DOCUMENT_CATEGORIES.map((category) => ({
        code: category,
        label: category.replace(/_/g, " "),
      }))
    );
  })
);

router.get(
  "/documents",
  requireAuth,
  requireRoles(...DOCUMENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(listDocumentsQuerySchema, req.query, "Invalid document list query");
    const context = await getScopeContext(req.auth);

    const params = [req.auth.schoolId];
    const where = ["d.school_id = $1"];

    if (!query.include_archived) {
      where.push("d.is_archived = FALSE");
    }
    if (query.category) {
      params.push(query.category);
      where.push(`d.category = $${params.length}`);
    }
    if (query.scope_type) {
      params.push(query.scope_type);
      where.push(`d.scope_type = $${params.length}`);
    }
    if (query.scope_id) {
      params.push(query.scope_id);
      where.push(`d.scope_id = $${params.length}::uuid`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(
        `(d.title ILIKE $${params.length} OR d.file_name ILIKE $${params.length} OR COALESCE(d.description, '') ILIKE $${params.length})`
      );
    }

    applyRoleScopedWhere({
      auth: req.auth,
      where,
      params,
      context,
    });

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM documents d
        WHERE ${where.join(" AND ")}
      `,
      params
    );
    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const listParams = [...params, query.page_size, offset];
    const rows = await pool.query(
      `
        SELECT
          d.*,
          u.first_name AS uploaded_by_first_name,
          u.last_name AS uploaded_by_last_name,
          (
            SELECT COUNT(*)::int
            FROM document_versions dv
            WHERE dv.school_id = d.school_id
              AND dv.document_id = d.id
          ) AS versions_count,
          (
            SELECT COUNT(*)::int
            FROM document_download_events dde
            WHERE dde.school_id = d.school_id
              AND dde.document_id = d.id
          ) AS downloads_count
        FROM documents d
        LEFT JOIN users u
          ON u.id = d.uploaded_by_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY d.updated_at DESC, d.created_at DESC
        LIMIT $${listParams.length - 1}
        OFFSET $${listParams.length}
      `,
      listParams
    );

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

router.post(
  "/documents",
  requireAuth,
  requireRoles(...DOCUMENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createDocumentSchema, req.body, "Invalid document payload");
    const scopeId = normalizeScopeId(body.scope_id);
    assertFileKeyBelongsToSchool(body.file_key, req.auth.schoolId);

    await ensureScopeEntityExists({
      schoolId: req.auth.schoolId,
      scopeType: body.scope_type,
      scopeId,
    });

    const context = await getScopeContext(req.auth);
    await assertManageScopeAllowed({
      auth: req.auth,
      scopeType: body.scope_type,
      scopeId,
      category: body.category,
      context,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const created = await client.query(
        `
          INSERT INTO documents (
            school_id,
            title,
            description,
            file_key,
            file_name,
            file_size_bytes,
            mime_type,
            category,
            scope_type,
            scope_id,
            uploaded_by_user_id,
            expires_on,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          body.title,
          body.description || null,
          body.file_key,
          body.file_name,
          body.file_size_bytes,
          body.mime_type,
          body.category,
          body.scope_type,
          scopeId,
          req.auth.userId,
          body.expires_on || null,
          JSON.stringify(body.metadata || {}),
        ]
      );

      const document = created.rows[0];

      await client.query(
        `
          INSERT INTO document_versions (
            school_id,
            document_id,
            version_no,
            file_key,
            file_name,
            file_size_bytes,
            mime_type,
            uploaded_by_user_id
          )
          VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
        `,
        [
          req.auth.schoolId,
          document.id,
          body.file_key,
          body.file_name,
          body.file_size_bytes,
          body.mime_type,
          req.auth.userId,
        ]
      );

      await replaceDocumentAccessRules({
        client,
        schoolId: req.auth.schoolId,
        documentId: document.id,
        rules: body.access_rules,
      });

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "documents.vault.created",
        entityName: "documents",
        entityId: document.id,
        metadata: {
          category: body.category,
          scope_type: body.scope_type,
          scope_id: scopeId,
          access_rules: body.access_rules.length,
        },
      });

      return success(res, document, 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/documents/:documentId",
  requireAuth,
  requireRoles(...DOCUMENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(documentPathSchema, req.params, "Invalid document id");
    const context = await getScopeContext(req.auth);
    const document = await ensureDocumentReadable({
      auth: req.auth,
      documentId: path.documentId,
      context,
    });

    const [accessRules, versions] = await Promise.all([
      pool.query(
        `
          SELECT id, access_type, role_code, user_id, can_view, can_download, created_at
          FROM document_access_rules
          WHERE school_id = $1
            AND document_id = $2
          ORDER BY created_at DESC
        `,
        [req.auth.schoolId, path.documentId]
      ),
      pool.query(
        `
          SELECT id, version_no, file_key, file_name, file_size_bytes, mime_type, uploaded_by_user_id, created_at
          FROM document_versions
          WHERE school_id = $1
            AND document_id = $2
          ORDER BY version_no DESC
          LIMIT 25
        `,
        [req.auth.schoolId, path.documentId]
      ),
    ]);

    return success(res, {
      ...document,
      access_rules: accessRules.rows,
      versions: versions.rows,
    });
  })
);

router.patch(
  "/documents/:documentId",
  requireAuth,
  requireRoles(...DOCUMENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(documentPathSchema, req.params, "Invalid document id");
    const body = parseSchema(updateDocumentSchema, req.body, "Invalid document update payload");
    const context = await getScopeContext(req.auth);
    const existing = await ensureDocumentReadable({
      auth: req.auth,
      documentId: path.documentId,
      context,
    });
    assertDocumentManagePermission({
      auth: req.auth,
      row: existing,
      context,
    });

    const nextScopeType = body.scope_type || existing.scope_type;
    const nextScopeId =
      Object.prototype.hasOwnProperty.call(body, "scope_id")
        ? normalizeScopeId(body.scope_id)
        : existing.scope_id;

    await ensureScopeEntityExists({
      schoolId: req.auth.schoolId,
      scopeType: nextScopeType,
      scopeId: nextScopeId,
    });

    const nextCategory = body.category || existing.category;
    await assertManageScopeAllowed({
      auth: req.auth,
      scopeType: nextScopeType,
      scopeId: nextScopeId,
      category: nextCategory,
      context,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updated = await client.query(
        `
          UPDATE documents
          SET
            title = COALESCE($3, title),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            category = COALESCE($6, category),
            scope_type = COALESCE($7, scope_type),
            scope_id = CASE WHEN $8::boolean THEN $9::uuid ELSE scope_id END,
            expires_on = CASE WHEN $10::boolean THEN $11::date ELSE expires_on END,
            is_archived = COALESCE($12, is_archived),
            metadata = CASE WHEN $13::boolean THEN $14::jsonb ELSE metadata END
          WHERE school_id = $1
            AND id = $2
          RETURNING *
        `,
        [
          req.auth.schoolId,
          path.documentId,
          body.title || null,
          Object.prototype.hasOwnProperty.call(body, "description"),
          Object.prototype.hasOwnProperty.call(body, "description") ? body.description || null : null,
          body.category || null,
          body.scope_type || null,
          Object.prototype.hasOwnProperty.call(body, "scope_id"),
          nextScopeId,
          Object.prototype.hasOwnProperty.call(body, "expires_on"),
          Object.prototype.hasOwnProperty.call(body, "expires_on") ? body.expires_on || null : null,
          Object.prototype.hasOwnProperty.call(body, "is_archived") ? body.is_archived : null,
          Object.prototype.hasOwnProperty.call(body, "metadata"),
          Object.prototype.hasOwnProperty.call(body, "metadata")
            ? JSON.stringify(body.metadata || {})
            : null,
        ]
      );

      if (Array.isArray(body.access_rules)) {
        await replaceDocumentAccessRules({
          client,
          schoolId: req.auth.schoolId,
          documentId: path.documentId,
          rules: body.access_rules,
        });
      }

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "documents.vault.updated",
        entityName: "documents",
        entityId: path.documentId,
        metadata: {
          updated_fields: Object.keys(body),
          access_rules_replaced: Array.isArray(body.access_rules),
        },
      });

      return success(res, updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/documents/:documentId/versions",
  requireAuth,
  requireRoles(...DOCUMENT_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(documentPathSchema, req.params, "Invalid document id");
    const body = parseSchema(createDocumentVersionSchema, req.body, "Invalid document version payload");
    assertFileKeyBelongsToSchool(body.file_key, req.auth.schoolId);

    const context = await getScopeContext(req.auth);
    const existing = await ensureDocumentReadable({
      auth: req.auth,
      documentId: path.documentId,
      context,
    });
    assertDocumentManagePermission({
      auth: req.auth,
      row: existing,
      context,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lock = await client.query(
        `
          SELECT id, version_no
          FROM documents
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [req.auth.schoolId, path.documentId]
      );
      if (!lock.rows[0]) {
        throw new AppError(404, "NOT_FOUND", "Document not found");
      }
      const nextVersion = Number(lock.rows[0].version_no || 1) + 1;

      const version = await client.query(
        `
          INSERT INTO document_versions (
            school_id,
            document_id,
            version_no,
            file_key,
            file_name,
            file_size_bytes,
            mime_type,
            uploaded_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
        [
          req.auth.schoolId,
          path.documentId,
          nextVersion,
          body.file_key,
          body.file_name,
          body.file_size_bytes,
          body.mime_type,
          req.auth.userId,
        ]
      );

      await client.query(
        `
          UPDATE documents
          SET
            file_key = $3,
            file_name = $4,
            file_size_bytes = $5,
            mime_type = $6,
            version_no = $7,
            uploaded_by_user_id = $8
          WHERE school_id = $1
            AND id = $2
        `,
        [
          req.auth.schoolId,
          path.documentId,
          body.file_key,
          body.file_name,
          body.file_size_bytes,
          body.mime_type,
          nextVersion,
          req.auth.userId,
        ]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "documents.vault.version_added",
        entityName: "document_versions",
        entityId: version.rows[0].id,
        metadata: {
          document_id: path.documentId,
          version_no: nextVersion,
        },
      });

      return success(res, version.rows[0], 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/documents/:documentId/download-url",
  requireAuth,
  requireRoles(...DOCUMENT_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(documentPathSchema, req.params, "Invalid document id");
    const context = await getScopeContext(req.auth);
    const document = await ensureDocumentReadable({
      auth: req.auth,
      documentId: path.documentId,
      context,
      permissionType: "can_download",
    });

    const download = await createDownloadTarget({
      objectKey: document.file_key,
      expiresInSeconds: config.storage.signedUrlExpiresIn,
      baseUrl: getBaseUrl(req),
    });

    await pool.query(
      `
        INSERT INTO document_download_events (
          school_id,
          document_id,
          downloaded_by_user_id,
          delivery_method
        )
        VALUES ($1, $2, $3, 'signed_url')
      `,
      [req.auth.schoolId, path.documentId, req.auth.userId]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "documents.vault.download_url_issued",
      entityName: "documents",
      entityId: path.documentId,
      metadata: {
        delivery_method: "signed_url",
      },
    });

    return success(res, {
      document_id: document.id,
      file_key: document.file_key,
      download,
    });
  })
);

module.exports = router;
