-- Phase 2 Memory & Context
ALTER TABLE personal_ai.memories
ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES personal_ai.memories(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'conflict', 'rejected'));

-- Update any existing memories
UPDATE personal_ai.memories SET status = 'active' WHERE status IS NULL;
