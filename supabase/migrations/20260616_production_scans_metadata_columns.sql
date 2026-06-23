-- =============================================================================
-- GemGrade Production — Sprint 2 scan metadata columns
-- Safe to run multiple times on existing public.scans (legacy + new rows).
--
-- Run in Supabase Dashboard → SQL Editor (production project).
-- Does not touch grading, credits, or app logic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add missing metadata columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS mode text NULL,
  ADD COLUMN IF NOT EXISTS credits_used integer NULL,
  ADD COLUMN IF NOT EXISTS era text NULL,
  ADD COLUMN IF NOT EXISTS confidence text NULL,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NULL;

-- Backfill null snapshots for existing rows before NOT NULL default enforcement
UPDATE public.scans
SET result_snapshot = '{}'::jsonb
WHERE result_snapshot IS NULL;

-- Ensure default for future inserts (idempotent)
ALTER TABLE public.scans
  ALTER COLUMN result_snapshot SET DEFAULT '{}'::jsonb;

-- Optional: enforce NOT NULL only if no nulls remain (safe on re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.scans
    WHERE result_snapshot IS NULL
  ) THEN
    ALTER TABLE public.scans
      ALTER COLUMN result_snapshot SET NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'scans.result_snapshot NOT NULL not applied: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Constraints (add only if missing)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scans_mode_check'
      AND conrelid = 'public.scans'::regclass
  ) THEN
    ALTER TABLE public.scans
      ADD CONSTRAINT scans_mode_check
      CHECK (mode IS NULL OR mode IN ('scout', 'pro'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scans_credits_used_check'
      AND conrelid = 'public.scans'::regclass
  ) THEN
    ALTER TABLE public.scans
      ADD CONSTRAINT scans_credits_used_check
      CHECK (credits_used IS NULL OR credits_used >= 0);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Helpful index for history queries (no-op if exists)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS scans_created_at_idx
  ON public.scans (created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Grants for service role / PostgREST (idempotent)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.scans TO service_role;
GRANT SELECT ON public.scans TO authenticated;
