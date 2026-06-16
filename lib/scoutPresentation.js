/**
 * Client-side Scout presentation helpers.
 * Derives buy signal from existing grade response — no grading logic changes.
 */

/**
 * @param {{ scanQuality?: { confidence?: string } }} grade
 * @returns {string}
 */
export function getScoutConfidence(grade) {
  const confidence = grade.scanQuality?.confidence?.trim();
  return confidence || "Unknown";
}

/**
 * @param {{ psaGrade?: number, likelyRange?: string }} grade
 * @returns {string}
 */
export function getScoutPsaEstimate(grade) {
  const gradeValue = grade.psaGrade;
  const range = grade.likelyRange?.trim();

  if (typeof gradeValue === "number" && range) {
    return `PSA ${gradeValue} (${range})`;
  }

  if (typeof gradeValue === "number") {
    return `PSA ${gradeValue}`;
  }

  return "Unavailable";
}

/**
 * @typedef {"positive"|"neutral"|"warn"|"negative"} BuySignalTone
 * @typedef {{ label: string, tone: BuySignalTone, summary: string }} BuySignal
 */

/**
 * @param {{
 *   psaGrade?: number,
 *   scanQuality?: { confidence?: string },
 *   primaryLimiter?: { tag?: string, label?: string },
 * }} grade
 * @returns {BuySignal}
 */
export function getScoutBuySignal(grade) {
  const psa = typeof grade.psaGrade === "number" ? grade.psaGrade : 0;
  const confidence = (grade.scanQuality?.confidence || "").toLowerCase();
  const limiterTag = (grade.primaryLimiter?.tag || "").toLowerCase();
  const limiterLabel = grade.primaryLimiter?.label || "Unknown limiter";
  const noVisibleLimiter =
    !limiterTag ||
    limiterTag === "none" ||
    limiterTag.includes("none_visible") ||
    limiterLabel.toLowerCase().includes("none visible");

  if (psa >= 9 && noVisibleLimiter && confidence === "high") {
    return {
      label: "Strong Buy",
      tone: "positive",
      summary: "High grade with strong scan confidence and no visible limiter.",
    };
  }

  if (psa >= 8) {
    return {
      label: "Buy",
      tone: "positive",
      summary: "Solid projected grade for acquisition screening.",
    };
  }

  if (psa >= 6) {
    return {
      label: "Consider",
      tone: "neutral",
      summary: "Mid-grade projection — verify price and condition in person.",
    };
  }

  if (psa >= 4) {
    return {
      label: "Caution",
      tone: "warn",
      summary: `Primary concern: ${limiterLabel}.`,
    };
  }

  return {
    label: "Pass",
    tone: "negative",
    summary: `Low projected grade. Primary concern: ${limiterLabel}.`,
  };
}

/**
 * @param {{ credits?: { deducted?: number } } | null | undefined} grade
 * @param {"scout"|"pro"} mode
 * @returns {number}
 */
export function getCreditsUsed(grade, mode) {
  if (typeof grade?.credits?.deducted === "number") {
    return grade.credits.deducted;
  }

  return mode === "scout" ? 1 : 2;
}
