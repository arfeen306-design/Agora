BEGIN;

-- =====================================================
-- Phase 6: Notification Expansion + Portal Support
-- =====================================================

-- 1. Add 'whatsapp' to notification_channel enum
ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'whatsapp';

-- 2. Scheduled notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'in_app',
  target_type TEXT NOT NULL CHECK (target_type IN ('role', 'user', 'classroom', 'all')),
  target_id TEXT, -- role code, user UUID, classroom UUID, or NULL for 'all'
  send_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel notification_channel NOT NULL DEFAULT 'in_app',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, user_id, event_type, channel)
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_school_status
  ON scheduled_notifications(school_id, status, send_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_pending
  ON scheduled_notifications(send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(school_id, user_id);

-- 5. Triggers
CREATE TRIGGER trg_scheduled_notifications_updated_at
BEFORE UPDATE ON scheduled_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_preferences_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
