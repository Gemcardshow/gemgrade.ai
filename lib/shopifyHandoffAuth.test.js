import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  clearShopifyAdminAccessTokenCache,
  consumeShopifyHandoffToken,
  createShopifyHandoffToken,
  establishGemGradeSession,
  fetchShopifyCustomerEmail,
  findOrCreateGemGradeUser,
  finalizeShopifyHandoffUser,
  registerShopifyHandoffNonce,
  resolveShopifyAdminAccessToken,
  sanitizeHandoffNextPath,
  ShopifyHandoffError,
  verifyShopifyAppProxySignature,
  verifyShopifyHandoffToken,
} from "./shopifyHandoffAuth.js";

const SECRET = "test-shopify-handoff-secret";

/**
 * @param {{
 *   nonces?: Map<string, Record<string, unknown>>,
 *   profiles?: Array<{ id: string, email: string }>,
 * }} [config]
 */
function createHandoffMockSupabase(config = {}) {
  const nonces = config.nonces ?? new Map();
  const profiles = config.profiles ?? [];

  return {
    nonces,
    auth: {
      admin: {
        async createUser(payload) {
          const existing = profiles.find(
            (row) => row.email.toLowerCase() === payload.email.toLowerCase(),
          );
          if (existing) {
            return {
              data: { user: null },
              error: { message: "User already registered" },
            };
          }

          const user = {
            id: `user-${profiles.length + 1}`,
            email: payload.email,
            created_at: new Date().toISOString(),
          };
          profiles.push({ id: user.id, email: user.email });
          return { data: { user }, error: null };
        },
        async generateLink(payload) {
          const existing = profiles.find(
            (row) => row.email.toLowerCase() === payload.email.toLowerCase(),
          );
          if (!existing) {
            return {
              data: null,
              error: { message: "User not found" },
            };
          }

          return {
            data: {
              user: { id: existing.id, email: existing.email },
              properties: { hashed_token: `hash-${existing.id}` },
            },
            error: null,
          };
        },
      },
      async verifyOtp(payload) {
        if (!payload.token_hash?.startsWith("hash-")) {
          return { data: { user: null }, error: { message: "bad token" } };
        }
        const userId = payload.token_hash.slice("hash-".length);
        const profile = profiles.find((row) => row.id === userId);
        return {
          data: {
            user: profile
              ? {
                  id: profile.id,
                  email: profile.email,
                  created_at: "2026-07-11T00:00:00.000Z",
                }
              : null,
          },
          error: profile ? null : { message: "missing user" },
        };
      },
    },
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return {
              ilike(_column, email) {
                return {
                  async maybeSingle() {
                    const hit = profiles.find(
                      (row) =>
                        row.email.toLowerCase() === String(email).toLowerCase(),
                    );
                    return { data: hit ?? null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "shopify_auth_handoff_nonces") {
        return {
          insert(payload) {
            if (nonces.has(payload.jti)) {
              return Promise.resolve({
                error: { message: "duplicate jti", code: "23505" },
              });
            }
            nonces.set(payload.jti, {
              ...payload,
              consumed_at: null,
            });
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq(_column, jti) {
                return {
                  async maybeSingle() {
                    const row = nonces.get(jti) ?? null;
                    return { data: row, error: null };
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(_column, jti) {
                return {
                  is(_field, value) {
                    return {
                      select() {
                        return {
                          async maybeSingle() {
                            const row = nonces.get(jti);
                            if (!row) {
                              return { data: null, error: null };
                            }
                            if (value === null && row.consumed_at) {
                              return { data: null, error: null };
                            }
                            nonces.set(jti, { ...row, ...payload });
                            return { data: { jti }, error: null };
                          },
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

test("createShopifyHandoffToken signs required claims", () => {
  const { token, claims } = createShopifyHandoffToken({
    shopifyCustomerId: "12345",
    email: " Buyer@GemCardShow.COM ",
    nextPath: "/credits",
    secret: SECRET,
    nowSeconds: 1_700_000_000,
  });

  assert.equal(typeof token, "string");
  assert.equal(claims.email, "buyer@gemcardshow.com");
  assert.equal(claims.cid, "12345");
  assert.equal(claims.next, "/credits");
  assert.equal(claims.exp - claims.iat, 300);
});

test("verifyShopifyHandoffToken accepts a valid handoff", () => {
  const { token, claims } = createShopifyHandoffToken({
    shopifyCustomerId: "99",
    email: "valid@example.com",
    secret: SECRET,
    nowSeconds: 1_700_000_000,
  });

  const verified = verifyShopifyHandoffToken(token, {
    secret: SECRET,
    nowSeconds: 1_700_000_010,
  });

  assert.equal(verified.jti, claims.jti);
  assert.equal(verified.email, "valid@example.com");
});

test("verifyShopifyHandoffToken rejects expired tokens", () => {
  const { token } = createShopifyHandoffToken({
    shopifyCustomerId: "99",
    email: "valid@example.com",
    secret: SECRET,
    nowSeconds: 1_700_000_000,
    ttlSeconds: 60,
  });

  assert.throws(
    () =>
      verifyShopifyHandoffToken(token, {
        secret: SECRET,
        nowSeconds: 1_700_000_061,
      }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "expired_token",
  );
});

test("verifyShopifyHandoffToken rejects altered tokens", () => {
  const { token } = createShopifyHandoffToken({
    shopifyCustomerId: "99",
    email: "valid@example.com",
    secret: SECRET,
  });

  const [payload] = token.split(".");
  const altered = `${payload}.deadbeef`;

  assert.throws(
    () => verifyShopifyHandoffToken(altered, { secret: SECRET }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "altered_token",
  );
});

test("createShopifyHandoffToken rejects missing email", () => {
  assert.throws(
    () =>
      createShopifyHandoffToken({
        shopifyCustomerId: "99",
        email: "",
        secret: SECRET,
      }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "missing_email",
  );
});

test("consumeShopifyHandoffToken rejects replayed tokens", async () => {
  const supabase = createHandoffMockSupabase();
  const { token, claims } = createShopifyHandoffToken({
    shopifyCustomerId: "42",
    email: "replay@example.com",
    secret: SECRET,
    nowSeconds: 1_700_000_000,
  });

  await registerShopifyHandoffNonce(supabase, claims);

  const first = await consumeShopifyHandoffToken(supabase, token, {
    secret: SECRET,
    nowSeconds: 1_700_000_001,
  });
  assert.equal(first.email, "replay@example.com");

  await assert.rejects(
    () =>
      consumeShopifyHandoffToken(supabase, token, {
        secret: SECRET,
        nowSeconds: 1_700_000_002,
      }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "replayed_token",
  );
});

test("findOrCreateGemGradeUser creates a new user", async () => {
  const supabase = createHandoffMockSupabase();
  const result = await findOrCreateGemGradeUser(
    supabase,
    "new.buyer@example.com",
  );

  assert.equal(result.created, true);
  assert.equal(result.email, "new.buyer@example.com");
  assert.ok(result.userId);
});

test("findOrCreateGemGradeUser logs in an existing user", async () => {
  const supabase = createHandoffMockSupabase({
    profiles: [{ id: "existing-1", email: "existing@example.com" }],
  });

  const result = await findOrCreateGemGradeUser(
    supabase,
    "existing@example.com",
  );

  assert.equal(result.created, false);
  assert.equal(result.userId, "existing-1");
});

test("establishGemGradeSession verifies hashed token", async () => {
  const service = createHandoffMockSupabase({
    profiles: [{ id: "user-9", email: "session@example.com" }],
  });
  const session = createHandoffMockSupabase({
    profiles: [{ id: "user-9", email: "session@example.com" }],
  });

  const user = await establishGemGradeSession(
    service,
    session,
    "session@example.com",
  );

  assert.equal(user.id, "user-9");
  assert.equal(user.email, "session@example.com");
});

test("verifyShopifyAppProxySignature validates Shopify proxy query", () => {
  const secret = "hush";
  const params = {
    shop: "demo.myshopify.com",
    logged_in_customer_id: "1",
    path_prefix: "/apps/gemgrade",
    timestamp: "1317327555",
  };

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  assert.equal(
    verifyShopifyAppProxySignature({ ...params, signature }, secret),
    true,
  );
  assert.equal(
    verifyShopifyAppProxySignature(
      { ...params, signature: "0000000000000000000000000000000000000000000000000000000000000000" },
      secret,
    ),
    false,
  );
});

test("fetchShopifyCustomerEmail reads Admin API email", async () => {
  const customer = await fetchShopifyCustomerEmail("555", {
    shopDomain: "demo.myshopify.com",
    accessToken: "shpat_test",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          customer: {
            id: 555,
            email: "Admin.Lookup@Example.com",
          },
        };
      },
    }),
  });

  assert.equal(customer.id, "555");
  assert.equal(customer.email, "admin.lookup@example.com");
});

test("resolveShopifyAdminAccessToken uses client_credentials", async () => {
  clearShopifyAdminAccessTokenCache();
  const previous = {
    key: process.env.SHOPIFY_API_KEY,
    secret: process.env.SHOPIFY_API_SECRET,
    admin: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    shop: process.env.SHOPIFY_SHOP_DOMAIN,
  };
  process.env.SHOPIFY_API_KEY = "client-id-test";
  process.env.SHOPIFY_API_SECRET = "client-secret-test";
  process.env.SHOPIFY_SHOP_DOMAIN = "demo.myshopify.com";
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  try {
    /** @type {string[]} */
    const urls = [];
    const token = await resolveShopifyAdminAccessToken({
      fetchImpl: async (url, init) => {
        urls.push(String(url));
        assert.equal(init?.method, "POST");
        assert.match(String(init?.body ?? ""), /grant_type=client_credentials/);
        return {
          ok: true,
          async json() {
            return { access_token: "shpat_from_client_credentials", expires_in: 3600 };
          },
        };
      },
    });
    assert.equal(token, "shpat_from_client_credentials");
    assert.equal(
      urls[0],
      "https://demo.myshopify.com/admin/oauth/access_token",
    );

    const cached = await resolveShopifyAdminAccessToken({
      fetchImpl: async () => {
        throw new Error("should use cache");
      },
    });
    assert.equal(cached, "shpat_from_client_credentials");
  } finally {
    clearShopifyAdminAccessTokenCache();
    process.env.SHOPIFY_API_KEY = previous.key;
    process.env.SHOPIFY_API_SECRET = previous.secret;
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = previous.admin;
    process.env.SHOPIFY_SHOP_DOMAIN = previous.shop;
  }
});

test("resolveShopifyAdminAccessToken falls back to stored offline token", async () => {
  clearShopifyAdminAccessTokenCache();
  const previous = {
    key: process.env.SHOPIFY_API_KEY,
    secret: process.env.SHOPIFY_API_SECRET,
    admin: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    shop: process.env.SHOPIFY_SHOP_DOMAIN,
  };
  process.env.SHOPIFY_API_KEY = "client-id-test";
  process.env.SHOPIFY_API_SECRET = "client-secret-test";
  process.env.SHOPIFY_SHOP_DOMAIN = "demo.myshopify.com";
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  try {
    const supabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: { access_token: "shpat_stored_offline" },
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

    const token = await resolveShopifyAdminAccessToken({
      supabase,
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        async json() {
          return { error: "shop_not_permitted" };
        },
      }),
    });
    assert.equal(token, "shpat_stored_offline");
  } finally {
    clearShopifyAdminAccessTokenCache();
    process.env.SHOPIFY_API_KEY = previous.key;
    process.env.SHOPIFY_API_SECRET = previous.secret;
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = previous.admin;
    process.env.SHOPIFY_SHOP_DOMAIN = previous.shop;
  }
});

test("fetchShopifyCustomerEmail rejects missing email", async () => {
  await assert.rejects(
    () =>
      fetchShopifyCustomerEmail("555", {
        shopDomain: "demo.myshopify.com",
        accessToken: "shpat_test",
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return { customer: { id: 555, email: "" } };
          },
        }),
      }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "missing_email",
  );
});

test("sanitizeHandoffNextPath blocks open redirects", () => {
  assert.equal(sanitizeHandoffNextPath("/credits"), "/credits");
  assert.equal(sanitizeHandoffNextPath("//evil.com"), "/");
  assert.equal(sanitizeHandoffNextPath("https://evil.com"), "/");
  assert.equal(sanitizeHandoffNextPath("/\\evil.com"), "/");
  assert.equal(sanitizeHandoffNextPath("/%2f%2fevil.com"), "/");
  assert.equal(sanitizeHandoffNextPath("/%5cevil.com"), "/");
  assert.equal(sanitizeHandoffNextPath(null), "/");
});

test("valid handoff registers nonce then consumes once", async () => {
  const supabase = createHandoffMockSupabase();
  const { token, claims } = createShopifyHandoffToken({
    shopifyCustomerId: "777",
    email: "handoff@example.com",
    secret: SECRET,
    nowSeconds: 1_700_000_000,
  });

  await registerShopifyHandoffNonce(supabase, claims);
  const consumed = await consumeShopifyHandoffToken(supabase, token, {
    secret: SECRET,
    nowSeconds: 1_700_000_005,
  });

  assert.equal(consumed.cid, "777");
  assert.equal(supabase.nonces.get(claims.jti)?.consumed_at != null, true);
});

test("finalizeShopifyHandoffUser resolves pending Shopify credits", async () => {
  /** @type {Array<[string, string]>} */
  const fulfillCalls = [];
  const result = await finalizeShopifyHandoffUser(
    /** @type {any} */ ({}),
    {
      id: "user-pending",
      email: "Pending.Buyer@Example.com",
      created_at: "2026-07-11T12:00:00.000Z",
    },
    {
      async ensureCreditProfile() {},
      async grantSignupBonusIfEligible() {
        return { balance: 5, creditsGranted: 5 };
      },
      async fulfillPendingGrantsForEmail(_supabase, userId, email) {
        fulfillCalls.push([userId, email]);
        return {
          fulfilledCount: 1,
          creditsGranted: 25,
          balance: 30,
          transactionIds: ["tx-pending-1"],
        };
      },
    },
  );

  assert.equal(result.fulfilledCount, 1);
  assert.equal(result.creditsGranted, 25);
  assert.deepEqual(fulfillCalls, [
    ["user-pending", "pending.buyer@example.com"],
  ]);
});
