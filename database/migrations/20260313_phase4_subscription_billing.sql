BEGIN;

-- =====================================================
-- Phase 4: Subscription & Billing System
-- =====================================================
-- Platform-level SaaS billing (separate from student fee system)

-- 1. Enums
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired');
CREATE TYPE billing_cycle AS ENUM ('monthly', 'annual');
CREATE TYPE platform_invoice_status AS ENUM ('draft', 'issued', 'paid', 'overdue', 'cancelled');
CREATE TYPE platform_payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- 2. Plan catalog
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_monthly >= 0),
  price_annual NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_annual >= 0),
  -- limits
  max_students INT NOT NULL DEFAULT 50,
  max_staff INT NOT NULL DEFAULT 10,
  max_storage_gb INT NOT NULL DEFAULT 1,
  -- feature flags
  ai_tutor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  api_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  custom_branding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- metadata
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order SMALLINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. School subscriptions
CREATE TABLE school_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  billing_cycle billing_cycle NOT NULL DEFAULT 'monthly',
  status subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL,
  trial_ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  payment_gateway TEXT, -- stripe | razorpay | manual
  gateway_subscription_id TEXT,
  gateway_customer_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one active subscription per school
  CONSTRAINT uq_school_subscriptions_active UNIQUE (school_id)
);

-- 4. Platform invoices (SaaS billing, NOT student fees)
CREATE TABLE platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES school_subscriptions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  currency TEXT NOT NULL DEFAULT 'PKR',
  status platform_invoice_status NOT NULL DEFAULT 'draft',
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start),
  CHECK (amount_paid <= amount_due + tax)
);

-- 5. Platform payments
CREATE TABLE platform_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES platform_invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL, -- card | bank_transfer | manual | gateway
  gateway_payment_id TEXT,
  gateway_ref TEXT,
  status platform_payment_status NOT NULL DEFAULT 'completed',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Indexes
CREATE INDEX idx_subscription_plans_active ON subscription_plans(is_active, display_order);
CREATE INDEX idx_school_subscriptions_school ON school_subscriptions(school_id);
CREATE INDEX idx_school_subscriptions_status ON school_subscriptions(status) WHERE status IN ('active', 'trialing');
CREATE INDEX idx_platform_invoices_school ON platform_invoices(school_id, status, due_date);
CREATE INDEX idx_platform_invoices_number ON platform_invoices(invoice_number);
CREATE INDEX idx_platform_payments_invoice ON platform_payments(invoice_id);

-- 7. Updated_at triggers
CREATE TRIGGER trg_subscription_plans_updated_at
BEFORE UPDATE ON subscription_plans
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_school_subscriptions_updated_at
BEFORE UPDATE ON school_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_platform_invoices_updated_at
BEFORE UPDATE ON platform_invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8. Seed default plans
INSERT INTO subscription_plans (code, name, description, price_monthly, price_annual, max_students, max_staff, max_storage_gb, ai_tutor_enabled, sms_enabled, api_access_enabled, custom_branding_enabled, display_order)
VALUES
  ('free',         'Free',          'Get started with basic school management',                       0,       0, 50,   10,  1,  FALSE, FALSE, FALSE, FALSE, 0),
  ('starter',      'Starter',       'For small schools ready to grow',                             2999, 29990, 200,   30,  5,  FALSE, TRUE,  FALSE, FALSE, 1),
  ('professional', 'Professional',  'Full-featured for mid-size schools with AI tutor',            7999, 79990, 1000, 100, 25,  TRUE,  TRUE,  TRUE,  FALSE, 2),
  ('enterprise',   'Enterprise',    'Unlimited capacity with custom branding and priority support', 0,       0, 99999, 99999, 100, TRUE, TRUE, TRUE, TRUE, 3);

COMMIT;
