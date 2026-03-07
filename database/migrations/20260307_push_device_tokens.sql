BEGIN;

CREATE TABLE IF NOT EXISTS push_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'fcm', -- fcm
  platform TEXT NOT NULL, -- android | ios | web
  device_token TEXT NOT NULL,
  device_id TEXT,
  app_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON push_device_tokens(user_id, is_active, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_tokens_school_provider
  ON push_device_tokens(school_id, provider, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_push_device_tokens_updated_at'
  ) THEN
    CREATE TRIGGER trg_push_device_tokens_updated_at
    BEFORE UPDATE ON push_device_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
