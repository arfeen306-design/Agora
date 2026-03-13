-- Agora School Platform
-- Step 2: PostgreSQL Schema (Multi-school, MVP + scale-ready)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- ENUMS
-- =========================
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late', 'leave');
CREATE TYPE homework_submission_status AS ENUM ('assigned', 'submitted', 'reviewed', 'missing');
CREATE TYPE invoice_status AS ENUM ('draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled');
CREATE TYPE message_kind AS ENUM ('text', 'file', 'system');
CREATE TYPE notification_channel AS ENUM ('in_app', 'push', 'email', 'sms');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed', 'read');
CREATE TYPE conversation_kind AS ENUM ('direct', 'group', 'broadcast');

-- =========================
-- UTILITIES
-- =========================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- CORE TENANCY + AUTH
-- =========================
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  branch_group_id UUID, -- FK added after branch_groups table creation
  kpi_targets JSONB NOT NULL DEFAULT '{"attendance_rate_target":85,"marks_avg_target":60,"homework_completion_target":70}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, email),
  UNIQUE (school_id, phone)
);

CREATE TABLE roles (
  id SMALLSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

INSERT INTO roles (code, description)
VALUES
  ('school_admin', 'Full control within a school'),
  ('super_admin', 'Platform-level operations across schools'),
  ('principal', 'Leadership dashboard and approvals'),
  ('vice_principal', 'Leadership operations support'),
  ('headmistress', 'Section operations lead'),
  ('accountant', 'Finance and fee management'),
  ('front_desk', 'Admissions and inquiry workflow'),
  ('hr_admin', 'Staff and payroll operations'),
  ('teacher', 'Manages class operations'),
  ('class_teacher', 'Manages homeroom class operations and report cards'),
  ('parent', 'Views linked student data'),
  ('student', 'Student mobile app access')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- PEOPLE PROFILES
-- =========================
CREATE TABLE parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  occupation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  designation TEXT,
  joined_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, employee_code)
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT,
  date_of_birth DATE,
  gender TEXT,
  admission_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_code)
);

CREATE TABLE student_user_accounts (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE parent_students (
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'guardian',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_id, student_id)
);

-- =========================
-- ACADEMIC STRUCTURE
-- =========================
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on > starts_on),
  UNIQUE (school_id, name)
);

CREATE TABLE classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade_label TEXT NOT NULL,
  section_label TEXT NOT NULL,
  homeroom_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  capacity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (capacity IS NULL OR capacity > 0),
  UNIQUE (school_id, academic_year_id, grade_label, section_label)
);

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, code),
  UNIQUE (school_id, name)
);

CREATE TABLE classroom_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, classroom_id, subject_id)
);

CREATE TABLE student_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  roll_no INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  joined_on DATE,
  left_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, academic_year_id),
  UNIQUE (school_id, classroom_id, academic_year_id, roll_no)
);

-- =========================
-- ATTENDANCE
-- =========================
CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  status attendance_status NOT NULL,
  check_in_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | rfid | qr | face
  note TEXT,
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, attendance_date)
);

-- =========================
-- HOMEWORK
-- =========================
CREATE TABLE homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  attachment_urls JSONB NOT NULL DEFAULT '[]'::JSONB,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id UUID NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status homework_submission_status NOT NULL DEFAULT 'assigned',
  submitted_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ,
  score NUMERIC(5,2),
  feedback TEXT,
  attachment_urls JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  UNIQUE (school_id, homework_id, student_id)
);

-- =========================
-- MARKS / ASSESSMENTS
-- =========================
CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  assessment_type TEXT NOT NULL, -- quiz | assignment | monthly | term
  max_marks NUMERIC(7,2) NOT NULL CHECK (max_marks > 0),
  assessment_date DATE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assessment_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks_obtained NUMERIC(7,2) NOT NULL CHECK (marks_obtained >= 0),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, assessment_id, student_id)
);

-- =========================
-- MESSAGING
-- =========================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind conversation_kind NOT NULL,
  title TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_conversation TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind message_kind NOT NULL DEFAULT 'text',
  body TEXT,
  attachment_urls JSONB NOT NULL DEFAULT '[]'::JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

-- =========================
-- NOTIFICATIONS
-- =========================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'in_app',
  status notification_status NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE push_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'fcm', -- fcm
  platform TEXT NOT NULL, -- android | ios | web
  device_token TEXT NOT NULL,
  device_id TEXT,
  app_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, device_token)
);

-- =========================
-- FEES
-- =========================
CREATE TABLE fee_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_day SMALLINT CHECK (due_day BETWEEN 1 AND 31),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fee_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_plan_id UUID REFERENCES fee_plans(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date DATE NOT NULL,
  status invoice_status NOT NULL DEFAULT 'issued',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CHECK (amount_paid <= amount_due)
);

CREATE TABLE fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES fee_invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  method TEXT NOT NULL, -- cash | bank | online
  reference_no TEXT,
  received_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- EVENTS
-- =========================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'general',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  target_scope TEXT NOT NULL DEFAULT 'school', -- school | classroom
  target_classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- =========================
-- AUDIT TRAIL
-- =========================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- INDEXES (QUERY HOT PATHS)
-- =========================
CREATE INDEX idx_users_school_active ON users(school_id, is_active);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX idx_students_school_code ON students(school_id, student_code);
CREATE INDEX idx_parent_students_student ON parent_students(student_id);
CREATE INDEX idx_enrollments_classroom_year ON student_enrollments(classroom_id, academic_year_id);

CREATE INDEX idx_attendance_student_date ON attendance_records(student_id, attendance_date DESC);
CREATE INDEX idx_attendance_classroom_date ON attendance_records(classroom_id, attendance_date DESC);
CREATE INDEX idx_attendance_school_status_date ON attendance_records(school_id, status, attendance_date DESC);

CREATE INDEX idx_homework_class_due ON homework(classroom_id, due_at);
CREATE INDEX idx_hw_submissions_student_status ON homework_submissions(student_id, status);
CREATE INDEX idx_hw_submissions_homework ON homework_submissions(homework_id);

CREATE INDEX idx_assessment_scores_student ON assessment_scores(student_id);
CREATE INDEX idx_assessments_class_subject ON assessments(classroom_id, subject_id, assessment_date DESC);

CREATE INDEX idx_messages_conversation_sent ON messages(conversation_id, sent_at DESC);
CREATE INDEX idx_messages_school_sent ON messages(school_id, sent_at DESC);

CREATE INDEX idx_notifications_user_status ON notifications(user_id, status, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_push_tokens_user_active ON push_device_tokens(user_id, is_active, last_seen_at DESC);
CREATE INDEX idx_push_tokens_school_provider ON push_device_tokens(school_id, provider, is_active);

CREATE INDEX idx_fee_invoices_student_status ON fee_invoices(student_id, status, due_date);
CREATE INDEX idx_fee_payments_invoice ON fee_payments(invoice_id);

CREATE INDEX idx_events_school_start ON events(school_id, starts_at);
CREATE INDEX idx_audit_school_time ON audit_logs(school_id, created_at DESC);

-- =========================
-- UPDATED_AT TRIGGERS
-- =========================
CREATE TRIGGER trg_schools_updated_at
BEFORE UPDATE ON schools
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_parents_updated_at
BEFORE UPDATE ON parents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_teachers_updated_at
BEFORE UPDATE ON teachers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_students_updated_at
BEFORE UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_academic_years_updated_at
BEFORE UPDATE ON academic_years
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_classrooms_updated_at
BEFORE UPDATE ON classrooms
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subjects_updated_at
BEFORE UPDATE ON subjects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_student_enrollments_updated_at
BEFORE UPDATE ON student_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_attendance_records_updated_at
BEFORE UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_homework_updated_at
BEFORE UPDATE ON homework
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_homework_submissions_updated_at
BEFORE UPDATE ON homework_submissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assessments_updated_at
BEFORE UPDATE ON assessments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assessment_scores_updated_at
BEFORE UPDATE ON assessment_scores
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_push_device_tokens_updated_at
BEFORE UPDATE ON push_device_tokens
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fee_plans_updated_at
BEFORE UPDATE ON fee_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_fee_invoices_updated_at
BEFORE UPDATE ON fee_invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- SUBSCRIPTIONS & PLATFORM BILLING
-- =========================
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'annual');
CREATE TYPE platform_invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue', 'cancelled');
CREATE TYPE platform_payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_monthly >= 0),
  price_annual NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_annual >= 0),
  max_students INT NOT NULL DEFAULT 50,
  max_staff INT NOT NULL DEFAULT 10,
  max_storage_gb INT NOT NULL DEFAULT 1,
  ai_tutor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  api_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_branding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order SMALLINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE school_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  billing_cycle billing_cycle NOT NULL DEFAULT 'monthly',
  status subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  payment_gateway TEXT,
  gateway_subscription_id TEXT,
  gateway_customer_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_school_subscriptions_active UNIQUE (school_id)
);

CREATE TABLE platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES school_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  currency TEXT NOT NULL DEFAULT 'PKR',
  status platform_invoice_status NOT NULL DEFAULT 'draft',
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CHECK (amount_paid <= amount_due + tax)
);

CREATE TABLE platform_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL,
  gateway_payment_id TEXT,
  gateway_ref TEXT,
  status platform_payment_status NOT NULL DEFAULT 'completed',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscription_plans_active ON subscription_plans(is_active, display_order);
CREATE INDEX idx_school_subscriptions_school ON school_subscriptions(school_id);
CREATE INDEX idx_school_subscriptions_status ON school_subscriptions(status) WHERE status IN ('active', 'trialing');
CREATE INDEX idx_platform_invoices_school ON platform_invoices(school_id, status, due_date);
CREATE INDEX idx_platform_invoices_number ON platform_invoices(invoice_number);
CREATE INDEX idx_platform_payments_invoice ON platform_payments(invoice_id);

CREATE TRIGGER trg_subscription_plans_updated_at
BEFORE UPDATE ON subscription_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_school_subscriptions_updated_at
BEFORE UPDATE ON school_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_platform_invoices_updated_at
BEFORE UPDATE ON platform_invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- MULTI-BRANCH & ANALYTICS
-- =========================
CREATE TABLE branch_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE branch_group_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_group_id UUID NOT NULL REFERENCES branch_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_group_id, user_id)
);

-- Add branch group linkage and KPI targets to schools
-- (ALTER statements for migration compat; columns are included inline for fresh deploys)
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS branch_group_id UUID REFERENCES branch_groups(id) ON DELETE SET NULL;
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS kpi_targets JSONB NOT NULL DEFAULT '{"attendance_rate_target":85,"marks_avg_target":60,"homework_completion_target":70}';

CREATE INDEX idx_schools_branch_group ON schools(branch_group_id) WHERE branch_group_id IS NOT NULL;
CREATE INDEX idx_branch_group_admins_user ON branch_group_admins(user_id);
CREATE INDEX idx_branch_group_admins_group ON branch_group_admins(branch_group_id);

CREATE TRIGGER trg_branch_groups_updated_at
BEFORE UPDATE ON branch_groups
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- NOTIFICATION EXPANSION
-- =========================
CREATE TABLE scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'in_app',
  target_type TEXT NOT NULL CHECK (target_type IN ('role', 'user', 'classroom', 'all')),
  target_id TEXT,
  send_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'in_app',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, user_id, event_type, channel)
);

CREATE INDEX idx_scheduled_notifications_school_status ON scheduled_notifications(school_id, status, send_at);
CREATE INDEX idx_scheduled_notifications_pending ON scheduled_notifications(send_at) WHERE status = 'pending';
CREATE INDEX idx_notification_preferences_user ON notification_preferences(school_id, user_id);

CREATE TRIGGER trg_scheduled_notifications_updated_at
BEFORE UPDATE ON scheduled_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- TRANSPORT
-- =========================
CREATE TABLE transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_name TEXT NOT NULL,
  route_code TEXT,
  description TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'daily' CHECK (schedule_type IN ('daily', 'weekdays', 'custom')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, route_code)
);

CREATE TABLE transport_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_name TEXT NOT NULL,
  stop_order INT NOT NULL DEFAULT 0,
  pickup_time TIME,
  dropoff_time TIME,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transport_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  vehicle_number TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'bus' CHECK (vehicle_type IN ('bus', 'van', 'car', 'other')),
  capacity INT NOT NULL DEFAULT 40,
  driver_name TEXT,
  driver_phone TEXT,
  driver_license TEXT,
  route_id UUID REFERENCES transport_routes(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, vehicle_number)
);

CREATE TABLE transport_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_id UUID REFERENCES transport_stops(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('pickup', 'dropoff', 'both')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, route_id, direction)
);

CREATE INDEX idx_transport_routes_school ON transport_routes(school_id, is_active);
CREATE INDEX idx_transport_stops_route ON transport_stops(route_id, stop_order);
CREATE INDEX idx_transport_vehicles_school ON transport_vehicles(school_id, is_active);
CREATE INDEX idx_transport_assignments_student ON transport_assignments(school_id, student_id);
CREATE INDEX idx_transport_assignments_route ON transport_assignments(route_id, is_active);

CREATE TRIGGER trg_transport_routes_updated_at BEFORE UPDATE ON transport_routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_stops_updated_at BEFORE UPDATE ON transport_stops FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_vehicles_updated_at BEFORE UPDATE ON transport_vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transport_assignments_updated_at BEFORE UPDATE ON transport_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- LIBRARY
-- =========================
CREATE TABLE library_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  publisher TEXT,
  edition TEXT,
  publish_year INT,
  total_copies INT NOT NULL DEFAULT 1,
  available_copies INT NOT NULL DEFAULT 1,
  shelf_location TEXT,
  description TEXT,
  cover_image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE library_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('student', 'staff')),
  member_id UUID NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'returned', 'overdue', 'lost')),
  fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  fine_paid BOOLEAN NOT NULL DEFAULT FALSE,
  issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  returned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_library_books_school ON library_books(school_id, is_active);
CREATE INDEX idx_library_books_isbn ON library_books(school_id, isbn) WHERE isbn IS NOT NULL;
CREATE INDEX idx_library_transactions_book ON library_transactions(book_id, status);
CREATE INDEX idx_library_transactions_member ON library_transactions(school_id, member_type, member_id);
CREATE INDEX idx_library_transactions_overdue ON library_transactions(due_at) WHERE status = 'issued';

CREATE TRIGGER trg_library_books_updated_at BEFORE UPDATE ON library_books FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_library_transactions_updated_at BEFORE UPDATE ON library_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- LEAVE REQUESTS (self-service)
-- =========================
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_profile_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL DEFAULT 'casual' CHECK (leave_type IN ('casual', 'sick', 'annual', 'maternity', 'paternity', 'unpaid', 'other')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  total_days NUMERIC(5,1) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leave_requests_staff ON leave_requests(school_id, user_id, status);
CREATE INDEX idx_leave_requests_pending ON leave_requests(school_id, status) WHERE status = 'pending';

CREATE TRIGGER trg_leave_requests_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- AI TUTOR
-- =========================
CREATE TABLE tutor_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_subjects UUID[] NOT NULL DEFAULT '{}',
  system_prompt_override TEXT,
  difficulty_level TEXT NOT NULL DEFAULT 'adaptive' CHECK (difficulty_level IN ('easy', 'medium', 'hard', 'adaptive')),
  max_messages_per_session INT NOT NULL DEFAULT 50,
  max_sessions_per_day INT NOT NULL DEFAULT 10,
  allowed_roles TEXT[] NOT NULL DEFAULT '{student}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id)
);

CREATE TABLE tutor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
  summary TEXT,
  message_count INT NOT NULL DEFAULT 0,
  total_tokens_used INT NOT NULL DEFAULT 0,
  model_used TEXT,
  context_snapshot JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tutor_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_count INT NOT NULL DEFAULT 0,
  model TEXT,
  latency_ms INT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tutor_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  grade_label TEXT,
  topic TEXT NOT NULL,
  learning_objectives TEXT[],
  curriculum_notes TEXT,
  difficulty_level TEXT DEFAULT 'medium',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tutor_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id UUID REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  cost_estimate NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tutor_sessions_student ON tutor_sessions(school_id, student_id, status);
CREATE INDEX idx_tutor_sessions_user ON tutor_sessions(school_id, user_id);
CREATE INDEX idx_tutor_sessions_subject ON tutor_sessions(school_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_tutor_messages_session ON tutor_messages(session_id, created_at);
CREATE INDEX idx_tutor_contexts_school ON tutor_contexts(school_id, subject_id);
CREATE INDEX idx_tutor_usage_school_month ON tutor_usage_logs(school_id, created_at);
CREATE INDEX idx_tutor_usage_user ON tutor_usage_logs(user_id, created_at);

CREATE TRIGGER trg_tutor_configs_updated_at BEFORE UPDATE ON tutor_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutor_sessions_updated_at BEFORE UPDATE ON tutor_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutor_contexts_updated_at BEFORE UPDATE ON tutor_contexts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- MOBILE
-- =========================
CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  device_model TEXT,
  os_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_token)
);

CREATE TABLE app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  min_app_version TEXT NOT NULL DEFAULT '1.0.0',
  latest_app_version TEXT NOT NULL DEFAULT '1.0.0',
  force_update BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message TEXT,
  app_store_url TEXT,
  play_store_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id)
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id, is_active);
CREATE INDEX idx_user_devices_token ON user_devices(device_token);
CREATE INDEX idx_user_devices_school ON user_devices(school_id, platform);

CREATE TRIGGER trg_user_devices_updated_at BEFORE UPDATE ON user_devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_configs_updated_at BEFORE UPDATE ON app_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- OPTIONAL SECURITY NOTE
-- =========================
-- For production, enable RLS and enforce school isolation:
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY users_school_isolation ON users
--   USING (school_id = current_setting('app.current_school_id')::UUID);

COMMIT;
