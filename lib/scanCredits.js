/** Scan credit costs — shared by client adapters and server credit gating. */
export const CREDIT_COSTS = {
  scout: 1,
  pro: 2,
};

/** @typedef {"scout"|"pro"} ScanMode */

/**
 * @param {unknown} mode
 * @returns {ScanMode}
 */
export function normalizeScanMode(mode) {
  return mode === "scout" ? "scout" : "pro";
}

/**
 * @param {unknown} mode
 * @returns {number}
 */
export function getScanCreditCost(mode) {
  return CREDIT_COSTS[normalizeScanMode(mode)];
}

/**
 * @param {unknown} mode
 * @returns {"scan_scout"|"scan_pro"}
 */
export function getScanTransactionType(mode) {
  return normalizeScanMode(mode) === "scout" ? "scan_scout" : "scan_pro";
}
