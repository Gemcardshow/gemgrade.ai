-- Apple In-App Purchase credit grants.
-- Idempotent per Apple transaction id.
-- Does not change Shopify columns, scan pricing, or existing balances.

ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS apple_transaction_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_apple_transaction_id_unique
  ON public.credit_transactions (apple_transaction_id)
  WHERE apple_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.grant_apple_purchase_credits(
  p_user_id uuid,
  p_amount integer,
  p_apple_transaction_id text,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
  new_balance integer;
  new_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF p_apple_transaction_id IS NULL OR btrim(p_apple_transaction_id) = '' THEN
    RAISE EXCEPTION 'Apple transaction id is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;

  PERFORM 1
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT id
  INTO existing_id
  FROM public.credit_transactions
  WHERE apple_transaction_id = p_apple_transaction_id
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    SELECT credit_balance
    INTO new_balance
    FROM public.profiles
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'balance', new_balance,
      'transactionId', existing_id,
      'creditsGranted', 0
    );
  END IF;

  UPDATE public.profiles
  SET credit_balance = credit_balance + p_amount
  WHERE id = p_user_id
  RETURNING credit_balance INTO new_balance;

  INSERT INTO public.credit_transactions (
    user_id,
    amount,
    type,
    metadata,
    apple_transaction_id
  )
  VALUES (
    p_user_id,
    p_amount,
    'purchase',
    COALESCE(p_metadata, '{}'::jsonb),
    p_apple_transaction_id
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'balance', new_balance,
    'transactionId', new_id,
    'creditsGranted', p_amount
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT id
    INTO existing_id
    FROM public.credit_transactions
    WHERE apple_transaction_id = p_apple_transaction_id
    LIMIT 1;

    SELECT credit_balance
    INTO new_balance
    FROM public.profiles
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'balance', COALESCE(new_balance, 0),
      'transactionId', existing_id,
      'creditsGranted', 0
    );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_apple_purchase_credits(uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_apple_purchase_credits(uuid, integer, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.grant_apple_purchase_credits(uuid, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_apple_purchase_credits(uuid, integer, text, jsonb) TO service_role;
