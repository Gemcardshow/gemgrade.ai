import {
  getDefectCap,
  getDefectDefinition,
  getDefectLabel,
  getEffectiveDefectCap,
} from "./defects.js";
import {
  applyCenteringGemCap,
  applyCompoundHarshness,
  applyPsa1Calibration,
  applyVintageMultiPillarWearCap,
  finalizeInternalGrade,
} from "./psa-calibration.js";
import {
  clampGrade,
  formatLikelyRange,
  roundToHalf,
  snapToPsaGrade,
} from "./types.js";

const SCAN_CEILINGS = {
  excellent: 10,
  good: 9.5,
  fair: 7.5,
  poor: 6.0,
};

const SCAN_CONFIDENCE = {
  excellent: "high",
  good: "high",
  fair: "medium",
  poor: "low",
};

function applyCategoryImpactScores(categoryScores, defects, capAudit) {
  const adjusted = { ...categoryScores };

  for (const defect of defects) {
    const definition = getDefectDefinition(defect.tag);
    if (!definition?.categoryImpact) continue;

    for (const [category, cap] of Object.entries(definition.categoryImpact)) {
      if (adjusted[category] > cap) {
        adjusted[category] = cap;
        capAudit.push({
          source: `categoryImpact:${defect.tag}:${category}`,
          cap,
        });
      }
    }
  }

  for (const key of Object.keys(adjusted)) {
    adjusted[key] = roundToHalf(clampGrade(adjusted[key]));
  }

  return adjusted;
}

function getScanCeiling(scanQuality) {
  const base = SCAN_CEILINGS[scanQuality.level] ?? 6.0;
  let ceiling = base;
  const limits = scanQuality.inspectionLimits || [];
  const issues = scanQuality.visibilityIssues || [];
  const combined = [...limits, ...issues].join(" ").toLowerCase();

  if (
    combined.includes("back not visible") ||
    combined.includes("back obscured") ||
    combined.includes("cropped back") ||
    combined.includes("back cropped")
  ) {
    ceiling = Math.min(ceiling, 5.0);
  }

  if (
    combined.includes("severe glare") ||
    combined.includes("glare obscuring") ||
    combined.includes("surface obscured")
  ) {
    ceiling = Math.min(ceiling, 7.0);
  }

  return ceiling;
}

function getDefectCeiling(defects, era, categoryScores, capAudit) {
  if (!defects.length) return 10;

  let ceiling = 10;

  for (const defect of defects) {
    let cap = getEffectiveDefectCap(defect, era);

    if (
      categoryScores.surface <= 4 &&
      (defect.tag === "surface_wear" || defect.tag === "surface_scratch_moderate")
    ) {
      const surfaceBound = era === "vintage" ? 2.0 : 2.5;
      if (surfaceBound < cap) {
        cap = surfaceBound;
        capAudit.push({ source: `categoryBound:${defect.tag}`, cap });
      }
    }

    if (cap < ceiling) {
      ceiling = cap;
      capAudit.push({ source: `defect:${defect.tag}`, cap });
    }
  }

  return ceiling;
}

function getPrimaryLimiterCap(primaryLimiterTag, defects, era, capAudit) {
  if (!primaryLimiterTag) return 10;

  const matchingDefect = defects.find((defect) => defect.tag === primaryLimiterTag);
  const cap = matchingDefect
    ? getEffectiveDefectCap(matchingDefect, era)
    : getDefectCap(primaryLimiterTag, era);

  if (cap < 10) {
    capAudit.push({ source: `primaryLimiter:${primaryLimiterTag}`, cap });
  }
  return cap;
}

function deriveConfidence(scanQuality, defects) {
  const base = SCAN_CONFIDENCE[scanQuality.level] || "low";
  const lowConfidenceDefect = defects.some((defect) => defect.confidence === "low");

  if (base === "high" && lowConfidenceDefect) return "medium";
  if (base === "medium" && lowConfidenceDefect) return "low";
  return base;
}

/**
 * @param {import("./types.js").VisionAnalysis} analysis
 * @param {import("./types.js").Era} era
 */
export function computeGrade(analysis, era) {
  const capAudit = [];
  const categoryScores = applyCategoryImpactScores(
    analysis.categoryScores,
    analysis.defects,
    capAudit
  );

  const categoryFloor = Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );
  capAudit.push({ source: "categoryFloor", value: categoryFloor });

  const defectCeiling = getDefectCeiling(analysis.defects, era, categoryScores, capAudit);
  const scanCeiling = getScanCeiling(analysis.scanQuality);
  capAudit.push({ source: "scanQuality", cap: scanCeiling });

  let rawOverall = Math.min(categoryFloor, defectCeiling, scanCeiling);

  rawOverall = applyCompoundHarshness(rawOverall, analysis.defects, era, capAudit);
  rawOverall = applyPsa1Calibration(rawOverall, analysis.defects, capAudit);

  const primaryLimiterCap = analysis.defects.some(
    (defect) => defect.tag === analysis.primaryLimiterTag
  )
    ? getPrimaryLimiterCap(
        analysis.primaryLimiterTag,
        analysis.defects,
        era,
        capAudit
      )
    : 10;
  rawOverall = Math.min(rawOverall, primaryLimiterCap);

  rawOverall = applyCenteringGemCap(
    rawOverall,
    categoryScores.centering,
    capAudit
  );

  rawOverall = applyVintageMultiPillarWearCap(
    rawOverall,
    categoryScores,
    era,
    analysis.defects,
    capAudit
  );

  const internalGrade = finalizeInternalGrade(rawOverall);
  capAudit.push({ source: "overall_derivation", value: internalGrade });

  const psaGrade = snapToPsaGrade(internalGrade);
  const likelyRange = formatLikelyRange(internalGrade);
  const confidence = deriveConfidence(analysis.scanQuality, analysis.defects);

  return {
    psaGrade,
    internalGrade,
    era,
    categoryScores,
    primaryLimiter: {
      tag: analysis.primaryLimiterTag,
      label:
        analysis.primaryLimiterLabel ||
        getDefectLabel(analysis.primaryLimiterTag) ||
        "Visible wear",
    },
    scanQuality: {
      ...analysis.scanQuality,
      confidence,
      ceilingApplied: scanCeiling,
    },
    capAudit,
    likelyRange,
  };
}

export { SCAN_CEILINGS, SCAN_CONFIDENCE, getScanCeiling };
