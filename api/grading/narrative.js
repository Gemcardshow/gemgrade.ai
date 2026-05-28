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

/**
 * Unified professional verdict for every scan.
 *
 * @param {import("./types.js").GradeResult} gradeResult
 * @param {import("./types.js").VisionAnalysis} analysis
 */
export function buildVerdict(gradeResult, analysis) {
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
