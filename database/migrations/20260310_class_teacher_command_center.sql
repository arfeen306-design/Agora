BEGIN;

-- =====================================================
-- Exam Terms
-- =====================================================
CREATE TABLE IF NOT EXISTS exam_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  term_type TEXT NOT NULL CHECK (term_type IN ('midterm', 'final', 'monthly')),
  starts_on DATE,
  ends_on DATE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, academic_year_id, name),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_exam_terms_school_year
  ON exam_terms(school_id, academic_year_id, is_locked);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exam_terms_updated_at'
  ) THEN
    CREATE TRIGGER trg_exam_terms_updated_at
    BEFORE UPDATE ON exam_terms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Link assessments to exam terms (backward compatible)
-- =====================================================
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS exam_term_id UUID REFERENCES exam_terms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_exam_term
  ON assessments(exam_term_id)
  WHERE exam_term_id IS NOT NULL;

-- =====================================================
-- Grading Scales
-- =====================================================
CREATE TABLE IF NOT EXISTS grading_scales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_grading_scales_updated_at'
  ) THEN
    CREATE TRIGGER trg_grading_scales_updated_at
    BEFORE UPDATE ON grading_scales
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS grading_scale_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_scale_id UUID NOT NULL REFERENCES grading_scales(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  min_percentage NUMERIC(5,2) NOT NULL,
  max_percentage NUMERIC(5,2) NOT NULL,
  gpa_points NUMERIC(3,1),
  sort_order SMALLINT NOT NULL DEFAULT 0,
  CHECK (max_percentage >= min_percentage),
  UNIQUE (grading_scale_id, grade)
);

CREATE INDEX IF NOT EXISTS idx_grading_scale_bands_scale
  ON grading_scale_bands(grading_scale_id, sort_order);

-- =====================================================
-- Report Cards
-- =====================================================
CREATE TABLE IF NOT EXISTS report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  exam_term_id UUID NOT NULL REFERENCES exam_terms(id) ON DELETE CASCADE,
  grading_scale_id UUID REFERENCES grading_scales(id) ON DELETE SET NULL,
  total_marks_obtained NUMERIC(8,2),
  total_max_marks NUMERIC(8,2),
  percentage NUMERIC(5,2),
  grade TEXT,
  attendance_present INTEGER DEFAULT 0,
  attendance_total INTEGER DEFAULT 0,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  generated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, exam_term_id)
);

CREATE INDEX IF NOT EXISTS idx_report_cards_classroom_term
  ON report_cards(classroom_id, exam_term_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_student_status
  ON report_cards(student_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_report_cards_updated_at'
  ) THEN
    CREATE TRIGGER trg_report_cards_updated_at
    BEFORE UPDATE ON report_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Report Card Subject Details (per-subject breakdown)
-- =====================================================
CREATE TABLE IF NOT EXISTS report_card_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_card_id UUID NOT NULL REFERENCES report_cards(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL,
  marks_obtained NUMERIC(8,2) NOT NULL DEFAULT 0,
  max_marks NUMERIC(8,2) NOT NULL DEFAULT 0,
  percentage NUMERIC(5,2),
  grade TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (report_card_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_report_card_subjects_card
  ON report_card_subjects(report_card_id, sort_order);

-- =====================================================
-- Permissions for class teacher module
-- =====================================================
INSERT INTO permissions (code, module, description)
VALUES
  ('class_teacher.dashboard.view', 'academics', 'Access class teacher command center'),
  ('class_teacher.attendance.manage', 'academics', 'Manage class attendance as class teacher'),
  ('class_teacher.subjects.manage', 'academics', 'Manage subject-teacher assignments for own class'),
  ('exam_terms.manage', 'academics', 'Create and manage exam terms'),
  ('report_cards.manage', 'academics', 'Generate and manage report cards'),
  ('report_cards.view', 'academics', 'View report cards')
ON CONFLICT (code) DO NOTHING;

-- Assign class teacher permissions to appropriate roles
INSERT INTO role_permissions (role_id, permission_id, scope_level, can_view, can_create, can_edit, can_delete)
SELECT r.id, p.id, 'school',
  TRUE,
  CASE
    WHEN p.code = 'class_teacher.dashboard.view'
      THEN FALSE
    WHEN p.code = 'report_cards.view'
      THEN FALSE
    WHEN p.code IN ('class_teacher.attendance.manage', 'class_teacher.subjects.manage', 'report_cards.manage')
      AND r.code IN ('school_admin', 'principal', 'teacher')
      THEN TRUE
    WHEN p.code = 'exam_terms.manage'
      AND r.code IN ('school_admin', 'principal', 'teacher')
      THEN TRUE
    ELSE FALSE
  END,
  CASE
    WHEN p.code IN ('class_teacher.attendance.manage', 'class_teacher.subjects.manage', 'report_cards.manage')
      AND r.code IN ('school_admin', 'principal', 'teacher')
      THEN TRUE
    WHEN p.code = 'exam_terms.manage'
      AND r.code IN ('school_admin', 'principal')
      THEN TRUE
    ELSE FALSE
  END,
  CASE
    WHEN p.code IN ('class_teacher.subjects.manage', 'exam_terms.manage')
      AND r.code IN ('school_admin', 'principal')
      THEN TRUE
    ELSE FALSE
  END
FROM roles r
JOIN permissions p ON p.code IN (
  'class_teacher.dashboard.view',
  'class_teacher.attendance.manage',
  'class_teacher.subjects.manage',
  'exam_terms.manage',
  'report_cards.manage',
  'report_cards.view'
)
WHERE r.code IN ('school_admin', 'principal', 'vice_principal', 'headmistress', 'teacher', 'parent', 'student')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

-- =====================================================
-- Seed O-Level grading scale for demo school
-- =====================================================
INSERT INTO grading_scales (id, school_id, name, is_default)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'O-Level (Cambridge IGCSE)', TRUE),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'A-Level (Cambridge)', FALSE)
ON CONFLICT (school_id, name) DO NOTHING;

-- O-Level bands
INSERT INTO grading_scale_bands (grading_scale_id, grade, min_percentage, max_percentage, gpa_points, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'A*', 90.00, 100.00, 4.0, 1),
  ('a0000000-0000-0000-0000-000000000001', 'A',  80.00, 89.99,  4.0, 2),
  ('a0000000-0000-0000-0000-000000000001', 'B',  70.00, 79.99,  3.0, 3),
  ('a0000000-0000-0000-0000-000000000001', 'C',  60.00, 69.99,  2.0, 4),
  ('a0000000-0000-0000-0000-000000000001', 'D',  50.00, 59.99,  1.0, 5),
  ('a0000000-0000-0000-0000-000000000001', 'E',  40.00, 49.99,  0.0, 6),
  ('a0000000-0000-0000-0000-000000000001', 'U',   0.00, 39.99, NULL, 7)
ON CONFLICT (grading_scale_id, grade) DO NOTHING;

-- A-Level bands
INSERT INTO grading_scale_bands (grading_scale_id, grade, min_percentage, max_percentage, gpa_points, sort_order)
VALUES
  ('a0000000-0000-0000-0000-000000000002', 'A*', 90.00, 100.00, 4.0, 1),
  ('a0000000-0000-0000-0000-000000000002', 'A',  80.00, 89.99,  4.0, 2),
  ('a0000000-0000-0000-0000-000000000002', 'B',  70.00, 79.99,  3.0, 3),
  ('a0000000-0000-0000-0000-000000000002', 'C',  60.00, 69.99,  2.0, 4),
  ('a0000000-0000-0000-0000-000000000002', 'D',  50.00, 59.99,  1.0, 5),
  ('a0000000-0000-0000-0000-000000000002', 'E',  40.00, 49.99,  0.0, 6),
  ('a0000000-0000-0000-0000-000000000002', 'U',   0.00, 39.99, NULL, 7)
ON CONFLICT (grading_scale_id, grade) DO NOTHING;

-- =====================================================
-- Seed demo exam term for demo school
-- =====================================================
INSERT INTO exam_terms (id, school_id, academic_year_id, name, term_type)
VALUES
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Midterm', 'midterm'),
  ('b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Final Term', 'final')
ON CONFLICT (school_id, academic_year_id, name) DO NOTHING;

COMMIT;
