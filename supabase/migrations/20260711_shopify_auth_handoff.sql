-- Single-use Shopify → GemGrade auth handoff nonces.

CREATE TABLE IF NOT EXISTS public.shopify_auth_handoff_nonces (
  jti          text PRIMARY KEY,
  shopify_customer_id text NOT NULL,
  email        text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_auth_handoff_nonces_expires_at_idx
  ON public.shopify_auth_handoff_nonces (expires_at);

ALTER TABLE public.shopify_auth_handoff_nonces ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.shopify_auth_handoff_nonces TO service_role;
