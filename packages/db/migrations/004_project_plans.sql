-- Project plan metadata in Neon (not file contents).
-- Artifacts remain in S3 / Google Drive / workspace.

CREATE TABLE IF NOT EXISTS personal_ai.project_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  workspace_id TEXT,
  classification TEXT NOT NULL,
  project_status TEXT NOT NULL,
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_project_plans_user ON personal_ai.project_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_pai_project_plans_task ON personal_ai.project_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_pai_project_plans_project ON personal_ai.project_plans(project_id);
