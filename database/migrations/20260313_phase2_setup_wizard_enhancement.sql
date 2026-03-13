BEGIN;

-- =====================================================
-- Phase 2: Setup Wizard Enhancement
-- =====================================================
-- Adds three missing wizard steps: subjects, grading_system, timetable
-- These modules already have full CRUD APIs but were not tracked in the wizard.

-- 1. Expand the step_code CHECK constraint on school_onboarding_steps
--    Must drop and recreate since ALTER CHECK is not supported.
ALTER TABLE school_onboarding_steps
  DROP CONSTRAINT IF EXISTS school_onboarding_steps_step_code_check;

ALTER TABLE school_onboarding_steps
  ADD CONSTRAINT school_onboarding_steps_step_code_check CHECK (
    step_code IN (
      'school_profile',
      'academic_year',
      'sections',
      'classrooms',
      'subjects',
      'staff_setup',
      'students',
      'fee_plans',
      'grading_system',
      'timetable',
      'role_assignment',
      'notification_settings'
    )
  );

COMMIT;
