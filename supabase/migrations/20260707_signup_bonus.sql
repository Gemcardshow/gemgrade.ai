-- One-time signup bonus ledger type and per-user idempotency guard.

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN (
    'purchase',
    'scan_scout',
    'scan_pro',
    'admin_grant',
    'refund',
    'signup_bonus'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_signup_bonus_user_unique
  ON public.credit_transactions (user_id)
  WHERE type = 'signup_bonus';
