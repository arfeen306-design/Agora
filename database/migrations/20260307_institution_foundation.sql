BEGIN;

-- =====================================================
-- Roles expansion (institution management layer)
-- =====================================================
INSERT INTO roles (code, description)
VALUES
  ('super_admin', 'Platform-wide super admin'),
  ('principal', 'School principal with leadership controls'),
  ('vice_principal', 'Vice principal with delegated leadership controls'),
  ('headmistress', 'Section head with section-scoped controls'),
  ('accountant', 'Finance and fees operations role'),
  ('front_desk', 'Admissions/front desk operations role'),
  ('hr_admin', 'HR and staff operations role')
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- School profile / setup enhancements
-- =====================================================
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS branch_name TEXT,
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS academic_year_label TEXT,
  ADD COLUMN IF NOT EXISTS school_starts_at TIME,
  ADD COLUMN IF NOT EXISTS school_ends_at TIME,
  ADD COLUMN IF NOT EXISTS weekly_holidays TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS late_arrival_cutoff TIME,
  ADD COLUMN IF NOT EXISTS attendance_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS principal_user_id UUID,
  ADD COLUMN IF NOT EXISTS vice_principal_user_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_principal_user_id_fkey'
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_principal_user_id_fkey
      FOREIGN KEY (principal_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_vice_principal_user_id_fkey'
  ) THEN
    ALTER TABLE schools
      ADD CONSTRAINT schools_vice_principal_user_id_fkey
      FOREIGN KEY (vice_principal_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================
-- Section model
-- =====================================================
CREATE TABLE IF NOT EXISTS school_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  section_type TEXT NOT NULL DEFAULT 'general',
  head_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  coordinator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  announcements_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sections_school_active
  ON school_sections(school_id, is_active, display_order, name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_school_sections_updated_at'
  ) THEN
    CREATE TRIGGER trg_school_sections_updated_at
    BEFORE UPDATE ON school_sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Classroom institutional hooks
-- =====================================================
ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS section_id UUID,
  ADD COLUMN IF NOT EXISTS classroom_code TEXT,
  ADD COLUMN IF NOT EXISTS room_number TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'classrooms_section_id_fkey'
  ) THEN
    ALTER TABLE classrooms
      ADD CONSTRAINT classrooms_section_id_fkey
      FOREIGN KEY (section_id) REFERENCES school_sections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_classrooms_school_year_code
  ON classrooms(school_id, academic_year_id, classroom_code)
  WHERE classroom_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_classrooms_school_section
  ON classrooms(school_id, section_id, academic_year_id, is_active);

-- =====================================================
-- Staff profiles and assignment model
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  staff_code TEXT NOT NULL,
  staff_type TEXT NOT NULL,
  designation TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active',
  joining_date DATE,
  reporting_manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  primary_section_id UUID REFERENCES school_sections(id) ON DELETE SET NULL,
  id_document_no TEXT,
  appointment_document_url TEXT,
  policy_acknowledged_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, staff_code)
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_school_type_status
  ON staff_profiles(school_id, staff_type, employment_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_profiles_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_profiles_updated_at
    BEFORE UPDATE ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_classroom_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  assignment_role TEXT NOT NULL DEFAULT 'teacher',
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_staff_assignment_school_staff
  ON staff_classroom_assignments(school_id, staff_profile_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_assignment_school_classroom
  ON staff_classroom_assignments(school_id, classroom_id, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_classroom_assignments_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_classroom_assignments_updated_at
    BEFORE UPDATE ON staff_classroom_assignments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Parent + student profile enrichment for people module
-- =====================================================
ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS guardian_name TEXT,
  ADD COLUMN IF NOT EXISTS father_name TEXT,
  ADD COLUMN IF NOT EXISTS mother_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS address_line TEXT,
  ADD COLUMN IF NOT EXISTS preferred_channel notification_channel NOT NULL DEFAULT 'in_app';

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS medical_alert TEXT,
  ADD COLUMN IF NOT EXISTS transport_info TEXT,
  ADD COLUMN IF NOT EXISTS admission_status TEXT NOT NULL DEFAULT 'admitted',
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- =====================================================
-- RBAC permission templates + delegation model
-- =====================================================
CREATE TABLE IF NOT EXISTS permissions (
  id SMALLSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT NOT NULL
);

INSERT INTO permissions (code, module, description)
VALUES
  ('institution.profile.view', 'institution', 'View school profile and setup'),
  ('institution.profile.manage', 'institution', 'Manage school profile and setup'),
  ('institution.sections.manage', 'institution', 'Manage sections and section ownership'),
  ('institution.classrooms.manage', 'institution', 'Manage classroom hierarchy and allocation'),
  ('people.staff.view', 'people', 'View staff records'),
  ('people.staff.manage', 'people', 'Create or update staff records'),
  ('people.students.view', 'people', 'View student master records'),
  ('people.students.manage', 'people', 'Create or update student records'),
  ('academics.attendance.manage', 'academics', 'Manage attendance records'),
  ('academics.homework.manage', 'academics', 'Manage homework lifecycle'),
  ('academics.marks.manage', 'academics', 'Manage assessments and marks'),
  ('finance.fees.view', 'finance', 'View fee records and summaries'),
  ('finance.fees.manage', 'finance', 'Manage fee plans, invoices, and payments'),
  ('leadership.principal.dashboard', 'leadership', 'Access principal command center'),
  ('leadership.section.dashboard', 'leadership', 'Access section operations dashboard'),
  ('rbac.permissions.manage', 'security', 'Manage role permissions'),
  ('rbac.delegation.manage', 'security', 'Create and revoke delegated permissions'),
  ('reports.analytics.view', 'reports', 'View analytics and exports'),
  ('audit.logs.view', 'security', 'View audit logs')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_level TEXT NOT NULL DEFAULT 'school',
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id, scope_level)
);

CREATE TABLE IF NOT EXISTS delegated_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id SMALLINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'school',
  scope_id UUID,
  grant_reason TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_delegated_permissions_school_target
  ON delegated_permissions(school_id, granted_to_user_id, is_active, starts_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_delegated_permissions_updated_at'
  ) THEN
    CREATE TRIGGER trg_delegated_permissions_updated_at
    BEFORE UPDATE ON delegated_permissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Bulk import job model (CSV/Excel engine foundation)
-- =====================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  import_type TEXT NOT NULL,
  source_format TEXT NOT NULL,
  source_file_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_school_type_status
  ON import_jobs(school_id, import_type, status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_import_jobs_updated_at'
  ) THEN
    CREATE TRIGGER trg_import_jobs_updated_at
    BEFORE UPDATE ON import_jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  field_name TEXT,
  issue TEXT NOT NULL,
  raw_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_errors_job_row
  ON import_errors(job_id, row_number);

-- =====================================================
-- Seed role-permission templates (idempotent)
-- =====================================================
INSERT INTO role_permissions (role_id, permission_id, scope_level, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, 'school',
  TRUE,
  CASE WHEN r.code IN ('school_admin', 'principal', 'super_admin') THEN TRUE ELSE FALSE END,
  CASE WHEN r.code IN ('school_admin', 'principal', 'super_admin') THEN TRUE ELSE FALSE END,
  CASE WHEN r.code IN ('school_admin', 'super_admin') THEN TRUE ELSE FALSE END
FROM roles r
JOIN permissions p ON p.code IN (
  'institution.profile.view',
  'institution.profile.manage',
  'institution.sections.manage',
  'institution.classrooms.manage',
  'people.staff.view',
  'people.staff.manage',
  'people.students.view',
  'people.students.manage',
  'leadership.principal.dashboard',
  'leadership.section.dashboard',
  'rbac.permissions.manage',
  'rbac.delegation.manage',
  'audit.logs.view'
)
WHERE r.code IN ('school_admin', 'super_admin', 'principal', 'vice_principal', 'headmistress', 'teacher', 'accountant', 'front_desk', 'hr_admin')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

COMMIT;
