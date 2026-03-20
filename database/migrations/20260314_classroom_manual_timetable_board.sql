BEGIN;

CREATE TABLE IF NOT EXISTS classroom_weekly_timetable_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, classroom_id)
);

CREATE TABLE IF NOT EXISTS classroom_weekly_timetable_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES classroom_weekly_timetable_boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  day_of_week INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (position > 0),
  CHECK (day_of_week IS NULL OR day_of_week BETWEEN 1 AND 7),
  UNIQUE (board_id, position)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classroom_weekly_timetable_rows_day
  ON classroom_weekly_timetable_rows(board_id, day_of_week)
  WHERE day_of_week IS NOT NULL;

CREATE TABLE IF NOT EXISTS classroom_weekly_timetable_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES classroom_weekly_timetable_boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  starts_at TIME,
  ends_at TIME,
  period_id UUID REFERENCES timetable_periods(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (position > 0),
  UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS classroom_weekly_timetable_cells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES classroom_weekly_timetable_boards(id) ON DELETE CASCADE,
  row_id UUID NOT NULL REFERENCES classroom_weekly_timetable_rows(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES classroom_weekly_timetable_columns(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  title TEXT,
  subtitle TEXT,
  room_number TEXT,
  notes TEXT,
  color_hex TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, row_id, column_id)
);

CREATE INDEX IF NOT EXISTS idx_classroom_weekly_timetable_boards_classroom
  ON classroom_weekly_timetable_boards(classroom_id);

CREATE INDEX IF NOT EXISTS idx_classroom_weekly_timetable_rows_board
  ON classroom_weekly_timetable_rows(board_id, position);

CREATE INDEX IF NOT EXISTS idx_classroom_weekly_timetable_columns_board
  ON classroom_weekly_timetable_columns(board_id, position);

CREATE INDEX IF NOT EXISTS idx_classroom_weekly_timetable_cells_board
  ON classroom_weekly_timetable_cells(board_id, row_id, column_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_classroom_weekly_timetable_boards_updated_at'
  ) THEN
    CREATE TRIGGER trg_classroom_weekly_timetable_boards_updated_at
    BEFORE UPDATE ON classroom_weekly_timetable_boards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_classroom_weekly_timetable_rows_updated_at'
  ) THEN
    CREATE TRIGGER trg_classroom_weekly_timetable_rows_updated_at
    BEFORE UPDATE ON classroom_weekly_timetable_rows
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_classroom_weekly_timetable_columns_updated_at'
  ) THEN
    CREATE TRIGGER trg_classroom_weekly_timetable_columns_updated_at
    BEFORE UPDATE ON classroom_weekly_timetable_columns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_classroom_weekly_timetable_cells_updated_at'
  ) THEN
    CREATE TRIGGER trg_classroom_weekly_timetable_cells_updated_at
    BEFORE UPDATE ON classroom_weekly_timetable_cells
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMIT;
