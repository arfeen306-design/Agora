ALTER TABLE report_card_subjects
  ADD COLUMN IF NOT EXISTS comment_category TEXT,
  ADD COLUMN IF NOT EXISTS teacher_comment TEXT;
