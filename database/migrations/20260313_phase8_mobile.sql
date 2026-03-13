BEGIN;

-- =====================================================
-- Phase 8: Mobile App Features
-- =====================================================

-- 1. User Devices (push token registration)
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version TEXT,
  device_model TEXT,
  os_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_token)
);

-- 2. App Configs (per-school mobile app settings)
CREATE TABLE IF NOT EXISTS app_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  min_app_version TEXT NOT NULL DEFAULT '1.0.0',
  latest_app_version TEXT NOT NULL DEFAULT '1.0.0',
  force_update BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message TEXT,
  app_store_url TEXT,
  play_store_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id)
);

-- 3. Indexes
CREATE INDEX idx_user_devices_user ON user_devices(user_id, is_active);
CREATE INDEX idx_user_devices_token ON user_devices(device_token);
CREATE INDEX idx_user_devices_school ON user_devices(school_id, platform);

-- 4. Triggers
CREATE TRIGGER trg_user_devices_updated_at BEFORE UPDATE ON user_devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_app_configs_updated_at BEFORE UPDATE ON app_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
