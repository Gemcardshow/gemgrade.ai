import {
  CREDIT_COSTS,
  getScanCreditCost,
  getScanTransactionType,
  normalizeScanMode,
} from "./scanCredits.js";

export { CREDIT_COSTS, getScanCreditCost, getScanTransactionType, normalizeScanMode };

/** Placeholder pack sizes for Sprint 1 purchase API. */
export const CREDIT_PACKS = {
  starter: 10,
  standard: 50,
  pro: 100,
};

/** @typedef {"starter"|"standard"|"pro"} CreditPackKey */

const RECENT_TRANSACTIONS_LIMIT = 5;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * credit_transactions.scan_id is uuid. Legacy public.scans rows may use integer ids.
 *
 * @param {string | null | undefined} scanId
 * @returns {{ scanId: string | null, legacyScanId: string | null }}
 */
export function resolveCreditTransactionScanLink(scanId) {
  if (scanId === null || scanId === undefined || scanId === "") {
    return { scanId: null, legacyScanId: null };
  }

  const value = String(scanId).trim();

  if (UUID_PATTERN.test(value)) {
    return { scanId: value, legacyScanId: null };
  }

  return { scanId: null, legacyScanId: value };
}

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
    balance: Number(profile?.credit_balance ?? 0),
    email: profile?.email ?? "",
    recentTransactions: (transactions ?? []).map(mapTransaction),
  };
}

/**
 * Ensure a profiles row exists for credit reads and purchases.
 * Uses service role in trusted API routes only — does not modify balances.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} [email]
 * @returns {Promise<void>}
 */
export async function ensureCreditProfile(supabase, userId, email = "") {
  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  if (existing) {
    return;
  }

  const { error: insertError } = await supabase.from("profiles").insert({
    id: userId,
    email,
    credit_balance: 0,
  });

  if (insertError && insertError.code !== "23505") {
    throw new Error(insertError.message);
  }
}

/** @typedef {import("./scanCredits.js").ScanMode} ScanMode */

export class InsufficientCreditsError extends Error {
  /**
   * @param {number} required
   * @param {number} balance
   * @param {ScanMode} mode
   */
  constructor(required, balance, mode) {
    super(
      `Insufficient credits: ${balance} available, ${required} required for ${mode} scan.`,
    );
    this.name = "InsufficientCreditsError";
    this.statusCode = 402;
    this.required = required;
    this.balance = balance;
    this.mode = mode;
  }

  toJSON() {
    return {
      error: this.message,
      required: this.required,
      balance: this.balance,
      mode: this.mode,
    };
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getUserCreditBalance(supabase, userId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    throw new Error(error?.message || "Profile not found");
  }

  return profile.credit_balance;
}

/**
 * @typedef {Object} ScanCreditDeductionResult
 * @property {number} balance
 * @property {string} transactionId
 * @property {number} creditsDeducted
 */

/**
 * Deduct scan credits after a successful grade. Uses service-role writes.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {unknown} mode
 * @param {string | null} [scanId]
 * @returns {Promise<ScanCreditDeductionResult>}
 */
export async function deductScanCredits(supabase, userId, mode, scanId = null) {
  const normalizedMode = normalizeScanMode(mode);
  const cost = getScanCreditCost(normalizedMode);
  const type = getScanTransactionType(normalizedMode);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error(profileError?.message || "Profile not found");
  }

  if (profile.credit_balance < cost) {
    throw new InsufficientCreditsError(
      cost,
      profile.credit_balance,
      normalizedMode,
    );
  }

  const previousBalance = profile.credit_balance;
  const newBalance = previousBalance - cost;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ credit_balance: newBalance })
    .eq("id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const scanLink = resolveCreditTransactionScanLink(scanId);

  const { data: transaction, error: insertError } = await supabase
    .from("credit_transactions")
    .insert({
      user_id: userId,
      amount: -cost,
      type,
      scan_id: scanLink.scanId,
      metadata: {
        mode: normalizedMode,
        ...(scanLink.legacyScanId ? { legacy_scan_id: scanLink.legacyScanId } : {}),
      },
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase
      .from("profiles")
      .update({ credit_balance: previousBalance })
      .eq("id", userId);
    throw new Error(insertError.message);
  }

  return {
    balance: newBalance,
    transactionId: String(transaction.id),
    creditsDeducted: cost,
  };
}

export class PurchaseValidationError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   */
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "PurchaseValidationError";
    this.statusCode = statusCode;
  }
}

/** @returns {boolean} */
export function isCreditsPlaceholderModeEnabled() {
  return process.env.CREDITS_PLACEHOLDER_MODE?.trim().toLowerCase() === "true";
}

/**
 * @param {unknown} packKey
 * @returns {number | null}
 */
export function resolvePackCredits(packKey) {
  if (typeof packKey !== "string") {
    return null;
  }

  const key = packKey.trim();

  if (!Object.hasOwn(CREDIT_PACKS, key)) {
    return null;
  }

  return CREDIT_PACKS[key];
}

/**
 * @typedef {Object} PlaceholderPurchaseResult
 * @property {number} balance
 * @property {string} transactionId
 * @property {number} creditsGranted
 */

/**
 * Grant credits via placeholder purchase using service-role writes.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} packKey
 * @returns {Promise<PlaceholderPurchaseResult>}
 */
export async function purchasePlaceholderCredits(supabase, userId, packKey) {
  const amount = resolvePackCredits(packKey);

  if (amount === null) {
    throw new PurchaseValidationError("Invalid pack");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    throw new Error(profileError?.message || "Profile not found");
  }

  const previousBalance = profile.credit_balance;
  const newBalance = previousBalance + amount;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ credit_balance: newBalance })
    .eq("id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const metadata = {
    pack: packKey,
    placeholder: true,
  };

  const { data: transaction, error: insertError } = await supabase
    .from("credit_transactions")
    .insert({
      user_id: userId,
      amount,
      type: "purchase",
      metadata,
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase
      .from("profiles")
      .update({ credit_balance: previousBalance })
      .eq("id", userId);
    throw new Error(insertError.message);
  }

  return {
    balance: newBalance,
    transactionId: String(transaction.id),
    creditsGranted: amount,
  };
}

/**
 * @typedef {Object} PlaceholderPurchaseOutcome
 * @property {number} status
 * @property {string} [error]
 * @property {PlaceholderPurchaseResult} [data]
 */

/**
 * Orchestrate placeholder purchase checks and service-role grant.
 *
 * @param {string | null | undefined} userId
 * @param {unknown} pack
 * @param {{
 *   placeholderEnabled?: boolean,
 *   getServiceRoleClient?: () => import("@supabase/supabase-js").SupabaseClient | null,
 *   purchaseCredits?: typeof purchasePlaceholderCredits,
 * }} [options]
 * @returns {Promise<PlaceholderPurchaseOutcome>}
 */
export async function executePlaceholderPurchase(userId, pack, options = {}) {
  if (!userId) {
    return { status: 401, error: "Unauthorized" };
  }

  const placeholderEnabled =
    options.placeholderEnabled ?? isCreditsPlaceholderModeEnabled();

  if (!placeholderEnabled) {
    return { status: 403, error: "Placeholder purchases are disabled" };
  }

  if (resolvePackCredits(pack) === null) {
    return { status: 400, error: "Invalid pack" };
  }

  const getClient =
    options.getServiceRoleClient ??
    (async () => {
      const { getServiceRoleClient } = await import("./supabase/server.js");
      return getServiceRoleClient();
    });

  const supabase = await getClient();

  if (!supabase) {
    return { status: 503, error: "Supabase service role is not configured" };
  }

  const purchaseCredits =
    options.purchaseCredits ?? purchasePlaceholderCredits;

  try {
    const data = await purchaseCredits(supabase, userId, String(pack).trim());
    return { status: 200, data };
  } catch (error) {
    if (error instanceof PurchaseValidationError) {
      return { status: error.statusCode, error: error.message };
    }

    const message =
      error instanceof Error ? error.message : "Failed to purchase credits";
    return { status: 500, error: message };
  }
}
