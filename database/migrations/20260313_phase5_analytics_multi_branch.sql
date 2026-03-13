BEGIN;

-- =====================================================
-- Phase 5: Analytics Depth + Multi-Branch Architecture
-- =====================================================

-- 1. Add KPI targets to schools
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS kpi_targets JSONB NOT NULL DEFAULT '{
    "attendance_rate_target": 85,
    "marks_avg_target": 60,
    "homework_completion_target": 70
  }';

-- 2. Branch groups (organization / school network identity)
CREATE TABLE IF NOT EXISTS branch_groups (
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

-- 3. Link schools to their branch group
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS branch_group_id UUID REFERENCES branch_groups(id) ON DELETE SET NULL;

-- 4. Branch group administrators
CREATE TABLE IF NOT EXISTS branch_group_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_group_id UUID NOT NULL REFERENCES branch_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_group_id, user_id)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_schools_branch_group ON schools(branch_group_id) WHERE branch_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_branch_group_admins_user ON branch_group_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_branch_group_admins_group ON branch_group_admins(branch_group_id);

-- 6. Updated_at trigger for branch_groups
CREATE TRIGGER trg_branch_groups_updated_at
BEFORE UPDATE ON branch_groups
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. Add branch_group_admin role
INSERT INTO roles (code, description)
VALUES ('branch_group_admin', 'Cross-branch analytics and oversight for school networks')
ON CONFLICT (code) DO NOTHING;

COMMIT;
