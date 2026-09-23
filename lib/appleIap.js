/**
 * Apple consumable credit products.
 * Credit amounts are granted only from this server-side map.
 * Keep the product ids in sync with ios/App/App/AppleIAPPlugin.swift.
 */

export const APPLE_IAP_BUNDLE_ID = "com.gemcardshow.gemgrade";

/** @type {Readonly<Record<string, number>>} */
export const APPLE_IAP_PRODUCTS = Object.freeze({
  "com.gemcardshow.gemgrade.credits20": 20,
  "com.gemcardshow.gemgrade.credits50": 50,
  "com.gemcardshow.gemgrade.credits100": 100,
  "com.gemcardshow.gemgrade.credits200": 200,
});

export const APPLE_IAP_PRODUCT_IDS = Object.freeze(Object.keys(APPLE_IAP_PRODUCTS));

const APPLE_TRANSACTION_ID_PATTERN = /^\d{1,32}$/;

/**
 * @param {string} event
 * @param {Record<string, unknown>} [details]
 */
export function logAppleIap(event, details = {}) {
  console.info(
    `[apple-iap] ${JSON.stringify({
      event,
      ...details,
      at: new Date().toISOString(),
    })}`,
  );
}

/**
 * @param {unknown} productId
 * @returns {number | null}
 */
export function creditsForAppleProduct(productId) {
  if (typeof productId !== "string") {
    return null;
  }

  const credits = APPLE_IAP_PRODUCTS[productId.trim()];
  return Number.isFinite(credits) ? credits : null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizedUuid(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Decide whether a cryptographically verified Apple transaction may grant credits.
 * Callers must verify the signature before passing the payload in.
 *
 * @param {Record<string, unknown>} transaction
 * @param {{
 *   userId: string,
 *   bundleId?: string,
 *   allowSandbox?: boolean,
 * }} context
 * @returns {{
 *   ok: true,
 *   credits: number,
 *   appleTransactionId: string,
 *   productId: string,
 *   environment: string,
 *   metadata: Record<string, unknown>,
 *   finishTransaction: true,
 * } | {
 *   ok: false,
 *   code: string,
 *   error: string,
 *   httpStatus: number,
 *   finishTransaction: boolean,
 * }}
 */
export function assessVerifiedAppleTransaction(transaction, context) {
  const bundleId = context.bundleId || APPLE_IAP_BUNDLE_ID;
  const allowSandbox = context.allowSandbox !== false;
  const environment = typeof transaction.environment === "string"
    ? transaction.environment
    : "";

  if (environment === "Sandbox" && !allowSandbox) {
    return {
      ok: false,
      code: "sandbox_disabled",
      error: "Sandbox App Store purchases are disabled on this server.",
      httpStatus: 403,
      finishTransaction: false,
    };
  }

  if (environment !== "Production" && environment !== "Sandbox") {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "This App Store environment cannot grant GemGrade credits.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  if (transaction.bundleId !== bundleId) {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "This purchase is for a different app.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  const productId = typeof transaction.productId === "string"
    ? transaction.productId.trim()
    : "";
  const unitCredits = creditsForAppleProduct(productId);

  if (unitCredits === null) {
    return {
      ok: false,
      code: "unknown_product",
      error: "This App Store product is not a GemGrade credit pack.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  if (transaction.type !== "Consumable") {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "Only consumable App Store credit packs can be added.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  if (
    transaction.inAppOwnershipType &&
    transaction.inAppOwnershipType !== "PURCHASED"
  ) {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "Shared App Store purchases cannot add GemGrade credits.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  const appleTransactionId = typeof transaction.transactionId === "string"
    ? transaction.transactionId.trim()
    : "";

  if (!APPLE_TRANSACTION_ID_PATTERN.test(appleTransactionId)) {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "Apple did not provide a valid transaction id.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  const accountToken = normalizedUuid(transaction.appAccountToken);
  const userId = normalizedUuid(context.userId);

  if (!accountToken || accountToken !== userId) {
    return {
      ok: false,
      code: "user_mismatch",
      error: "This purchase belongs to a different GemGrade account. Sign in with the account that started it.",
      httpStatus: 403,
      finishTransaction: false,
    };
  }

  if (transaction.revocationDate) {
    return {
      ok: false,
      code: "revoked",
      error: "Apple refunded this purchase, so credits were not added.",
      httpStatus: 200,
      finishTransaction: true,
    };
  }

  const quantity = transaction.quantity === undefined || transaction.quantity === null
    ? 1
    : Number(transaction.quantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return {
      ok: false,
      code: "invalid_transaction",
      error: "This purchase quantity cannot be applied.",
      httpStatus: 400,
      finishTransaction: false,
    };
  }

  const credits = unitCredits * quantity;

  return {
    ok: true,
    credits,
    appleTransactionId,
    productId,
    environment,
    finishTransaction: true,
    metadata: {
      source: "apple_iap",
      productId,
      appleTransactionId,
      originalTransactionId:
        typeof transaction.originalTransactionId === "string"
          ? transaction.originalTransactionId
          : null,
      environment,
      bundleId,
      quantity,
      appAccountToken: accountToken,
      storefront:
        typeof transaction.storefront === "string" ? transaction.storefront : null,
      purchaseDate:
        typeof transaction.purchaseDate === "number" ? transaction.purchaseDate : null,
    },
  };
}
