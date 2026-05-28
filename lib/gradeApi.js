/**
 * Structured grading API client.
 * Consumes the unified /api/grade response — no markdown parsing or mode branching.
 */

const UPLOAD_TOO_LARGE_MESSAGE =
  "Image upload too large. Try a smaller image or screenshot.";

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
 * @property {Record<string, string>} categoryNotes
 * @property {{ level: string, confidence: string, ceilingApplied: number, visibilityIssues: string[], inspectionLimits: string[] }} scanQuality
 * @property {Array<{ source: string, cap?: number, value?: number }>} capAudit
 * @property {string} likelyRange
 * @property {string} verdict
 * @property {{ estimatedYear: number|null, isReflective: boolean, isDarkBorder: boolean }} cardMeta
 */

function isUploadTooLargeError(status, message) {
  const normalized = message.toLowerCase();

  return (
    status === 413 ||
    normalized.includes("request entity too large") ||
    normalized.includes("body exceeded") ||
    normalized.includes("payload too large") ||
    normalized.includes("content too large") ||
    normalized.includes("too large")
  );
}

async function readApiError(response) {
  const contentType = response.headers.get("content-type") || "";
  let message = "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      message = typeof payload?.error === "string" ? payload.error : "";
    } catch {
      message = "";
    }
  } else {
    message = await response.text();
  }

  if (isUploadTooLargeError(response.status, message)) {
    return UPLOAD_TOO_LARGE_MESSAGE;
  }

  return message.trim() || "Failed to grade card";
}

/**
 * @param {{
 *   frontImage: string,
 *   backImage: string,
 *   era?: "auto"|"vintage"|"modern",
 *   email?: string,
 * }} params
 * @returns {Promise<GradeResponse>}
 */
export async function gradeCard({ frontImage, backImage, era = "auto", email }) {
  const response = await fetch("/api/grade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      frontImage,
      backImage,
      era,
      email,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Unexpected response from grading service. Please try again.");
  }
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

export { UPLOAD_TOO_LARGE_MESSAGE };
