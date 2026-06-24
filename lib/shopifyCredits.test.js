import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  extractShopifyOrderCredits,
  fulfillPendingGrantsForEmail,
  normalizeShopifyEmail,
  parseCreditMapEnv,
  processShopifyPaidOrder,
  sumCreditsFromLineItems,
  verifyShopifyWebhookHmac,
} from "./shopifyCredits.js";

test("normalizeShopifyEmail lowercases and trims", () => {
  assert.equal(normalizeShopifyEmail("  Buyer@Example.COM "), "buyer@example.com");
  assert.equal(normalizeShopifyEmail(""), "");
});

test("parseCreditMapEnv parses valid JSON maps and ignores invalid entries", () => {
  assert.deepEqual(parseCreditMapEnv('{"111":10,"222":"50","bad":0,"x":"nope"}'), {
    111: 10,
    222: 50,
  });
  assert.deepEqual(parseCreditMapEnv(""), {});
  assert.deepEqual(parseCreditMapEnv("not-json"), {});
});

test("sumCreditsFromLineItems maps variant id and sku with quantity", () => {
  const result = sumCreditsFromLineItems(
    [
      { variant_id: 111, sku: "GG-SCOUT-10", quantity: 2 },
      { variant_id: 999, sku: "OTHER", quantity: 1 },
      { variant_id: 222, sku: "GG-STANDARD-50", quantity: 1 },
    ],
    {
      variantMap: { 111: 10, 222: 50 },
      skuMap: { "GG-STANDARD-50": 50 },
    },
  );

  assert.equal(result.credits, 70);
  assert.equal(result.matchedItems.length, 2);
});

test("extractShopifyOrderCredits reads email, order id, and credits", () => {
  const extracted = extractShopifyOrderCredits(
    {
      id: 5001,
      email: "Buyer@Example.COM",
      order_number: 1001,
      line_items: [{ variant_id: 111, quantity: 1 }],
    },
    { variantMap: { 111: 10 }, skuMap: {} },
  );

  assert.equal(extracted.email, "buyer@example.com");
  assert.equal(extracted.orderId, "5001");
  assert.equal(extracted.orderNumber, "1001");
  assert.equal(extracted.credits, 10);
});

test("verifyShopifyWebhookHmac accepts valid signatures and rejects invalid ones", () => {
  const secret = "test-webhook-secret";
  const body = Buffer.from('{"id":1}', "utf8");
  const digest = crypto.createHmac("sha256", secret).update(body).digest("base64");

  assert.equal(verifyShopifyWebhookHmac(body, digest, secret), true);
  assert.equal(verifyShopifyWebhookHmac(body, "bad-signature", secret), false);
  assert.equal(verifyShopifyWebhookHmac(body, digest, ""), false);
});

/**
 * @param {{
 *   profiles?: Array<{ id: string, email: string, credit_balance: number }>,
 *   transactions?: Array<Record<string, unknown>>,
 *   pending?: Array<Record<string, unknown>>,
 * }} initial
 */
function createShopifySupabase(initial = {}) {
  const profiles = [...(initial.profiles ?? [])];
  const transactions = [...(initial.transactions ?? [])];
  const pending = [...(initial.pending ?? [])];

  return {
    profiles,
    transactions,
    pending,
    client: {
      from(table) {
        if (table === "profiles") {
          return {
            select(columns) {
              return {
                eq(column, value) {
                  if (column === "id") {
                    const profile = profiles.find((row) => row.id === value);
                    return {
                      async maybeSingle() {
                        return { data: profile ?? null, error: null };
                      },
                      async single() {
                        const row = profiles.find((item) => item.id === value);
                        return {
                          data: row ?? null,
                          error: row ? null : { message: "Profile not found" },
                        };
                      },
                    };
                  }

                  throw new Error(`Unexpected profiles.eq column: ${column}`);
                },
                ilike(column, value) {
                  assert.equal(column, "email");
                  const profile = profiles.find(
                    (row) => row.email.toLowerCase() === value.toLowerCase(),
                  );
                  return {
                    async maybeSingle() {
                      return { data: profile ?? null, error: null };
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(column, value) {
                  const profile = profiles.find((row) => row.id === value);
                  if (profile && payload.credit_balance !== undefined) {
                    profile.credit_balance = payload.credit_balance;
                  }
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
                eq(column, value) {
                  if (column === "shopify_order_id") {
                    const row = transactions.find(
                      (item) => item.shopify_order_id === value,
                    );
                    return {
                      async maybeSingle() {
                        return { data: row ?? null, error: null };
                      },
                    };
                  }

                  throw new Error(
                    `Unexpected credit_transactions.eq column: ${column}`,
                  );
                },
              };
            },
            insert(payload) {
              const duplicate = transactions.some(
                (item) =>
                  payload.shopify_order_id &&
                  item.shopify_order_id === payload.shopify_order_id,
              );

              if (duplicate) {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: null,
                          error: { code: "23505", message: "duplicate key" },
                        };
                      },
                    };
                  },
                };
              }

              const row = {
                id: `tx-${transactions.length + 1}`,
                ...payload,
              };
              transactions.push(row);
              return {
                select() {
                  return {
                    async single() {
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
          };
        }

        if (table === "pending_credit_grants") {
          return {
            select() {
              return {
                eq(column, value) {
                  if (column === "shopify_order_id") {
                    const row = pending.find(
                      (item) => item.shopify_order_id === value,
                    );
                    return {
                      async maybeSingle() {
                        return { data: row ?? null, error: null };
                      },
                    };
                  }

                  throw new Error(
                    `Unexpected pending_credit_grants.eq column: ${column}`,
                  );
                },
                is(column, value) {
                  assert.equal(column, "fulfilled_at");
                  assert.equal(value, null);
                  return {
                    ilike(emailColumn, emailValue) {
                      assert.equal(emailColumn, "email");
                      const rows = pending.filter(
                        (item) =>
                          !item.fulfilled_at &&
                          item.email.toLowerCase() === emailValue.toLowerCase(),
                      );
                      return {
                        order() {
                          return {
                            async then(resolve) {
                              resolve({ data: rows, error: null });
                            },
                          };
                        },
                      };
                    },
                    eq(idColumn, idValue) {
                      assert.equal(idColumn, "id");
                      const row = pending.find((item) => item.id === idValue);
                      return {
                        async then(resolve) {
                          if (row && !row.fulfilled_at) {
                            row.fulfilled_at = new Date().toISOString();
                          }
                          resolve({ error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
            insert(payload) {
              const duplicate = pending.some(
                (item) => item.shopify_order_id === payload.shopify_order_id,
              );

              if (duplicate) {
                return {
                  select() {
                    return {
                      async single() {
                        return {
                          data: null,
                          error: { code: "23505", message: "duplicate key" },
                        };
                      },
                    };
                  },
                };
              }

              const row = {
                id: `pending-${pending.length + 1}`,
                fulfilled_at: null,
                ...payload,
              };
              pending.push(row);
              return {
                select() {
                  return {
                    async single() {
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
            update(payload) {
              return {
                eq(idColumn, idValue) {
                  assert.equal(idColumn, "id");
                  return {
                    is(column, value) {
                      assert.equal(column, "fulfilled_at");
                      assert.equal(value, null);
                      const row = pending.find((item) => item.id === idValue);
                      if (row && !row.fulfilled_at) {
                        Object.assign(row, payload);
                      }
                      return Promise.resolve({ error: null });
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

test("processShopifyPaidOrder grants credits when profile exists", async () => {
  const mock = createShopifySupabase({
    profiles: [
      {
        id: "user-1",
        email: "buyer@example.com",
        credit_balance: 5,
      },
    ],
  });

  const result = await processShopifyPaidOrder(
    mock.client,
    {
      id: 9001,
      email: "buyer@example.com",
      order_number: 42,
      line_items: [{ variant_id: 111, quantity: 1 }],
    },
    { variantMap: { 111: 10 }, skuMap: {} },
  );

  assert.equal(result.status, "granted");
  assert.equal(result.credits, 10);
  assert.equal(mock.profiles[0].credit_balance, 15);
  assert.equal(mock.transactions.length, 1);
  assert.equal(mock.transactions[0].shopify_order_id, "9001");
});

test("processShopifyPaidOrder creates pending grant when profile is missing", async () => {
  const mock = createShopifySupabase();

  const result = await processShopifyPaidOrder(
    mock.client,
    {
      id: 9002,
      email: "newbuyer@example.com",
      order_number: 43,
      line_items: [{ sku: "GG-SCOUT-10", quantity: 1 }],
    },
    { variantMap: {}, skuMap: { "GG-SCOUT-10": 10 } },
  );

  assert.equal(result.status, "pending");
  assert.equal(result.credits, 10);
  assert.equal(mock.pending.length, 1);
  assert.equal(mock.pending[0].email, "newbuyer@example.com");
  assert.equal(mock.transactions.length, 0);
});

test("processShopifyPaidOrder is idempotent for duplicate webhooks", async () => {
  const mock = createShopifySupabase({
    profiles: [
      {
        id: "user-1",
        email: "buyer@example.com",
        credit_balance: 20,
      },
    ],
    transactions: [
      {
        id: "tx-existing",
        shopify_order_id: "9003",
        amount: 10,
      },
    ],
  });

  const result = await processShopifyPaidOrder(
    mock.client,
    {
      id: 9003,
      email: "buyer@example.com",
      line_items: [{ variant_id: 111, quantity: 1 }],
    },
    { variantMap: { 111: 10 }, skuMap: {} },
  );

  assert.equal(result.status, "duplicate");
  assert.equal(mock.profiles[0].credit_balance, 20);
  assert.equal(mock.transactions.length, 1);
});

test("fulfillPendingGrantsForEmail grants credits once for pending orders", async () => {
  const mock = createShopifySupabase({
    profiles: [
      {
        id: "user-2",
        email: "newbuyer@example.com",
        credit_balance: 0,
      },
    ],
    pending: [
      {
        id: "pending-1",
        email: "newbuyer@example.com",
        credits: 50,
        shopify_order_id: "9100",
        shopify_order_number: "200",
        metadata: { source: "shopify" },
        fulfilled_at: null,
      },
    ],
  });

  const first = await fulfillPendingGrantsForEmail(
    mock.client,
    "user-2",
    "newbuyer@example.com",
  );

  assert.equal(first.fulfilledCount, 1);
  assert.equal(first.creditsGranted, 50);
  assert.equal(mock.profiles[0].credit_balance, 50);
  assert.equal(mock.transactions.length, 1);
  assert.ok(mock.pending[0].fulfilled_at);

  const second = await fulfillPendingGrantsForEmail(
    mock.client,
    "user-2",
    "newbuyer@example.com",
  );

  assert.equal(second.fulfilledCount, 0);
  assert.equal(second.creditsGranted, 0);
  assert.equal(mock.transactions.length, 1);
});
