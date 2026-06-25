export const GEM_CARD_SHOW_URL = "https://gemcardshow.com";

export const SITE_TITLE = "Gem Card Show · GemGrade";

export const GEMGRADE_DISCLAIMER =
  "GemGrade is an independent AI pre-grade estimation platform designed to help collectors make more informed decisions before submitting cards to professional grading services.";

export const GEMGRADE_FOOTER_TAGLINE = "Together, we'll change the hobby.";

/**
 * @param {number | null | undefined} grade
 * @returns {string}
 */
export function formatGemGradeValue(grade) {
  return typeof grade === "number" ? String(grade) : "—";
}

/**
 * @param {number | null | undefined} grade
 * @returns {string}
 */
export function formatGemGradeHeader(grade) {
  return `GemGrade ${formatGemGradeValue(grade)}`;
}

/**
 * Convert API likelyRange strings for display (PSA-prefixed → neutral labels).
 *
 * @param {string | null | undefined} likelyRange
 * @returns {string}
 */
export function formatLikelyRangeDisplay(likelyRange) {
  if (!likelyRange || typeof likelyRange !== "string") {
    return "";
  }

  const trimmed = likelyRange.trim();
  const rangeMatch = trimmed.match(
    /^PSA\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/i,
  );

  if (rangeMatch) {
    return `Estimated Grade Range: ${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  const singleMatch = trimmed.match(/^PSA\s+(\d+(?:\.\d+)?)$/i);
  if (singleMatch) {
    return `Estimated Grade: ${singleMatch[1]}`;
  }

  return trimmed;
}

/**
 * Sanitize grading verdict markdown for user display (PSA-branded strings → GemGrade).
 *
 * @param {string | null | undefined} verdict
 * @returns {string}
 */
export function formatVerdictDisplay(verdict) {
  if (!verdict || typeof verdict !== "string") {
    return "";
  }

  return verdict
    .replace(/Projected PSA (\d+)/gi, "Projected GemGrade $1")
    .replace(
      /^PSA\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*$/gim,
      "Estimated Grade Range: $1-$2",
    )
    .replace(/^PSA\s+(\d+(?:\.\d+)?)\s*$/gim, "Estimated Grade: $1");
}

/**
 * @param {{ psaGrade?: number, likelyRange?: string }} grade
 * @returns {string}
 */
export function formatScoutGradeEstimate(grade) {
  const gradeValue = grade.psaGrade;
  const range = formatLikelyRangeDisplay(grade.likelyRange);

  if (typeof gradeValue === "number" && range) {
    return `GemGrade ${gradeValue} (${range})`;
  }

  if (typeof gradeValue === "number") {
    return formatGemGradeHeader(gradeValue);
  }

  return "Unavailable";
}
