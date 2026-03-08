BEGIN;

-- =====================================================
-- Permission registry additions (discipline module)
-- =====================================================
INSERT INTO permissions (code, module, description)
VALUES
  ('discipline.incidents.view', 'discipline', 'View discipline incidents and consequence summaries'),
  ('discipline.incidents.manage', 'discipline', 'Create and manage discipline incidents')
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
  CASE WHEN r.code = 'headmistress' THEN 'section' ELSE 'school' END,
  TRUE,
  FALSE,
  FALSE,
  FALSE
FROM roles r
JOIN permissions p ON p.code = 'discipline.incidents.view'
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
  CASE WHEN r.code IN ('school_admin', 'principal', 'teacher') THEN TRUE ELSE FALSE END,
  CASE WHEN r.code IN ('school_admin', 'principal', 'headmistress') THEN TRUE ELSE FALSE END,
  CASE WHEN r.code IN ('school_admin', 'principal') THEN TRUE ELSE FALSE END
FROM roles r
JOIN permissions p ON p.code = 'discipline.incidents.manage'
WHERE r.code IN ('school_admin', 'principal', 'headmistress', 'teacher')
ON CONFLICT (role_id, permission_id, scope_level) DO NOTHING;

-- =====================================================
-- Discipline incidents and consequences
-- =====================================================
CREATE TABLE IF NOT EXISTS discipline_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  section_id UUID REFERENCES school_sections(id) ON DELETE SET NULL,
  reported_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  incident_date DATE NOT NULL,
  incident_type TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  witnesses TEXT,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported',
  resolution_notes TEXT,
  pastoral_notes TEXT,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (incident_type IN ('minor_infraction', 'major_infraction', 'positive_behavior', 'bullying', 'safety_concern')),
  CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CHECK (status IN ('reported', 'under_review', 'resolved', 'escalated')),
  CHECK (
    (status <> 'resolved')
    OR (resolution_notes IS NOT NULL AND length(trim(resolution_notes)) > 0)
  ),
  CHECK ((resolved_at IS NULL) OR (resolved_at >= created_at))
);

CREATE INDEX IF NOT EXISTS idx_discipline_incidents_school_status_date
  ON discipline_incidents(school_id, status, incident_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discipline_incidents_school_student
  ON discipline_incidents(school_id, student_id, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_discipline_incidents_school_section
  ON discipline_incidents(school_id, section_id, status, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_discipline_incidents_school_classroom
  ON discipline_incidents(school_id, classroom_id, status, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_discipline_incidents_sensitive
  ON discipline_incidents(school_id, is_sensitive, incident_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_discipline_incidents_scope_id
  ON discipline_incidents(school_id, id);

DO $$
DECLARE
  classrooms_scope_unique_exists boolean;
  sections_scope_unique_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a1 ON a1.attrelid = t.oid AND a1.attnum = i.indkey[0]
    JOIN pg_attribute a2 ON a2.attrelid = t.oid AND a2.attnum = i.indkey[1]
    WHERE t.relname = 'classrooms'
      AND i.indisunique = TRUE
      AND i.indnatts = 2
      AND a1.attname = 'school_id'
      AND a2.attname = 'id'
  ) INTO classrooms_scope_unique_exists;

  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_attribute a1 ON a1.attrelid = t.oid AND a1.attnum = i.indkey[0]
    JOIN pg_attribute a2 ON a2.attrelid = t.oid AND a2.attnum = i.indkey[1]
    WHERE t.relname = 'school_sections'
      AND i.indisunique = TRUE
      AND i.indnatts = 2
      AND a1.attname = 'school_id'
      AND a2.attname = 'id'
  ) INTO sections_scope_unique_exists;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'discipline_incidents_scope_classroom_fkey'
  ) AND classrooms_scope_unique_exists THEN
    ALTER TABLE discipline_incidents
      ADD CONSTRAINT discipline_incidents_scope_classroom_fkey
      FOREIGN KEY (school_id, classroom_id)
      REFERENCES classrooms(school_id, id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'discipline_incidents_scope_section_fkey'
  ) AND sections_scope_unique_exists THEN
    ALTER TABLE discipline_incidents
      ADD CONSTRAINT discipline_incidents_scope_section_fkey
      FOREIGN KEY (school_id, section_id)
      REFERENCES school_sections(school_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_discipline_incidents_updated_at'
  ) THEN
    CREATE TRIGGER trg_discipline_incidents_updated_at
    BEFORE UPDATE ON discipline_incidents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS discipline_consequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES discipline_incidents(id) ON DELETE CASCADE,
  consequence_type TEXT NOT NULL,
  description TEXT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  administered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_notified BOOLEAN NOT NULL DEFAULT FALSE,
  parent_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consequence_type IN ('verbal_warning', 'written_warning', 'detention', 'suspension', 'parent_meeting', 'community_service', 'other')),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((parent_notified = FALSE AND parent_notified_at IS NULL) OR (parent_notified = TRUE))
);

CREATE INDEX IF NOT EXISTS idx_discipline_consequences_school_incident
  ON discipline_consequences(school_id, incident_id, starts_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discipline_consequences_school_notification
  ON discipline_consequences(school_id, parent_notified, starts_on DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_discipline_consequences_scope_id
  ON discipline_consequences(school_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'discipline_consequences_scope_incident_fkey'
  ) THEN
    ALTER TABLE discipline_consequences
      ADD CONSTRAINT discipline_consequences_scope_incident_fkey
      FOREIGN KEY (school_id, incident_id)
      REFERENCES discipline_incidents(school_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_discipline_consequences_updated_at'
  ) THEN
    CREATE TRIGGER trg_discipline_consequences_updated_at
    BEFORE UPDATE ON discipline_consequences
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
    'discipline_incidents',
    'discipline_consequences'
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
