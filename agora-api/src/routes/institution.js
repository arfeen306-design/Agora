const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { fireAndForgetAuditLog } = require("../utils/audit-log");
const { success } = require("../utils/http");
const { ensureTeacherProjectionForUser } = require("../utils/teacher-projection");
const { listTeacherClassroomIds } = require("../utils/teacher-scope");

const router = express.Router();

const PROFILE_VIEW_ROLES = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "accountant",
  "front_desk",
  "hr_admin",
];

const PROFILE_MANAGE_ROLES = ["school_admin", "principal", "vice_principal"];
const SECTION_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];
const CLASSROOM_MANAGE_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];
const SETUP_WIZARD_VIEW_ROLES = ["school_admin", "principal", "vice_principal", "front_desk", "hr_admin"];
const SETUP_WIZARD_MANAGE_ROLES = ["school_admin", "principal", "vice_principal"];
const SETUP_WIZARD_STEP_CODES = [
  "school_profile",
  "academic_year",
  "sections",
  "classrooms",
  "subjects",
  "staff_setup",
  "students",
  "fee_plans",
  "grading_system",
  "timetable",
  "role_assignment",
  "notification_settings",
];
const SETUP_WIZARD_STEP_DEFINITIONS = [
  {
    code: "school_profile",
    label: "School Profile",
    description: "Set school contact profile, branch details, and core identity.",
    owner_module: "institution",
  },
  {
    code: "academic_year",
    label: "Academic Year",
    description: "Ensure an active academic year exists and is marked current.",
    owner_module: "institution",
  },
  {
    code: "sections",
    label: "Sections",
    description: "Create active school sections (Pre School, Junior, Middle, Senior, High School).",
    owner_module: "institution",
  },
  {
    code: "classrooms",
    label: "Classrooms",
    description: "Create active classrooms and map them to sections and academic year.",
    owner_module: "institution",
  },
  {
    code: "subjects",
    label: "Subjects",
    description: "Create subjects and assign them to classrooms with teachers.",
    owner_module: "institution",
  },
  {
    code: "staff_setup",
    label: "Staff Setup",
    description: "Create staff records and activate teaching/operations assignments.",
    owner_module: "people",
  },
  {
    code: "students",
    label: "Students",
    description: "Add or import students and ensure active enrollment records are available.",
    owner_module: "people",
  },
  {
    code: "fee_plans",
    label: "Fee Plans",
    description: "Create at least one active fee plan for financial workflows.",
    owner_module: "fees",
  },
  {
    code: "grading_system",
    label: "Grading System",
    description: "Configure grading scales and grade bands for report card generation.",
    owner_module: "academics",
  },
  {
    code: "timetable",
    label: "Timetable",
    description: "Set up class timetables with period definitions and subject-teacher slots.",
    owner_module: "timetable",
  },
  {
    code: "role_assignment",
    label: "Role Assignment",
    description: "Assign leadership and core operational roles for governance.",
    owner_module: "access_control",
  },
  {
    code: "notification_settings",
    label: "Notification Settings",
    description: "Configure notification preferences/channels for school communications.",
    owner_module: "notifications",
  },
];

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    timezone: z.string().trim().min(2).max(120).optional(),
    logo_url: z.string().trim().url().max(1000).optional(),
    branch_name: z.string().trim().min(1).max(160).optional(),
    address_line: z.string().trim().min(1).max(300).optional(),
    contact_phone: z.string().trim().min(3).max(60).optional(),
    contact_email: z.string().trim().email().max(160).optional(),
    academic_year_label: z.string().trim().min(2).max(60).optional(),
    school_starts_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    school_ends_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    weekly_holidays: z.array(z.string().trim().min(2).max(30)).max(7).optional(),
    late_arrival_cutoff: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    attendance_rules: z.record(z.any()).optional(),
    principal_user_id: z.string().uuid().nullable().optional(),
    vice_principal_user_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const sectionsListSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const sectionCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(24),
  section_type: z
    .enum(["pre_school", "junior", "middle", "senior", "high_school", "general"])
    .default("general"),
  head_user_id: z.string().uuid().nullable().optional(),
  coordinator_user_id: z.string().uuid().nullable().optional(),
  display_order: z.coerce.number().int().min(0).max(500).default(0),
  announcements_enabled: z.boolean().default(true),
  is_active: z.boolean().default(true),
  metadata: z.record(z.any()).default({}),
});

const sectionUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    code: z.string().trim().min(2).max(24).optional(),
    section_type: z.enum(["pre_school", "junior", "middle", "senior", "high_school", "general"]).optional(),
    head_user_id: z.string().uuid().nullable().optional(),
    coordinator_user_id: z.string().uuid().nullable().optional(),
    display_order: z.coerce.number().int().min(0).max(500).optional(),
    announcements_enabled: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

const classroomListSchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  section_id: z.string().uuid().optional(),
  academic_year_id: z.string().uuid().optional(),
  is_active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const classroomCreateSchema = z.object({
  academic_year_id: z.string().uuid(),
  grade_label: z.string().trim().min(1).max(80),
  section_label: z.string().trim().min(1).max(80),
  section_id: z.string().uuid().nullable().optional(),
  classroom_code: z.string().trim().min(1).max(30).nullable().optional(),
  room_number: z.string().trim().min(1).max(30).nullable().optional(),
  homeroom_teacher_user_id: z.string().uuid().nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
  is_active: z.boolean().default(true),
});

const classroomUpdateSchema = z
  .object({
    grade_label: z.string().trim().min(1).max(80).optional(),
    section_label: z.string().trim().min(1).max(80).optional(),
    section_id: z.string().uuid().nullable().optional(),
    classroom_code: z.string().trim().min(1).max(30).nullable().optional(),
    room_number: z.string().trim().min(1).max(30).nullable().optional(),
    homeroom_teacher_user_id: z.string().uuid().nullable().optional(),
    capacity: z.coerce.number().int().min(1).max(200).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const academicYearPathSchema = z.object({
  id: z.string().uuid(),
});

const sectionDashboardQuerySchema = z.object({
  section_id: z.string().uuid().optional(),
  include_detail: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const setupStepPathSchema = z.object({
  stepCode: z.enum(SETUP_WIZARD_STEP_CODES),
});

const setupStepUpdateSchema = z.object({
  is_completed: z.boolean(),
  notes: z.string().trim().max(500).optional(),
  metadata: z.record(z.any()).default({}),
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

function isSchoolLeadership(auth) {
  return (
    hasRole(auth, "school_admin") ||
    hasRole(auth, "principal") ||
    hasRole(auth, "vice_principal") ||
    hasRole(auth, "super_admin")
  );
}

async function assertUserInSchool(schoolId, userId, fieldName) {
  if (!userId) return;
  const check = await pool.query(
    `
      SELECT id
      FROM users
      WHERE school_id = $1 AND id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );

  if (!check.rows[0]) {
    throw new AppError(422, "VALIDATION_ERROR", `${fieldName} must belong to this school`);
  }
}

async function resolveTeacherIdByUser(schoolId, userId) {
  if (!userId) return null;
  const teacher = await ensureTeacherProjectionForUser({
    schoolId,
    userId,
    roles: ["teacher"],
  });

  if (!teacher?.id) {
    throw new AppError(422, "VALIDATION_ERROR", "Homeroom teacher user must have teacher profile");
  }

  return teacher.id;
}

async function assertSectionVisibleToHm({ auth, sectionId }) {
  if (!sectionId || isSchoolLeadership(auth)) return;
  if (!hasRole(auth, "headmistress")) return;

  const check = await pool.query(
    `
      SELECT ss.id
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
    [auth.schoolId, sectionId, auth.userId]
  );

  if (!check.rows[0]) {
    throw new AppError(403, "FORBIDDEN", "Headmistress scope does not include this section");
  }
}

async function fetchSchoolProfile(schoolId) {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.code,
        s.name,
        s.timezone,
        s.is_active,
        s.logo_url,
        s.branch_name,
        s.address_line,
        s.contact_phone,
        s.contact_email,
        s.academic_year_label,
        s.school_starts_at,
        s.school_ends_at,
        s.weekly_holidays,
        s.late_arrival_cutoff,
        s.attendance_rules,
        s.principal_user_id,
        s.vice_principal_user_id,
        pu.first_name AS principal_first_name,
        pu.last_name AS principal_last_name,
        pu.email AS principal_email,
        vu.first_name AS vice_principal_first_name,
        vu.last_name AS vice_principal_last_name,
        vu.email AS vice_principal_email,
        (
          SELECT COUNT(*)::int
          FROM school_sections ss
          WHERE ss.school_id = s.id
            AND ss.is_active = TRUE
        ) AS active_sections,
        (
          SELECT COUNT(*)::int
          FROM classrooms c
          WHERE c.school_id = s.id
            AND c.is_active = TRUE
        ) AS active_classrooms,
        (
          SELECT COUNT(*)::int
          FROM staff_profiles sp
          WHERE sp.school_id = s.id
            AND sp.employment_status = 'active'
        ) AS active_staff,
        (
          SELECT COUNT(*)::int
          FROM students st
          WHERE st.school_id = s.id
            AND st.status = 'active'
        ) AS active_students
      FROM schools s
      LEFT JOIN users pu ON pu.id = s.principal_user_id
      LEFT JOIN users vu ON vu.id = s.vice_principal_user_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [schoolId]
  );

  return result.rows[0] || null;
}

async function fetchSetupWizardStatus(schoolId) {
  const summaryResult = await pool.query(
    `
      SELECT
        CASE
          WHEN
            COALESCE(NULLIF(TRIM(s.name), ''), '') <> ''
            AND COALESCE(NULLIF(TRIM(s.branch_name), ''), '') <> ''
            AND COALESCE(NULLIF(TRIM(s.address_line), ''), '') <> ''
            AND (
              COALESCE(NULLIF(TRIM(s.contact_phone), ''), '') <> ''
              OR COALESCE(NULLIF(TRIM(s.contact_email), ''), '') <> ''
            )
          THEN TRUE
          ELSE FALSE
        END AS school_profile_ready,
        EXISTS (
          SELECT 1
          FROM academic_years ay
          WHERE ay.school_id = s.id
            AND ay.is_current = TRUE
        ) AS academic_year_ready,
        EXISTS (
          SELECT 1
          FROM school_sections ss
          WHERE ss.school_id = s.id
            AND ss.is_active = TRUE
        ) AS sections_ready,
        EXISTS (
          SELECT 1
          FROM classrooms c
          WHERE c.school_id = s.id
            AND c.is_active = TRUE
        ) AS classrooms_ready,
        EXISTS (
          SELECT 1
          FROM staff_profiles sp
          WHERE sp.school_id = s.id
            AND sp.employment_status = 'active'
        ) AS staff_setup_ready,
        EXISTS (
          SELECT 1
          FROM students st
          WHERE st.school_id = s.id
            AND st.status = 'active'
        ) AS students_ready,
        EXISTS (
          SELECT 1
          FROM fee_plans fp
          WHERE fp.school_id = s.id
            AND fp.is_active = TRUE
        ) AS fee_plans_ready,
        EXISTS (
          SELECT 1
          FROM subjects sub
          WHERE sub.school_id = s.id
        ) AS subjects_ready,
        EXISTS (
          SELECT 1
          FROM grading_scales gs
          WHERE gs.school_id = s.id
        ) AS grading_system_ready,
        EXISTS (
          SELECT 1
          FROM timetable_periods tp
          WHERE tp.school_id = s.id
        ) AS timetable_ready,
        (
          s.principal_user_id IS NOT NULL
          OR s.vice_principal_user_id IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM users u
            JOIN user_roles ur
              ON ur.user_id = u.id
            JOIN roles r
              ON r.id = ur.role_id
            WHERE u.school_id = s.id
              AND r.code IN ('principal', 'vice_principal', 'headmistress')
          )
        ) AS role_assignment_ready,
        (
          s.attendance_rules ? 'notifications_enabled'
          OR s.attendance_rules ? 'notification_channels'
          OR s.attendance_rules ? 'notification_rules'
        ) AS notification_settings_ready
      FROM schools s
      WHERE s.id = $1
      LIMIT 1
    `,
    [schoolId]
  );

  const auto = summaryResult.rows[0];
  if (!auto) {
    throw new AppError(404, "NOT_FOUND", "School not found for setup wizard");
  }

  const [manualStepsResult, launchResult] = await Promise.all([
    pool.query(
      `
        SELECT
          step_code,
          is_completed,
          completed_at,
          completed_by_user_id,
          notes,
          metadata
        FROM school_onboarding_steps
        WHERE school_id = $1
      `,
      [schoolId]
    ),
    pool.query(
      `
        SELECT
          school_id,
          launched_at,
          launched_by_user_id,
          checklist_snapshot
        FROM school_onboarding_launches
        WHERE school_id = $1
        LIMIT 1
      `,
      [schoolId]
    ),
  ]);

  const manualByStep = new Map(
    manualStepsResult.rows.map((row) => [row.step_code, row])
  );
  const autoByStep = {
    school_profile: Boolean(auto.school_profile_ready),
    academic_year: Boolean(auto.academic_year_ready),
    sections: Boolean(auto.sections_ready),
    classrooms: Boolean(auto.classrooms_ready),
    subjects: Boolean(auto.subjects_ready),
    staff_setup: Boolean(auto.staff_setup_ready),
    students: Boolean(auto.students_ready),
    fee_plans: Boolean(auto.fee_plans_ready),
    grading_system: Boolean(auto.grading_system_ready),
    timetable: Boolean(auto.timetable_ready),
    role_assignment: Boolean(auto.role_assignment_ready),
    notification_settings: Boolean(auto.notification_settings_ready),
  };

  const steps = SETUP_WIZARD_STEP_DEFINITIONS.map((definition) => {
    const manual = manualByStep.get(definition.code) || null;
    const autoCompleted = Boolean(autoByStep[definition.code]);
    const manualCompleted = Boolean(manual?.is_completed);
    return {
      ...definition,
      auto_completed: autoCompleted,
      manual_completed: manualCompleted,
      is_completed: autoCompleted || manualCompleted,
      completed_at: manual?.completed_at || null,
      completed_by_user_id: manual?.completed_by_user_id || null,
      notes: manual?.notes || null,
      metadata: manual?.metadata || {},
    };
  });

  const completedSteps = steps.filter((step) => step.is_completed).length;
  const launch = launchResult.rows[0] || null;

  return {
    steps,
    total_steps: steps.length,
    completed_steps: completedSteps,
    completion_percent: Number(((completedSteps / Math.max(steps.length, 1)) * 100).toFixed(1)),
    launch_ready: completedSteps === steps.length,
    launched_at: launch?.launched_at || null,
    launched_by_user_id: launch?.launched_by_user_id || null,
    launched_snapshot: launch?.checklist_snapshot || null,
  };
}

router.get(
  "/institution/profile",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const profile = await fetchSchoolProfile(req.auth.schoolId);
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "School profile not found");
    }

    return success(res, profile, 200);
  })
);

router.patch(
  "/institution/profile",
  requireAuth,
  requireRoles(...PROFILE_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(profileUpdateSchema, req.body, "Invalid institution profile update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    if (Object.prototype.hasOwnProperty.call(body, "principal_user_id") && body.principal_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.principal_user_id, "principal_user_id");
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "vice_principal_user_id") &&
      body.vice_principal_user_id
    ) {
      await assertUserInSchool(
        req.auth.schoolId,
        body.vice_principal_user_id,
        "vice_principal_user_id"
      );
    }

    const values = [req.auth.schoolId];
    const setClauses = [];

    for (const [key, value] of entries) {
      values.push(key === "attendance_rules" ? JSON.stringify(value || {}) : value);
      if (key === "attendance_rules") {
        setClauses.push(`${key} = $${values.length}::jsonb`);
      } else {
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE schools
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      values
    );

    if (!updated.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "School profile not found");
    }

    const profile = await fetchSchoolProfile(req.auth.schoolId);
    return success(res, profile, 200);
  })
);

router.get(
  "/institution/sections",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(sectionsListSchema, req.query, "Invalid section list query");
    const params = [req.auth.schoolId];
    const where = ["ss.school_id = $1"];

    if (typeof query.is_active === "boolean") {
      params.push(query.is_active);
      where.push(`ss.is_active = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(ss.name ILIKE $${params.length} OR ss.code ILIKE $${params.length})`);
    }

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
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
      `);
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM school_sections ss
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
          ss.id,
          ss.school_id,
          ss.name,
          ss.code,
          ss.section_type,
          ss.head_user_id,
          ss.coordinator_user_id,
          ss.announcements_enabled,
          ss.display_order,
          ss.is_active,
          ss.metadata,
          ss.created_at,
          ss.updated_at,
          hu.first_name AS head_first_name,
          hu.last_name AS head_last_name,
          hu.email AS head_email,
          cu.first_name AS coordinator_first_name,
          cu.last_name AS coordinator_last_name,
          cu.email AS coordinator_email,
          (
            SELECT COUNT(*)::int
            FROM classrooms c
            WHERE c.school_id = ss.school_id
              AND c.section_id = ss.id
              AND c.is_active = TRUE
          ) AS class_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            JOIN classrooms c2
              ON c2.id = se.classroom_id
             AND c2.school_id = se.school_id
            WHERE se.school_id = ss.school_id
              AND c2.section_id = ss.id
              AND se.status = 'active'
          ) AS active_students
        FROM school_sections ss
        LEFT JOIN users hu ON hu.id = ss.head_user_id
        LEFT JOIN users cu ON cu.id = ss.coordinator_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ss.display_order ASC, ss.name ASC
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
  "/institution/sections",
  requireAuth,
  requireRoles(...SECTION_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(sectionCreateSchema, req.body, "Invalid section create payload");

    await assertUserInSchool(req.auth.schoolId, body.head_user_id || null, "head_user_id");
    await assertUserInSchool(
      req.auth.schoolId,
      body.coordinator_user_id || null,
      "coordinator_user_id"
    );

    const created = await pool.query(
      `
        INSERT INTO school_sections (
          school_id,
          name,
          code,
          section_type,
          head_user_id,
          coordinator_user_id,
          display_order,
          announcements_enabled,
          is_active,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        body.name,
        body.code,
        body.section_type,
        body.head_user_id || null,
        body.coordinator_user_id || null,
        body.display_order,
        body.announcements_enabled,
        body.is_active,
        JSON.stringify(body.metadata || {}),
      ]
    );

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/institution/sections/:sectionId",
  requireAuth,
  requireRoles(...SECTION_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(sectionUpdateSchema, req.body, "Invalid section update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const sectionCheck = await pool.query(
      `
        SELECT id
        FROM school_sections
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, req.params.sectionId]
    );

    if (!sectionCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Section not found");
    }

    await assertSectionVisibleToHm({ auth: req.auth, sectionId: req.params.sectionId });

    if (Object.prototype.hasOwnProperty.call(body, "head_user_id") && body.head_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.head_user_id, "head_user_id");
    }
    if (Object.prototype.hasOwnProperty.call(body, "coordinator_user_id") && body.coordinator_user_id) {
      await assertUserInSchool(req.auth.schoolId, body.coordinator_user_id, "coordinator_user_id");
    }

    const values = [req.auth.schoolId, req.params.sectionId];
    const setClauses = [];

    for (const [key, value] of entries) {
      values.push(key === "metadata" ? JSON.stringify(value || {}) : value);
      if (key === "metadata") {
        setClauses.push(`${key} = $${values.length}::jsonb`);
      } else {
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE school_sections
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
        RETURNING *
      `,
      values
    );

    return success(res, updated.rows[0], 200);
  })
);

router.get(
  "/institution/classrooms",
  requireAuth,
  requireRoles(...PROFILE_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(classroomListSchema, req.query, "Invalid classroom list query");

    const params = [req.auth.schoolId];
    const where = ["c.school_id = $1"];

    if (query.section_id) {
      params.push(query.section_id);
      where.push(`c.section_id = $${params.length}`);
    }

    if (query.academic_year_id) {
      params.push(query.academic_year_id);
      where.push(`c.academic_year_id = $${params.length}`);
    }

    if (typeof query.is_active === "boolean") {
      params.push(query.is_active);
      where.push(`c.is_active = $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`
        (
          c.grade_label ILIKE $${params.length}
          OR c.section_label ILIKE $${params.length}
          OR COALESCE(c.classroom_code, '') ILIKE $${params.length}
          OR COALESCE(c.room_number, '') ILIKE $${params.length}
        )
      `);
    }

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      where.push(`
        (
          c.section_id IN (
            SELECT ss.id
            FROM school_sections ss
            WHERE ss.school_id = c.school_id
              AND (
                ss.head_user_id = $${params.length}
                OR ss.coordinator_user_id = $${params.length}
              )
          )
          OR c.id IN (
            SELECT sca.classroom_id
            FROM staff_classroom_assignments sca
            JOIN staff_profiles sp ON sp.id = sca.staff_profile_id
            WHERE sca.school_id = c.school_id
              AND sp.user_id = $${params.length}
              AND sca.is_active = TRUE
          )
        )
      `);
    }

    if (
      hasRole(req.auth, "teacher") &&
      !hasRole(req.auth, "headmistress") &&
      !isSchoolLeadership(req.auth)
    ) {
      const teacherClassroomIds = await listTeacherClassroomIds({
        schoolId: req.auth.schoolId,
        userId: req.auth.userId,
      });

      if (teacherClassroomIds.length === 0) {
        where.push("FALSE");
      } else {
        params.push(teacherClassroomIds);
        where.push(`c.id = ANY($${params.length}::uuid[])`);
      }
    }

    const countResult = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM classrooms c
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
          c.id,
          c.school_id,
          c.academic_year_id,
          c.grade_label,
          c.section_label,
          c.section_id,
          c.classroom_code,
          c.room_number,
          c.capacity,
          c.is_active,
          c.created_at,
          c.updated_at,
          ay.name AS academic_year_name,
          ss.name AS section_name,
          ss.code AS section_code,
          c.homeroom_teacher_id,
          tu.id AS homeroom_teacher_user_id,
          tu.first_name AS homeroom_teacher_first_name,
          tu.last_name AS homeroom_teacher_last_name,
          hsp.id AS homeroom_teacher_staff_profile_id,
          hsp.staff_code AS homeroom_teacher_staff_code,
          COALESCE(hsp.designation, ht.designation) AS homeroom_teacher_designation,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            WHERE se.school_id = c.school_id
              AND se.classroom_id = c.id
              AND se.status = 'active'
          ) AS active_student_count
        FROM classrooms c
        JOIN academic_years ay
          ON ay.id = c.academic_year_id
         AND ay.school_id = c.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        LEFT JOIN teachers ht
          ON ht.id = c.homeroom_teacher_id
         AND ht.school_id = c.school_id
        LEFT JOIN users tu
          ON tu.id = ht.user_id
        LEFT JOIN staff_profiles hsp
          ON hsp.user_id = ht.user_id
         AND hsp.school_id = c.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY ay.is_current DESC, c.grade_label ASC, c.section_label ASC
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
  "/institution/classrooms",
  requireAuth,
  requireRoles(...CLASSROOM_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(classroomCreateSchema, req.body, "Invalid classroom create payload");

    const academicYearOk = await pool.query(
      `
        SELECT id
        FROM academic_years
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, body.academic_year_id]
    );

    if (!academicYearOk.rows[0]) {
      throw new AppError(422, "VALIDATION_ERROR", "academic_year_id does not belong to this school");
    }

    if (body.section_id) {
      const sectionOk = await pool.query(
        `
          SELECT id
          FROM school_sections
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
        `,
        [req.auth.schoolId, body.section_id]
      );
      if (!sectionOk.rows[0]) {
        throw new AppError(422, "VALIDATION_ERROR", "section_id does not belong to this school");
      }

      await assertSectionVisibleToHm({ auth: req.auth, sectionId: body.section_id });
    }

    const homeroomTeacherId = await resolveTeacherIdByUser(
      req.auth.schoolId,
      body.homeroom_teacher_user_id || null
    );

    const created = await pool.query(
      `
        INSERT INTO classrooms (
          school_id,
          academic_year_id,
          grade_label,
          section_label,
          section_id,
          classroom_code,
          room_number,
          homeroom_teacher_id,
          capacity,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        req.auth.schoolId,
        body.academic_year_id,
        body.grade_label,
        body.section_label,
        body.section_id || null,
        body.classroom_code || null,
        body.room_number || null,
        homeroomTeacherId,
        body.capacity || null,
        body.is_active,
      ]
    );

    return success(res, created.rows[0], 201);
  })
);

router.patch(
  "/institution/classrooms/:classroomId",
  requireAuth,
  requireRoles(...CLASSROOM_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(classroomUpdateSchema, req.body, "Invalid classroom update payload");
    const entries = Object.entries(body);

    if (entries.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "At least one field is required for update");
    }

    const classroomCheck = await pool.query(
      `
        SELECT id, section_id
        FROM classrooms
        WHERE school_id = $1
          AND id = $2
        LIMIT 1
      `,
      [req.auth.schoolId, req.params.classroomId]
    );

    if (!classroomCheck.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Classroom not found");
    }

    if (body.section_id) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: body.section_id });
    } else if (classroomCheck.rows[0].section_id) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: classroomCheck.rows[0].section_id });
    }

    const values = [req.auth.schoolId, req.params.classroomId];
    const setClauses = [];

    for (const [key, value] of entries) {
      if (key === "homeroom_teacher_user_id") {
        const teacherId = await resolveTeacherIdByUser(req.auth.schoolId, value || null);
        values.push(teacherId);
        setClauses.push(`homeroom_teacher_id = $${values.length}`);
      } else {
        values.push(value);
        setClauses.push(`${key} = $${values.length}`);
      }
    }

    const updated = await pool.query(
      `
        UPDATE classrooms
        SET ${setClauses.join(", ")}, updated_at = NOW()
        WHERE school_id = $1
          AND id = $2
        RETURNING *
      `,
      values
    );

    return success(res, updated.rows[0], 200);
  })
);

router.patch(
  "/institution/academic-years/:id/activate",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal"),
  asyncHandler(async (req, res) => {
    const path = parseSchema(academicYearPathSchema, req.params, "Invalid academic year id");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const targetYearResult = await client.query(
        `
          SELECT id, school_id, name, starts_on, ends_on, is_current
          FROM academic_years
          WHERE school_id = $1
            AND id = $2
          LIMIT 1
        `,
        [req.auth.schoolId, path.id]
      );

      const targetYear = targetYearResult.rows[0];
      if (!targetYear) {
        throw new AppError(404, "NOT_FOUND", "Academic year not found");
      }

      const previouslyCurrentResult = await client.query(
        `
          SELECT id, name
          FROM academic_years
          WHERE school_id = $1
            AND is_current = TRUE
            AND id <> $2
          LIMIT 1
        `,
        [req.auth.schoolId, path.id]
      );
      const previousCurrent = previouslyCurrentResult.rows[0] || null;

      await client.query(
        `
          UPDATE academic_years
          SET is_current = FALSE, updated_at = NOW()
          WHERE school_id = $1
            AND id <> $2
            AND is_current = TRUE
        `,
        [req.auth.schoolId, path.id]
      );

      const activatedResult = await client.query(
        `
          UPDATE academic_years
          SET is_current = TRUE, updated_at = NOW()
          WHERE school_id = $1
            AND id = $2
          RETURNING id, school_id, name, starts_on, ends_on, is_current, created_at, updated_at
        `,
        [req.auth.schoolId, path.id]
      );

      await client.query("COMMIT");

      fireAndForgetAuditLog({
        schoolId: req.auth.schoolId,
        actorUserId: req.auth.userId,
        action: "institution.academic_year.activated",
        entityName: "academic_years",
        entityId: path.id,
        metadata: {
          previous_current_id: previousCurrent?.id || null,
          previous_current_name: previousCurrent?.name || null,
          activated_name: activatedResult.rows[0]?.name || null,
        },
      });

      return success(
        res,
        {
          activated: activatedResult.rows[0],
          previous_current: previousCurrent,
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
  "/institution/setup-wizard/status",
  requireAuth,
  requireRoles(...SETUP_WIZARD_VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const status = await fetchSetupWizardStatus(req.auth.schoolId);
    return success(res, status, 200);
  })
);

router.patch(
  "/institution/setup-wizard/steps/:stepCode",
  requireAuth,
  requireRoles(...SETUP_WIZARD_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const path = parseSchema(setupStepPathSchema, req.params, "Invalid setup wizard step code");
    const body = parseSchema(
      setupStepUpdateSchema,
      req.body,
      "Invalid setup wizard step update payload"
    );

    const upserted = await pool.query(
      `
        INSERT INTO school_onboarding_steps (
          school_id,
          step_code,
          is_completed,
          completed_at,
          completed_by_user_id,
          notes,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $3 THEN NOW() ELSE NULL END,
          CASE WHEN $3 THEN $4::uuid ELSE NULL END,
          $5,
          $6::jsonb
        )
        ON CONFLICT (school_id, step_code)
        DO UPDATE SET
          is_completed = EXCLUDED.is_completed,
          completed_at = CASE WHEN EXCLUDED.is_completed THEN NOW() ELSE NULL END,
          completed_by_user_id = CASE WHEN EXCLUDED.is_completed THEN EXCLUDED.completed_by_user_id::uuid ELSE NULL END,
          notes = EXCLUDED.notes,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING *
      `,
      [
        req.auth.schoolId,
        path.stepCode,
        body.is_completed,
        req.auth.userId,
        body.notes || null,
        JSON.stringify(body.metadata || {}),
      ]
    );

    const status = await fetchSetupWizardStatus(req.auth.schoolId);

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "institution.setup_wizard.step.updated",
      entityName: "school_onboarding_steps",
      entityId: upserted.rows[0]?.id || null,
      metadata: {
        step_code: path.stepCode,
        is_completed: body.is_completed,
      },
    });

    return success(
      res,
      {
        step: upserted.rows[0] || null,
        status,
      },
      200
    );
  })
);

router.post(
  "/institution/setup-wizard/launch",
  requireAuth,
  requireRoles(...SETUP_WIZARD_MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const status = await fetchSetupWizardStatus(req.auth.schoolId);
    const missingSteps = status.steps.filter((step) => !step.is_completed);

    if (missingSteps.length > 0) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Cannot launch setup wizard while required steps are incomplete",
        missingSteps.map((step) => ({
          field: step.code,
          issue: "step_incomplete",
        }))
      );
    }

    const launched = await pool.query(
      `
        INSERT INTO school_onboarding_launches (
          school_id,
          launched_at,
          launched_by_user_id,
          checklist_snapshot
        )
        VALUES ($1, NOW(), $2::uuid, $3::jsonb)
        ON CONFLICT (school_id)
        DO UPDATE SET
          launched_at = EXCLUDED.launched_at,
          launched_by_user_id = EXCLUDED.launched_by_user_id,
          checklist_snapshot = EXCLUDED.checklist_snapshot,
          updated_at = NOW()
        RETURNING *
      `,
      [req.auth.schoolId, req.auth.userId, JSON.stringify(status.steps)]
    );

    fireAndForgetAuditLog({
      schoolId: req.auth.schoolId,
      actorUserId: req.auth.userId,
      action: "institution.setup_wizard.launched",
      entityName: "school_onboarding_launches",
      entityId: req.auth.schoolId,
      metadata: {
        completed_steps: status.completed_steps,
        total_steps: status.total_steps,
      },
    });

    return success(
      res,
      {
        launch: launched.rows[0] || null,
        status: {
          ...status,
          launched_at: launched.rows[0]?.launched_at || null,
          launched_by_user_id: launched.rows[0]?.launched_by_user_id || null,
          launched_snapshot: launched.rows[0]?.checklist_snapshot || null,
        },
      },
      200
    );
  })
);

router.get(
  "/institution/dashboards/principal",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal"),
  asyncHandler(async (req, res) => {
    const attendanceSummary = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'present')::int AS present_count,
          COUNT(*) FILTER (WHERE status = 'late')::int AS late_count,
          COUNT(*) FILTER (WHERE status = 'absent')::int AS absent_count,
          COUNT(*) FILTER (WHERE status = 'leave')::int AS leave_count
        FROM attendance_records
        WHERE school_id = $1
          AND attendance_date = CURRENT_DATE
      `,
      [req.auth.schoolId]
    );

    const sectionAttendance = await pool.query(
      `
        SELECT
          ss.id AS section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          COUNT(ar.id)::int AS attendance_records_today,
          COUNT(ar.id) FILTER (WHERE ar.status = 'present')::int AS present_count,
          COUNT(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_count,
          COUNT(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_count
        FROM school_sections ss
        LEFT JOIN classrooms c
          ON c.school_id = ss.school_id
         AND c.section_id = ss.id
        LEFT JOIN attendance_records ar
          ON ar.school_id = ss.school_id
         AND ar.classroom_id = c.id
         AND ar.attendance_date = CURRENT_DATE
        WHERE ss.school_id = $1
          AND ss.is_active = TRUE
        GROUP BY ss.id, ss.name, ss.code, ss.display_order
        ORDER BY ss.display_order ASC, ss.name ASC
      `,
      [req.auth.schoolId]
    );

    const homeworkCompletion = await pool.query(
      `
        SELECT
          COALESCE(ss.code, 'UNASSIGNED') AS section_code,
          COALESCE(ss.name, 'Unassigned') AS section_name,
          COUNT(hs.id)::int AS total_submissions,
          COUNT(hs.id) FILTER (WHERE hs.status IN ('submitted', 'reviewed'))::int AS completed_submissions,
          COUNT(hs.id) FILTER (WHERE hs.status = 'missing')::int AS missing_submissions
        FROM homework_submissions hs
        JOIN homework h
          ON h.id = hs.homework_id
         AND h.school_id = hs.school_id
        JOIN classrooms c
          ON c.id = h.classroom_id
         AND c.school_id = h.school_id
        LEFT JOIN school_sections ss
          ON ss.id = c.section_id
         AND ss.school_id = c.school_id
        WHERE hs.school_id = $1
          AND h.assigned_at >= NOW() - INTERVAL '30 days'
        GROUP BY COALESCE(ss.code, 'UNASSIGNED'), COALESCE(ss.name, 'Unassigned')
        ORDER BY section_name ASC
      `,
      [req.auth.schoolId]
    );

    const marksUpload = await pool.query(
      `
        SELECT
          COUNT(DISTINCT a.id)::int AS assessment_count,
          COUNT(sc.id)::int AS score_count,
          COUNT(DISTINCT a.created_by_user_id)::int AS contributing_teachers
        FROM assessments a
        LEFT JOIN assessment_scores sc
          ON sc.assessment_id = a.id
         AND sc.school_id = a.school_id
        WHERE a.school_id = $1
          AND a.created_at >= NOW() - INTERVAL '30 days'
      `,
      [req.auth.schoolId]
    );

    const feeAndEvents = await pool.query(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM fee_invoices fi
            WHERE fi.school_id = $1
              AND fi.status IN ('overdue', 'issued', 'partial')
              AND fi.due_date < CURRENT_DATE
          ) AS defaulter_invoices,
          (
            SELECT COUNT(*)::int
            FROM events e
            WHERE e.school_id = $1
              AND e.starts_at >= NOW()
              AND e.starts_at <= NOW() + INTERVAL '14 days'
          ) AS upcoming_events,
          (
            SELECT COUNT(*)::int
            FROM delegated_permissions dp
            WHERE dp.school_id = $1
              AND dp.is_active = TRUE
              AND (dp.ends_at IS NULL OR dp.ends_at >= NOW())
          ) AS active_delegations
      `,
      [req.auth.schoolId]
    );

    const sectionCommandBlocksResult = await pool.query(
      `
        SELECT
          ss.id AS section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          ss.section_type,
          ss.head_user_id,
          COALESCE(NULLIF(BTRIM(CONCAT(head.first_name, ' ', head.last_name)), ''), head.email) AS head_name,
          ss.coordinator_user_id,
          COALESCE(NULLIF(BTRIM(CONCAT(coord.first_name, ' ', coord.last_name)), ''), coord.email) AS coordinator_name,
          (
            SELECT COUNT(*)::int
            FROM classrooms c
            WHERE c.school_id = ss.school_id
              AND c.section_id = ss.id
              AND c.is_active = TRUE
          ) AS class_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            JOIN classrooms c
              ON c.id = se.classroom_id
             AND c.school_id = se.school_id
            WHERE se.school_id = ss.school_id
              AND c.section_id = ss.id
              AND se.status = 'active'
          ) AS active_students,
          (
            SELECT COUNT(*)::int
            FROM staff_profiles sp
            WHERE sp.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sp.employment_status = 'active'
          ) AS assigned_staff,
          (
            SELECT COUNT(DISTINCT ps.parent_id)::int
            FROM parent_students ps
            JOIN student_enrollments se
              ON se.student_id = ps.student_id
             AND se.school_id = ps.school_id
            JOIN classrooms c
              ON c.id = se.classroom_id
             AND c.school_id = se.school_id
            WHERE ps.school_id = ss.school_id
              AND c.section_id = ss.id
              AND se.status = 'active'
          ) AS linked_parents,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
          ) AS student_total,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'present'
          ) AS student_present_count,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'late'
          ) AS student_late_count,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'absent'
          ) AS student_absent_count,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'leave'
          ) AS student_leave_count,
          (
            SELECT COUNT(sal.id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sal.attendance_date = CURRENT_DATE
          ) AS staff_total,
          (
            SELECT COUNT(sal.id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'present'
          ) AS staff_present_count,
          (
            SELECT COUNT(sal.id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'late'
          ) AS staff_late_count,
          (
            SELECT COUNT(sal.id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'absent'
          ) AS staff_absent_count,
          (
            SELECT COUNT(sal.id)::int
            FROM staff_attendance_logs sal
            JOIN staff_profiles sp
              ON sp.id = sal.staff_profile_id
             AND sp.school_id = sal.school_id
            WHERE sal.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sal.attendance_date = CURRENT_DATE
              AND sal.status = 'leave'
          ) AS staff_leave_count,
          (
            SELECT COUNT(di.id)::int
            FROM discipline_incidents di
            WHERE di.school_id = ss.school_id
              AND di.section_id = ss.id
              AND di.status IN ('reported', 'under_review')
              AND di.incident_date >= CURRENT_DATE - INTERVAL '30 days'
          ) AS discipline_open_count,
          (
            SELECT COUNT(di.id)::int
            FROM discipline_incidents di
            WHERE di.school_id = ss.school_id
              AND di.section_id = ss.id
              AND di.status = 'escalated'
              AND di.incident_date >= CURRENT_DATE - INTERVAL '30 days'
          ) AS discipline_escalated_count,
          (
            SELECT COUNT(di.id)::int
            FROM discipline_incidents di
            WHERE di.school_id = ss.school_id
              AND di.section_id = ss.id
              AND di.severity = 'critical'
              AND di.incident_date >= CURRENT_DATE - INTERVAL '30 days'
          ) AS discipline_critical_count,
          (
            SELECT COUNT(e.id)::int
            FROM events e
            LEFT JOIN classrooms ec
              ON ec.id = e.target_classroom_id
             AND ec.school_id = e.school_id
            WHERE e.school_id = ss.school_id
              AND e.starts_at >= NOW()
              AND e.starts_at <= NOW() + INTERVAL '14 days'
              AND (
                e.target_scope = 'school'
                OR (e.target_scope = 'classroom' AND ec.section_id = ss.id)
              )
          ) AS upcoming_events_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'inquiry'
          ) AS admission_inquiry_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'under_review'
          ) AS admission_under_review_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'accepted'
          ) AS admission_accepted_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'waitlisted'
          ) AS admission_waitlisted_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'admitted'
          ) AS admission_admitted_count,
          (
            SELECT COUNT(*)::int
            FROM admission_applications aa
            LEFT JOIN classrooms dc
              ON dc.id = aa.desired_classroom_id
             AND dc.school_id = aa.school_id
            LEFT JOIN school_sections ds
              ON ds.school_id = aa.school_id
             AND dc.id IS NULL
             AND aa.desired_section_label IS NOT NULL
             AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
            WHERE aa.school_id = ss.school_id
              AND COALESCE(dc.section_id, ds.id) = ss.id
              AND aa.current_status = 'rejected'
          ) AS admission_rejected_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            JOIN classrooms c
              ON c.id = se.classroom_id
             AND c.school_id = se.school_id
            WHERE se.school_id = ss.school_id
              AND c.section_id = ss.id
              AND se.status <> 'active'
          ) AS withdrawal_count,
          (
            SELECT COUNT(rc.id)::int
            FROM report_cards rc
            JOIN classrooms c
              ON c.id = rc.classroom_id
             AND c.school_id = rc.school_id
            WHERE rc.school_id = ss.school_id
              AND c.section_id = ss.id
          ) AS result_total_cards,
          (
            SELECT COUNT(rc.id)::int
            FROM report_cards rc
            JOIN classrooms c
              ON c.id = rc.classroom_id
             AND c.school_id = rc.school_id
            WHERE rc.school_id = ss.school_id
              AND c.section_id = ss.id
              AND rc.status = 'published'
          ) AS result_published_cards,
          (
            SELECT COUNT(rc.id)::int
            FROM report_cards rc
            JOIN classrooms c
              ON c.id = rc.classroom_id
             AND c.school_id = rc.school_id
            WHERE rc.school_id = ss.school_id
              AND c.section_id = ss.id
              AND rc.status = 'draft'
          ) AS result_draft_cards,
          (
            SELECT ROUND(COALESCE(AVG(rc.percentage), 0)::numeric, 2)
            FROM report_cards rc
            JOIN classrooms c
              ON c.id = rc.classroom_id
             AND c.school_id = rc.school_id
            WHERE rc.school_id = ss.school_id
              AND c.section_id = ss.id
              AND rc.status = 'published'
          ) AS result_average_percentage,
          (
            SELECT et.name
            FROM report_cards rc
            JOIN classrooms c
              ON c.id = rc.classroom_id
             AND c.school_id = rc.school_id
            JOIN exam_terms et
              ON et.id = rc.exam_term_id
             AND et.school_id = rc.school_id
            WHERE rc.school_id = ss.school_id
              AND c.section_id = ss.id
            ORDER BY COALESCE(et.ends_on, et.starts_on, rc.published_at::date, rc.created_at::date) DESC NULLS LAST
            LIMIT 1
          ) AS result_term_name,
          (
            SELECT COUNT(te.id)::int
            FROM timetable_entries te
            JOIN classrooms c
              ON c.id = te.classroom_id
             AND c.school_id = te.school_id
            WHERE te.school_id = ss.school_id
              AND c.section_id = ss.id
              AND te.is_active = TRUE
          ) AS timetable_entries_count,
          (
            SELECT COUNT(DISTINCT te.classroom_id)::int
            FROM timetable_entries te
            JOIN classrooms c
              ON c.id = te.classroom_id
             AND c.school_id = te.school_id
            WHERE te.school_id = ss.school_id
              AND c.section_id = ss.id
              AND te.is_active = TRUE
          ) AS classrooms_with_timetable,
          (
            SELECT COUNT(tsb.id)::int
            FROM timetable_substitutions tsb
            JOIN timetable_entries te
              ON te.id = tsb.timetable_entry_id
             AND te.school_id = tsb.school_id
            JOIN classrooms c
              ON c.id = te.classroom_id
             AND c.school_id = te.school_id
            WHERE tsb.school_id = ss.school_id
              AND c.section_id = ss.id
              AND tsb.is_active = TRUE
              AND tsb.substitution_date >= CURRENT_DATE - INTERVAL '7 days'
          ) AS timetable_substitutions_this_week
        FROM school_sections ss
        LEFT JOIN users head
          ON head.id = ss.head_user_id
        LEFT JOIN users coord
          ON coord.id = ss.coordinator_user_id
        WHERE ss.school_id = $1
          AND ss.is_active = TRUE
        ORDER BY ss.display_order ASC, ss.name ASC
      `,
      [req.auth.schoolId]
    );

    const sectionIds = sectionCommandBlocksResult.rows.map((row) => row.section_id).filter(Boolean);
    const staffPreviewResult =
      sectionIds.length > 0
        ? await pool.query(
            `
              SELECT
                sp.primary_section_id AS section_id,
                sp.id AS staff_profile_id,
                sp.staff_code,
                sp.staff_type,
                sp.designation,
                sp.department,
                u.id AS user_id,
                u.first_name,
                u.last_name,
                u.email,
                COALESCE(sal.status, 'unmarked') AS attendance_status
              FROM staff_profiles sp
              JOIN users u
                ON u.id = sp.user_id
              LEFT JOIN staff_attendance_logs sal
                ON sal.school_id = sp.school_id
               AND sal.staff_profile_id = sp.id
               AND sal.attendance_date = CURRENT_DATE
              WHERE sp.school_id = $1
                AND sp.primary_section_id = ANY($2::uuid[])
                AND sp.employment_status = 'active'
              ORDER BY
                sp.primary_section_id ASC,
                CASE sp.staff_type
                  WHEN 'headmistress' THEN 0
                  WHEN 'teacher' THEN 1
                  ELSE 2
                END ASC,
                COALESCE(sp.designation, '') ASC,
                u.first_name ASC
            `,
            [req.auth.schoolId, sectionIds]
          )
        : { rows: [] };

    const staffPreviewMap = new Map();
    for (const row of staffPreviewResult.rows) {
      if (!staffPreviewMap.has(row.section_id)) staffPreviewMap.set(row.section_id, []);
      if (staffPreviewMap.get(row.section_id).length < 5) {
        staffPreviewMap.get(row.section_id).push({
          staff_profile_id: row.staff_profile_id,
          user_id: row.user_id,
          staff_code: row.staff_code,
          staff_type: row.staff_type,
          designation: row.designation,
          department: row.department,
          name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.email,
          email: row.email,
          attendance_status: row.attendance_status,
        });
      }
    }

    const summary = {
      attendance_today: attendanceSummary.rows[0] || {
        total: 0,
        present_count: 0,
        late_count: 0,
        absent_count: 0,
        leave_count: 0,
      },
      section_attendance: sectionAttendance.rows,
      homework_completion_by_section: homeworkCompletion.rows,
      marks_upload_status: marksUpload.rows[0] || {
        assessment_count: 0,
        score_count: 0,
        contributing_teachers: 0,
      },
      finance_and_alerts: feeAndEvents.rows[0] || {
        defaulter_invoices: 0,
        upcoming_events: 0,
        active_delegations: 0,
      },
      section_command_blocks: sectionCommandBlocksResult.rows.map((row) => ({
        section_id: row.section_id,
        section_name: row.section_name,
        section_code: row.section_code,
        section_type: row.section_type,
        head_user_id: row.head_user_id,
        head_name: row.head_name,
        coordinator_user_id: row.coordinator_user_id,
        coordinator_name: row.coordinator_name,
        class_count: Number(row.class_count) || 0,
        active_students: Number(row.active_students) || 0,
        assigned_staff: Number(row.assigned_staff) || 0,
        linked_parents: Number(row.linked_parents) || 0,
        student_attendance_today: {
          total: Number(row.student_total) || 0,
          present_count: Number(row.student_present_count) || 0,
          late_count: Number(row.student_late_count) || 0,
          absent_count: Number(row.student_absent_count) || 0,
          leave_count: Number(row.student_leave_count) || 0,
        },
        staff_attendance_today: {
          total: Number(row.staff_total) || 0,
          present_count: Number(row.staff_present_count) || 0,
          late_count: Number(row.staff_late_count) || 0,
          absent_count: Number(row.staff_absent_count) || 0,
          leave_count: Number(row.staff_leave_count) || 0,
        },
        discipline: {
          open_count: Number(row.discipline_open_count) || 0,
          escalated_count: Number(row.discipline_escalated_count) || 0,
          critical_count: Number(row.discipline_critical_count) || 0,
        },
        events: {
          upcoming_count: Number(row.upcoming_events_count) || 0,
        },
        admissions: {
          inquiry_count: Number(row.admission_inquiry_count) || 0,
          under_review_count: Number(row.admission_under_review_count) || 0,
          accepted_count: Number(row.admission_accepted_count) || 0,
          waitlisted_count: Number(row.admission_waitlisted_count) || 0,
          admitted_count: Number(row.admission_admitted_count) || 0,
          rejected_count: Number(row.admission_rejected_count) || 0,
        },
        withdrawals: {
          count: Number(row.withdrawal_count) || 0,
        },
        results: {
          total_cards: Number(row.result_total_cards) || 0,
          published_cards: Number(row.result_published_cards) || 0,
          draft_cards: Number(row.result_draft_cards) || 0,
          average_percentage: Number(row.result_average_percentage) || 0,
          latest_term_name: row.result_term_name || null,
        },
        timetable: {
          entries_count: Number(row.timetable_entries_count) || 0,
          classrooms_with_timetable: Number(row.classrooms_with_timetable) || 0,
          substitutions_this_week: Number(row.timetable_substitutions_this_week) || 0,
        },
        staff_preview: staffPreviewMap.get(row.section_id) || [],
      })),
      generated_at: new Date().toISOString(),
    };

    return success(res, summary, 200);
  })
);

router.get(
  "/institution/dashboards/section",
  requireAuth,
  requireRoles("school_admin", "principal", "vice_principal", "headmistress"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      sectionDashboardQuerySchema,
      req.query,
      "Invalid section dashboard query"
    );
    const params = [req.auth.schoolId];
    let scopeFilter = "";

    if (hasRole(req.auth, "headmistress") && !isSchoolLeadership(req.auth)) {
      params.push(req.auth.userId);
      scopeFilter = `
        AND (
          ss.head_user_id = $2
          OR ss.coordinator_user_id = $2
          OR EXISTS (
            SELECT 1
            FROM staff_profiles sp
            WHERE sp.school_id = ss.school_id
              AND sp.user_id = $2
              AND sp.primary_section_id = ss.id
          )
        )
      `;
    }

    const rows = await pool.query(
      `
        SELECT
          ss.id AS section_id,
          ss.name AS section_name,
          ss.code AS section_code,
          ss.section_type,
          ss.head_user_id,
          COALESCE(NULLIF(BTRIM(CONCAT(head.first_name, ' ', head.last_name)), ''), head.email) AS head_name,
          ss.coordinator_user_id,
          COALESCE(NULLIF(BTRIM(CONCAT(coord.first_name, ' ', coord.last_name)), ''), coord.email) AS coordinator_name,
          (
            SELECT COUNT(*)::int
            FROM classrooms c
            WHERE c.school_id = ss.school_id
              AND c.section_id = ss.id
              AND c.is_active = TRUE
          ) AS class_count,
          (
            SELECT COUNT(*)::int
            FROM student_enrollments se
            JOIN classrooms c
              ON c.id = se.classroom_id
             AND c.school_id = se.school_id
            WHERE se.school_id = ss.school_id
              AND c.section_id = ss.id
              AND se.status = 'active'
          ) AS active_students,
          (
            SELECT COUNT(*)::int
            FROM staff_profiles sp
            WHERE sp.school_id = ss.school_id
              AND sp.primary_section_id = ss.id
              AND sp.employment_status = 'active'
          ) AS assigned_staff,
          (
            SELECT COUNT(DISTINCT ps.parent_id)::int
            FROM parent_students ps
            JOIN student_enrollments se
              ON se.student_id = ps.student_id
             AND se.school_id = ps.school_id
            JOIN classrooms c
              ON c.id = se.classroom_id
             AND c.school_id = se.school_id
            WHERE ps.school_id = ss.school_id
              AND c.section_id = ss.id
              AND se.status = 'active'
          ) AS linked_parents,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
          ) AS attendance_records_today,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'late'
          ) AS late_today,
          (
            SELECT COUNT(ar.id)::int
            FROM attendance_records ar
            JOIN classrooms c
              ON c.id = ar.classroom_id
             AND c.school_id = ar.school_id
            WHERE ar.school_id = ss.school_id
              AND c.section_id = ss.id
              AND ar.attendance_date = CURRENT_DATE
              AND ar.status = 'absent'
          ) AS absent_today
        FROM school_sections ss
        LEFT JOIN users head
          ON head.id = ss.head_user_id
        LEFT JOIN users coord
          ON coord.id = ss.coordinator_user_id
        WHERE ss.school_id = $1
          AND ss.is_active = TRUE
          ${scopeFilter}
        ORDER BY ss.display_order ASC, ss.name ASC
      `,
      params
    );

    const sections = rows.rows;
    const visibleSectionIds = new Set(sections.map((row) => row.section_id));

    let selectedSectionId = query.section_id || sections[0]?.section_id || null;
    if (selectedSectionId && !visibleSectionIds.has(selectedSectionId)) {
      throw new AppError(404, "NOT_FOUND", "Section not found for this dashboard scope");
    }

    let selectedSectionDetail = null;
    if (query.include_detail && selectedSectionId) {
      await assertSectionVisibleToHm({ auth: req.auth, sectionId: selectedSectionId });

      const selectedSectionRow =
        sections.find((row) => row.section_id === selectedSectionId) || null;

      const [
        classAttendanceResult,
        teacherCompletionResult,
        lateAbsentResult,
        eventsResult,
        announcementsResult,
        staffRosterResult,
        staffAttendanceSummaryResult,
        parentAccessResult,
        resultsByTermResult,
        admissionsSummaryResult,
        admissionRecordsResult,
        timetableSummaryResult,
        timetablePreviewResult,
        movementSummaryResult,
      ] =
        await Promise.all([
          pool.query(
            `
              SELECT
                c.id AS classroom_id,
                c.grade_label,
                c.section_label,
                c.classroom_code,
                c.room_number,
                COALESCE(NULLIF(BTRIM(CONCAT(hu.first_name, ' ', hu.last_name)), ''), hu.email) AS homeroom_teacher_name,
                (
                  SELECT COUNT(*)::int
                  FROM student_enrollments se
                  WHERE se.school_id = c.school_id
                    AND se.classroom_id = c.id
                    AND se.status = 'active'
                ) AS active_students,
                COUNT(ar.id)::int AS attendance_records_today,
                COUNT(ar.id) FILTER (WHERE ar.status = 'present')::int AS present_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'late')::int AS late_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'absent')::int AS absent_count,
                COUNT(ar.id) FILTER (WHERE ar.status = 'leave')::int AS leave_count
              FROM classrooms c
              LEFT JOIN teachers ht
                ON ht.id = c.homeroom_teacher_id
               AND ht.school_id = c.school_id
              LEFT JOIN users hu
                ON hu.id = ht.user_id
              LEFT JOIN attendance_records ar
                ON ar.school_id = c.school_id
               AND ar.classroom_id = c.id
               AND ar.attendance_date = CURRENT_DATE
              WHERE c.school_id = $1
                AND c.section_id = $2
                AND c.is_active = TRUE
              GROUP BY c.id, c.grade_label, c.section_label, c.classroom_code, c.room_number, homeroom_teacher_name
              ORDER BY c.grade_label ASC, c.section_label ASC
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                (
                  SELECT COUNT(*)::int
                  FROM staff_profiles sp
                  WHERE sp.school_id = $1
                    AND sp.primary_section_id = $2
                    AND sp.employment_status = 'active'
                ) AS assigned_staff,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_total_submissions,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND hs.status IN ('submitted', 'reviewed')
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_completed_submissions,
                (
                  SELECT COUNT(hs.id)::int
                  FROM homework_submissions hs
                  JOIN homework h
                    ON h.id = hs.homework_id
                   AND h.school_id = hs.school_id
                  JOIN classrooms c
                    ON c.id = h.classroom_id
                   AND c.school_id = h.school_id
                  WHERE hs.school_id = $1
                    AND c.section_id = $2
                    AND hs.status = 'missing'
                    AND h.assigned_at >= NOW() - INTERVAL '30 days'
                ) AS homework_missing_submissions,
                (
                  SELECT COUNT(DISTINCT a.id)::int
                  FROM assessments a
                  JOIN classrooms c
                    ON c.id = a.classroom_id
                   AND c.school_id = a.school_id
                  WHERE a.school_id = $1
                    AND c.section_id = $2
                    AND a.created_at >= NOW() - INTERVAL '30 days'
                ) AS marks_assessments_count,
                (
                  SELECT COUNT(sc.id)::int
                  FROM assessment_scores sc
                  JOIN assessments a
                    ON a.id = sc.assessment_id
                   AND a.school_id = sc.school_id
                  JOIN classrooms c
                    ON c.id = a.classroom_id
                   AND c.school_id = a.school_id
                  WHERE sc.school_id = $1
                    AND c.section_id = $2
                    AND a.created_at >= NOW() - INTERVAL '30 days'
                ) AS marks_scores_count
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                ar.id AS attendance_record_id,
                ar.student_id,
                st.student_code,
                st.first_name,
                st.last_name,
                ar.status,
                ar.check_in_at,
                c.id AS classroom_id,
                c.grade_label,
                c.section_label
              FROM attendance_records ar
              JOIN students st
                ON st.id = ar.student_id
               AND st.school_id = ar.school_id
              JOIN classrooms c
                ON c.id = ar.classroom_id
               AND c.school_id = ar.school_id
              WHERE ar.school_id = $1
                AND c.section_id = $2
                AND ar.attendance_date = CURRENT_DATE
                AND ar.status IN ('late', 'absent')
              ORDER BY
                CASE ar.status WHEN 'absent' THEN 0 ELSE 1 END,
                st.first_name ASC
              LIMIT 25
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                e.id,
                e.title,
                e.description,
                e.event_type,
                e.starts_at,
                e.ends_at,
                e.target_scope,
                e.target_classroom_id,
                c.grade_label,
                c.section_label
              FROM events e
              LEFT JOIN classrooms c
                ON c.id = e.target_classroom_id
               AND c.school_id = e.school_id
              WHERE e.school_id = $1
                AND e.starts_at >= NOW()
                AND e.starts_at <= NOW() + INTERVAL '14 days'
                AND (
                  e.target_scope = 'school'
                  OR (e.target_scope = 'classroom' AND c.section_id = $2)
                )
              ORDER BY e.starts_at ASC
              LIMIT 8
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                e.id,
                e.title,
                e.description,
                e.event_type,
                e.starts_at,
                e.target_scope,
                e.target_classroom_id,
                c.grade_label,
                c.section_label
              FROM events e
              LEFT JOIN classrooms c
                ON c.id = e.target_classroom_id
               AND c.school_id = e.school_id
              WHERE e.school_id = $1
                AND (
                  e.event_type IN ('announcement', 'notice', 'circular')
                  OR e.event_type ILIKE '%announce%'
                )
                AND (
                  e.target_scope = 'school'
                  OR (e.target_scope = 'classroom' AND c.section_id = $2)
                )
              ORDER BY e.starts_at DESC NULLS LAST, e.created_at DESC
              LIMIT 6
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                sp.id AS staff_profile_id,
                sp.user_id,
                sp.staff_code,
                sp.staff_type,
                sp.designation,
                sp.department,
                sp.employment_status,
                u.first_name,
                u.last_name,
                u.email,
                COALESCE(sal.status, 'unmarked') AS attendance_status,
                sal.check_in_at,
                sal.check_out_at
              FROM staff_profiles sp
              JOIN users u
                ON u.id = sp.user_id
              LEFT JOIN staff_attendance_logs sal
                ON sal.school_id = sp.school_id
               AND sal.staff_profile_id = sp.id
               AND sal.attendance_date = CURRENT_DATE
              WHERE sp.school_id = $1
                AND sp.primary_section_id = $2
                AND sp.employment_status = 'active'
              ORDER BY
                CASE sp.staff_type
                  WHEN 'headmistress' THEN 0
                  WHEN 'teacher' THEN 1
                  ELSE 2
                END ASC,
                COALESCE(sp.designation, '') ASC,
                u.first_name ASC
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                COUNT(sal.id)::int AS total,
                COUNT(sal.id) FILTER (WHERE sal.status = 'present')::int AS present_count,
                COUNT(sal.id) FILTER (WHERE sal.status = 'late')::int AS late_count,
                COUNT(sal.id) FILTER (WHERE sal.status = 'absent')::int AS absent_count,
                COUNT(sal.id) FILTER (WHERE sal.status = 'leave')::int AS leave_count
              FROM staff_attendance_logs sal
              JOIN staff_profiles sp
                ON sp.id = sal.staff_profile_id
               AND sp.school_id = sal.school_id
              WHERE sal.school_id = $1
                AND sp.primary_section_id = $2
                AND sal.attendance_date = CURRENT_DATE
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                (
                  SELECT COUNT(*)::int
                  FROM student_enrollments se
                  JOIN classrooms c
                    ON c.id = se.classroom_id
                   AND c.school_id = se.school_id
                  WHERE se.school_id = $1
                    AND c.section_id = $2
                    AND se.status = 'active'
                ) AS active_students,
                (
                  SELECT COUNT(DISTINCT ps.parent_id)::int
                  FROM parent_students ps
                  JOIN student_enrollments se
                    ON se.student_id = ps.student_id
                   AND se.school_id = ps.school_id
                  JOIN classrooms c
                    ON c.id = se.classroom_id
                   AND c.school_id = se.school_id
                  WHERE ps.school_id = $1
                    AND c.section_id = $2
                    AND se.status = 'active'
                ) AS linked_parents
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                et.id AS exam_term_id,
                et.name AS term_name,
                et.term_type,
                et.starts_on,
                et.ends_on,
                COUNT(rc.id)::int AS total_report_cards,
                COUNT(rc.id) FILTER (WHERE rc.status = 'published')::int AS published_report_cards,
                COUNT(rc.id) FILTER (WHERE rc.status = 'draft')::int AS draft_report_cards,
                ROUND(COALESCE(AVG(rc.percentage) FILTER (WHERE rc.status = 'published'), 0)::numeric, 2) AS average_percentage
              FROM exam_terms et
              JOIN classrooms c
                ON c.school_id = et.school_id
               AND c.academic_year_id = et.academic_year_id
               AND c.section_id = $2
               AND c.is_active = TRUE
              LEFT JOIN report_cards rc
                ON rc.school_id = et.school_id
               AND rc.exam_term_id = et.id
               AND rc.classroom_id = c.id
              WHERE et.school_id = $1
              GROUP BY et.id, et.name, et.term_type, et.starts_on, et.ends_on, et.created_at
              ORDER BY COALESCE(et.ends_on, et.starts_on) DESC NULLS LAST, et.created_at DESC
              LIMIT 6
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                aa.id,
                aa.student_id,
                st.student_code,
                st.first_name,
                st.last_name,
                aa.guardian_name,
                aa.guardian_phone,
                aa.current_status,
                aa.created_at,
                aa.desired_grade_label,
                aa.desired_section_label,
                dc.grade_label AS desired_grade_actual,
                dc.section_label AS desired_section_actual
              FROM admission_applications aa
              JOIN students st
                ON st.id = aa.student_id
               AND st.school_id = aa.school_id
              LEFT JOIN classrooms dc
                ON dc.id = aa.desired_classroom_id
               AND dc.school_id = aa.school_id
              LEFT JOIN school_sections ds
                ON ds.school_id = aa.school_id
               AND dc.id IS NULL
               AND aa.desired_section_label IS NOT NULL
               AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
              WHERE aa.school_id = $1
                AND COALESCE(dc.section_id, ds.id) = $2
              ORDER BY aa.created_at DESC
              LIMIT 8
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                COUNT(*) FILTER (WHERE aa.current_status = 'inquiry')::int AS inquiry_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'applied')::int AS applied_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'under_review')::int AS under_review_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'accepted')::int AS accepted_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'waitlisted')::int AS waitlisted_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'admitted')::int AS admitted_count,
                COUNT(*) FILTER (WHERE aa.current_status = 'rejected')::int AS rejected_count
              FROM admission_applications aa
              LEFT JOIN classrooms dc
                ON dc.id = aa.desired_classroom_id
               AND dc.school_id = aa.school_id
              LEFT JOIN school_sections ds
                ON ds.school_id = aa.school_id
               AND dc.id IS NULL
               AND aa.desired_section_label IS NOT NULL
               AND LOWER(aa.desired_section_label) IN (LOWER(ds.name), LOWER(ds.code))
              WHERE aa.school_id = $1
                AND COALESCE(dc.section_id, ds.id) = $2
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                COUNT(te.id)::int AS entries_count,
                COUNT(DISTINCT te.classroom_id)::int AS classrooms_with_timetable,
                COUNT(tsb.id) FILTER (
                  WHERE tsb.is_active = TRUE
                    AND tsb.substitution_date >= CURRENT_DATE - INTERVAL '7 days'
                )::int AS substitutions_this_week
              FROM timetable_entries te
              JOIN classrooms c
                ON c.id = te.classroom_id
               AND c.school_id = te.school_id
              LEFT JOIN timetable_substitutions tsb
                ON tsb.school_id = te.school_id
               AND tsb.timetable_entry_id = te.id
              WHERE te.school_id = $1
                AND c.section_id = $2
                AND te.is_active = TRUE
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                te.id AS timetable_entry_id,
                c.id AS classroom_id,
                c.grade_label,
                c.section_label,
                s.name AS subject_name,
                COALESCE(NULLIF(BTRIM(CONCAT(tu.first_name, ' ', tu.last_name)), ''), tu.email) AS teacher_name,
                tp.label AS period_label,
                tp.period_number,
                ts.day_of_week,
                te.room_number
              FROM timetable_entries te
              JOIN classrooms c
                ON c.id = te.classroom_id
               AND c.school_id = te.school_id
              JOIN timetable_slots ts
                ON ts.id = te.slot_id
               AND ts.school_id = te.school_id
              JOIN timetable_periods tp
                ON tp.id = ts.period_id
               AND tp.school_id = ts.school_id
              LEFT JOIN subjects s
                ON s.id = te.subject_id
               AND s.school_id = te.school_id
              LEFT JOIN teachers tt
                ON tt.id = te.teacher_id
               AND tt.school_id = te.school_id
              LEFT JOIN users tu
                ON tu.id = tt.user_id
              WHERE te.school_id = $1
                AND c.section_id = $2
                AND te.is_active = TRUE
              ORDER BY ts.day_of_week ASC, tp.period_number ASC, c.grade_label ASC, c.section_label ASC
              LIMIT 12
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
          pool.query(
            `
              SELECT
                COUNT(*) FILTER (WHERE se.status <> 'active')::int AS inactive_enrollments,
                COUNT(*) FILTER (WHERE se.status = 'transferred')::int AS transferred_students,
                COUNT(*) FILTER (WHERE se.status = 'promoted')::int AS promoted_students,
                COUNT(*) FILTER (WHERE se.status = 'withdrawn')::int AS withdrawn_students
              FROM student_enrollments se
              JOIN classrooms c
                ON c.id = se.classroom_id
               AND c.school_id = se.school_id
              WHERE se.school_id = $1
                AND c.section_id = $2
            `,
            [req.auth.schoolId, selectedSectionId]
          ),
        ]);

      const classAttendance = classAttendanceResult.rows.map((row) => {
        const total = Number(row.attendance_records_today) || 0;
        const present = Number(row.present_count) || 0;
        const attendanceRate = total > 0 ? (present / total) * 100 : 0;
        return {
          classroom_id: row.classroom_id,
          classroom_label: `${row.grade_label} - ${row.section_label}`,
          classroom_code: row.classroom_code,
          room_number: row.room_number,
          homeroom_teacher_name: row.homeroom_teacher_name,
          active_students: Number(row.active_students) || 0,
          attendance_records_today: total,
          present_count: present,
          late_count: Number(row.late_count) || 0,
          absent_count: Number(row.absent_count) || 0,
          leave_count: Number(row.leave_count) || 0,
          attendance_rate: Number(attendanceRate.toFixed(2)),
        };
      });

      const completionRow = teacherCompletionResult.rows[0] || {};
      const staffAttendanceSummary = staffAttendanceSummaryResult.rows[0] || {};
      const parentAccess = parentAccessResult.rows[0] || {};
      const admissionsSummary = admissionsSummaryResult.rows[0] || {};
      const timetableSummary = timetableSummaryResult.rows[0] || {};
      const movementSummary = movementSummaryResult.rows[0] || {};
      const studentAttendanceSummary = {
        total: classAttendance.reduce((sum, row) => sum + (row.attendance_records_today || 0), 0),
        present_count: classAttendance.reduce((sum, row) => sum + (row.present_count || 0), 0),
        late_count: classAttendance.reduce((sum, row) => sum + (row.late_count || 0), 0),
        absent_count: classAttendance.reduce((sum, row) => sum + (row.absent_count || 0), 0),
        leave_count: classAttendance.reduce((sum, row) => sum + (row.leave_count || 0), 0),
      };
      selectedSectionDetail = {
        section: selectedSectionRow,
        leadership: {
          head_user_id: selectedSectionRow?.head_user_id || null,
          head_name: selectedSectionRow?.head_name || null,
          coordinator_user_id: selectedSectionRow?.coordinator_user_id || null,
          coordinator_name: selectedSectionRow?.coordinator_name || null,
        },
        parent_access_summary: {
          active_students: Number(parentAccess.active_students) || 0,
          linked_parents: Number(parentAccess.linked_parents) || 0,
        },
        student_attendance_today: studentAttendanceSummary,
        staff_attendance_today: {
          total: Number(staffAttendanceSummary.total) || 0,
          present_count: Number(staffAttendanceSummary.present_count) || 0,
          late_count: Number(staffAttendanceSummary.late_count) || 0,
          absent_count: Number(staffAttendanceSummary.absent_count) || 0,
          leave_count: Number(staffAttendanceSummary.leave_count) || 0,
        },
        class_attendance: classAttendance,
        teacher_completion: {
          assigned_staff: Number(completionRow.assigned_staff) || 0,
          homework_total_submissions: Number(completionRow.homework_total_submissions) || 0,
          homework_completed_submissions: Number(completionRow.homework_completed_submissions) || 0,
          homework_missing_submissions: Number(completionRow.homework_missing_submissions) || 0,
          marks_assessments_count: Number(completionRow.marks_assessments_count) || 0,
          marks_scores_count: Number(completionRow.marks_scores_count) || 0,
        },
        staff_profiles: staffRosterResult.rows.map((row) => ({
          staff_profile_id: row.staff_profile_id,
          user_id: row.user_id,
          staff_code: row.staff_code,
          staff_type: row.staff_type,
          designation: row.designation,
          department: row.department,
          employment_status: row.employment_status,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          attendance_status: row.attendance_status,
          check_in_at: row.check_in_at,
          check_out_at: row.check_out_at,
        })),
        late_absent_students: lateAbsentResult.rows.map((row) => ({
          attendance_record_id: row.attendance_record_id,
          student_id: row.student_id,
          student_code: row.student_code,
          first_name: row.first_name,
          last_name: row.last_name,
          status: row.status,
          check_in_at: row.check_in_at,
          classroom_id: row.classroom_id,
          classroom_label: `${row.grade_label} - ${row.section_label}`,
        })),
        upcoming_events: eventsResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          event_type: row.event_type,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          target_scope: row.target_scope,
          target_classroom_id: row.target_classroom_id,
          classroom_label:
            row.grade_label && row.section_label
              ? `${row.grade_label} - ${row.section_label}`
              : null,
        })),
        announcements: announcementsResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          event_type: row.event_type,
          starts_at: row.starts_at,
          target_scope: row.target_scope,
          target_classroom_id: row.target_classroom_id,
          classroom_label:
            row.grade_label && row.section_label
              ? `${row.grade_label} - ${row.section_label}`
              : null,
        })),
        result_progress_by_term: resultsByTermResult.rows.map((row) => ({
          exam_term_id: row.exam_term_id,
          term_name: row.term_name,
          term_type: row.term_type,
          starts_on: row.starts_on,
          ends_on: row.ends_on,
          total_report_cards: Number(row.total_report_cards) || 0,
          published_report_cards: Number(row.published_report_cards) || 0,
          draft_report_cards: Number(row.draft_report_cards) || 0,
          average_percentage: Number(row.average_percentage) || 0,
        })),
        admissions_summary: {
          inquiry_count: Number(admissionsSummary.inquiry_count) || 0,
          applied_count: Number(admissionsSummary.applied_count) || 0,
          under_review_count: Number(admissionsSummary.under_review_count) || 0,
          accepted_count: Number(admissionsSummary.accepted_count) || 0,
          waitlisted_count: Number(admissionsSummary.waitlisted_count) || 0,
          admitted_count: Number(admissionsSummary.admitted_count) || 0,
          rejected_count: Number(admissionsSummary.rejected_count) || 0,
        },
        admission_records: admissionRecordsResult.rows.map((row) => ({
          id: row.id,
          student_id: row.student_id,
          student_code: row.student_code,
          student_name: [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
          guardian_name: row.guardian_name,
          guardian_phone: row.guardian_phone,
          current_status: row.current_status,
          created_at: row.created_at,
          desired_grade_label: row.desired_grade_actual || row.desired_grade_label || null,
          desired_section_label: row.desired_section_actual || row.desired_section_label || null,
        })),
        timetable_summary: {
          entries_count: Number(timetableSummary.entries_count) || 0,
          classrooms_with_timetable: Number(timetableSummary.classrooms_with_timetable) || 0,
          substitutions_this_week: Number(timetableSummary.substitutions_this_week) || 0,
        },
        timetable_preview: timetablePreviewResult.rows.map((row) => ({
          timetable_entry_id: row.timetable_entry_id,
          classroom_id: row.classroom_id,
          classroom_label: `${row.grade_label} - ${row.section_label}`,
          subject_name: row.subject_name,
          teacher_name: row.teacher_name,
          day_of_week: Number(row.day_of_week) || 0,
          period_label: row.period_label,
          period_number: Number(row.period_number) || 0,
          room_number: row.room_number,
        })),
        movement_summary: {
          inactive_enrollments: Number(movementSummary.inactive_enrollments) || 0,
          transferred_students: Number(movementSummary.transferred_students) || 0,
          promoted_students: Number(movementSummary.promoted_students) || 0,
          withdrawn_students: Number(movementSummary.withdrawn_students) || 0,
        },
      };
    }

    return success(
      res,
      {
        sections,
        selected_section_id: selectedSectionId,
        selected_section_detail: selectedSectionDetail,
        generated_at: new Date().toISOString(),
      },
      200
    );
  })
);

module.exports = router;
