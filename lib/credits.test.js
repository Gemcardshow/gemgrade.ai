import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  deductScanCredits,
  executePlaceholderPurchase,
  getCreditBalanceSummary,
  getScanCreditCost,
  getScanTransactionType,
  InsufficientCreditsError,
  isCreditsPlaceholderModeEnabled,
  normalizeScanMode,
  purchasePlaceholderCredits,
  resolvePackCredits,
} from "./credits.js";

test("CREDIT_COSTS defines scout and pro scan costs", () => {
  assert.equal(CREDIT_COSTS.scout, 1);
  assert.equal(CREDIT_COSTS.pro, 2);
  assert.equal(getScanCreditCost("scout"), 1);
  assert.equal(getScanCreditCost("pro"), 2);
  assert.equal(getScanTransactionType("scout"), "scan_scout");
  assert.equal(getScanTransactionType("pro"), "scan_pro");
  assert.equal(normalizeScanMode("scout"), "scout");
  assert.equal(normalizeScanMode(undefined), "pro");
});

test("CREDIT_PACKS uses sprint defaults", () => {
  assert.equal(CREDIT_PACKS.starter, 10);
  assert.equal(CREDIT_PACKS.standard, 50);
  assert.equal(CREDIT_PACKS.pro, 100);
});

test("resolvePackCredits accepts valid packs and rejects invalid keys", () => {
  assert.equal(resolvePackCredits("starter"), 10);
  assert.equal(resolvePackCredits("standard"), 50);
  assert.equal(resolvePackCredits("pro"), 100);
  assert.equal(resolvePackCredits("pro_pack"), null);
  assert.equal(resolvePackCredits(""), null);
  assert.equal(resolvePackCredits(null), null);
});

test("isCreditsPlaceholderModeEnabled reads CREDITS_PLACEHOLDER_MODE", () => {
  const saved = process.env.CREDITS_PLACEHOLDER_MODE;

  process.env.CREDITS_PLACEHOLDER_MODE = "true";
  assert.equal(isCreditsPlaceholderModeEnabled(), true);

  process.env.CREDITS_PLACEHOLDER_MODE = "false";
  assert.equal(isCreditsPlaceholderModeEnabled(), false);

  delete process.env.CREDITS_PLACEHOLDER_MODE;
  assert.equal(isCreditsPlaceholderModeEnabled(), false);

  if (saved === undefined) {
    delete process.env.CREDITS_PLACEHOLDER_MODE;
  } else {
    process.env.CREDITS_PLACEHOLDER_MODE = saved;
  }
});

/**
 * @param {{
 *   profile?: { credit_balance: number, email: string } | null,
 *   transactions?: Array<Record<string, unknown>>,
 *   profileError?: { message: string } | null,
 *   transactionsError?: { message: string } | null,
 * }} config
 */
function createMockSupabase(config) {
  return {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (config.profileError) {
                      return { data: null, error: config.profileError };
                    }
                    return { data: config.profile ?? null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "credit_transactions") {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      async limit() {
                        if (config.transactionsError) {
                          return { data: null, error: config.transactionsError };
                        }
                        return {
                          data: config.transactions ?? [],
                          error: null,
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("getCreditBalanceSummary returns balance and recent transactions", async () => {
  const supabase = createMockSupabase({
    profile: { credit_balance: 42, email: "user@test.com" },
    transactions: [
      {
        id: "tx-1",
        amount: 10,
        type: "purchase",
        created_at: "2026-06-10T00:00:00.000Z",
      },
    ],
  });

  const result = await getCreditBalanceSummary(supabase, "user-uuid");

  assert.equal(result.balance, 42);
  assert.equal(result.email, "user@test.com");
  assert.equal(result.recentTransactions.length, 1);
  assert.equal(result.recentTransactions[0].amount, 10);
  assert.equal(result.recentTransactions[0].type, "purchase");
});

test("getCreditBalanceSummary defaults when profile is missing", async () => {
  const supabase = createMockSupabase({
    profile: null,
    transactions: [],
  });

  const result = await getCreditBalanceSummary(supabase, "user-uuid");

  assert.equal(result.balance, 0);
  assert.equal(result.email, "");
  assert.deepEqual(result.recentTransactions, []);
});

test("getCreditBalanceSummary surfaces profile query errors", async () => {
  const supabase = createMockSupabase({
    profileError: { message: "profiles query failed" },
  });

  await assert.rejects(
    () => getCreditBalanceSummary(supabase, "user-uuid"),
    /profiles query failed/,
  );
});

/**
 * @param {{
 *   startingBalance?: number,
 *   insertError?: { message: string } | null,
 *   updateError?: { message: string } | null,
 * }} config
 */
function createPurchaseMockSupabase(config) {
  let balance = config.startingBalance ?? 0;

  return {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return {
                      data: { credit_balance: balance },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                if (config.updateError) {
                  return Promise.resolve({ error: config.updateError });
                }
                balance = payload.credit_balance;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "credit_transactions") {
        return {
          insert() {
            return {
              select() {
                return {
                  async single() {
                    if (config.insertError) {
                      return { data: null, error: config.insertError };
                    }
                    return {
                      data: { id: "tx-new" },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("purchasePlaceholderCredits grants credits and returns transaction id", async () => {
  const supabase = createPurchaseMockSupabase({ startingBalance: 5 });

  const result = await purchasePlaceholderCredits(
    supabase,
    "user-uuid",
    "starter",
  );

  assert.equal(result.balance, 15);
  assert.equal(result.creditsGranted, 10);
  assert.equal(result.transactionId, "tx-new");
});

test("executePlaceholderPurchase rejects unauthenticated requests", async () => {
  const outcome = await executePlaceholderPurchase(null, "starter", {
    placeholderEnabled: true,
  });

  assert.equal(outcome.status, 401);
  assert.equal(outcome.error, "Unauthorized");
});

test("executePlaceholderPurchase rejects when placeholder mode is disabled", async () => {
  const outcome = await executePlaceholderPurchase("user-uuid", "starter", {
    placeholderEnabled: false,
  });

  assert.equal(outcome.status, 403);
  assert.equal(outcome.error, "Placeholder purchases are disabled");
});

test("executePlaceholderPurchase rejects invalid pack keys", async () => {
  const outcome = await executePlaceholderPurchase("user-uuid", "invalid", {
    placeholderEnabled: true,
  });

  assert.equal(outcome.status, 400);
  assert.equal(outcome.error, "Invalid pack");
});

test("executePlaceholderPurchase grants correct credits for valid pack", async () => {
  const supabase = createPurchaseMockSupabase({ startingBalance: 0 });

  const outcome = await executePlaceholderPurchase("user-uuid", "pro", {
    placeholderEnabled: true,
    getServiceRoleClient: async () => supabase,
  });

  assert.equal(outcome.status, 200);
  assert.equal(outcome.data?.balance, 100);
  assert.equal(outcome.data?.creditsGranted, 100);
  assert.equal(outcome.data?.transactionId, "tx-new");
});

test("deductScanCredits rejects when balance would go negative", async () => {
  const supabase = createPurchaseMockSupabase({ startingBalance: 1 });

  await assert.rejects(
    () => deductScanCredits(supabase, "user-uuid", "pro"),
    InsufficientCreditsError,
  );
});

test("deductScanCredits updates balance for scout scan", async () => {
  const supabase = createPurchaseMockSupabase({ startingBalance: 3 });

  const result = await deductScanCredits(supabase, "user-uuid", "scout", "scan-1");

  assert.equal(result.balance, 2);
  assert.equal(result.creditsDeducted, 1);
});
