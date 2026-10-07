-- Phase 3 External Automation tables

-- 1. External Connections (Connectors)
CREATE TABLE IF NOT EXISTS personal_ai.external_connections (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active', 'revoked', 'expired', 'error'
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_external_connections_user_provider ON personal_ai.external_connections(user_id, provider);

-- 2. External Action Permissions (Approval Policies)
CREATE TABLE IF NOT EXISTS personal_ai.external_action_permissions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  risk TEXT NOT NULL, -- 'low', 'medium', 'high', 'critical'
  permission TEXT NOT NULL, -- 'allow', 'deny', 'ask'
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_action_perm_unique ON personal_ai.external_action_permissions(user_id, provider, action, resource);

-- 3. External Action Audit Logs
CREATE TABLE IF NOT EXISTS personal_ai.external_actions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL, -- 'discovered', 'analyzed', 'prepared', 'waiting_for_approval', 'approved', 'executing', 'verifying', 'completed', 'failed', 'rejected'
  idempotency_key TEXT,
  resource TEXT,
  request_payload JSONB,
  result_payload JSONB,
  error_details TEXT,
  approved_by TEXT,
  approval_timestamp TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_actions_user_status ON personal_ai.external_actions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ext_actions_idempotency ON personal_ai.external_actions(provider, idempotency_key);

-- 4. Notifications
CREATE TABLE IF NOT EXISTS personal_ai.notifications (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'info', 'important', 'action_required', 'warning', 'critical'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  action_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON personal_ai.notifications(user_id, read);
