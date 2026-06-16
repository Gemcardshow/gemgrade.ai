-- =============================================================================
-- GemGrade Launch Sprint 2 — scan history
-- Extends existing public.scans for per-user history (nullable columns preserve
-- legacy inserts until the app starts populating them).
-- =============================================================================

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mode text NULL CHECK (mode IS NULL OR mode IN ('scout', 'pro')),
  ADD COLUMN IF NOT EXISTS credits_used integer NULL CHECK (credits_used IS NULL OR credits_used >= 0),
  ADD COLUMN IF NOT EXISTS era text NULL,
  ADD COLUMN IF NOT EXISTS confidence text NULL,
  ADD COLUMN IF NOT EXISTS result_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS scans_user_id_created_at_idx
  ON public.scans (user_id, created_at DESC);

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scans_select_own" ON public.scans;
CREATE POLICY "scans_select_own"
  ON public.scans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.scans TO authenticated;

-- Link credit ledger to scans when both exist:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'credit_transactions_scan_id_fkey'
  ) THEN
    ALTER TABLE public.credit_transactions
      ADD CONSTRAINT credit_transactions_scan_id_fkey
      FOREIGN KEY (scan_id) REFERENCES public.scans (id) ON DELETE SET NULL;
  END IF;
END $$;
