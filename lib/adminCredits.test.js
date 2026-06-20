import test from "node:test";
import assert from "node:assert/strict";
import { isAdminUser } from "./adminAuth.js";
import {
  AdminCreditValidationError,
  adjustUserCredits,
  buildAdminCreditTransactionMetadata,
  computeAdminAdjustment,
  searchUserByEmail,
} from "./adminCredits.js";

test("non-admin users are blocked from admin operations", () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "gemcardshow@gmail.com,akurgin@att.net";

  assert.equal(isAdminUser({ email: "beta@test.com" }), false);
  assert.equal(isAdminUser({ email: "gemcardshow@gmail.com" }), true);

  if (saved === undefined) {
    delete process.env.ADMIN_EMAILS;
  } else {
    process.env.ADMIN_EMAILS = saved;
  }
});

/**
 * @param {{
 *   profile?: Record<string, unknown> | null,
 *   transactions?: Array<Record<string, unknown>>,
 *   startingBalance?: number,
 * }} config
 */
function createAdminMockSupabase(config) {
  let balance = config.startingBalance ?? config.profile?.credit_balance ?? 0;
  /** @type {Record<string, unknown> | null} */
  let insertedTransaction = null;

  return {
    insertedTransaction: () => insertedTransaction,
    supabase: {
      from(table) {
        if (table === "profiles") {
          return {
            select() {
              return {
                eq(_column, value) {
                  return {
                    async maybeSingle() {
                      const profile = config.profile;

                      if (!profile) {
                        return { data: null, error: null };
                      }

                      if (String(profile.id) !== String(value)) {
                        return { data: null, error: null };
                      }

                      return {
                        data: {
                          ...profile,
                          credit_balance: balance,
                        },
                        error: null,
                      };
                    },
                  };
                },
                ilike(_column, value) {
                  return {
                    async maybeSingle() {
                      const profile = config.profile;

                      if (
                        !profile ||
                        String(profile.email).toLowerCase() !==
                          String(value).toLowerCase()
                      ) {
                        return { data: null, error: null };
                      }

                      return {
                        data: {
                          ...profile,
                          credit_balance: balance,
                        },
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
                eq() {
                  return {
                    order() {
                      return {
                        async limit() {
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
            insert(payload) {
              insertedTransaction = payload;
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: { id: "admin-tx-1" },
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
    },
  };
}

test("admin can search user by email", async () => {
  const { supabase } = createAdminMockSupabase({
    profile: {
      id: "user-1",
      email: "beta@test.com",
      credit_balance: 25,
      created_at: "2026-06-01T00:00:00.000Z",
    },
    transactions: [
      {
        id: "tx-1",
        amount: 10,
        type: "purchase",
        created_at: "2026-06-02T00:00:00.000Z",
        metadata: {},
      },
    ],
  });

  const result = await searchUserByEmail(supabase, "beta@test.com");

  assert.ok(result);
  assert.equal(result.user.email, "beta@test.com");
  assert.equal(result.user.balance, 25);
  assert.equal(result.user.id, "user-1");
  assert.equal(result.recentTransactions.length, 1);
});

test("admin can add 50 credits", async () => {
  const mock = createAdminMockSupabase({
    profile: {
      id: "user-1",
      email: "beta@test.com",
      credit_balance: 10,
    },
    startingBalance: 10,
  });

  const result = await adjustUserCredits(mock.supabase, {
    adminEmail: "admin@example.com",
    email: "beta@test.com",
    amount: 50,
    mode: "add",
    reason: "Beta bonus",
  });

  assert.equal(result.balance, 60);
  assert.equal(result.previousBalance, 10);
  assert.equal(result.transactionId, "admin-tx-1");
  assert.equal(mock.insertedTransaction()?.amount, 50);
});

test("admin can add 100 credits", async () => {
  const mock = createAdminMockSupabase({
    profile: {
      id: "user-1",
      email: "beta@test.com",
      credit_balance: 0,
    },
    startingBalance: 0,
  });

  const result = await adjustUserCredits(mock.supabase, {
    adminEmail: "admin@example.com",
    email: "beta@test.com",
    amount: 100,
    mode: "add",
    reason: "Beta launch grant",
  });

  assert.equal(result.balance, 100);
  assert.equal(mock.insertedTransaction()?.amount, 100);
});

test("subtract cannot make balance negative unless explicitly allowed", async () => {
  const mock = createAdminMockSupabase({
    profile: {
      id: "user-1",
      email: "beta@test.com",
      credit_balance: 20,
    },
    startingBalance: 20,
  });

  await assert.rejects(
    () =>
      adjustUserCredits(mock.supabase, {
        adminEmail: "admin@example.com",
        email: "beta@test.com",
        amount: 25,
        mode: "subtract",
        reason: "Correction",
      }),
    AdminCreditValidationError,
  );

  const allowed = await adjustUserCredits(mock.supabase, {
    adminEmail: "admin@example.com",
    email: "beta@test.com",
    amount: 25,
    mode: "subtract",
    reason: "Correction",
    allowNegative: true,
  });

  assert.equal(allowed.balance, -5);
});

test("transaction logging payload is created for admin adjustments", async () => {
  const mock = createAdminMockSupabase({
    profile: {
      id: "user-1",
      email: "beta@test.com",
      credit_balance: 40,
    },
    startingBalance: 40,
  });

  await adjustUserCredits(mock.supabase, {
    adminEmail: "admin@example.com",
    email: "beta@test.com",
    amount: 50,
    mode: "add",
    reason: "Manual top-up",
  });

  const transaction = mock.insertedTransaction();
  assert.equal(transaction?.type, "admin_grant");
  assert.equal(transaction?.amount, 50);
  assert.deepEqual(transaction?.metadata, {
    reason: "admin_credit_adjustment",
    admin_email: "admin@example.com",
    target_email: "beta@test.com",
    adjustment_amount: 50,
    previous_balance: 40,
    new_balance: 90,
    admin_reason: "Manual top-up",
    mode: "add",
  });
});

test("computeAdminAdjustment calculates set mode delta", () => {
  const result = computeAdminAdjustment({
    mode: "set",
    amount: 75,
    currentBalance: 40,
  });

  assert.equal(result.newBalance, 75);
  assert.equal(result.delta, 35);
});

test("buildAdminCreditTransactionMetadata includes audit fields", () => {
  const metadata = buildAdminCreditTransactionMetadata({
    adminEmail: "admin@example.com",
    targetEmail: "beta@test.com",
    mode: "subtract",
    adjustmentAmount: 10,
    previousBalance: 30,
    newBalance: 20,
    reason: "Refund correction",
  });

  assert.equal(metadata.reason, "admin_credit_adjustment");
  assert.equal(metadata.admin_email, "admin@example.com");
  assert.equal(metadata.target_email, "beta@test.com");
  assert.equal(metadata.adjustment_amount, 10);
  assert.equal(metadata.previous_balance, 30);
  assert.equal(metadata.new_balance, 20);
  assert.equal(metadata.admin_reason, "Refund correction");
  assert.equal(metadata.mode, "subtract");
});
