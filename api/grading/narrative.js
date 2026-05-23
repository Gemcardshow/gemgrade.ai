function formatCategoryScores(categoryScores) {
  return `- Corners: ${categoryScores.corners}
- Edges: ${categoryScores.edges}
- Surface: ${categoryScores.surface}
- Centering: ${categoryScores.centering}`;
}

function formatScanQuality(scanQuality) {
  const visibility =
    scanQuality.visibilityIssues?.length > 0
      ? scanQuality.visibilityIssues.join("; ")
      : "None significant.";

  return `Scan Quality: ${scanQuality.level}
Confidence Level: ${scanQuality.confidence}
Visibility Issues: ${visibility}`;
}

export function buildProUpsellText(psaGrade) {
  if (psaGrade >= 9) {
    return "This card missed a Gem Mint projection due to minor visible defects. Use 1 Pro Scan to unlock the full breakdown.";
  }
  if (psaGrade >= 7) {
    return "This card shows strong collector appeal with moderate visible wear. Use 1 Pro Scan to unlock the full breakdown.";
  }
  if (psaGrade >= 4) {
    return "Visible wear and aging characteristics limit the projected grade. Use 1 Pro Scan to unlock the full breakdown.";
  }
  return "Heavy wear and condition defects significantly impact the projected grade. Use 1 Pro Scan to unlock the full breakdown.";
}

/**
 * Short formatted summary for free mode display.
 *
 * @param {import("./types.js").GradeResult} gradeResult
 * @param {import("./types.js").VisionAnalysis} analysis
 */
export function buildSummaryVerdict(gradeResult, analysis) {
  return `## Overall Grade: ${gradeResult.psaGrade} / 10

### Category Scores
${formatCategoryScores(gradeResult.categoryScores)}

### Primary Grade Limiter
${gradeResult.primaryLimiter.label}

### Best Attribute
${analysis.bestAttribute}

### Eye Appeal Summary
${analysis.eyeAppealSummary}

### Likely Grade Range
${gradeResult.likelyRange}

## Scan Quality Analysis
${formatScanQuality(gradeResult.scanQuality)}

GemGrade evaluates visible condition only. Hidden defects, altered surfaces, or defects obscured by holders/scans may impact final professional grading results.`;
}

/**
 * Detailed formatted summary for pro mode display.
 *
 * @param {import("./types.js").GradeResult} gradeResult
 * @param {import("./types.js").VisionAnalysis} analysis
 */
export function buildDetailedVerdict(gradeResult, analysis) {
  return `## Overall Grade: ${gradeResult.psaGrade} / 10
Internal Grade: ${gradeResult.internalGrade}

### Category Scores
${formatCategoryScores(gradeResult.categoryScores)}

### Primary Grade Limiter
${gradeResult.primaryLimiter.label}

### Best Attribute
${analysis.bestAttribute}

### Eye Appeal Summary
${analysis.eyeAppealSummary}

### Likely Grade Range
${gradeResult.likelyRange}

## Scan Quality Analysis
${formatScanQuality(gradeResult.scanQuality)}

## Detailed Breakdown

#### Corners
${analysis.categoryNotes.corners}

#### Edges
${analysis.categoryNotes.edges}

#### Surface
${analysis.categoryNotes.surface}

#### Centering
${analysis.categoryNotes.centering}

## Professional Verdict
Projected PSA ${gradeResult.psaGrade} based on visible condition. The primary limiter is ${gradeResult.primaryLimiter.label.toLowerCase()}.

GemGrade evaluates visible condition only. Hidden defects, altered surfaces, or defects obscured by holders/scans may impact final professional grading results.`;
}

/**
 * @param {import("./types.js").GradeResult} gradeResult
 * @param {import("./types.js").VisionAnalysis} analysis
 * @param {import("./types.js").GradingMode} mode
 */
export function buildVerdict(gradeResult, analysis, mode) {
  if (mode === "pro") {
    return buildDetailedVerdict(gradeResult, analysis);
  }
  return buildSummaryVerdict(gradeResult, analysis);
}
