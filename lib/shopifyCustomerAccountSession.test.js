import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  extractBearerToken,
  normalizeShopifyShopHost,
  parseShopifyCustomerIdFromSub,
  verifyShopifyCustomerAccountSessionToken,
  __testOnly,
} from "./shopifyCustomerAccountSession.js";
import { ShopifyHandoffError } from "./shopifyHandoffAuth.js";

const API_KEY = "test-client-id";
const API_SECRET = "test-client-secret";
const SHOP = "hidden-gem-sportcards.myshopify.com";

/**
 * @param {Record<string, unknown>} claims
 * @param {{ secret?: string, header?: Record<string, unknown> }} [options]
 */
function signSessionToken(claims, options = {}) {
  const header = options.header ?? { alg: "HS256", typ: "JWT" };
  const headerPart = __testOnly.base64UrlEncode(JSON.stringify(header));
  const payloadPart = __testOnly.base64UrlEncode(JSON.stringify(claims));
  const secret = options.secret ?? API_SECRET;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${headerPart}.${payloadPart}.${signature}`;
}

/**
 * @param {Partial<Record<string, unknown>>} overrides
 */
function validClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    dest: SHOP,
    aud: API_KEY,
    exp: now + 300,
    nbf: now - 5,
    iat: now - 5,
    jti: "test-jti-1",
    sub: "gid://shopify/Customer/1234567890",
    ...overrides,
  };
}

test("parseShopifyCustomerIdFromSub accepts gid and digits", () => {
  assert.equal(
    parseShopifyCustomerIdFromSub("gid://shopify/Customer/999"),
    "999",
  );
  assert.equal(parseShopifyCustomerIdFromSub("42"), "42");
  assert.equal(parseShopifyCustomerIdFromSub(""), "");
  assert.equal(parseShopifyCustomerIdFromSub("gid://shopify/Order/1"), "");
});

test("normalizeShopifyShopHost strips protocol and trailing slash", () => {
  assert.equal(
    normalizeShopifyShopHost("https://Hidden-Gem-Sportcards.myshopify.com/"),
    SHOP,
  );
});

test("extractBearerToken reads Authorization header", () => {
  assert.equal(extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerToken("basic x"), "");
  assert.equal(extractBearerToken(""), "");
});

test("verifyShopifyCustomerAccountSessionToken accepts valid JWT", () => {
  const token = signSessionToken(validClaims());
  const verified = verifyShopifyCustomerAccountSessionToken(token, {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    expectedShop: SHOP,
  });
  assert.equal(verified.customerId, "1234567890");
  assert.equal(verified.shopDomain, SHOP);
});

test("verifyShopifyCustomerAccountSessionToken accepts iss matching dest", () => {
  const token = signSessionToken(
    validClaims({
      iss: `https://${SHOP}/admin`,
      dest: `https://${SHOP}`,
    }),
  );
  const verified = verifyShopifyCustomerAccountSessionToken(token, {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    expectedShop: SHOP,
  });
  assert.equal(verified.customerId, "1234567890");
  assert.equal(verified.shopDomain, SHOP);
});

for (const issuerPath of ["/checkouts", "/checkouts/"]) {
  test(`verifyShopifyCustomerAccountSessionToken accepts issuer ${issuerPath}`, () => {
    const token = signSessionToken(
      validClaims({ iss: `https://${SHOP}${issuerPath}` }),
    );
    const verified = verifyShopifyCustomerAccountSessionToken(token, {
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      expectedShop: SHOP,
    });
    assert.equal(verified.shopDomain, SHOP);
    assert.equal(verified.customerId, "1234567890");
  });
}

test("verifyShopifyCustomerAccountSessionToken preserves root issuer behavior", () => {
  const token = signSessionToken(validClaims({ iss: `https://${SHOP}/` }));
  const verified = verifyShopifyCustomerAccountSessionToken(token, {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    expectedShop: SHOP,
  });
  assert.equal(verified.shopDomain, SHOP);
});

test("verifyShopifyCustomerAccountSessionToken rejects bad signature", () => {
  const token = signSessionToken(validClaims(), { secret: "wrong-secret" });
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
      }),
    (error) =>
      error instanceof ShopifyHandoffError &&
      error.code === "invalid_signature",
  );
});

test("verifyShopifyCustomerAccountSessionToken rejects audience mismatch", () => {
  const token = signSessionToken(validClaims({ aud: "other-app" }));
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
      }),
    (error) =>
      error instanceof ShopifyHandoffError &&
      error.code === "wrong_audience",
  );
});

test("verifyShopifyCustomerAccountSessionToken rejects expired token", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signSessionToken(validClaims({ exp: now - 10, nbf: now - 60 }));
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
        nowSeconds: now,
      }),
    (error) =>
      error instanceof ShopifyHandoffError &&
      error.code === "expired_session_token",
  );
});

test("verifyShopifyCustomerAccountSessionToken rejects shop mismatch", () => {
  const token = signSessionToken(validClaims({ dest: "other.myshopify.com" }));
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
      }),
    (error) =>
      error instanceof ShopifyHandoffError &&
      error.code === "wrong_destination",
  );
});

test("verifyShopifyCustomerAccountSessionToken rejects issuer mismatch", () => {
  const token = signSessionToken(
    validClaims({
      dest: SHOP,
      iss: "https://evil.myshopify.com/admin",
    }),
  );
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
      }),
    (error) =>
      error instanceof ShopifyHandoffError &&
      error.code === "wrong_issuer",
  );
});

for (const [label, iss] of [
  ["non-HTTPS issuer", `http://${SHOP}/checkouts`],
  ["malformed issuer", "not a valid URL"],
  ["deceptive suffix hostname", `https://${SHOP}.evil.example/checkouts`],
  ["embedded credentials", `https://user:password@${SHOP}/checkouts`],
]) {
  test(`verifyShopifyCustomerAccountSessionToken rejects ${label}`, () => {
    const token = signSessionToken(validClaims({ iss }));
    assert.throws(
      () =>
        verifyShopifyCustomerAccountSessionToken(token, {
          apiKey: API_KEY,
          apiSecret: API_SECRET,
          expectedShop: SHOP,
        }),
      (error) =>
        error instanceof ShopifyHandoffError && error.code === "wrong_issuer",
    );
  });
}

test("verifyShopifyCustomerAccountSessionToken rejects missing sub", () => {
  const { sub: _omit, ...claims } = validClaims();
  const token = signSessionToken(claims);
  assert.throws(
    () =>
      verifyShopifyCustomerAccountSessionToken(token, {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        expectedShop: SHOP,
      }),
    (error) =>
      error instanceof ShopifyHandoffError && error.code === "missing_customer_id",
  );
});

test("peekShopifySessionTokenClaims returns safe claim metadata", async () => {
  const { peekShopifySessionTokenClaims } = await import(
    "./shopifyCustomerAccountSession.js"
  );
  const token = signSessionToken(validClaims({ jti: "abcdef12-xxxx" }));
  const peeked = peekShopifySessionTokenClaims(token, { apiKey: API_KEY });
  assert.equal(peeked.peek_ok, true);
  assert.equal(peeked.alg, "HS256");
  assert.equal(peeked.has_sub, true);
  assert.equal(peeked.sub_is_customer_gid, true);
  assert.equal(peeked.aud_matches_api_key, true);
  assert.equal(peeked.dest, SHOP);
});
