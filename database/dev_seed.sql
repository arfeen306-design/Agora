-- Agora development seed data
-- Apply after agora_schema.sql

BEGIN;

INSERT INTO schools (id, code, name, timezone, is_active)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'agora_demo', 'Agora Demo School', 'Asia/Karachi', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO users (
  id,
  school_id,
  email,
  phone,
  password_hash,
  first_name,
  last_name,
  is_active
)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'admin@agora.com',
    '+920000000001',
    'admin123',
    'Agora',
    'Admin',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'teacher1@agora.com',
    '+920000000002',
    'teach123',
    'Areeba',
    'Khan',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'student1@agora.com',
    '+920000000004',
    'student123',
    'Zain',
    'Ahmed',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'parent1@agora.com',
    '+920000000003',
    'pass123',
    'Ali',
    'Raza',
    TRUE
  )
ON CONFLICT (school_id, email) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000001', id FROM roles WHERE code = 'school_admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000002', id FROM roles WHERE code = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000003', id FROM roles WHERE code = 'parent'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000004', id FROM roles WHERE code = 'student'
ON CONFLICT DO NOTHING;

INSERT INTO teachers (id, school_id, user_id, employee_code, designation, joined_on)
VALUES (
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  'T-001',
  'Math Teacher',
  '2025-08-01'
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO parents (id, school_id, user_id, occupation)
VALUES (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  'Engineer'
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO students (id, school_id, student_code, first_name, last_name, date_of_birth, gender, admission_date, status)
VALUES
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'STD-001',
    'Zain',
    'Ahmed',
    '2013-05-10',
    'male',
    '2024-08-01',
    'active'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'STD-002',
    'Sara',
    'Ali',
    '2013-11-20',
    'female',
    '2024-08-01',
    'active'
  )
ON CONFLICT (school_id, student_code) DO NOTHING;

INSERT INTO student_user_accounts (student_id, user_id)
VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004')
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO parent_students (school_id, parent_id, student_id, relation_type, is_primary)
VALUES
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'father', TRUE),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 'guardian', FALSE)
ON CONFLICT (parent_id, student_id) DO NOTHING;

INSERT INTO academic_years (id, school_id, name, starts_on, ends_on, is_current)
VALUES (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '2025-2026',
  '2025-08-01',
  '2026-06-30',
  TRUE
)
ON CONFLICT (school_id, name) DO NOTHING;

INSERT INTO classrooms (
  id,
  school_id,
  academic_year_id,
  grade_label,
  section_label,
  homeroom_teacher_id,
  capacity
)
VALUES (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'Grade 7',
  'A',
  '30000000-0000-0000-0000-000000000002',
  40
)
ON CONFLICT (school_id, academic_year_id, grade_label, section_label) DO NOTHING;

INSERT INTO subjects (id, school_id, code, name)
VALUES ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MATH-7', 'Mathematics')
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO classroom_subjects (id, school_id, classroom_id, subject_id, teacher_id)
VALUES (
  '71000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002'
)
ON CONFLICT (school_id, classroom_id, subject_id) DO NOTHING;

INSERT INTO student_enrollments (
  school_id,
  student_id,
  classroom_id,
  academic_year_id,
  roll_no,
  status,
  joined_on
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    1,
    'active',
    '2025-08-01'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    2,
    'active',
    '2025-08-01'
  )
ON CONFLICT (school_id, student_id, academic_year_id) DO NOTHING;

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
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    CURRENT_DATE,
    'present',
    NOW(),
    'manual',
    'On time',
    '20000000-0000-0000-0000-000000000002'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000001',
    CURRENT_DATE,
    'late',
    NOW(),
    'manual',
    'Arrived after assembly',
    '20000000-0000-0000-0000-000000000002'
  )
ON CONFLICT (school_id, student_id, attendance_date) DO NOTHING;

INSERT INTO homework (
  id,
  school_id,
  classroom_id,
  subject_id,
  teacher_id,
  title,
  description,
  assigned_at,
  due_at,
  attachment_urls,
  is_published
)
VALUES (
  '80000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  'Algebra Worksheet 1',
  'Solve questions 1 to 10.',
  NOW(),
  NOW() + INTERVAL '2 days',
  '[]'::jsonb,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO homework_submissions (
  id,
  school_id,
  homework_id,
  student_id,
  status,
  submitted_at,
  graded_at,
  score,
  feedback,
  attachment_urls
)
VALUES
  (
    '81000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'submitted',
    NOW(),
    NULL,
    NULL,
    NULL,
    '[]'::jsonb
  ),
  (
    '81000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'assigned',
    NULL,
    NULL,
    NULL,
    NULL,
    '[]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO assessments (
  id,
  school_id,
  classroom_id,
  subject_id,
  title,
  assessment_type,
  max_marks,
  assessment_date,
  created_by_user_id
)
VALUES (
  '90000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'Monthly Test 1',
  'monthly',
  50,
  CURRENT_DATE,
  '20000000-0000-0000-0000-000000000002'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO assessment_scores (
  id,
  school_id,
  assessment_id,
  student_id,
  marks_obtained,
  remarks
)
VALUES
  (
    '91000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    42,
    'Excellent'
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    31,
    'Needs revision'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
