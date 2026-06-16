import { getScanCreditCost, normalizeScanMode } from "./scanCredits.js";

/**
 * @typedef {"scout"|"pro"} ScanMode
 * @typedef {{
 *   ok: true,
 *   mode: ScanMode,
 *   frontImage: string,
 *   backImage: string,
 *   scoutFrontOnlyApproximation: boolean,
 *   creditCost: number,
 * }} ResolvedScanImages
 * @typedef {{
 *   ok: false,
 *   status: number,
 *   error: string,
 * }} ScanImageValidationError
 */

/**
 * @param {{
 *   mode?: string,
 *   frontImage?: string | null,
 *   backImage?: string | null,
 * }} params
 * @returns {ResolvedScanImages | ScanImageValidationError}
 */
export function resolveScanImagesForGrade({
  mode,
  frontImage,
  backImage = null,
}) {
  const normalizedMode = normalizeScanMode(mode);

  if (!frontImage) {
    return {
      ok: false,
      status: 400,
      error: "Front image is required.",
    };
  }

  if (normalizedMode === "pro" && !backImage) {
    return {
      ok: false,
      status: 400,
      error: "Pro scans require front and back images.",
    };
  }

  if (normalizedMode === "scout" && !backImage) {
    return {
      ok: true,
      mode: normalizedMode,
      frontImage,
      backImage: frontImage,
      scoutFrontOnlyApproximation: true,
      creditCost: getScanCreditCost(normalizedMode),
    };
  }

  return {
    ok: true,
    mode: normalizedMode,
    frontImage,
    backImage,
    scoutFrontOnlyApproximation: false,
    creditCost: getScanCreditCost(normalizedMode),
  };
}

export { normalizeScanMode };
