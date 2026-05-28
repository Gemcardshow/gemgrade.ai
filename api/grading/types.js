/**
 * @typedef {"vintage"|"modern"} Era
 * @typedef {"auto"|"vintage"|"modern"} EraRequest
 * @typedef {"minor"|"moderate"|"severe"|"disqualifying"} SeverityClass
 * @typedef {"minor"|"moderate"|"severe"} DefectSeverity
 * @typedef {"high"|"medium"|"low"} ConfidenceLevel
 * @typedef {"excellent"|"good"|"fair"|"poor"} ScanLevel
 * @typedef {Object} CategoryScores
 * @property {number} corners
 * @property {number} edges
 * @property {number} surface
 * @property {number} centering
 *
 * @typedef {Object} DefectObservation
 * @property {string} tag
 * @property {DefectSeverity} severity
 * @property {"front"|"back"|"both"} location
 * @property {ConfidenceLevel} confidence
 *
 * @typedef {Object} ScanQuality
 * @property {ScanLevel} level
 * @property {string[]} visibilityIssues
 * @property {string[]} inspectionLimits
 *
 * @typedef {Object} CardMeta
 * @property {number|null} estimatedYear
 * @property {boolean} isReflective
 * @property {boolean} isDarkBorder
 *
 * @typedef {Object} VisionAnalysis
 * @property {ScanQuality} scanQuality
 * @property {CategoryScores} categoryScores
 * @property {DefectObservation[]} defects
 * @property {string} primaryLimiterTag
 * @property {string} primaryLimiterLabel
 * @property {string} bestAttribute
 * @property {string} eyeAppealSummary
 * @property {CardMeta} cardMeta
 * @property {Record<string, string>} categoryNotes
 *
 * @typedef {Object} EraDetectionResult
 * @property {Era} era
 * @property {"override"|"auto"|"fallback"} eraSource
 * @property {number|null} estimatedYear
 * @property {ConfidenceLevel} confidence
 * @property {string[]} signals
 *
 * @typedef {Object} CapAuditEntry
 * @property {string} source
 * @property {number} [cap]
 * @property {number} [value]
 *
 * @typedef {Object} GradeResponse
 * @property {number} psaGrade
 * @property {number} internalGrade
 * @property {Era} era
 * @property {"override"|"auto"|"fallback"} eraSource
 * @property {number|null} estimatedYear
 * @property {CategoryScores} categoryScores
 * @property {{ tag: string, label: string }} primaryLimiter
 * @property {string} bestAttribute
 * @property {string} eyeAppealSummary
 * @property {DefectObservation[]} defects
 * @property {Record<string, string>} [categoryNotes]
 * @property {ScanQuality & { confidence: ConfidenceLevel, ceilingApplied: number }} scanQuality
 * @property {CapAuditEntry[]} capAudit
 * @property {string} likelyRange
 * @property {string} verdict
 * @property {CardMeta} cardMeta
 *
 * @typedef {Object} GradeResult
 * @property {number} psaGrade
 * @property {number} internalGrade
 * @property {Era} era
 * @property {CategoryScores} categoryScores
 * @property {{ tag: string, label: string }} [primaryLimiter]
 * @property {ScanQuality & { confidence: ConfidenceLevel, ceilingApplied: number }} scanQuality
 * @property {CapAuditEntry[]} capAudit
 * @property {string} likelyRange
 */

export const SCAN_LEVELS = ["excellent", "good", "fair", "poor"];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"];
export const DEFECT_SEVERITIES = ["minor", "moderate", "severe"];

export function clampGrade(value, min = 1, max = 10) {
  return Math.min(max, Math.max(min, value));
}

export function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

export function snapToPsaGrade(internalGrade) {
  return clampGrade(Math.floor(internalGrade));
}

export function formatLikelyRange(internalGrade) {
  const low = snapToPsaGrade(Math.max(1, internalGrade - 0.5));
  const high = snapToPsaGrade(clampGrade(internalGrade + 0.5));
  return low === high ? `PSA ${low}` : `PSA ${low}–${high}`;
}
