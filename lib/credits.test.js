import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  getCreditBalanceSummary,
} from "./credits.js";

test("CREDIT_COSTS defines scout and pro scan costs", () => {
  assert.equal(CREDIT_COSTS.scout, 1);
  assert.equal(CREDIT_COSTS.pro, 2);
});

test("CREDIT_PACKS uses sprint defaults", () => {
  assert.equal(CREDIT_PACKS.starter, 10);
  assert.equal(CREDIT_PACKS.standard, 50);
  assert.equal(CREDIT_PACKS.pro_pack, 100);
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
