-- Fix users.external_id when an older personal_ai.users existed without it.
-- Also avoids resolving to public.users via search_path ambiguities.

ALTER TABLE IF EXISTS personal_ai.users
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Backfill nulls so UNIQUE NOT NULL can apply
UPDATE personal_ai.users
SET external_id = id::text
WHERE external_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_external_id_key'
      AND conrelid = 'personal_ai.users'::regclass
  ) THEN
    ALTER TABLE personal_ai.users ADD CONSTRAINT users_external_id_key UNIQUE (external_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE IF EXISTS personal_ai.users
  ALTER COLUMN external_id SET NOT NULL;

ALTER TABLE IF EXISTS personal_ai.users
  ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE IF EXISTS personal_ai.users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS personal_ai.users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
