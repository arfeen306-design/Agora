BEGIN;

-- =====================================================
-- Document vault core
-- =====================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  mime_type TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'hr_document',
      'salary_slip',
      'appointment_letter',
      'contract',
      'policy_document',
      'circular',
      'student_document',
      'admission_form',
      'report_card',
      'fee_receipt',
      'certificate',
      'identity_document',
      'medical_record',
      'official_letter',
      'other'
    )
  ),
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('school', 'student', 'staff', 'classroom', 'parent', 'admission', 'finance')
  ),
  scope_id UUID,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  expires_on DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_school_category_scope
  ON documents(school_id, category, scope_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_school_scope_id
  ON documents(school_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_documents_school_archived
  ON documents(school_id, is_archived, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_documents_updated_at'
  ) THEN
    CREATE TRIGGER trg_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  mime_type TEXT NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_school_document
  ON document_versions(school_id, document_id, version_no DESC);

CREATE TABLE IF NOT EXISTS document_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  access_type TEXT NOT NULL CHECK (access_type IN ('role', 'user')),
  role_code TEXT,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_download BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (access_type = 'role' AND role_code IS NOT NULL AND user_id IS NULL)
    OR
    (access_type = 'user' AND user_id IS NOT NULL AND role_code IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_access_rules_unique_role
  ON document_access_rules(document_id, access_type, role_code)
  WHERE access_type = 'role';

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_access_rules_unique_user
  ON document_access_rules(document_id, access_type, user_id)
  WHERE access_type = 'user';

CREATE INDEX IF NOT EXISTS idx_document_access_rules_school_document
  ON document_access_rules(school_id, document_id);

CREATE TABLE IF NOT EXISTS document_download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  downloaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_method TEXT NOT NULL DEFAULT 'signed_url'
);

CREATE INDEX IF NOT EXISTS idx_document_download_events_school_document
  ON document_download_events(school_id, document_id, downloaded_at DESC);

-- =====================================================
-- Permission registry + role templates
-- =====================================================
INSERT INTO permissions (code, module, description)
VALUES
  ('documents.vault.view', 'documents', 'View document vault'),
  ('documents.vault.manage', 'documents', 'Upload and manage documents')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id, scope_level, can_view, can_create, can_edit, can_delete)
SELECT
  r.id,
  p.id,
  'school',
  TRUE,
  CASE WHEN p.code = 'documents.vault.manage' AND r.code IN ('school_admin', 'principal', 'teacher', 'front_desk', 'hr_admin', 'accountant') THEN TRUE ELSE FALSE END,
  CASE WHEN p.code = 'documents.vault.manage' AND r.code IN ('school_admin', 'principal', 'teacher', 'front_desk', 'hr_admin', 'accountant') THEN TRUE ELSE FALSE END,
  CASE WHEN p.code = 'documents.vault.manage' AND r.code IN ('school_admin', 'principal', 'hr_admin') THEN TRUE ELSE FALSE END
FROM roles r
JOIN permissions p
  ON p.code IN ('documents.vault.view', 'documents.vault.manage')
WHERE r.code IN (
  'school_admin',
  'principal',
  'vice_principal',
  'headmistress',
  'teacher',
  'front_desk',
  'hr_admin',
  'accountant',
  'parent',
  'student'
)
ON CONFLICT (role_id, permission_id, scope_level)
DO UPDATE
SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

COMMIT;
