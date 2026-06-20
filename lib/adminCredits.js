const ADMIN_TRANSACTION_TYPE = "admin_grant";
const ADMIN_TRANSACTION_REASON = "admin_credit_adjustment";
const RECENT_TRANSACTIONS_LIMIT = 10;

/** @typedef {"add"|"subtract"|"set"} AdminCreditAdjustMode */

export class AdminCreditValidationError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   */
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AdminCreditValidationError";
    this.statusCode = statusCode;
  }
}

/**
 * @param {Record<string, unknown>} row
 */
function mapTransaction(row) {
  return {
    id: String(row.id),
    amount: Number(row.amount),
    type: String(row.type),
    createdAt: String(row.created_at),
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

/**
 * @param {unknown} mode
 * @returns {AdminCreditAdjustMode}
 */
export function normalizeAdminAdjustMode(mode) {
  if (mode === "add" || mode === "subtract" || mode === "set") {
    return mode;
  }

  throw new AdminCreditValidationError(
    'mode must be "add", "subtract", or "set"',
  );
}

/**
 * @param {{
 *   mode: AdminCreditAdjustMode,
 *   amount: number,
 *   currentBalance: number,
 *   allowNegative?: boolean,
 * }} params
 */
export function computeAdminAdjustment({
  mode,
  amount,
  currentBalance,
  allowNegative = false,
}) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AdminCreditValidationError(
      "amount must be a non-negative number",
    );
  }

  let newBalance = currentBalance;
  let delta = 0;

  if (mode === "add") {
    delta = amount;
    newBalance = currentBalance + amount;
  } else if (mode === "subtract") {
    delta = -amount;
    newBalance = currentBalance - amount;
  } else {
    newBalance = amount;
    delta = amount - currentBalance;
  }

  if (newBalance < 0 && !allowNegative) {
    throw new AdminCreditValidationError(
      `Balance cannot go below zero (would be ${newBalance})`,
    );
  }

  return {
    previousBalance: currentBalance,
    newBalance,
    delta,
    adjustmentAmount: amount,
    mode,
  };
}

/**
 * @param {{
 *   adminEmail: string,
 *   targetEmail: string,
 *   mode: AdminCreditAdjustMode,
 *   adjustmentAmount: number,
 *   previousBalance: number,
 *   newBalance: number,
 *   reason: string,
 * }} params
 */
export function buildAdminCreditTransactionMetadata({
  adminEmail,
  targetEmail,
  mode,
  adjustmentAmount,
  previousBalance,
  newBalance,
  reason,
}) {
  return {
    reason: ADMIN_TRANSACTION_REASON,
    admin_email: adminEmail,
    target_email: targetEmail,
    adjustment_amount: adjustmentAmount,
    previous_balance: previousBalance,
    new_balance: newBalance,
    admin_reason: reason,
    mode,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 */
export async function searchUserByEmail(supabase, email) {
  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    throw new AdminCreditValidationError("email is required");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, credit_balance, created_at")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profile) {
    return null;
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from("credit_transactions")
    .select("id, amount, type, created_at, metadata")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_TRANSACTIONS_LIMIT);

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  return {
    user: {
      id: String(profile.id),
      email: String(profile.email),
      balance: Number(profile.credit_balance ?? 0),
      createdAt: profile.created_at ? String(profile.created_at) : null,
    },
    recentTransactions: (transactions ?? []).map(mapTransaction),
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 */
async function loadTargetProfile(supabase, userId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, credit_balance")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!profile) {
    throw new AdminCreditValidationError("User not found", 404);
  }

  return profile;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ email?: string, user_id?: string }} target
 */
async function resolveTargetProfile(supabase, target) {
  const email =
    typeof target.email === "string" ? target.email.trim() : "";
  const userId =
    typeof target.user_id === "string" ? target.user_id.trim() : "";

  if (userId) {
    return loadTargetProfile(supabase, userId);
  }

  if (email) {
    const result = await searchUserByEmail(supabase, email);

    if (!result) {
      throw new AdminCreditValidationError("User not found", 404);
    }

    return {
      id: result.user.id,
      email: result.user.email,
      credit_balance: result.user.balance,
    };
  }

  throw new AdminCreditValidationError("email or user_id is required");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   adminEmail: string,
 *   email?: string,
 *   user_id?: string,
 *   amount: unknown,
 *   mode: unknown,
 *   reason?: string,
 *   allowNegative?: boolean,
 * }} params
 */
export async function adjustUserCredits(supabase, params) {
  const mode = normalizeAdminAdjustMode(params.mode);
  const amount = Number(params.amount);
  const reason =
    typeof params.reason === "string" ? params.reason.trim() : "";

  if (!reason) {
    throw new AdminCreditValidationError("reason is required");
  }

  const profile = await resolveTargetProfile(supabase, {
    email: params.email,
    user_id: params.user_id,
  });

  const adjustment = computeAdminAdjustment({
    mode,
    amount,
    currentBalance: Number(profile.credit_balance ?? 0),
    allowNegative: params.allowNegative === true,
  });

  if (adjustment.delta === 0) {
    return {
      userId: String(profile.id),
      email: String(profile.email),
      previousBalance: adjustment.previousBalance,
      balance: adjustment.newBalance,
      transactionId: null,
      adjustment,
    };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ credit_balance: adjustment.newBalance })
    .eq("id", profile.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const metadata = buildAdminCreditTransactionMetadata({
    adminEmail: params.adminEmail,
    targetEmail: String(profile.email),
    mode,
    adjustmentAmount: adjustment.adjustmentAmount,
    previousBalance: adjustment.previousBalance,
    newBalance: adjustment.newBalance,
    reason,
  });

  const { data: transaction, error: insertError } = await supabase
    .from("credit_transactions")
    .insert({
      user_id: profile.id,
      amount: adjustment.delta,
      type: ADMIN_TRANSACTION_TYPE,
      metadata,
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase
      .from("profiles")
      .update({ credit_balance: adjustment.previousBalance })
      .eq("id", profile.id);
    throw new Error(insertError.message);
  }

  return {
    userId: String(profile.id),
    email: String(profile.email),
    previousBalance: adjustment.previousBalance,
    balance: adjustment.newBalance,
    transactionId: String(transaction.id),
    adjustment,
  };
}
