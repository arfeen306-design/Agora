BEGIN;

ALTER TABLE classroom_subjects
  ADD COLUMN IF NOT EXISTS periods_per_week INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lesson_duration INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lesson_priority INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_timetable_locked BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE classroom_subjects
SET
  periods_per_week = COALESCE(periods_per_week, 0),
  lesson_duration = COALESCE(lesson_duration, 1),
  lesson_priority = COALESCE(lesson_priority, 5),
  is_timetable_locked = COALESCE(is_timetable_locked, FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'classroom_subjects_periods_per_week_check'
  ) THEN
    ALTER TABLE classroom_subjects
      ADD CONSTRAINT classroom_subjects_periods_per_week_check
      CHECK (periods_per_week BETWEEN 0 AND 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'classroom_subjects_lesson_duration_check'
  ) THEN
    ALTER TABLE classroom_subjects
      ADD CONSTRAINT classroom_subjects_lesson_duration_check
      CHECK (lesson_duration BETWEEN 1 AND 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'classroom_subjects_lesson_priority_check'
  ) THEN
    ALTER TABLE classroom_subjects
      ADD CONSTRAINT classroom_subjects_lesson_priority_check
      CHECK (lesson_priority BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_classroom_subjects_generation_ready
  ON classroom_subjects(school_id, classroom_id, teacher_id)
  WHERE periods_per_week > 0;

COMMIT;
