BEGIN;

-- =====================================================
-- Staff HR profile expansion
-- =====================================================
ALTER TABLE staff_profiles
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS employment_type TEXT,
  ADD COLUMN IF NOT EXISTS contract_type TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_date DATE,
  ADD COLUMN IF NOT EXISTS work_location TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_title TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_identifier TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_profiles_school_department
  ON staff_profiles(school_id, department, employment_status);

-- =====================================================
-- Staff status lifecycle history
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  reason TEXT,
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_status_history_school_staff
  ON staff_status_history(school_id, staff_profile_id, changed_at DESC);

-- =====================================================
-- Salary structures (history-preserving)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  effective_to DATE,
  base_salary NUMERIC(12,2) NOT NULL CHECK (base_salary >= 0),
  allowances_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  deductions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  bonuses_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  provident_fund NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (provident_fund >= 0),
  gop_fund NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (gop_fund >= 0),
  currency_code TEXT NOT NULL DEFAULT 'PKR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_salary_structures_school_staff
  ON staff_salary_structures(school_id, staff_profile_id, effective_from DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_salary_structures_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_salary_structures_updated_at
    BEFORE UPDATE ON staff_salary_structures
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Salary adjustments/increments
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_salary_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (
    adjustment_type IN ('increment', 'allowance', 'deduction', 'bonus', 'one_time')
  ),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  effective_on DATE NOT NULL,
  expires_on DATE,
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_on IS NULL OR expires_on >= effective_on)
);

CREATE INDEX IF NOT EXISTS idx_salary_adjustments_school_staff
  ON staff_salary_adjustments(school_id, staff_profile_id, effective_on DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_salary_adjustments_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_salary_adjustments_updated_at
    BEFORE UPDATE ON staff_salary_adjustments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Payroll periods and records
-- =====================================================
CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'closed', 'paid')),
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (school_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_school_status
  ON payroll_periods(school_id, status, period_start DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_payroll_periods_updated_at'
  ) THEN
    CREATE TRIGGER trg_payroll_periods_updated_at
    BEFORE UPDATE ON payroll_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  salary_structure_id UUID REFERENCES staff_salary_structures(id) ON DELETE SET NULL,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  allowances_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  provident_fund NUMERIC(12,2) NOT NULL DEFAULT 0,
  gop_fund NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'cancelled')),
  paid_on DATE,
  payment_method TEXT,
  finance_notes TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_period_id, staff_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_records_school_staff
  ON payroll_records(school_id, staff_profile_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payroll_records_school_status
  ON payroll_records(school_id, payment_status, generated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_payroll_records_updated_at'
  ) THEN
    CREATE TRIGGER trg_payroll_records_updated_at
    BEFORE UPDATE ON payroll_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Staff attendance and leave records (self-service support)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'leave')),
  note TEXT,
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, staff_profile_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_school_staff_date
  ON staff_attendance_logs(school_id, staff_profile_id, attendance_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_attendance_logs_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_attendance_logs_updated_at
    BEFORE UPDATE ON staff_attendance_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS staff_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'casual',
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  total_days NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (total_days > 0),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reason TEXT,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_school_staff_date
  ON staff_leave_records(school_id, staff_profile_id, starts_on DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_leave_records_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_leave_records_updated_at
    BEFORE UPDATE ON staff_leave_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- HR document hooks (Document Vault integration point)
-- =====================================================
CREATE TABLE IF NOT EXISTS staff_hr_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  document_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  expires_on DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_hr_documents_school_staff
  ON staff_hr_documents(school_id, staff_profile_id, category, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_staff_hr_documents_updated_at'
  ) THEN
    CREATE TRIGGER trg_staff_hr_documents_updated_at
    BEFORE UPDATE ON staff_hr_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Permission seeds for HR/Payroll module
-- =====================================================
INSERT INTO permissions (code, module, description)
VALUES
  ('people.hr.view', 'people', 'View HR staff records and leave/attendance summaries'),
  ('people.hr.manage', 'people', 'Manage HR staff records and employment lifecycle'),
  ('finance.payroll.view', 'finance', 'View payroll periods and payroll records'),
  ('finance.payroll.manage', 'finance', 'Manage payroll periods, salary structures and payments'),
  ('finance.payroll.self.view', 'finance', 'View own payroll and salary slips')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, scope_level, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  'school',
  CASE
    WHEN p.code = 'people.hr.view'
      THEN r.code IN ('school_admin', 'principal', 'vice_principal', 'hr_admin', 'accountant')
    WHEN p.code = 'people.hr.manage'
      THEN r.code IN ('school_admin', 'hr_admin')
    WHEN p.code = 'finance.payroll.view'
      THEN r.code IN ('school_admin', 'principal', 'hr_admin', 'accountant')
    WHEN p.code = 'finance.payroll.manage'
      THEN r.code IN ('school_admin', 'hr_admin', 'accountant')
    WHEN p.code = 'finance.payroll.self.view'
      THEN r.code = 'teacher'
    ELSE FALSE
  END AS can_view,
  CASE
    WHEN p.code IN ('people.hr.manage', 'finance.payroll.manage')
      THEN r.code IN ('school_admin', 'hr_admin', 'accountant')
    ELSE FALSE
  END AS can_create,
  CASE
    WHEN p.code IN ('people.hr.manage', 'finance.payroll.manage')
      THEN r.code IN ('school_admin', 'hr_admin', 'accountant')
    ELSE FALSE
  END AS can_edit,
  CASE
    WHEN p.code IN ('people.hr.manage', 'finance.payroll.manage')
      THEN r.code IN ('school_admin', 'hr_admin')
    ELSE FALSE
  END AS can_delete
FROM roles r
JOIN permissions p
  ON p.code IN (
    'people.hr.view',
    'people.hr.manage',
    'finance.payroll.view',
    'finance.payroll.manage',
    'finance.payroll.self.view'
  )
WHERE r.code IN ('school_admin', 'principal', 'vice_principal', 'hr_admin', 'accountant', 'teacher')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

COMMIT;
