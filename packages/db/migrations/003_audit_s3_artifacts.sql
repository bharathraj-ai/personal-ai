-- Audit logs + project artifact metadata (Phase 11)
CREATE TABLE IF NOT EXISTS personal_ai.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  event TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_audit_user ON personal_ai.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_pai_audit_task ON personal_ai.audit_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_pai_audit_event ON personal_ai.audit_logs(event);

CREATE TABLE IF NOT EXISTS personal_ai.project_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT,
  s3_key TEXT NOT NULL,
  relative_path TEXT,
  size_bytes BIGINT DEFAULT 0,
  content_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_artifacts_project ON personal_ai.project_artifacts(user_id, project_id);
