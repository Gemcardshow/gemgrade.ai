import {
  getDefectDefinition,
  isStructuralDefect,
  resolveEffectiveDefectTag,
  countWearDefects,
} from "./defects.js";
import {
  hasVintageExAppealSignals,
  isNmVintagePresentationCandidate,
  isStrongCenteringWearOverTagPattern,
} from "./analyze.js";
import { clampGrade, roundToHalf } from "./types.js";

const STAIN_TAGS = new Set(["staining_light", "heavy_staining", "wax_stain"]);

const PSA1_TRIGGER_TAGS = new Set([
  "paper_loss",
  "hole_tear",
  "trim_alteration_suspected",
  "writing_mark_severe",
]);

const BACK_DISQUALIFYING_TAGS = new Set([
  "writing_mark_severe",
  "writing_mark",
  "paper_loss",
  "hole_tear",
  "trim_alteration_suspected",
]);

export function hasDominantBackDisqualifier(defects) {
  return defects.some(
    (defect) =>
      BACK_DISQUALIFYING_TAGS.has(
        resolveEffectiveDefectTag(defect.tag, defect.severity)
      ) && defect.location === "back"
  );
}

export function countSevereDefects(defects) {
  return defects.filter((defect) => {
    const effectiveTag = resolveEffectiveDefectTag(defect.tag, defect.severity);
    const definition = getDefectDefinition(effectiveTag);
    if (!definition) return defect.severity === "severe";
    return (
      definition.severityClass === "severe" ||
      definition.severityClass === "disqualifying" ||
      defect.severity === "severe"
    );
  }).length;
}

export function countStructuralDefects(defects) {
  return defects.filter((defect) => isStructuralDefect(defect)).length;
}

export function countModeratePlusDefects(defects) {
  return defects.filter((defect) => {
    const effectiveTag = resolveEffectiveDefectTag(defect.tag, defect.severity);
    const definition = getDefectDefinition(effectiveTag);
    if (!definition) {
      return defect.severity === "moderate" || defect.severity === "severe";
    }
    return (
      definition.severityClass === "moderate" ||
      definition.severityClass === "severe" ||
      definition.severityClass === "disqualifying" ||
      defect.severity === "moderate" ||
      defect.severity === "severe"
    );
  }).length;
}

export function hasSevereBackDamage(defects) {
  return defects.some(
    (defect) =>
      resolveEffectiveDefectTag(defect.tag, defect.severity) === "back_damage_severe"
  );
}

export function hasModerateFrontWear(defects) {
  const frontWearTags = new Set([
    "corner_wear_moderate",
    "edge_fraying_major",
    "moderate_crease",
    "severe_crease",
    "surface_wear",
    "surface_scratch_moderate",
  ]);

  return defects.some(
    (defect) =>
      frontWearTags.has(resolveEffectiveDefectTag(defect.tag, defect.severity)) &&
      (defect.location === "front" || defect.location === "both") &&
      (defect.severity === "moderate" || defect.severity === "severe")
  );
}

export function triggersPsa1Calibration(defects) {
  const severeCount = countSevereDefects(defects);
  const structuralCount = countStructuralDefects(defects);

  if (severeCount >= 3) return true;

  if (defects.some((defect) => PSA1_TRIGGER_TAGS.has(defect.tag))) {
    return true;
  }

  const hasSevereCrease = defects.some(
    (defect) => resolveEffectiveDefectTag(defect.tag, defect.severity) === "severe_crease"
  );
  if (hasSevereCrease && severeCount >= 2) return true;

  if (hasSevereCrease && structuralCount >= 3) return true;

  if (
    defects.some(
      (defect) =>
        resolveEffectiveDefectTag(defect.tag, defect.severity) === "back_damage_severe"
    ) &&
    countModeratePlusDefects(defects) >= 2
  ) {
    return true;
  }

  return false;
}

export function applyCompoundHarshness(
  overall,
  defects,
  era,
  capAudit,
  categoryScores = null
) {
  let adjusted = overall;
  const severeCount = countSevereDefects(defects);
  const structuralCount = countStructuralDefects(defects);
  const moderatePlusCount = countModeratePlusDefects(defects);
  const wearFloor = categoryScores
    ? Math.min(
        categoryScores.corners,
        categoryScores.edges,
        categoryScores.surface
      )
    : overall;
  const hasWeakPillar =
    categoryScores &&
    [categoryScores.corners, categoryScores.edges, categoryScores.surface].some(
      (score) => score <= 5.5
    );

  if (severeCount >= 2) {
    adjusted = Math.min(adjusted, 2.5);
    capAudit.push({ source: "compound:2_severe_defects", cap: 2.5 });
  }

  if (severeCount >= 3) {
    adjusted = Math.min(adjusted, 1.5);
    capAudit.push({ source: "compound:3plus_severe_defects", cap: 1.5 });
  }

  if (structuralCount >= 3) {
    const applyHarshStructuralCap =
      !categoryScores || wearFloor <= 5.5 || hasWeakPillar;
    const structuralCap = applyHarshStructuralCap
      ? era === "vintage"
        ? 3.5
        : 4.0
      : era === "vintage"
        ? 5.0
        : 5.5;
    adjusted = Math.min(adjusted, structuralCap);
    capAudit.push({
      source: applyHarshStructuralCap
        ? "compound:3plus_structural_defects"
        : "compound:3plus_structural_ex_band",
      cap: structuralCap,
    });
  } else if (moderatePlusCount >= 2) {
    const moderateCap = era === "vintage" ? 4.0 : 4.5;
    adjusted = Math.min(adjusted, moderateCap);
    capAudit.push({ source: "compound:2plus_moderate_defects", cap: moderateCap });
  }

  if (era === "vintage" && hasSevereBackDamage(defects) && hasModerateFrontWear(defects)) {
    adjusted = roundToHalf(adjusted - 0.5);
    capAudit.push({ source: "compound:vintage_back_plus_front_wear", cap: adjusted });
  }

  return adjusted;
}

export function applyPsa1Calibration(overall, defects, capAudit) {
  if (!triggersPsa1Calibration(defects)) {
    return overall;
  }

  const capped = Math.min(overall, 2.0);
  capAudit.push({ source: "psa1_calibration", cap: 2.0 });
  return capped;
}

/**
 * Vintage cards with heavy wear across multiple pillars should not grade as mid-tier
 * when subgrades already show poor corners, edges, and surface together.
 */
function hasUniformOptimisticWearAppeal(analysis) {
  if (!analysis) return false;

  const text = [analysis.eyeAppealSummary, analysis.bestAttribute]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(clean presentation|pristine|near.?mint|nm condition|sharp corners|clean edges)\b/.test(
      text
    )
  ) {
    return false;
  }

  const mentionsCorners = /\bcorner/.test(text);
  const mentionsSurfaceWear = /\b(scratch|scuff|surface|stain)\b/.test(text);
  const mentionsWear = /\b(wear|chipping|rounding)\b/.test(text);
  const appealMultiPillar =
    mentionsCorners &&
    mentionsSurfaceWear &&
    (/\b(minor|light|visible|moderate)\b/.test(text) || mentionsWear);

  const defectList = analysis.defects || [];
  const defectTags = new Set(defectList.map((defect) => defect.tag));
  const stainWearCombo =
    analysis.primaryLimiterTag === "staining_light" &&
    hasBackStainDefects(defectList) &&
    defectTags.has("corner_wear_light") &&
    (defectTags.has("surface_scratch_light") || defectTags.has("edge_wear_light"));

  return appealMultiPillar || stainWearCombo;
}

function hasBackStainDefects(defects) {
  return defects.some(
    (defect) => STAIN_TAGS.has(defect.tag) && defect.location === "back"
  );
}

function resolveUniformOptimisticWearCap(analysis, defects) {
  if (!hasUniformOptimisticWearAppeal(analysis)) {
    return null;
  }

  if (hasBackStainDefects(defects)) {
    return 3.5;
  }

  if (hasVintageExAppealSignals(analysis)) {
    return 5.5;
  }

  return 3.5;
}

export function applyVintageMultiPillarWearCap(
  overall,
  categoryScores,
  era,
  defects,
  capAudit,
  analysis = null
) {
  if (era !== "vintage") return overall;

  if (hasDominantBackDisqualifier(defects)) {
    return overall;
  }

  const { corners, edges, surface } = categoryScores;
  const floor = Math.min(corners, edges, surface);

  if (surface <= 4 && corners <= 5 && edges <= 5) {
    const capped = Math.min(overall, 1.5);
    capAudit.push({ source: "vintage:multi_pillar_heavy_wear", cap: 1.5 });
    return capped;
  }

  if (surface <= 4.5 && corners <= 5.5 && edges <= 5.5) {
    const capped = Math.min(overall, 2.5);
    capAudit.push({ source: "vintage:multi_pillar_wear", cap: 2.5 });
    return capped;
  }

  if (
    floor <= 5 &&
    [corners, edges, surface].filter((score) => score <= 5).length >= 2 &&
    corners <= 7.5 &&
    edges <= 6.5 &&
    surface <= 7.5 &&
    countWearDefects(defects) >= 2
  ) {
    const capped = Math.min(overall, 3.5);
    capAudit.push({ source: "vintage:distributed_vg_wear", cap: 3.5 });
    return capped;
  }

  if (
    floor >= 6 &&
    floor <= 7 &&
    Math.max(corners, edges, surface) - Math.min(corners, edges, surface) >= 1.5 &&
    countWearDefects(defects) >= 2 &&
    countModeratePlusDefects(defects) === 0
  ) {
    const capped = Math.min(overall, 3.5);
    capAudit.push({ source: "vintage:optimistic_light_wear", cap: 3.5 });
    return capped;
  }

  if (
    analysis &&
    isStrongCenteringWearOverTagPattern(categoryScores, analysis) &&
    countModeratePlusDefects(defects) === 0 &&
    defects.some((defect) =>
      ["edge_wear_light", "edge_fraying_major"].includes(defect.tag)
    ) &&
    edges <= 7
  ) {
    return overall;
  }

  const uniformCap = resolveUniformOptimisticWearCap(analysis, defects);
  if (
    uniformCap === 3.5 &&
    analysis &&
    isNmVintagePresentationCandidate(categoryScores, analysis) &&
    countModeratePlusDefects(defects) === 0 &&
    floor >= 6.5
  ) {
    return overall;
  }
  if (
    floor >= 7 &&
    floor <= 8 &&
    Math.max(corners, edges, surface) - Math.min(corners, edges, surface) < 1.5 &&
    countWearDefects(defects) >= 2 &&
    countModeratePlusDefects(defects) === 0 &&
    uniformCap !== null
  ) {
    const capped = Math.min(overall, uniformCap);
    capAudit.push({
      source: "vintage:uniform_optimistic_light_wear",
      cap: uniformCap,
    });
    return capped;
  }

  return overall;
}

/**
 * When only one pillar is weak but the other two stay fair, avoid collapsing
 * the overall grade as if all three pillars failed together.
 */
export function applyIsolatedPillarFloor(overall, categoryScores, defects, capAudit) {
  const { corners, edges, surface } = categoryScores;
  const structuralCount = countStructuralDefects(defects);
  const structuralTags = defects
    .filter((defect) => isStructuralDefect(defect))
    .map((defect) => resolveEffectiveDefectTag(defect.tag, defect.severity));
  const onlyEdgeStructural =
    structuralCount === 1 && structuralTags[0] === "edge_fraying_major";

  if (structuralCount >= 2 || !onlyEdgeStructural) {
    return overall;
  }

  if (
    edges > 5 ||
    corners < 6 ||
    surface < 6 ||
    overall >= 5.5
  ) {
    return overall;
  }

  const avgStrong = (corners + surface) / 2;
  const floor = Math.min(avgStrong - 0.5, 7);
  if (overall >= floor) {
    return overall;
  }

  capAudit.push({ source: "isolated_pillar_outlier", floor });
  return floor;
}

export function applyCenteringGemCap(overall, centering, capAudit) {
  let adjusted = overall;

  if (centering < 8.0) {
    adjusted = Math.min(adjusted, 8.0);
    capAudit.push({ source: "centering:major", cap: 8.0 });
  } else if (centering < 9.0) {
    adjusted = Math.min(adjusted, 9.0);
    capAudit.push({ source: "centering:minor", cap: 9.0 });
  }

  return adjusted;
}

export function finalizeInternalGrade(value) {
  return clampGrade(roundToHalf(value));
}
