BEGIN;

-- =====================================================
-- Permission registry additions (timetable module)
-- =====================================================
INSERT INTO permissions (code, module, description)
VALUES
  ('academics.timetable.view', 'academics', 'View timetable schedules and substitutions'),
  ('academics.timetable.manage', 'academics', 'Create and manage timetable schedules and substitutions')
ON CONFLICT (code) DO NOTHING;

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
  r.id,
  p.id,
  'school',
  TRUE,
  FALSE,
  FALSE,
  FALSE
FROM roles r
JOIN permissions p ON p.code = 'academics.timetable.view'
WHERE r.code IN ('school_admin', 'principal', 'vice_principal', 'headmistress', 'teacher')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

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
  r.id,
  p.id,
  'school',
  TRUE,
  TRUE,
  TRUE,
  TRUE
FROM roles r
JOIN permissions p ON p.code = 'academics.timetable.manage'
WHERE r.code IN ('school_admin', 'principal', 'vice_principal', 'headmistress')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

-- =====================================================
-- Timetable periods and slots
-- =====================================================
CREATE TABLE IF NOT EXISTS timetable_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  is_break BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_number BETWEEN 1 AND 20),
  CHECK (ends_at > starts_at),
  UNIQUE (school_id, academic_year_id, period_number),
  UNIQUE (school_id, academic_year_id, starts_at, ends_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_periods_scope_id
  ON timetable_periods(school_id, academic_year_id, id);
CREATE INDEX IF NOT EXISTS idx_timetable_periods_school_year_active
  ON timetable_periods(school_id, academic_year_id, is_active, period_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_timetable_periods_updated_at'
  ) THEN
    CREATE TRIGGER trg_timetable_periods_updated_at
    BEFORE UPDATE ON timetable_periods
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS timetable_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  period_id UUID NOT NULL REFERENCES timetable_periods(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (day_of_week BETWEEN 1 AND 7),
  UNIQUE (school_id, academic_year_id, day_of_week, period_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_slots_scope_id
  ON timetable_slots(school_id, academic_year_id, id);
CREATE INDEX IF NOT EXISTS idx_timetable_slots_school_year_day
  ON timetable_slots(school_id, academic_year_id, day_of_week, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timetable_slots_scope_period_fkey'
  ) THEN
    ALTER TABLE timetable_slots
      ADD CONSTRAINT timetable_slots_scope_period_fkey
      FOREIGN KEY (school_id, academic_year_id, period_id)
      REFERENCES timetable_periods(school_id, academic_year_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_timetable_slots_updated_at'
  ) THEN
    CREATE TRIGGER trg_timetable_slots_updated_at
    BEFORE UPDATE ON timetable_slots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- Timetable entries and substitutions
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_classrooms_scope_id
  ON classrooms(school_id, academic_year_id, id);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL DEFAULT 'teaching',
  room_number TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (entry_type IN ('teaching', 'activity', 'study_hall', 'break'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_entries_scope_id
  ON timetable_entries(school_id, id);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_school_year_classroom
  ON timetable_entries(school_id, academic_year_id, classroom_id, is_active);
CREATE INDEX IF NOT EXISTS idx_timetable_entries_school_year_teacher
  ON timetable_entries(school_id, academic_year_id, teacher_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_entries_classroom_slot_active
  ON timetable_entries(school_id, classroom_id, slot_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_entries_teacher_slot_active
  ON timetable_entries(school_id, teacher_id, slot_id)
  WHERE is_active = TRUE AND teacher_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_timetable_entries_room_slot_active
  ON timetable_entries(school_id, slot_id, lower(room_number))
  WHERE is_active = TRUE AND room_number IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timetable_entries_scope_classroom_fkey'
  ) THEN
    ALTER TABLE timetable_entries
      ADD CONSTRAINT timetable_entries_scope_classroom_fkey
      FOREIGN KEY (school_id, academic_year_id, classroom_id)
      REFERENCES classrooms(school_id, academic_year_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timetable_entries_scope_slot_fkey'
  ) THEN
    ALTER TABLE timetable_entries
      ADD CONSTRAINT timetable_entries_scope_slot_fkey
      FOREIGN KEY (school_id, academic_year_id, slot_id)
      REFERENCES timetable_slots(school_id, academic_year_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_timetable_entries_updated_at'
  ) THEN
    CREATE TRIGGER trg_timetable_entries_updated_at
    BEFORE UPDATE ON timetable_entries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS timetable_substitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  timetable_entry_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
  substitute_teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  substitution_date DATE NOT NULL,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, timetable_entry_id, substitution_date),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_timetable_substitutions_school_date
  ON timetable_substitutions(school_id, substitution_date DESC, is_active);
CREATE INDEX IF NOT EXISTS idx_timetable_substitutions_school_teacher
  ON timetable_substitutions(school_id, substitute_teacher_id, substitution_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'timetable_substitutions_scope_entry_fkey'
  ) THEN
    ALTER TABLE timetable_substitutions
      ADD CONSTRAINT timetable_substitutions_scope_entry_fkey
      FOREIGN KEY (school_id, timetable_entry_id)
      REFERENCES timetable_entries(school_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_timetable_substitutions_updated_at'
  ) THEN
    CREATE TRIGGER trg_timetable_substitutions_updated_at
    BEFORE UPDATE ON timetable_substitutions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- =====================================================
-- RLS policy bootstrap for new tables
-- =====================================================
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
    'timetable_periods',
    'timetable_slots',
    'timetable_entries',
    'timetable_substitutions'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app.tenant_match(school_id)) WITH CHECK (app.tenant_match(school_id))',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
