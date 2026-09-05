-- Personal AI Phase 6 — Neon PostgreSQL + pgvector
-- Uses dedicated schema `personal_ai` to avoid colliding with existing Bharath AI tables.
-- Safe to re-run (IF NOT EXISTS). Does not drop existing data.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS personal_ai;

-- Users (external_id for anonymous/session-scoped identity)
CREATE TABLE IF NOT EXISTS personal_ai.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_ai.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_projects_user ON personal_ai.projects(user_id);

CREATE TABLE IF NOT EXISTS personal_ai.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES personal_ai.projects(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_conversations_user ON personal_ai.conversations(user_id);

CREATE TABLE IF NOT EXISTS personal_ai.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES personal_ai.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_messages_conversation ON personal_ai.messages(conversation_id);

CREATE TABLE IF NOT EXISTS personal_ai.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES personal_ai.projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'context',
  importance REAL NOT NULL DEFAULT 0.5,
  embedding vector,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_memories_user ON personal_ai.memories(user_id);
CREATE INDEX IF NOT EXISTS idx_pai_memories_project ON personal_ai.memories(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pai_memories_user_hash ON personal_ai.memories(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS personal_ai.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES personal_ai.projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'indexed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pai_documents_user ON personal_ai.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_pai_documents_project ON personal_ai.documents(project_id);

CREATE TABLE IF NOT EXISTS personal_ai.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES personal_ai.documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_pai_document_chunks_document ON personal_ai.document_chunks(document_id);

CREATE TABLE IF NOT EXISTS personal_ai.workspace_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES personal_ai.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES personal_ai.projects(id) ON DELETE SET NULL,
  external_workspace_id TEXT NOT NULL UNIQUE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_ai.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
