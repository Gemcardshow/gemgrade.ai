import { registerPlugin } from "@capacitor/core";
import { fetchAuthed } from "./fetchAuthed.js";

/** @type {import("@capacitor/core").Plugin | null} */
let plugin;

const inFlight = new Set();

/**
 * @param {string} event
 * @param {Record<string, unknown>} [details]
 */
function logAppleIapClient(event, details = {}) {
  console.info(`[apple-iap] ${JSON.stringify({ event, ...details })}`);
}

/**
 * Native StoreKit bridge. Null on web, Android, and iOS builds that
 * have not registered the AppleIAP plugin.
 */
export function getAppleIapPlugin() {
  if (typeof window === "undefined") {
    return null;
  }

  const capacitor = window.Capacitor;
  if (!capacitor || capacitor.getPlatform?.() !== "ios") {
    return null;
  }

  if (
    typeof capacitor.isPluginAvailable === "function" &&
    !capacitor.isPluginAvailable("AppleIAP")
  ) {
    return null;
  }

  if (!plugin) {
    plugin = registerPlugin("AppleIAP");
  }

  return plugin;
}

/**
 * @param {string} transactionId
 */
async function finishAppleTransaction(transactionId) {
  const nativePlugin = getAppleIapPlugin();
  if (!nativePlugin) {
    return;
  }

  const result = await nativePlugin.finishTransaction({ transactionId });
  logAppleIapClient("finish", {
    transactionId,
    finished: result?.finished === true,
  });
}

/**
 * Send a StoreKit signed transaction to the server, then finish it only
 * after the server says the transaction has been handled.
 *
 * @param {string} signedTransaction
 * @param {string} transactionId
 */
export async function processAppleSignedTransaction(signedTransaction, transactionId) {
  if (!signedTransaction || !transactionId) {
    throw new Error("Apple did not return a transaction to verify.");
  }

  if (inFlight.has(transactionId)) {
    return null;
  }

  inFlight.add(transactionId);

  try {
    logAppleIapClient("verify_request", { transactionId });
    const response = await fetchAuthed("/api/credits/apple/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedTransaction }),
    });
    const body = await response.json().catch(() => ({}));

    logAppleIapClient("verify_response", {
      transactionId,
      httpStatus: response.status,
      status: body.status ?? null,
      creditsGranted: body.creditsGranted ?? null,
      finishTransaction: body.finishTransaction === true,
    });

    if (body.finishTransaction === true) {
      try {
        await finishAppleTransaction(transactionId);
      } catch (error) {
        logAppleIapClient("finish_failed", {
          transactionId,
          message: error instanceof Error ? error.message : "finish failed",
        });
        if (!response.ok) {
          throw error;
        }
      }
    }

    if (!response.ok) {
      const error = new Error(
        body.error || "Could not add credits for this App Store purchase.",
      );
      error.code = body.status;
      error.retryable = response.status >= 500;
      throw error;
    }

    if (typeof body.balance === "number" && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("credits-updated", { detail: { balance: body.balance } }),
      );
    }

    return body;
  } finally {
    inFlight.delete(transactionId);
  }
}

/**
 * Replay StoreKit transactions that were purchased but not finished.
 * Safe to call more than once; the server grants each transaction id once.
 */
export async function syncUnfinishedAppleTransactions() {
  const nativePlugin = getAppleIapPlugin();
  if (!nativePlugin) {
    return [];
  }

  const result = await nativePlugin.getUnfinishedTransactions();
  const transactions = Array.isArray(result?.transactions) ? result.transactions : [];
  /** @type {Array<Record<string, unknown>>} */
  const processed = [];

  for (const transaction of transactions) {
    if (!transaction?.signedTransaction || !transaction?.transactionId) {
      continue;
    }

    try {
      const body = await processAppleSignedTransaction(
        transaction.signedTransaction,
        transaction.transactionId,
      );
      if (body) {
        processed.push(body);
      }
    } catch (error) {
      logAppleIapClient("unfinished_retry_failed", {
        transactionId: transaction.transactionId,
        message: error instanceof Error ? error.message : "retry failed",
      });
    }
  }

  return processed;
}
