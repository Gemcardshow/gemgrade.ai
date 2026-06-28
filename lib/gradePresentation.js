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
 * @param {string} likelyRange
 * @returns {{ low: string, high: string } | null}
 */
export function parseLikelyRangeBounds(likelyRange) {
  if (!likelyRange || typeof likelyRange !== "string") {
    return null;
  }

  const trimmed = likelyRange.trim();
  const rangeMatch = trimmed.match(
    /^PSA\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)$/i,
  );

  if (rangeMatch) {
    return { low: rangeMatch[1], high: rangeMatch[2] };
  }

  const singleMatch = trimmed.match(/^PSA\s+(\d+(?:\.\d+)?)$/i);
  if (singleMatch) {
    return { low: singleMatch[1], high: singleMatch[1] };
  }

  return null;
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

  const bounds = parseLikelyRangeBounds(likelyRange);
  if (!bounds) {
    return likelyRange.trim();
  }

  if (bounds.low === bounds.high) {
    return `Confidence range: around ${bounds.low}`;
  }

  return `Confidence range: ${bounds.low}–${bounds.high}`;
}

/**
 * Sanitize grading verdict markdown for user display.
 * Removes duplicate headline grades and reframes the range as confidence.
 *
 * @param {string | null | undefined} verdict
 * @param {{ headlineGrade?: number | null }} [options]
 * @returns {string}
 */
export function formatVerdictDisplay(verdict, { headlineGrade } = {}) {
  if (!verdict || typeof verdict !== "string") {
    return "";
  }

  let text = verdict;

  text = text.replace(
    /^## Overall Grade: (\d+(?:\.\d+)?) \/ 10\s*\nInternal Grade: [\d.]+\s*\n/m,
    (_match, grade) => {
      const headline =
        typeof headlineGrade === "number" ? headlineGrade : Number(grade);
      return `## Summary\nSupports the GemGrade ${headline} estimate shown above.\n\n`;
    },
  );

  text = text.replace(
    /^### Likely Grade Range\s*\nPSA\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*$/gim,
    (_match, low, high) => {
      if (low === high) {
        return `### Confidence Range\nVisible condition is consistent with a grade around ${low}.`;
      }

      return `### Confidence Range\nVisible condition suggests the grade could fall between ${low} and ${high}. The headline GemGrade estimate is the most likely outcome within this band.`;
    },
  );

  text = text.replace(
    /^### Likely Grade Range\s*\nPSA\s+(\d+(?:\.\d+)?)\s*$/gim,
    (_match, grade) =>
      `### Confidence Range\nVisible condition is consistent with a grade around ${grade}.`,
  );

  text = text
    .replace(/Projected PSA (\d+)/gi, "This card aligns with a GemGrade $1 read")
    .replace(
      /^PSA\s+(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*$/gim,
      "Confidence range: $1–$2",
    )
    .replace(/^PSA\s+(\d+(?:\.\d+)?)\s*$/gim, "Confidence range: around $1");

  text = text.replace(/^## Professional Verdict/m, "## Condition Notes");

  return text.trim();
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
