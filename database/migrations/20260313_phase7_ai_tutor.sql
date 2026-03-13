BEGIN;

-- =====================================================
-- Phase 7: AI Tutor Infrastructure
-- =====================================================

-- 1. Tutor Configs (per-school settings)
CREATE TABLE IF NOT EXISTS tutor_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_subjects UUID[] NOT NULL DEFAULT '{}',
  system_prompt_override TEXT,
  difficulty_level TEXT NOT NULL DEFAULT 'adaptive' CHECK (difficulty_level IN ('easy', 'medium', 'hard', 'adaptive')),
  max_messages_per_session INT NOT NULL DEFAULT 50,
  max_sessions_per_day INT NOT NULL DEFAULT 10,
  allowed_roles TEXT[] NOT NULL DEFAULT '{student}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id)
);

-- 2. Tutor Sessions
CREATE TABLE IF NOT EXISTS tutor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
  summary TEXT,
  message_count INT NOT NULL DEFAULT 0,
  total_tokens_used INT NOT NULL DEFAULT 0,
  model_used TEXT,
  context_snapshot JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tutor Messages
CREATE TABLE IF NOT EXISTS tutor_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  token_count INT NOT NULL DEFAULT 0,
  model TEXT,
  latency_ms INT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tutor Contexts (curriculum snapshots)
CREATE TABLE IF NOT EXISTS tutor_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  grade_label TEXT,
  topic TEXT NOT NULL,
  learning_objectives TEXT[],
  curriculum_notes TEXT,
  difficulty_level TEXT DEFAULT 'medium',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Tutor Usage Logs (token tracking)
CREATE TABLE IF NOT EXISTS tutor_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id UUID REFERENCES tutor_sessions(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  cost_estimate NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Indexes
CREATE INDEX idx_tutor_sessions_student ON tutor_sessions(school_id, student_id, status);
CREATE INDEX idx_tutor_sessions_user ON tutor_sessions(school_id, user_id);
CREATE INDEX idx_tutor_sessions_subject ON tutor_sessions(school_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_tutor_messages_session ON tutor_messages(session_id, created_at);
CREATE INDEX idx_tutor_contexts_school ON tutor_contexts(school_id, subject_id);
CREATE INDEX idx_tutor_usage_school_month ON tutor_usage_logs(school_id, created_at);
CREATE INDEX idx_tutor_usage_user ON tutor_usage_logs(user_id, created_at);

-- 7. Triggers
CREATE TRIGGER trg_tutor_configs_updated_at BEFORE UPDATE ON tutor_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutor_sessions_updated_at BEFORE UPDATE ON tutor_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tutor_contexts_updated_at BEFORE UPDATE ON tutor_contexts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
