/** Scan credit costs — enforcement deferred to Sprint 2. */
export const CREDIT_COSTS = {
  scout: 1,
  pro: 2,
};

/** Placeholder pack sizes — purchase API in Sprint 1 Commit 4. */
export const CREDIT_PACKS = {
  starter: 10,
  standard: 50,
  pro_pack: 100,
};

const RECENT_TRANSACTIONS_LIMIT = 5;

/**
 * @typedef {Object} CreditTransactionSummary
 * @property {string} id
 * @property {number} amount
 * @property {string} type
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CreditBalanceResult
 * @property {number} balance
 * @property {string} email
 * @property {CreditTransactionSummary[]} recentTransactions
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {CreditTransactionSummary}
 */
function mapTransaction(row) {
  return {
    id: String(row.id),
    amount: Number(row.amount),
    type: String(row.type),
    createdAt: String(row.created_at),
  };
}

/**
 * Read credit balance and recent ledger entries for the authenticated user.
 * Uses an RLS-scoped Supabase client — no service-role writes.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<CreditBalanceResult>}
 */
export async function getCreditBalanceSummary(supabase, userId) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credit_balance, email")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from("credit_transactions")
    .select("id, amount, type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_TRANSACTIONS_LIMIT);

  if (transactionsError) {
    throw new Error(transactionsError.message);
  }

  return {
    balance: profile?.credit_balance ?? 0,
    email: profile?.email ?? "",
    recentTransactions: (transactions ?? []).map(mapTransaction),
  };
}
