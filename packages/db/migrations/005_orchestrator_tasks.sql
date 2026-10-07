CREATE TABLE IF NOT EXISTS personal_ai.tasks (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  project_id TEXT,
  workspace_id TEXT,
  type TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT,
  risk_level TEXT,
  current_step TEXT,
  plan JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS personal_ai.observations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES personal_ai.tasks(id) ON DELETE CASCADE,
  step_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_ai.task_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES personal_ai.tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
