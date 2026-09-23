import test from "node:test";
import assert from "node:assert/strict";
import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";
import {
  APPLE_IAP_PRODUCTS,
  assessVerifiedAppleTransaction,
  creditsForAppleProduct,
} from "./appleIap.js";
import { grantApplePurchaseCredits } from "./credits.js";
import {
  AppleIapFlowError,
  appleIapErrorResponse,
  assertAppleEnvironmentConfigured,
  loadAppleRootCertificates,
  readAppleApiCredentials,
  readUnverifiedJwsPayload,
  verifyAndGrantApplePurchase,
} from "./appleIapVerify.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

/**
 * @param {Record<string, unknown>} payload
 */
function fakeJws(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJFUzI1NiJ9.${body}.sig`;
}

/**
 * @param {Record<string, unknown>} [overrides]
 */
function verifiedTransaction(overrides = {}) {
  return {
    transactionId: "2000000123456789",
    originalTransactionId: "2000000123456789",
    bundleId: "com.gemcardshow.gemgrade",
    productId: "com.gemcardshow.gemgrade.credits100",
    type: "Consumable",
    environment: "Sandbox",
    inAppOwnershipType: "PURCHASED",
    appAccountToken: USER_ID,
    quantity: 1,
    ...overrides,
  };
}

test("Apple credit products match the App Store consumable packs", () => {
  assert.deepEqual(APPLE_IAP_PRODUCTS, {
    "com.gemcardshow.gemgrade.credits20": 20,
    "com.gemcardshow.gemgrade.credits50": 50,
    "com.gemcardshow.gemgrade.credits100": 100,
    "com.gemcardshow.gemgrade.credits200": 200,
  });
  assert.equal(creditsForAppleProduct("com.gemcardshow.gemgrade.credits20"), 20);
  assert.equal(creditsForAppleProduct("com.gemcardshow.gemgrade.credits999"), null);
});

test("Apple root certificates are valid for StoreKit verification", () => {
  const certificates = loadAppleRootCertificates();
  assert.equal(certificates.length, 3);
  const verifier = new SignedDataVerifier(
    certificates,
    false,
    Environment.SANDBOX,
    "com.gemcardshow.gemgrade",
  );
  assert.ok(verifier);
});

test("assessVerifiedAppleTransaction grants the server product amount", () => {
  const result = assessVerifiedAppleTransaction(
    verifiedTransaction({
      productId: "com.gemcardshow.gemgrade.credits50",
      quantity: 2,
    }),
    { userId: USER_ID },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.credits, 100);
    assert.equal(result.appleTransactionId, "2000000123456789");
    assert.equal(result.metadata.source, "apple_iap");
  }
});

test("assessVerifiedAppleTransaction rejects replay across accounts, refunds, and unknown products", () => {
  const mismatch = assessVerifiedAppleTransaction(
    verifiedTransaction({ appAccountToken: "22222222-2222-4222-8222-222222222222" }),
    { userId: USER_ID },
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.code, "user_mismatch");
    assert.equal(mismatch.finishTransaction, false);
  }

  const revoked = assessVerifiedAppleTransaction(
    verifiedTransaction({ revocationDate: 1_700_000_000_000 }),
    { userId: USER_ID },
  );
  assert.equal(revoked.ok, false);
  if (!revoked.ok) {
    assert.equal(revoked.code, "revoked");
    assert.equal(revoked.finishTransaction, true);
  }

  const unknown = assessVerifiedAppleTransaction(
    verifiedTransaction({ productId: "com.gemcardshow.gemgrade.credits10" }),
    { userId: USER_ID },
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, "unknown_product");
  }

  const xcode = assessVerifiedAppleTransaction(
    verifiedTransaction({ environment: "Xcode" }),
    { userId: USER_ID },
  );
  assert.equal(xcode.ok, false);
});

test("production verification requires the numeric Apple app id", () => {
  assert.throws(
    () => assertAppleEnvironmentConfigured("Production", {}),
    (error) => error instanceof AppleIapFlowError && error.code === "apple_config",
  );
  assert.doesNotThrow(() => assertAppleEnvironmentConfigured("Sandbox", {}));
});

test("partial App Store Server API credentials fail closed", () => {
  assert.equal(readAppleApiCredentials({}), null);
  assert.throws(
    () => readAppleApiCredentials({ APPLE_IAP_KEY_ID: "ABC123" }),
    (error) => error instanceof AppleIapFlowError && error.code === "apple_config",
  );
});

test("verifyAndGrantApplePurchase grants once from the verified product id", async () => {
  const transaction = verifiedTransaction();
  /** @type {Array<Record<string, unknown>>} */
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          balance: 140,
          transactionId: "ledger-1",
          creditsGranted: 100,
        },
        error: null,
      };
    },
  };

  const outcome = await verifyAndGrantApplePurchase({
    supabase,
    userId: USER_ID,
    signedTransaction: fakeJws({ environment: "Sandbox" }),
    env: {},
    logger() {},
    async verifySignedTransaction() {
      return transaction;
    },
  });

  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.body.status, "granted");
  assert.equal(outcome.body.finishTransaction, true);
  assert.equal(outcome.body.creditsGranted, 100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "grant_apple_purchase_credits");
  assert.equal(calls[0].args.p_amount, 100);
  assert.equal(calls[0].args.p_apple_transaction_id, "2000000123456789");
  assert.equal(calls[0].args.p_metadata.confirmation, "signed_transaction");
});

test("verifyAndGrantApplePurchase treats a repeated Apple transaction as already processed", async () => {
  const outcome = await verifyAndGrantApplePurchase({
    supabase: {
      async rpc() {
        return {
          data: {
            balance: 140,
            transactionId: "ledger-1",
            creditsGranted: 0,
          },
          error: null,
        };
      },
    },
    userId: USER_ID,
    signedTransaction: fakeJws({ environment: "Sandbox" }),
    env: {},
    logger() {},
    async verifySignedTransaction() {
      return verifiedTransaction();
    },
  });

  assert.equal(outcome.body.status, "already_processed");
  assert.equal(outcome.body.creditsGranted, 0);
  assert.equal(outcome.body.finishTransaction, true);
});

test("server transaction product mismatch does not grant credits", async () => {
  let calls = 0;
  let granted = false;
  await assert.rejects(
    () => verifyAndGrantApplePurchase({
      supabase: {
        async rpc() {
          granted = true;
          return { data: { balance: 1, transactionId: "x", creditsGranted: 20 }, error: null };
        },
      },
      userId: USER_ID,
      signedTransaction: fakeJws({ environment: "Sandbox" }),
      env: {
        APPLE_IAP_ISSUER_ID: "issuer",
        APPLE_IAP_KEY_ID: "key",
        APPLE_IAP_PRIVATE_KEY: "pem",
      },
      logger() {},
      async verifySignedTransaction() {
        calls += 1;
        if (calls === 1) {
          return verifiedTransaction();
        }
        return verifiedTransaction({
          productId: "com.gemcardshow.gemgrade.credits20",
        });
      },
      async fetchServerSignedTransaction() {
        return "server.signed.transaction";
      },
    }),
    (error) => error instanceof AppleIapFlowError && error.code === "apple_mismatch",
  );
  assert.equal(granted, false);
});

test("grantApplePurchaseCredits maps an idempotent database result", async () => {
  const result = await grantApplePurchaseCredits(
    {
      async rpc() {
        return {
          data: [{ balance: 40, transaction_id: "ledger-2", credits_granted: 0 }],
          error: null,
        };
      },
    },
    USER_ID,
    20,
    { source: "apple_iap" },
    "2000000123456789",
  );

  assert.equal(result.balance, 40);
  assert.equal(result.transactionId, "ledger-2");
  assert.equal(result.creditsGranted, 0);
  assert.equal(result.alreadyProcessed, true);
});

test("a missing grant function is reported as configuration, not a client success", async () => {
  await assert.rejects(
    () => verifyAndGrantApplePurchase({
      supabase: {
        async rpc() {
          return {
            data: null,
            error: {
              code: "PGRST202",
              message: "Could not find the function grant_apple_purchase_credits",
            },
          };
        },
      },
      userId: USER_ID,
      signedTransaction: fakeJws({ environment: "Sandbox" }),
      env: {},
      logger() {},
      async verifySignedTransaction() {
        return verifiedTransaction();
      },
    }),
    (error) => {
      assert.ok(error instanceof AppleIapFlowError);
      assert.equal(error.code, "apple_config");
      assert.equal(error.finishTransaction, false);
      const response = appleIapErrorResponse(error);
      assert.equal(response.httpStatus, 503);
      assert.equal(response.body.finishTransaction, false);
      return true;
    },
  );
});

test("unsigned environment claims are only used to choose a verifier", () => {
  const payload = readUnverifiedJwsPayload(fakeJws({ environment: "Sandbox", productId: "ignored" }));
  assert.equal(payload?.environment, "Sandbox");
  assert.equal(readUnverifiedJwsPayload("not-a-jws"), null);
});
