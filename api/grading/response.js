import { buildProUpsellText, buildVerdict } from "./narrative.js";

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
 *   gradeResult: Omit<import("./types.js").GradeResult, "verdict" | "mode" | "proUpsellText">,
 *   analysis: import("./types.js").VisionAnalysis,
 *   eraSource: import("./types.js").GradeResult["eraSource"],
 *   estimatedYear: number | null,
 *   mode: import("./types.js").GradingMode,
 * }} params
 */
export function formatGradeResponse({
  gradeResult,
  analysis,
  eraSource,
  estimatedYear,
  mode,
}) {
  const verdict = buildVerdict(gradeResult, analysis, mode);

  return {
    psaGrade: gradeResult.psaGrade,
    internalGrade: gradeResult.internalGrade,
    era: gradeResult.era,
    eraSource,
    estimatedYear,
    categoryScores: gradeResult.categoryScores,
    primaryLimiter: gradeResult.primaryLimiter,
    bestAttribute: analysis.bestAttribute,
    eyeAppealSummary: analysis.eyeAppealSummary,
    defects: formatDefects(analysis),
    categoryNotes: mode === "pro" ? analysis.categoryNotes : undefined,
    scanQuality: gradeResult.scanQuality,
    capAudit: gradeResult.capAudit,
    likelyRange: gradeResult.likelyRange,
    verdict,
    mode,
    proUpsellText: buildProUpsellText(gradeResult.psaGrade),
    cardMeta: analysis.cardMeta,
  };
}
