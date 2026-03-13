BEGIN;

CREATE TABLE IF NOT EXISTS school_onboarding_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  step_code TEXT NOT NULL CHECK (
    step_code IN (
      'school_profile',
      'academic_year',
      'sections',
      'classrooms',
      'staff_setup',
      'students',
      'fee_plans',
      'role_assignment',
      'notification_settings'
    )
  ),
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, step_code)
);

CREATE INDEX IF NOT EXISTS idx_school_onboarding_steps_school
  ON school_onboarding_steps(school_id, step_code, is_completed);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_school_onboarding_steps_updated_at'
  ) THEN
    CREATE TRIGGER trg_school_onboarding_steps_updated_at
    BEFORE UPDATE ON school_onboarding_steps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_onboarding_launches (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  launched_at TIMESTAMPTZ NOT NULL,
  launched_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  checklist_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_school_onboarding_launches_updated_at'
  ) THEN
    CREATE TRIGGER trg_school_onboarding_launches_updated_at
    BEFORE UPDATE ON school_onboarding_launches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMIT;
