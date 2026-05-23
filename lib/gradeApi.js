/**
 * Structured grading API client.
 * Consumes the rebuilt /api/grade response directly — no markdown parsing.
 */

/**
 * @typedef {Object} GradeResponse
 * @property {number} psaGrade
 * @property {number} internalGrade
 * @property {"vintage"|"modern"} era
 * @property {"override"|"auto"|"fallback"} eraSource
 * @property {number|null} estimatedYear
 * @property {{ corners: number, edges: number, surface: number, centering: number }} categoryScores
 * @property {{ tag: string, label: string }} primaryLimiter
 * @property {string} bestAttribute
 * @property {string} eyeAppealSummary
 * @property {Array<{ tag: string, severity: string, location: string, confidence: string }>} defects
 * @property {Record<string, string>} [categoryNotes]
 * @property {{ level: string, confidence: string, ceilingApplied: number, visibilityIssues: string[], inspectionLimits: string[] }} scanQuality
 * @property {Array<{ source: string, cap?: number, value?: number }>} capAudit
 * @property {string} likelyRange
 * @property {string} verdict
 * @property {"free"|"pro"} mode
 * @property {string} proUpsellText
 */

/**
 * @param {{
 *   frontImage: string,
 *   backImage: string,
 *   mode?: "free"|"pro",
 *   era?: "auto"|"vintage"|"modern",
 *   email?: string,
 * }} params
 * @returns {Promise<GradeResponse>}
 */
export async function gradeCard({
  frontImage,
  backImage,
  mode = "free",
  era = "auto",
  email,
}) {
  const response = await fetch("/api/grade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      frontImage,
      backImage,
      mode,
      era,
      email,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to grade card");
  }

  return payload;
}

export function isStructuredGradeResponse(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.psaGrade === "number" &&
    value.categoryScores &&
    value.primaryLimiter &&
    Array.isArray(value.capAudit)
  );
}
