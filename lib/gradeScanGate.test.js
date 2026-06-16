import test from "node:test";
import assert from "node:assert/strict";
import { executeCreditGatedScan } from "./gradeScanGate.js";
import { InsufficientCreditsError } from "./credits.js";

function createBalanceSupabase(startingBalance) {
  let balance = startingBalance;
  /** @type {Array<Record<string, unknown>>} */
  const transactions = [];

  return {
    supabase: {
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
            insert(payload) {
              transactions.push(payload);
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: { id: `tx-${transactions.length}` },
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
    getBalance: () => balance,
    getTransactions: () => transactions,
  };
}

test("executeCreditGatedScan blocks scan when credits are insufficient", async () => {
  const { supabase } = createBalanceSupabase(1);
  let gradeCalled = false;

  await assert.rejects(
    () =>
      executeCreditGatedScan({
        userId: "user-1",
        mode: "pro",
        supabase,
        runGrade: async () => {
          gradeCalled = true;
          return { psaGrade: 8 };
        },
        saveScanRecord: async () => "scan-1",
      }),
    InsufficientCreditsError,
  );

  assert.equal(gradeCalled, false);
});

test("executeCreditGatedScan deducts 1 credit for scout scans", async () => {
  const { supabase, getBalance, getTransactions } = createBalanceSupabase(5);

  const result = await executeCreditGatedScan({
    userId: "user-1",
    mode: "scout",
    supabase,
    runGrade: async () => ({ psaGrade: 9 }),
    saveScanRecord: async () => "scan-scout",
  });

  assert.equal(result.deduction.creditsDeducted, 1);
  assert.equal(getBalance(), 4);
  assert.equal(getTransactions()[0].type, "scan_scout");
  assert.equal(getTransactions()[0].amount, -1);
  assert.equal(getTransactions()[0].scan_id, "scan-scout");
});

test("executeCreditGatedScan deducts 2 credits for pro scans", async () => {
  const { supabase, getBalance, getTransactions } = createBalanceSupabase(5);

  const result = await executeCreditGatedScan({
    userId: "user-1",
    mode: "pro",
    supabase,
    runGrade: async () => ({ psaGrade: 9 }),
    saveScanRecord: async () => "scan-pro",
  });

  assert.equal(result.deduction.creditsDeducted, 2);
  assert.equal(getBalance(), 3);
  assert.equal(getTransactions()[0].type, "scan_pro");
  assert.equal(getTransactions()[0].amount, -2);
});

test("executeCreditGatedScan does not deduct when grading fails", async () => {
  const { supabase, getBalance, getTransactions } = createBalanceSupabase(5);

  await assert.rejects(
    () =>
      executeCreditGatedScan({
        userId: "user-1",
        mode: "scout",
        supabase,
        runGrade: async () => {
          throw new Error("grading failed");
        },
        saveScanRecord: async () => "scan-1",
      }),
    /grading failed/,
  );

  assert.equal(getBalance(), 5);
  assert.equal(getTransactions().length, 0);
});

test("executeCreditGatedScan does not deduct when scan persistence fails", async () => {
  const { supabase, getBalance, getTransactions } = createBalanceSupabase(5);

  await assert.rejects(
    () =>
      executeCreditGatedScan({
        userId: "user-1",
        mode: "scout",
        supabase,
        runGrade: async () => ({ psaGrade: 8 }),
        saveScanRecord: async () => {
          throw new Error("save failed");
        },
      }),
    /save failed/,
  );

  assert.equal(getBalance(), 5);
  assert.equal(getTransactions().length, 0);
});
