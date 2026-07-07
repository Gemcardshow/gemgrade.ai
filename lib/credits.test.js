import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  deductScanCredits,
  ensureCreditProfile,
  executePlaceholderPurchase,
  getCreditBalanceSummary,
  getScanCreditCost,
  getScanTransactionType,
  grantSignupBonusIfEligible,
  InsufficientCreditsError,
  isCreditsPlaceholderModeEnabled,
  isEligibleForSignupBonus,
  normalizeScanMode,
  purchasePlaceholderCredits,
  resolveCreditTransactionScanLink,
  resolvePackCredits,
  SIGNUP_BONUS_AMOUNT,
  SIGNUP_BONUS_REASON,
  SIGNUP_BONUS_TYPE,
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

test("getCreditBalanceSummary coerces numeric balance values", async () => {
  const supabase = createMockSupabase({
    profile: { credit_balance: "12", email: "user@test.com" },
    transactions: [],
  });

  const result = await getCreditBalanceSummary(supabase, "user-uuid");

  assert.equal(result.balance, 12);
});

test("ensureCreditProfile inserts a zero-balance profile when missing", async () => {
  let inserted = false;
  const supabase = {
    from(table) {
      if (table !== "profiles") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        insert(payload) {
          inserted = true;
          assert.equal(payload.id, "user-uuid");
          assert.equal(payload.email, "user@test.com");
          assert.equal(payload.credit_balance, 0);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await ensureCreditProfile(supabase, "user-uuid", "user@test.com");
  assert.equal(inserted, true);
});

test("ensureCreditProfile skips insert when profile already exists", async () => {
  let inserted = false;
  const supabase = {
    from(table) {
      if (table !== "profiles") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { id: "user-uuid" }, error: null };
                },
              };
            },
          };
        },
        insert() {
          inserted = true;
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await ensureCreditProfile(supabase, "user-uuid", "user@test.com");
  assert.equal(inserted, false);
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

test("resolveCreditTransactionScanLink accepts uuid scan ids", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  assert.deepEqual(resolveCreditTransactionScanLink(uuid), {
    scanId: uuid,
    legacyScanId: null,
  });
});

test("resolveCreditTransactionScanLink moves legacy numeric scan ids to metadata", () => {
  assert.deepEqual(resolveCreditTransactionScanLink("112"), {
    scanId: null,
    legacyScanId: "112",
  });
});

test("resolveCreditTransactionScanLink treats empty values as unlinked", () => {
  assert.deepEqual(resolveCreditTransactionScanLink(null), {
    scanId: null,
    legacyScanId: null,
  });
  assert.deepEqual(resolveCreditTransactionScanLink(""), {
    scanId: null,
    legacyScanId: null,
  });
});

test("deductScanCredits stores legacy scan id in metadata for integer scan rows", async () => {
  /** @type {Record<string, unknown> | null} */
  let insertedTransaction = null;
  let balance = 5;

  const supabase = {
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: { credit_balance: balance }, error: null };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq() {
                balance = payload.credit_balance;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "credit_transactions") {
        return {
          insert(payload) {
            insertedTransaction = payload;
            return {
              select() {
                return {
                  async single() {
                    return { data: { id: "tx-112" }, error: null };
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

  const result = await deductScanCredits(supabase, "user-uuid", "pro", "112");

  assert.equal(result.balance, 3);
  assert.equal(result.creditsDeducted, 2);
  assert.equal(insertedTransaction?.scan_id, null);
  assert.equal(insertedTransaction?.metadata?.legacy_scan_id, "112");
  assert.equal(insertedTransaction?.metadata?.mode, "pro");
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

const SIGNUP_BONUS_TEST_ENABLED_AT = new Date("2026-07-07T04:00:00.000Z");

/**
 * @param {{
 *   startingBalance?: number,
 *   existingSignupBonus?: { id: string } | null,
 *   insertError?: { message: string, code?: string } | null,
 * }} config
 */
function createSignupBonusMockSupabase(config) {
  let balance = config.startingBalance ?? 0;
  /** @type {Record<string, unknown> | null} */
  let insertedTransaction = null;

  return {
    insertedTransaction: () => insertedTransaction,
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
                balance = payload.credit_balance;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }

      if (table === "credit_transactions") {
        return {
          select() {
            return {
              eq(_column, value) {
                const filters = { user_id: value };
                return {
                  eq(column, filterValue) {
                    filters[column] = filterValue;
                    return {
                      async maybeSingle() {
                        if (
                          filters.user_id === "user-uuid" &&
                          filters.type === SIGNUP_BONUS_TYPE &&
                          config.existingSignupBonus
                        ) {
                          return {
                            data: config.existingSignupBonus,
                            error: null,
                          };
                        }

                        return { data: null, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
          insert(payload) {
            insertedTransaction = payload;
            return {
              select() {
                return {
                  async single() {
                    if (config.insertError) {
                      return { data: null, error: config.insertError };
                    }

                    return {
                      data: { id: "signup-bonus-tx" },
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

test("isEligibleForSignupBonus allows accounts created after launch cutoff", () => {
  assert.equal(
    isEligibleForSignupBonus(
      "2026-07-08T00:00:00.000Z",
      SIGNUP_BONUS_TEST_ENABLED_AT,
    ),
    true,
  );
  assert.equal(
    isEligibleForSignupBonus(
      "2026-06-01T00:00:00.000Z",
      SIGNUP_BONUS_TEST_ENABLED_AT,
    ),
    false,
  );
});

test("grantSignupBonusIfEligible grants 5 credits to a new user", async () => {
  const supabase = createSignupBonusMockSupabase({ startingBalance: 0 });

  const result = await grantSignupBonusIfEligible(
    supabase,
    "user-uuid",
    "2026-07-08T00:00:00.000Z",
    { enabledAt: SIGNUP_BONUS_TEST_ENABLED_AT },
  );

  assert.equal(result.balance, SIGNUP_BONUS_AMOUNT);
  assert.equal(result.creditsGranted, SIGNUP_BONUS_AMOUNT);
  assert.equal(result.transactionId, "signup-bonus-tx");
  assert.equal(supabase.insertedTransaction()?.type, SIGNUP_BONUS_TYPE);
  assert.equal(supabase.insertedTransaction()?.amount, SIGNUP_BONUS_AMOUNT);
  assert.equal(supabase.insertedTransaction()?.metadata?.reason, SIGNUP_BONUS_REASON);
});

test("grantSignupBonusIfEligible does not grant credits to existing users", async () => {
  const supabase = createSignupBonusMockSupabase({ startingBalance: 3 });

  const result = await grantSignupBonusIfEligible(
    supabase,
    "user-uuid",
    "2026-05-01T00:00:00.000Z",
    { enabledAt: SIGNUP_BONUS_TEST_ENABLED_AT },
  );

  assert.equal(result.balance, 3);
  assert.equal(result.creditsGranted, 0);
  assert.equal(supabase.insertedTransaction(), null);
});

test("grantSignupBonusIfEligible does not create duplicate bonus transactions", async () => {
  const supabase = createSignupBonusMockSupabase({
    startingBalance: 10,
    existingSignupBonus: { id: "existing-signup-bonus" },
  });

  const result = await grantSignupBonusIfEligible(
    supabase,
    "user-uuid",
    "2026-07-08T00:00:00.000Z",
    { enabledAt: SIGNUP_BONUS_TEST_ENABLED_AT },
  );

  assert.equal(result.balance, 10);
  assert.equal(result.creditsGranted, 0);
  assert.equal(result.transactionId, "existing-signup-bonus");
  assert.equal(supabase.insertedTransaction(), null);
});
