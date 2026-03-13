BEGIN;

-- =====================================================
-- Phase 1: Multi-Tenant SaaS Foundation Gap Remediation
-- =====================================================
-- Addresses two gaps identified during Phase 1 audit:
-- 1. schools table missing address and subscription_plan
-- 2. class_teacher role missing from roles table

-- 1. Add address and subscription_plan to schools
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free';

-- 2. Add class_teacher role
INSERT INTO roles (code, description)
VALUES ('class_teacher', 'Manages homeroom class operations and report cards')
ON CONFLICT (code) DO NOTHING;

COMMIT;
