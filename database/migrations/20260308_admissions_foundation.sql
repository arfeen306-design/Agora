BEGIN;

CREATE TABLE IF NOT EXISTS admission_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  inquiry_source TEXT,
  desired_grade_label TEXT,
  desired_section_label TEXT,
  desired_classroom_id UUID REFERENCES classrooms(id) ON DELETE SET NULL,
  desired_academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  guardian_name TEXT,
  guardian_phone TEXT,
  guardian_email TEXT,
  notes TEXT,
  stage_notes TEXT,
  current_status TEXT NOT NULL DEFAULT 'inquiry',
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  admitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admitted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id),
  CHECK (
    current_status IN (
      'inquiry',
      'applied',
      'under_review',
      'test_scheduled',
      'accepted',
      'rejected',
      'admitted',
      'waitlisted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_admission_applications_school_status
  ON admission_applications(school_id, current_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admission_applications_school_guardian
  ON admission_applications(school_id, guardian_name, guardian_phone, guardian_email);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_admission_applications_updated_at'
  ) THEN
    CREATE TRIGGER trg_admission_applications_updated_at
    BEFORE UPDATE ON admission_applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admission_stage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    from_status IS NULL
    OR from_status IN (
      'inquiry',
      'applied',
      'under_review',
      'test_scheduled',
      'accepted',
      'rejected',
      'admitted',
      'waitlisted'
    )
  ),
  CHECK (
    to_status IN (
      'inquiry',
      'applied',
      'under_review',
      'test_scheduled',
      'accepted',
      'rejected',
      'admitted',
      'waitlisted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_admission_stage_events_school_student
  ON admission_stage_events(school_id, student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admission_stage_events_school_application
  ON admission_stage_events(school_id, application_id, created_at DESC);

DO $$
DECLARE
  school_attnum SMALLINT;
  student_attnum SMALLINT;
  classroom_attnum SMALLINT;
  year_attnum SMALLINT;
  roll_attnum SMALLINT;
  bad_constraint_name TEXT;
BEGIN
  IF to_regclass('student_enrollments') IS NULL THEN
    RETURN;
  END IF;

  SELECT attnum INTO school_attnum
  FROM pg_attribute
  WHERE attrelid = 'student_enrollments'::regclass
    AND attname = 'school_id'
    AND NOT attisdropped;

  SELECT attnum INTO student_attnum
  FROM pg_attribute
  WHERE attrelid = 'student_enrollments'::regclass
    AND attname = 'student_id'
    AND NOT attisdropped;

  SELECT attnum INTO classroom_attnum
  FROM pg_attribute
  WHERE attrelid = 'student_enrollments'::regclass
    AND attname = 'classroom_id'
    AND NOT attisdropped;

  SELECT attnum INTO year_attnum
  FROM pg_attribute
  WHERE attrelid = 'student_enrollments'::regclass
    AND attname = 'academic_year_id'
    AND NOT attisdropped;

  SELECT attnum INTO roll_attnum
  FROM pg_attribute
  WHERE attrelid = 'student_enrollments'::regclass
    AND attname = 'roll_no'
    AND NOT attisdropped;

  SELECT c.conname INTO bad_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'student_enrollments'::regclass
    AND c.contype = 'u'
    AND c.conkey = ARRAY[school_attnum, classroom_attnum, year_attnum]::SMALLINT[]
  LIMIT 1;

  IF bad_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE student_enrollments DROP CONSTRAINT %I', bad_constraint_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'student_enrollments'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[school_attnum, student_attnum, year_attnum]::SMALLINT[]
  ) THEN
    ALTER TABLE student_enrollments
      ADD CONSTRAINT student_enrollments_school_id_student_id_academic_year_id_key
      UNIQUE (school_id, student_id, academic_year_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'student_enrollments'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[school_attnum, classroom_attnum, year_attnum, roll_attnum]::SMALLINT[]
  ) THEN
    ALTER TABLE student_enrollments
      ADD CONSTRAINT student_enrollments_school_id_classroom_id_academic_year_id_roll_no_key
      UNIQUE (school_id, classroom_id, academic_year_id, roll_no);
  END IF;
END $$;

COMMIT;
