import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import {
  APPLE_IAP_BUNDLE_ID,
  assessVerifiedAppleTransaction,
  logAppleIap,
} from "./appleIap.js";
import { grantPurchaseCredits, PurchaseValidationError } from "./credits.js";

const CERT_FILES = [
  "AppleRootCA-G3.cer",
  "AppleRootCA-G2.cer",
  "AppleIncRootCertificate.cer",
];

/** @type {Buffer[] | null} */
let rootCertificates = null;

/** @type {Map<string, import("@apple/app-store-server-library").SignedDataVerifier>} */
const verifiers = new Map();

export class AppleIapFlowError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, httpStatus: number, finishTransaction: boolean }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "AppleIapFlowError";
    this.code = details.code;
    this.httpStatus = details.httpStatus;
    this.finishTransaction = details.finishTransaction;
  }
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} details
 * @param {(event: string, details?: Record<string, unknown>) => void} [logger]
 */
function log(event, details, logger = logAppleIap) {
  logger(event, details);
}

/**
 * @returns {Buffer[]}
 */
export function loadAppleRootCertificates() {
  if (rootCertificates) {
    return rootCertificates;
  }

  const certDir = join(dirname(fileURLToPath(import.meta.url)), "..", "certs", "apple");
  rootCertificates = CERT_FILES.map((name) => readFileSync(join(certDir, name)));
  return rootCertificates;
}

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
function unescapePem(raw) {
  return raw.replace(/\\n/g, "\n").trim();
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ issuerId: string, keyId: string, privateKey: string } | null}
 */
export function readAppleApiCredentials(env = process.env) {
  const issuerId = env.APPLE_IAP_ISSUER_ID?.trim() ?? "";
  const keyId = env.APPLE_IAP_KEY_ID?.trim() ?? "";
  const privateKeyRaw = env.APPLE_IAP_PRIVATE_KEY?.trim() ?? "";
  const present = [issuerId, keyId, privateKeyRaw].filter(Boolean).length;

  if (present === 0) {
    return null;
  }

  if (present < 3) {
    throw new AppleIapFlowError(
      "App Store Server API credentials are incomplete.",
      {
        code: "apple_config",
        httpStatus: 503,
        finishTransaction: false,
      },
    );
  }

  return {
    issuerId,
    keyId,
    privateKey: unescapePem(privateKeyRaw),
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number | undefined}
 */
export function readAppleAppId(env = process.env) {
  const raw = env.APPLE_IAP_APP_APPLE_ID?.trim();

  if (!raw) {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppleIapFlowError(
      "APPLE_IAP_APP_APPLE_ID must be the numeric App Store app id.",
      {
        code: "apple_config",
        httpStatus: 503,
        finishTransaction: false,
      },
    );
  }

  return value;
}

/**
 * @param {string} environment
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertAppleEnvironmentConfigured(environment, env = process.env) {
  if (environment !== "Sandbox" && environment !== "Production") {
    throw new AppleIapFlowError(
      "This App Store environment cannot grant GemGrade credits.",
      {
        code: "invalid_transaction",
        httpStatus: 400,
        finishTransaction: false,
      },
    );
  }

  if (environment === "Sandbox" && env.APPLE_IAP_ALLOW_SANDBOX?.trim().toLowerCase() === "false") {
    throw new AppleIapFlowError(
      "Sandbox App Store purchases are disabled on this server.",
      {
        code: "sandbox_disabled",
        httpStatus: 403,
        finishTransaction: false,
      },
    );
  }

  if (environment === "Production" && readAppleAppId(env) === undefined) {
    throw new AppleIapFlowError(
      "Production App Store purchases need APPLE_IAP_APP_APPLE_ID.",
      {
        code: "apple_config",
        httpStatus: 503,
        finishTransaction: false,
      },
    );
  }
}

/**
 * @param {unknown} signedTransaction
 * @returns {Record<string, unknown> | null}
 */
export function readUnverifiedJwsPayload(signedTransaction) {
  if (typeof signedTransaction !== "string" || signedTransaction.length < 20 || signedTransaction.length > 20000) {
    return null;
  }

  const parts = signedTransaction.split(".");

  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const padded = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} environment
 * @param {NodeJS.ProcessEnv} [env]
 */
function verifierForEnvironment(environment, env = process.env) {
  const bundleId = env.APPLE_IAP_BUNDLE_ID?.trim() || APPLE_IAP_BUNDLE_ID;
  const appAppleId = readAppleAppId(env);
  const enableOnlineChecks = env.APPLE_IAP_ONLINE_CHECKS?.trim().toLowerCase() === "true";
  const cacheKey = `${environment}:${bundleId}:${appAppleId ?? ""}:${enableOnlineChecks}`;
  const cached = verifiers.get(cacheKey);

  if (cached) {
    return cached;
  }

  const appleEnvironment = environment === "Production"
    ? Environment.PRODUCTION
    : Environment.SANDBOX;

  const verifier = new SignedDataVerifier(
    loadAppleRootCertificates(),
    enableOnlineChecks,
    appleEnvironment,
    bundleId,
    environment === "Production" ? appAppleId : undefined,
  );

  verifiers.set(cacheKey, verifier);
  return verifier;
}

/**
 * @param {unknown} error
 * @returns {AppleIapFlowError}
 */
function verificationFailure(error) {
  const status = error instanceof VerificationException ? error.status : undefined;
  const retryable = status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;

  return new AppleIapFlowError(
    retryable
      ? "Apple could not verify this purchase yet. It will be retried."
      : "Apple could not verify this purchase.",
    {
      code: retryable ? "apple_unavailable" : "invalid_transaction",
      httpStatus: retryable ? 503 : 400,
      finishTransaction: false,
    },
  );
}

/**
 * @param {string} signedTransaction
 * @param {string} environment
 * @param {NodeJS.ProcessEnv} [env]
 */
async function verifySignedTransaction(signedTransaction, environment, env = process.env) {
  try {
    return await verifierForEnvironment(environment, env).verifyAndDecodeTransaction(
      signedTransaction,
    );
  } catch (error) {
    throw verificationFailure(error);
  }
}

/**
 * @param {{ issuerId: string, keyId: string, privateKey: string }} credentials
 * @param {string} transactionId
 * @param {string} environment
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>}
 */
async function fetchServerSignedTransaction(credentials, transactionId, environment, env) {
  const bundleId = env.APPLE_IAP_BUNDLE_ID?.trim() || APPLE_IAP_BUNDLE_ID;
  const appleEnvironment = environment === "Production"
    ? Environment.PRODUCTION
    : Environment.SANDBOX;
  const client = new AppStoreServerAPIClient(
    credentials.privateKey,
    credentials.keyId,
    credentials.issuerId,
    bundleId,
    appleEnvironment,
  );
  const response = await client.getTransactionInfo(transactionId);
  return response?.signedTransactionInfo ?? "";
}

/**
 * @param {Record<string, unknown>} deviceTransaction
 * @param {Record<string, unknown>} serverTransaction
 */
function transactionsMatch(deviceTransaction, serverTransaction) {
  const fields = [
    "transactionId",
    "originalTransactionId",
    "productId",
    "bundleId",
    "environment",
    "appAccountToken",
  ];

  return fields.every((field) => {
    const left = deviceTransaction[field] ?? null;
    const right = serverTransaction[field] ?? null;
    if (typeof left === "string" || typeof right === "string") {
      return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
    }
    return left === right;
  });
}

/**
 * @param {{
 *   supabase: import("@supabase/supabase-js").SupabaseClient,
 *   userId: string,
 *   signedTransaction: unknown,
 *   env?: NodeJS.ProcessEnv,
 *   logger?: (event: string, details?: Record<string, unknown>) => void,
 *   verifySignedTransaction?: (signedTransaction: string, environment: string) => Promise<Record<string, unknown>>,
 *   fetchServerSignedTransaction?: (
 *     credentials: { issuerId: string, keyId: string, privateKey: string },
 *     transactionId: string,
 *     environment: string,
 *   ) => Promise<string>,
 * }} input
 */
export async function verifyAndGrantApplePurchase(input) {
  const env = input.env ?? process.env;
  const logger = input.logger ?? logAppleIap;
  const signedTransaction = input.signedTransaction;
  const claimed = readUnverifiedJwsPayload(signedTransaction);

  if (!claimed || typeof signedTransaction !== "string") {
    throw new AppleIapFlowError("Apple could not verify this purchase.", {
      code: "invalid_transaction",
      httpStatus: 400,
      finishTransaction: false,
    });
  }

  const claimedEnvironment = typeof claimed.environment === "string"
    ? claimed.environment
    : "";

  log("verify_start", {
    userId: input.userId,
    claimedEnvironment,
    signedLength: signedTransaction.length,
  }, logger);

  assertAppleEnvironmentConfigured(claimedEnvironment, env);

  const verify = input.verifySignedTransaction
    ?? ((signed, environment) => verifySignedTransaction(signed, environment, env));

  const deviceTransaction = await verify(signedTransaction, claimedEnvironment);

  log("jws_verified", {
    userId: input.userId,
    transactionId: deviceTransaction.transactionId ?? null,
    productId: deviceTransaction.productId ?? null,
    environment: deviceTransaction.environment ?? null,
  }, logger);

  let transactionForGrant = deviceTransaction;
  let confirmation = "signed_transaction";
  const credentials = readAppleApiCredentials(env);

  if (credentials) {
    const transactionId = String(deviceTransaction.transactionId ?? "");
    let serverSigned;

    try {
      serverSigned = input.fetchServerSignedTransaction
        ? await input.fetchServerSignedTransaction(
          credentials,
          transactionId,
          claimedEnvironment,
        )
        : await fetchServerSignedTransaction(credentials, transactionId, claimedEnvironment, env);
    } catch (error) {
      if (error instanceof AppleIapFlowError) {
        throw error;
      }

      const httpStatusCode = error instanceof APIException ? error.httpStatusCode : 0;
      log("app_store_api_error", {
        userId: input.userId,
        transactionId,
        httpStatusCode,
        apiError: error instanceof APIException ? error.apiError : null,
        message: error instanceof Error ? error.message : "App Store Server API request failed",
      }, logger);

      if (httpStatusCode === 401 || httpStatusCode === 403) {
        throw new AppleIapFlowError(
          "App Store Server API rejected the server credentials.",
          {
            code: "apple_config",
            httpStatus: 503,
            finishTransaction: false,
          },
        );
      }

      throw new AppleIapFlowError(
        "Apple could not confirm this purchase yet. It will be retried.",
        {
          code: "apple_unavailable",
          httpStatus: 502,
          finishTransaction: false,
        },
      );
    }

    if (!serverSigned) {
      throw new AppleIapFlowError(
        "Apple could not confirm this purchase yet. It will be retried.",
        {
          code: "apple_unavailable",
          httpStatus: 502,
          finishTransaction: false,
        },
      );
    }

    const serverTransaction = await verify(serverSigned, claimedEnvironment);

    if (!transactionsMatch(deviceTransaction, serverTransaction)) {
      log("app_store_mismatch", {
        userId: input.userId,
        deviceTransactionId: deviceTransaction.transactionId ?? null,
        serverTransactionId: serverTransaction.transactionId ?? null,
        deviceProductId: deviceTransaction.productId ?? null,
        serverProductId: serverTransaction.productId ?? null,
      }, logger);
      throw new AppleIapFlowError(
        "Apple's transaction record did not match this purchase.",
        {
          code: "apple_mismatch",
          httpStatus: 502,
          finishTransaction: false,
        },
      );
    }

    transactionForGrant = serverTransaction;
    confirmation = "app_store_server_api";
    log("app_store_confirmed", {
      userId: input.userId,
      transactionId,
      productId: serverTransaction.productId ?? null,
    }, logger);
  } else {
    log("app_store_api_skipped", {
      userId: input.userId,
      transactionId: deviceTransaction.transactionId ?? null,
      reason: "APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, and APPLE_IAP_PRIVATE_KEY are not set",
    }, logger);
  }

  const allowSandbox = env.APPLE_IAP_ALLOW_SANDBOX?.trim().toLowerCase() !== "false";
  const assessment = assessVerifiedAppleTransaction(transactionForGrant, {
    userId: input.userId,
    bundleId: env.APPLE_IAP_BUNDLE_ID?.trim() || APPLE_IAP_BUNDLE_ID,
    allowSandbox,
  });

  if (!assessment.ok) {
    log("rejected", {
      userId: input.userId,
      code: assessment.code,
      transactionId: transactionForGrant.transactionId ?? null,
      productId: transactionForGrant.productId ?? null,
    }, logger);
    throw new AppleIapFlowError(assessment.error, {
      code: assessment.code,
      httpStatus: assessment.httpStatus,
      finishTransaction: assessment.finishTransaction,
    });
  }

  try {
    const grant = await grantPurchaseCredits(
      input.supabase,
      input.userId,
      assessment.credits,
      {
        ...assessment.metadata,
        confirmation,
      },
      { appleTransactionId: assessment.appleTransactionId },
    );

    const status = grant.creditsGranted > 0 ? "granted" : "already_processed";
    log(status, {
      userId: input.userId,
      transactionId: assessment.appleTransactionId,
      productId: assessment.productId,
      creditsGranted: grant.creditsGranted,
      balance: grant.balance,
      ledgerTransactionId: grant.transactionId,
      confirmation,
    }, logger);

    return {
      httpStatus: 200,
      body: {
        status,
        finishTransaction: true,
        balance: grant.balance,
        transactionId: grant.transactionId,
        creditsGranted: grant.creditsGranted,
        appleTransactionId: assessment.appleTransactionId,
        productId: assessment.productId,
      },
    };
  } catch (error) {
    if (error instanceof PurchaseValidationError) {
      log("grant_rejected", {
        userId: input.userId,
        transactionId: assessment.appleTransactionId,
        message: error.message,
        statusCode: error.statusCode,
      }, logger);
      throw new AppleIapFlowError(error.message, {
        code: "apple_config",
        httpStatus: error.statusCode,
        finishTransaction: false,
      });
    }

    log("grant_failed", {
      userId: input.userId,
      transactionId: assessment.appleTransactionId,
      message: error instanceof Error ? error.message : "Grant failed",
    }, logger);
    throw new AppleIapFlowError(
      "Credits could not be added for this purchase yet. It will be retried.",
      {
        code: "grant_failed",
        httpStatus: 500,
        finishTransaction: false,
      },
    );
  }
}

/**
 * @param {unknown} error
 */
export function appleIapErrorResponse(error) {
  if (error instanceof AppleIapFlowError) {
    return {
      httpStatus: error.httpStatus,
      body: {
        status: error.code,
        error: error.message,
        finishTransaction: error.finishTransaction,
        creditsGranted: 0,
      },
    };
  }

  logAppleIap("unexpected_error", {
    message: error instanceof Error ? error.message : "Unknown Apple IAP error",
  });

  return {
    httpStatus: 500,
    body: {
      status: "error",
      error: "Credits could not be added for this purchase yet. It will be retried.",
      finishTransaction: false,
      creditsGranted: 0,
    },
  };
}
