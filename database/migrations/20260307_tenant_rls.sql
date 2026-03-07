BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.tenant_match(row_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_school_id', true) IS NULL THEN TRUE
    WHEN current_setting('app.current_school_id', true) = '' THEN TRUE
    ELSE row_school_id = current_setting('app.current_school_id', true)::uuid
  END
$$;

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'users',
    'user_sessions',
    'parents',
    'teachers',
    'students',
    'parent_students',
    'academic_years',
    'classrooms',
    'subjects',
    'classroom_subjects',
    'student_enrollments',
    'attendance_records',
    'homework',
    'homework_submissions',
    'assessments',
    'assessment_scores',
    'conversations',
    'messages',
    'notifications',
    'push_device_tokens',
    'fee_plans',
    'fee_invoices',
    'fee_payments',
    'events',
    'audit_logs'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables
  LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.tenant_match(school_id)) WITH CHECK (app.tenant_match(school_id))',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
