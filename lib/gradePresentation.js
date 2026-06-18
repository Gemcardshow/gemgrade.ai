export const GEMGRADE_DISCLAIMER =
  "GemGrade is an independent grading estimation tool and is not affiliated with or endorsed by PSA.";

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
