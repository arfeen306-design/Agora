BEGIN;

WITH desired_matrix AS (
  SELECT
    r.id AS role_id,
    p.id AS permission_id,
    'school'::text AS scope_level,
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
)
INSERT INTO role_permissions (
  role_id,
  permission_id,
  scope_level,
  can_view,
  can_create,
  can_edit,
  can_delete
)
SELECT
  role_id,
  permission_id,
  scope_level,
  can_view,
  can_create,
  can_edit,
  can_delete
FROM desired_matrix
ON CONFLICT (role_id, permission_id, scope_level)
DO UPDATE
SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

COMMIT;
