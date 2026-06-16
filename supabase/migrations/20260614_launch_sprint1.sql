-- =============================================================================
-- GemGrade Launch Sprint 1
-- profiles + credit_transactions + auth signup hook
-- Apply in Supabase SQL Editor or via Supabase CLI.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id             uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email          text NOT NULL,
  credit_balance integer NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- -----------------------------------------------------------------------------
-- credit_transactions (append-only ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount            integer NOT NULL,
  type              text NOT NULL CHECK (type IN (
                      'purchase',
                      'scan_scout',
                      'scan_pro',
                      'admin_grant',
                      'refund'
                    )),
  scan_id           uuid NULL,
  stripe_session_id text NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx
  ON public.credit_transactions (user_id, created_at DESC);

-- Optional FK when scans.user_id exists (Sprint 2 migration):
-- ALTER TABLE credit_transactions
--   ADD CONSTRAINT credit_transactions_scan_id_fkey
--   FOREIGN KEY (scan_id) REFERENCES public.scans (id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Auto-create profile on signup
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credit_balance)
  VALUES (NEW.id, NEW.email, 0)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "credit_transactions_select_own"
  ON public.credit_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Grants (required for PostgREST / service role)
-- -----------------------------------------------------------------------------
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.credit_transactions TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.credit_transactions TO service_role;
