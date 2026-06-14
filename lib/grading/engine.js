import { getDefectCap, getDefectDefinition, getDefectLabel, getEffectiveDefectCap, isStructuralDefect } from "./defects.js";
import {
  applyBackOnlyWritingCategoryRelief,
  applyBackOnlyWritingOverallFloor,
  applyCenteringGemCap,
  applyCompoundHarshness,
  applyExBandOptimismCeiling,
  applyExCategoryImpactRelief,
  applyIsolatedPillarFloor,
  applyModernPsa7LightWearStackCap,
  applyNmGemVintageBandRules,
  applyPsa1Calibration,
  applyVintageMultiPillarWearCap,
  applyVintageTriadSkipCategoryFloorRelief,
  countPillarsAtOrBelow,
  finalizeInternalGrade,
  getOverallCategoryFloor,
  qualifiesForExSingleCreaseCap,
  resolveBackOnlyWritingCap,
  resolveNmModernDefectCap,
  resolveNmVintageDefectCap,
  resolveModernCosmeticPrintLineCap,
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

function resolveExBandEdgeFrayingCap(defect, era, bandScores, categoryScores, defects, capAudit) {
  if (defect.tag !== "edge_fraying_major") {
    return null;
  }

  const structuralCount = defects.filter((entry) => isStructuralDefect(entry)).length;
  const sideStrength = Math.min(bandScores.corners, categoryScores.corners);
  const surfaceStrength = Math.min(bandScores.surface, categoryScores.surface);

  if (structuralCount > 1) {
    return null;
  }
  if (sideStrength < 5.5 || surfaceStrength < 5.5) {
    return null;
  }

  const isolatedEdgeCap = era === "vintage" ? 5.5 : 6.0;
  capAudit.push({ source: `isolatedEdge:${defect.tag}`, cap: isolatedEdgeCap });
  return isolatedEdgeCap;
}

function getDefectCeiling(defects, era, categoryScores, capAudit, analysis = null) {
  const bandScores = analysis?.visionCategoryScores || categoryScores;
  if (!defects.length) return 10;

  let ceiling = 10;

  for (const defect of defects) {
    let cap = getEffectiveDefectCap(defect, era);

    const isolatedEdgeCap = resolveExBandEdgeFrayingCap(
      defect,
      era,
      bandScores,
      categoryScores,
      defects,
      capAudit
    );
    if (isolatedEdgeCap !== null && isolatedEdgeCap > cap) {
      cap = isolatedEdgeCap;
    }

    if (
      era === "vintage" &&
      defect.tag === "moderate_crease" &&
      qualifiesForExSingleCreaseCap(categoryScores, defects, analysis, era)
    ) {
      const exCreaseCap = 5.0;
      if (exCreaseCap > cap) {
        cap = exCreaseCap;
        capAudit.push({ source: `exBandCrease:${defect.tag}`, cap: exCreaseCap });
      }
    }

    if (
      era === "vintage" &&
      (defect.tag === "surface_wear" || defect.tag === "surface_scratch_moderate") &&
      countPillarsAtOrBelow(bandScores, 4) >= 3 &&
      countPillarsAtOrBelow(bandScores, 5) >= 3
    ) {
      const surfaceBound = 2.0;
      if (surfaceBound < cap) {
        cap = surfaceBound;
        capAudit.push({ source: `categoryBound:${defect.tag}`, cap });
      }
    }

    if (
      era === "vintage" &&
      defect.tag === "surface_wear" &&
      bandScores.corners >= 6 &&
      bandScores.edges >= 6
    ) {
      const exSurfaceCap = 5.5;
      if (exSurfaceCap > cap) {
        cap = exSurfaceCap;
        capAudit.push({ source: `exBandSurface:${defect.tag}`, cap });
      }
    }

    const backWritingCap = resolveBackOnlyWritingCap(
      defect,
      categoryScores,
      defects,
      analysis,
      capAudit
    );
    if (backWritingCap !== null && backWritingCap > cap) {
      cap = backWritingCap;
    }

    const nmVintageCap = resolveNmVintageDefectCap(
      defect,
      era,
      categoryScores,
      defects,
      analysis
    );
    if (nmVintageCap !== null && nmVintageCap > cap) {
      cap = nmVintageCap;
      capAudit.push({ source: `nm_band:defect:${defect.tag}`, cap: nmVintageCap });
    }

    const nmModernCap = resolveNmModernDefectCap(
      defect,
      era,
      categoryScores,
      defects,
      analysis
    );
    if (nmModernCap !== null && nmModernCap > cap) {
      cap = nmModernCap;
      capAudit.push({ source: `nm_modern:defect:${defect.tag}`, cap: nmModernCap });
    }

    const modernPrintLineCap = resolveModernCosmeticPrintLineCap(
      defect,
      era,
      categoryScores,
      defects,
      analysis
    );
    if (modernPrintLineCap !== null && modernPrintLineCap > cap) {
      cap = modernPrintLineCap;
      capAudit.push({
        source: `modern_cosmetic:defect:${defect.tag}`,
        cap: modernPrintLineCap,
      });
    }

    if (cap < ceiling) {
      ceiling = cap;
      capAudit.push({ source: `defect:${defect.tag}`, cap });
    }
  }

  return ceiling;
}

function getPrimaryLimiterCap(
  primaryLimiterTag,
  defects,
  era,
  categoryScores,
  capAudit,
  analysis = null
) {
  if (!primaryLimiterTag) return 10;

  const bandScores = analysis?.visionCategoryScores || categoryScores;
  const matchingDefect = defects.find((defect) => defect.tag === primaryLimiterTag);
  let cap = matchingDefect
    ? getEffectiveDefectCap(matchingDefect, era)
    : getDefectCap(primaryLimiterTag, era);

  if (matchingDefect) {
    const isolatedEdgeCap = resolveExBandEdgeFrayingCap(
      matchingDefect,
      era,
      bandScores,
      categoryScores,
      defects,
      capAudit
    );
    if (isolatedEdgeCap !== null && isolatedEdgeCap > cap) {
      cap = isolatedEdgeCap;
    }
  }

  if (
    era === "vintage" &&
    primaryLimiterTag === "moderate_crease" &&
    qualifiesForExSingleCreaseCap(categoryScores, defects, analysis, era)
  ) {
    const exCreaseCap = 5.0;
    if (exCreaseCap > cap) {
      cap = exCreaseCap;
      capAudit.push({ source: `exBandCrease:${primaryLimiterTag}`, cap: exCreaseCap });
    }
  }

  if (
    matchingDefect &&
    (primaryLimiterTag === "writing_mark" || primaryLimiterTag === "writing_mark_severe")
  ) {
    const backWritingCap = resolveBackOnlyWritingCap(
      matchingDefect,
      categoryScores,
      defects,
      analysis,
      capAudit
    );
    if (backWritingCap !== null && backWritingCap > cap) {
      cap = backWritingCap;
    }
  }

  const nmVintageCap = matchingDefect
    ? resolveNmVintageDefectCap(
        matchingDefect,
        era,
        categoryScores,
        defects,
        analysis
      )
    : resolveNmVintageDefectCap(
        { tag: primaryLimiterTag, severity: "minor", location: "front", confidence: "high" },
        era,
        categoryScores,
        defects,
        analysis
      );
  if (nmVintageCap !== null && nmVintageCap > cap) {
    cap = nmVintageCap;
    capAudit.push({ source: `nm_band:primary:${primaryLimiterTag}`, cap: nmVintageCap });
  }

  const nmModernCap = matchingDefect
    ? resolveNmModernDefectCap(
        matchingDefect,
        era,
        categoryScores,
        defects,
        analysis
      )
    : resolveNmModernDefectCap(
        {
          tag: primaryLimiterTag,
          severity: "minor",
          location: "front",
          confidence: "high",
        },
        era,
        categoryScores,
        defects,
        analysis
      );
  if (nmModernCap !== null && nmModernCap > cap) {
    cap = nmModernCap;
    capAudit.push({ source: `nm_modern:primary:${primaryLimiterTag}`, cap: nmModernCap });
  }

  const modernPrintLineCap = matchingDefect
    ? resolveModernCosmeticPrintLineCap(
        matchingDefect,
        era,
        categoryScores,
        defects,
        analysis
      )
    : primaryLimiterTag === "print_line"
      ? resolveModernCosmeticPrintLineCap(
          {
            tag: "print_line",
            severity: "minor",
            location: "front",
            confidence: "high",
          },
          era,
          categoryScores,
          defects,
          analysis
        )
      : null;
  if (modernPrintLineCap !== null && modernPrintLineCap > cap) {
    cap = modernPrintLineCap;
    capAudit.push({
      source: `modern_cosmetic:primary:${primaryLimiterTag}`,
      cap: modernPrintLineCap,
    });
  }

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

  if (analysis.vintageTriadNormalizeClamp && analysis.preTriadClampWearScores) {
    analysis.visionCategoryScores = {
      ...analysis.preTriadClampWearScores,
      centering: analysis.categoryScores.centering,
    };
  } else {
    analysis.visionCategoryScores = { ...analysis.categoryScores };
  }

  let categoryScores = applyCategoryImpactScores(
    { ...analysis.categoryScores },
    analysis.defects,
    capAudit
  );

  categoryScores = applyExCategoryImpactRelief(
    categoryScores,
    analysis.defects,
    analysis,
    capAudit,
    era
  );

  categoryScores = applyBackOnlyWritingCategoryRelief(
    categoryScores,
    analysis.defects,
    analysis,
    capAudit,
    era
  );

  let categoryFloor = getOverallCategoryFloor(
    categoryScores,
    era,
    analysis.defects,
    analysis
  );

  if (era === "vintage") {
    categoryFloor = applyVintageTriadSkipCategoryFloorRelief(
      categoryFloor,
      categoryScores,
      analysis.defects,
      analysis,
      capAudit
    );
  }

  capAudit.push({ source: "categoryFloor", value: categoryFloor });

  const defectCeiling = getDefectCeiling(
    analysis.defects,
    era,
    categoryScores,
    capAudit,
    analysis
  );
  const scanCeiling = getScanCeiling(analysis.scanQuality);
  capAudit.push({ source: "scanQuality", cap: scanCeiling });

  let rawOverall = Math.min(categoryFloor, defectCeiling, scanCeiling);

  rawOverall = applyCompoundHarshness(
    rawOverall,
    analysis.defects,
    era,
    capAudit,
    categoryScores,
    analysis
  );
  rawOverall = applyPsa1Calibration(
    rawOverall,
    analysis.defects,
    capAudit,
    categoryScores,
    analysis
  );

  const primaryLimiterCap =
    analysis.primaryLimiterTag &&
    analysis.defects.some((defect) => defect.tag === analysis.primaryLimiterTag)
      ? getPrimaryLimiterCap(
          analysis.primaryLimiterTag,
          analysis.defects,
          era,
          categoryScores,
          capAudit,
          analysis
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
    capAudit,
    analysis
  );

  rawOverall = applyIsolatedPillarFloor(
    rawOverall,
    categoryScores,
    analysis.defects,
    capAudit
  );

  rawOverall = applyExBandOptimismCeiling(
    rawOverall,
    categoryScores,
    analysis.defects,
    capAudit,
    analysis,
    era
  );

  rawOverall = applyNmGemVintageBandRules(
    rawOverall,
    categoryScores,
    analysis.defects,
    capAudit,
    analysis,
    era
  );

  rawOverall = applyBackOnlyWritingOverallFloor(
    rawOverall,
    categoryScores,
    analysis.defects,
    analysis,
    capAudit
  );

  rawOverall = applyModernPsa7LightWearStackCap(
    rawOverall,
    analysis.defects,
    analysis,
    era,
    capAudit,
    categoryScores
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
        (analysis.primaryLimiterTag
          ? getDefectLabel(analysis.primaryLimiterTag)
          : "None visible"),
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
