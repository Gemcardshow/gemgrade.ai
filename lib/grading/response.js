import { buildVerdict } from "./narrative.js";
import { getDefectLabel } from "./defects.js";

/**
 * @param {import("./types.js").VisionAnalysis} analysis
 */
function formatDefects(analysis) {
  return analysis.defects.map((defect) => ({
    tag: defect.tag,
    severity: defect.severity,
    location: defect.location,
    confidence: defect.confidence,
  }));
}

/**
 * Build the canonical structured API response from finalized grading output.
 *
 * @param {{
 *   gradeResult: import("./types.js").GradeResult,
 *   analysis: import("./types.js").VisionAnalysis,
 *   eraSource: import("./types.js").GradeResponse["eraSource"],
 *   estimatedYear: number | null,
 * }} params
 * @returns {import("./types.js").GradeResponse}
 */
export function formatGradeResponse({
  gradeResult,
  analysis,
  eraSource,
  estimatedYear,
}) {
  const primaryLimiter = {
    tag: gradeResult.primaryLimiter?.tag ?? analysis.primaryLimiterTag ?? null,
    label:
      gradeResult.primaryLimiter?.label ??
      analysis.primaryLimiterLabel ??
      (analysis.primaryLimiterTag
        ? undefined
        : "None visible"),
  };
  if (!primaryLimiter.label) {
    primaryLimiter.label = primaryLimiter.tag
      ? getDefectLabel(primaryLimiter.tag)
      : "None visible";
  }

  return {
    psaGrade: gradeResult.psaGrade,
    internalGrade: gradeResult.internalGrade,
    era: gradeResult.era,
    eraSource,
    estimatedYear,
    categoryScores: gradeResult.categoryScores,
    primaryLimiter,
    bestAttribute: analysis.bestAttribute,
    eyeAppealSummary: analysis.eyeAppealSummary,
    defects: formatDefects(analysis),
    categoryNotes: analysis.categoryNotes,
    scanQuality: gradeResult.scanQuality,
    capAudit: gradeResult.capAudit,
    likelyRange: gradeResult.likelyRange,
    verdict: buildVerdict(
      {
        ...gradeResult,
        primaryLimiter,
      },
      analysis
    ),
    cardMeta: analysis.cardMeta,
    visionReconciliationAudit: analysis.visionReconciliationAudit || [],
  };
}
