-- =============================================================================
-- Shopify credit grants: idempotent order tracking + pending grants for unknown emails
-- Apply in Supabase SQL Editor or via Supabase CLI.
-- =============================================================================

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS shopify_order_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_shopify_order_id_unique
  ON public.credit_transactions (shopify_order_id)
  WHERE shopify_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pending_credit_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  credits             integer NOT NULL CHECK (credits > 0),
  shopify_order_id    text NOT NULL UNIQUE,
  shopify_order_number text NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  fulfilled_at        timestamptz NULL,
  fulfilled_user_id   uuid NULL REFERENCES public.profiles (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pending_credit_grants_unfulfilled_email_idx
  ON public.pending_credit_grants (lower(email))
  WHERE fulfilled_at IS NULL;

GRANT ALL ON public.pending_credit_grants TO service_role;
