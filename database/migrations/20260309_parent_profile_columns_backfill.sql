BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'notification_channel'
  ) THEN
    CREATE TYPE notification_channel AS ENUM ('in_app', 'push', 'email', 'sms');
  END IF;
END $$;

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS guardian_name TEXT,
  ADD COLUMN IF NOT EXISTS father_name TEXT,
  ADD COLUMN IF NOT EXISTS mother_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS address_line TEXT;

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS preferred_channel notification_channel;

UPDATE parents
SET preferred_channel = 'in_app'::notification_channel
WHERE preferred_channel IS NULL;

ALTER TABLE parents
  ALTER COLUMN preferred_channel SET DEFAULT 'in_app'::notification_channel;

ALTER TABLE parents
  ALTER COLUMN preferred_channel SET NOT NULL;

COMMIT;
