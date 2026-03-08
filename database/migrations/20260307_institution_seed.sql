BEGIN;

-- Demo leadership users for institution layer
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
    '20000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'principal@agora.com',
    '+920000000005',
    'principal123',
    'Farah',
    'Siddiqui',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    'viceprincipal@agora.com',
    '+920000000006',
    'vice123',
    'Naveed',
    'Qureshi',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'hm.middle@agora.com',
    '+920000000007',
    'hm123',
    'Saima',
    'Rehman',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000001',
    'accountant@agora.com',
    '+920000000008',
    'accounts123',
    'Bilal',
    'Khan',
    TRUE
  ),
  (
    '20000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000001',
    'frontdesk1@agora.com',
    '+920000000009',
    'front123',
    'Hina',
    'Ali',
    TRUE
  )
ON CONFLICT (school_id, email) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000005', id FROM roles WHERE code = 'principal'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000006', id FROM roles WHERE code = 'vice_principal'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000007', id FROM roles WHERE code = 'headmistress'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000008', id FROM roles WHERE code = 'accountant'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000009', id FROM roles WHERE code = 'front_desk'
ON CONFLICT DO NOTHING;

-- Map leadership on school profile
UPDATE schools
SET
  branch_name = COALESCE(branch_name, 'Main Campus'),
  address_line = COALESCE(address_line, 'Model Town, Lahore'),
  contact_phone = COALESCE(contact_phone, '+92-42-0000000'),
  contact_email = COALESCE(contact_email, 'info@agora.com'),
  academic_year_label = COALESCE(academic_year_label, '2025-2026'),
  school_starts_at = COALESCE(school_starts_at, '07:45:00'),
  school_ends_at = COALESCE(school_ends_at, '14:30:00'),
  late_arrival_cutoff = COALESCE(late_arrival_cutoff, '08:05:00'),
  attendance_rules = attendance_rules || jsonb_build_object(
    'allow_late_marking_until_minutes', 30,
    'auto_notify_on_absent', true,
    'auto_notify_on_late', true
  ),
  principal_user_id = COALESCE(principal_user_id, '20000000-0000-0000-0000-000000000005'::uuid),
  vice_principal_user_id = COALESCE(vice_principal_user_id, '20000000-0000-0000-0000-000000000006'::uuid)
WHERE id = '10000000-0000-0000-0000-000000000001';

-- School sections (institution setup)
INSERT INTO school_sections (
  id,
  school_id,
  name,
  code,
  section_type,
  head_user_id,
  display_order
)
VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Pre School',
    'PRE',
    'pre_school',
    NULL,
    1
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Junior',
    'JUN',
    'junior',
    NULL,
    2
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'Middle',
    'MID',
    'middle',
    '20000000-0000-0000-0000-000000000007',
    3
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'Senior',
    'SEN',
    'senior',
    NULL,
    4
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'High School',
    'HIGH',
    'high_school',
    NULL,
    5
  )
ON CONFLICT (school_id, code) DO NOTHING;

UPDATE classrooms
SET
  section_id = COALESCE(section_id, 'a0000000-0000-0000-0000-000000000003'::uuid),
  classroom_code = COALESCE(classroom_code, 'G7-A'),
  room_number = COALESCE(room_number, '201')
WHERE id = '60000000-0000-0000-0000-000000000001';

INSERT INTO staff_profiles (
  id,
  school_id,
  user_id,
  staff_code,
  staff_type,
  designation,
  joining_date,
  primary_section_id
)
VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000005',
    'EMP-PR-001',
    'principal',
    'Principal',
    '2024-04-01',
    NULL
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000006',
    'EMP-VP-001',
    'vice_principal',
    'Vice Principal',
    '2024-05-01',
    NULL
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000007',
    'EMP-HM-001',
    'headmistress',
    'Middle Section HM',
    '2024-06-15',
    'a0000000-0000-0000-0000-000000000003'
  ),
  (
    'b0000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000008',
    'EMP-AC-001',
    'accountant',
    'Accountant',
    '2024-07-01',
    NULL
  ),
  (
    'b0000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    'EMP-TC-001',
    'teacher',
    'Math Teacher',
    '2025-08-01',
    'a0000000-0000-0000-0000-000000000003'
  ),
  (
    'b0000000-0000-0000-0000-000000000006',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000009',
    'EMP-FD-001',
    'front_desk',
    'Admissions Officer',
    '2024-08-01',
    'a0000000-0000-0000-0000-000000000002'
  )
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO staff_classroom_assignments (
  school_id,
  staff_profile_id,
  classroom_id,
  subject_id,
  assignment_role
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000005',
    '60000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    'subject_teacher'
  )
ON CONFLICT DO NOTHING;

COMMIT;
