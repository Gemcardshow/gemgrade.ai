import {
  getDefectDefinition,
  isStructuralDefect,
  resolveEffectiveDefectTag,
  countWearDefects,
  countsForCompoundStructural,
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

export function hasPoorBandNoteSignals(analysis) {
  const notes = analysis?.categoryNotes || {};
  return ["corners", "edges", "surface"].filter((pillar) => {
    const text = String(notes[pillar] || "").toLowerCase();
    return (
      /\b(moderate wear|heavy wear|severe wear|heavy round|limits grade|reduces|affecting)\b/.test(
        text
      ) ||
      (/\bmoderate\b/.test(text) && /\bwear\b/.test(text)) ||
      (/\b(heavy|severe)\b/.test(text) &&
        /\b(chipping|fray|wear|rounding|rounded)\b/.test(text)) ||
      /\b(chipping noted|visible chipping|minor chipping|some rounding|limits visual|reduces)\b/.test(
        text
      )
    );
  }).length >= 2;
}

function hasModeratePlusWearLanguage(text) {
  return (
    /\b(moderate|major|heavy|severe)\b/.test(text) &&
    /\b(wear|scratch(?:es)?|scuff(?:s)?|fray(?:ing)?|chipping|rounding|rounded)\b/.test(
      text
    )
  );
}

function hasTriadModerateWearNotes(analysis) {
  const notes = analysis?.categoryNotes || {};
  return ["corners", "edges", "surface"].filter((pillar) => {
    const text = String(notes[pillar] || "").toLowerCase();
    return hasModeratePlusWearLanguage(text);
  }).length >= 2;
}

function hasTriadLightWearNotesOnly(analysis) {
  const notes = analysis?.categoryNotes || {};
  return ["corners", "edges", "surface"].filter((pillar) => {
    const text = String(notes[pillar] || "").toLowerCase();
    return /\b(wear|scratch(?:es)?|scuff(?:s)?|edge wear|chipping)\b/.test(text);
  }).length >= 3;
}

function shouldApplyTriadWearCap(analysis, categoryScores, defects) {
  if (!analysis) {
    return false;
  }

  const bandScores = analysis.visionCategoryScores || categoryScores;
  const wearFloor = getWearFloor(bandScores);
  const { centering } = categoryScores;

  if (
    countWearDefects(defects) >= 3 &&
    countModeratePlusDefects(defects) === 0 &&
    hasTriadLightWearNotesOnly(analysis) &&
    !hasTriadModerateWearNotes(analysis) &&
    wearFloor >= 5.5 &&
    wearFloor <= 6.5
  ) {
    if (centering >= 8 && hasVintageExAppealSignals(analysis)) {
      return false;
    }
    return true;
  }

  if (hasTriadModerateWearNotes(analysis)) {
    if (isExVgBandProtected(categoryScores, defects, analysis)) {
      return false;
    }
    return true;
  }
  if (isExVgBandProtected(categoryScores, defects, analysis)) {
    return false;
  }
  if (
    countWearDefects(defects) >= 3 &&
    countModeratePlusDefects(defects) === 0 &&
    hasTriadLightWearNotesOnly(analysis)
  ) {
    if (isExVgBandProtected(categoryScores, defects, analysis)) {
      return false;
    }
    return true;
  }
  return (
    getWearFloor(categoryScores) <= 5.5 &&
    hasPoorBandNoteSignals(analysis) &&
    hasTriadLightWearNotesOnly(analysis)
  );
}

const EX_VG_SKIPPED_VINTAGE_CAPS = new Set([
  "vintage:poor_band_notes_cluster",
  "vintage:optimistic_light_wear",
  "vintage:distributed_vg_wear",
  "vintage:multi_pillar_wear",
  "vintage:multi_pillar_heavy_wear",
  "vintage:triad_light_wear_notes",
  "vintage:uniform_optimistic_light_wear",
]);

const LIGHT_FRONT_WEAR_TAGS = new Set([
  "corner_wear_light",
  "edge_wear_light",
  "surface_scratch_light",
  "staining_light",
  "print_line",
  "gloss_loss",
  "registration_issue",
]);

function getWearBandScores(categoryScores, analysis) {
  return analysis?.visionCategoryScores || categoryScores;
}

function hasOnlyLightFrontWear(defects) {
  const frontDefects = defects.filter(
    (defect) => defect.location === "front" || defect.location === "both"
  );
  if (!frontDefects.length) {
    return true;
  }

  return frontDefects.every((defect) => {
    const definition = getDefectDefinition(defect.tag);
    return (
      LIGHT_FRONT_WEAR_TAGS.has(defect.tag) ||
      definition?.severityClass === "minor"
    );
  });
}

function shouldSkipOptimisticLightWearCap(categoryScores, defects, analysis) {
  return isExVgBandProtected(categoryScores, defects, analysis);
}

function qualifiesForExModerateWearCompound(categoryScores, defects, analysis) {
  if (!analysis || triggersPsa1Calibration(defects)) {
    return false;
  }

  const bandScores = getWearBandScores(categoryScores, analysis);
  const wearFloor = getWearFloor(bandScores);
  const { centering } = categoryScores;

  if (wearFloor < 5.5 || centering < 7) {
    return false;
  }
  if (hasClearlySevereStructuralTrigger(defects)) {
    return false;
  }
  if (countCompoundStructuralDefects(defects, analysis) >= 2) {
    return false;
  }
  if (
    analysis &&
    hasTriadLightWearNotesOnly(analysis) &&
    !hasTriadModerateWearNotes(analysis) &&
    countModeratePlusDefects(defects) === 0
  ) {
    return false;
  }
  if (analysis && hasPoorBandNoteSignals(analysis) && wearFloor <= 6) {
    return false;
  }

  return countModeratePlusDefects(defects) >= 2;
}

function shouldApplyHeavyMultiPillarCap(categoryScores, defects, analysis) {
  const bandScores = getWearBandScores(categoryScores, analysis);
  const bandPillarsAt45 = countPillarsAtOrBelow(bandScores, 4.5);
  const impactPillarsAt45 = countPillarsAtOrBelow(categoryScores, 4.5);

  if (bandPillarsAt45 >= 3) {
    return true;
  }

  const legacyPoorMultiPillar =
    categoryScores.surface <= 4 &&
    categoryScores.corners <= 5 &&
    categoryScores.edges <= 5;

  if (legacyPoorMultiPillar && bandPillarsAt45 >= 2) {
    if (analysis?.visionCategoryScores) {
      const visionPillarsAt45 = countPillarsAtOrBelow(
        analysis.visionCategoryScores,
        4.5
      );
      if (visionPillarsAt45 < 2) {
        return false;
      }
    }
    return true;
  }

  return (
    impactPillarsAt45 >= 3 &&
    bandPillarsAt45 >= 2 &&
    (hasClearlySevereStructuralTrigger(defects) || legacyPoorMultiPillar)
  );
}

function isExBackStainOnlyPresentation(categoryScores, defects, analysis) {
  if (!analysis?.primaryLimiterTag) {
    return false;
  }

  const bandScores = getWearBandScores(categoryScores, analysis);
  const { centering } = categoryScores;
  const wearFloor = getWearFloor(bandScores);

  if (centering < 7 || wearFloor < 6) {
    return false;
  }
  if (countModeratePlusDefects(defects) > 0) {
    return false;
  }
  if (isNmVintagePresentationCandidate(categoryScores, analysis)) {
    return false;
  }
  if (!hasBackStainDefects(defects)) {
    return false;
  }
  if (!STAIN_TAGS.has(analysis.primaryLimiterTag)) {
    return false;
  }

  return hasOnlyLightFrontWear(defects);
}

const EX_VG_INTERNAL_FLOOR = 5.0;

export function countPillarsAtOrBelow(categoryScores, threshold) {
  const { corners, edges, surface } = categoryScores;
  return [corners, edges, surface].filter((score) => score <= threshold).length;
}

export function getWearFloor(categoryScores) {
  return Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );
}

/**
 * EX/VG presentation: enough pillar strength to avoid poor-band vintage caps.
 * PSA-1/2 poor-band clusters still apply when notes or moderate+ defects say so.
 *
 * @param {import("./types.js").CategoryScores} categoryScores
 * @param {import("./types.js").VisionDefect[]} defects
 * @param {import("./types.js").VisionAnalysis | null} [analysis]
 */
export function isExVgBandProtected(categoryScores, defects, analysis = null) {
  if (triggersPsa1Calibration(defects)) {
    return false;
  }

  const bandScores = analysis?.visionCategoryScores || categoryScores;
  const wearFloor = getWearFloor(bandScores);
  if (wearFloor < 4.5) {
    return false;
  }
  if (countPillarsAtOrBelow(bandScores, 4.5) >= 1) {
    return false;
  }
  if (countPillarsAtOrBelow(bandScores, 5) >= 2) {
    return false;
  }
  if (countModeratePlusDefects(defects) >= 2) {
    return false;
  }
  if (analysis && hasPoorBandNoteSignals(analysis)) {
    const { centering } = categoryScores;
    if (wearFloor < 6 || centering < 7) {
      return false;
    }
  }

  // High subgrades with only minor wear tags are poor-band optimistic vision, not EX slab recovery.
  if (
    wearFloor >= 5.5 &&
    wearFloor <= 7.5 &&
    countModeratePlusDefects(defects) === 0 &&
    countWearDefects(defects) >= 2 &&
    !(analysis && hasVintageExAppealSignals(analysis))
  ) {
    return false;
  }

  // Light-wear-only triad notes on optimistic vision (PSA 3-style) still need poor-band caps.
  if (
    analysis &&
    wearFloor >= 5.5 &&
    wearFloor <= 6.5 &&
    countModeratePlusDefects(defects) === 0 &&
    countWearDefects(defects) >= 3 &&
    hasTriadLightWearNotesOnly(analysis) &&
    !hasTriadModerateWearNotes(analysis)
  ) {
    return false;
  }

  return wearFloor >= 5.5;
}

function hasClearlySevereStructuralTrigger(defects) {
  if (countSevereDefects(defects) >= 2) {
    return true;
  }

  const severeStructuralTags = new Set([
    "severe_crease",
    "paper_loss",
    "hole_tear",
    "writing_mark_severe",
    "back_damage_severe",
    "heavy_staining",
  ]);

  return defects.some((defect) =>
    severeStructuralTags.has(
      resolveEffectiveDefectTag(defect.tag, defect.severity)
    )
  );
}

function shouldApplyHarshStructuralCap(categoryScores, defects) {
  if (!categoryScores) {
    return true;
  }
  if (hasClearlySevereStructuralTrigger(defects)) {
    return true;
  }
  return countPillarsAtOrBelow(categoryScores, 4.5) >= 2;
}

export function countCompoundStructuralDefects(defects, analysis = null) {
  return defects.filter((defect) => countsForCompoundStructural(defect, analysis))
    .length;
}

function applyExVgVintageCap(
  overall,
  capValue,
  source,
  capAudit,
  categoryScores,
  defects,
  analysis = null
) {
  if (
    isExVgBandProtected(categoryScores, defects, analysis) &&
    EX_VG_SKIPPED_VINTAGE_CAPS.has(source)
  ) {
    return overall;
  }

  if (POOR_BAND_VINTAGE_CAP_SOURCES.has(source)) {
    capAudit.push({ source, cap: capValue });
    return Math.min(overall, capValue);
  }

  let effectiveCap = capValue;
  if (
    isExVgBandProtected(categoryScores, defects, analysis) &&
    capValue < EX_VG_INTERNAL_FLOOR
  ) {
    effectiveCap = EX_VG_INTERNAL_FLOOR;
    capAudit.push({ source: `${source}:ex_vg_floor`, floor: EX_VG_INTERNAL_FLOOR });
  } else {
    capAudit.push({ source, cap: capValue });
  }
  return Math.min(overall, effectiveCap);
}

function applyVintageWearCap(
  overall,
  capValue,
  source,
  capAudit,
  categoryScores,
  defects,
  analysis = null
) {
  return applyExVgVintageCap(
    overall,
    capValue,
    source,
    capAudit,
    categoryScores,
    defects,
    analysis
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
  categoryScores = null,
  analysis = null
) {
  let adjusted = overall;
  const severeCount = countSevereDefects(defects);
  const structuralCount = countCompoundStructuralDefects(defects, analysis);
  const moderatePlusCount = countModeratePlusDefects(defects);
  const wearFloor = categoryScores ? getWearFloor(categoryScores) : overall;

  if (severeCount >= 2) {
    adjusted = Math.min(adjusted, 2.5);
    capAudit.push({ source: "compound:2_severe_defects", cap: 2.5 });
  }

  if (severeCount >= 3) {
    adjusted = Math.min(adjusted, 1.5);
    capAudit.push({ source: "compound:3plus_severe_defects", cap: 1.5 });
  }

  if (structuralCount >= 3) {
    const applyHarshStructuralCap = shouldApplyHarshStructuralCap(
      categoryScores,
      defects
    );
    const structuralCap = applyHarshStructuralCap
      ? era === "vintage"
        ? 3.5
        : 4.0
      : era === "vintage"
        ? 5.0
        : 5.5;
    const source = applyHarshStructuralCap
      ? "compound:3plus_structural_defects"
      : "compound:3plus_structural_ex_band";
    if (categoryScores) {
      adjusted = applyExVgVintageCap(
        adjusted,
        structuralCap,
        source,
        capAudit,
        categoryScores,
        defects,
        analysis
      );
    } else {
      adjusted = Math.min(adjusted, structuralCap);
      capAudit.push({ source, cap: structuralCap });
    }
  } else if (moderatePlusCount >= 2) {
    let moderateCap =
      era === "vintage" &&
      categoryScores &&
      (isExVgBandProtected(categoryScores, defects, analysis) ||
        qualifiesForExModerateWearCompound(categoryScores, defects, analysis))
        ? 5.5
        : era === "vintage"
          ? 4.0
          : 4.5;
    let source = "compound:2plus_moderate_defects";
    if (
      era === "vintage" &&
      categoryScores &&
      wearFloor >= 6 &&
      moderatePlusCount >= 2 &&
      (analysis ? hasPoorBandNoteSignals(analysis) : false) &&
      !isExVgBandProtected(categoryScores, defects, analysis)
    ) {
      moderateCap =
        moderatePlusCount >= 3 || structuralCount >= 2 ? 2.5 : 3.0;
      source = "compound:optimistic_moderate_cluster";
    }
    if (categoryScores) {
      adjusted = applyExVgVintageCap(
        adjusted,
        moderateCap,
        source,
        capAudit,
        categoryScores,
        defects,
        analysis
      );
    } else {
      adjusted = Math.min(adjusted, moderateCap);
      capAudit.push({ source, cap: moderateCap });
    }
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

  const bandScores = getWearBandScores(categoryScores, analysis);
  const { corners, edges, surface } = categoryScores;
  const floor = Math.min(corners, edges, surface);
  const bandPillarsAt45 = countPillarsAtOrBelow(bandScores, 4.5);

  if (
    shouldApplyHeavyMultiPillarCap(categoryScores, defects, analysis) &&
    !isExVgBandProtected(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      1.5,
      "vintage:multi_pillar_heavy_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    bandPillarsAt45 >= 3 &&
    !isExVgBandProtected(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      2.5,
      "vintage:multi_pillar_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    analysis &&
    hasPoorBandNoteSignals(analysis) &&
    countModeratePlusDefects(defects) >= 2 &&
    floor <= 5.5
  ) {
    const notesText = Object.values(analysis.categoryNotes || {})
      .join(" ")
      .toLowerCase();
    const harshNotes =
      /\b(rounding|rounded|limits|heavy|severe|chipping|affecting|reduces)\b/.test(
        notesText
      );
    const clusterCap = harshNotes ? 2.0 : 2.5;
    return applyVintageWearCap(
      overall,
      clusterCap,
      "vintage:poor_band_notes_cluster",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  const pillarsAtOrBelowFive = [corners, edges, surface].filter(
    (score) => score <= 5
  ).length;
  const bandPillarsAtFive = countPillarsAtOrBelow(bandScores, 5);

  if (
    bandPillarsAtFive >= 3 &&
    countWearDefects(defects) >= 2 &&
    !isExVgBandProtected(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      3.5,
      "vintage:distributed_vg_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    bandPillarsAtFive >= 2 &&
    getWearFloor(bandScores) <= 4.5 &&
    countWearDefects(defects) >= 2 &&
    !isExVgBandProtected(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      3.5,
      "vintage:distributed_vg_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    pillarsAtOrBelowFive >= 2 &&
    countWearDefects(defects) >= 2 &&
    isExVgBandProtected(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      5.5,
      "vintage:distributed_vg_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    getWearFloor(bandScores) >= 6 &&
    getWearFloor(bandScores) <= 7 &&
    Math.max(corners, edges, surface) - Math.min(corners, edges, surface) >= 1.5 &&
    countWearDefects(defects) >= 2 &&
    countModeratePlusDefects(defects) === 0 &&
    !shouldSkipOptimisticLightWearCap(categoryScores, defects, analysis)
  ) {
    return applyVintageWearCap(
      overall,
      3.5,
      "vintage:optimistic_light_wear",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
  }

  if (
    countWearDefects(defects) >= 3 &&
    countModeratePlusDefects(defects) === 0 &&
    floor >= 5 &&
    floor <= 7.5 &&
    analysis &&
    shouldApplyTriadWearCap(analysis, categoryScores, defects)
  ) {
    return applyVintageWearCap(
      overall,
      3.5,
      "vintage:triad_light_wear_notes",
      capAudit,
      categoryScores,
      defects,
      analysis
    );
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

  overall = applyVintageExSlabBandRecovery(
    overall,
    categoryScores,
    defects,
    capAudit,
    analysis
  );

  return overall;
}

/**
 * Lift vintage EX/VG presentations that calibration stacked below slab band.
 */
const POOR_BAND_VINTAGE_CAP_SOURCES = new Set([
  "vintage:triad_light_wear_notes",
  "vintage:poor_band_notes_cluster",
  "vintage:multi_pillar_heavy_wear",
  "vintage:multi_pillar_wear",
]);

export function applyVintageExSlabBandRecovery(
  overall,
  categoryScores,
  defects,
  capAudit,
  analysis = null
) {
  if (!isExVgBandProtected(categoryScores, defects, analysis)) {
    return overall;
  }

  if (
    capAudit.some((entry) => POOR_BAND_VINTAGE_CAP_SOURCES.has(entry.source))
  ) {
    return overall;
  }

  const bandScores = analysis?.visionCategoryScores || categoryScores;
  const wearFloor = getWearFloor(bandScores);
  const { centering } = categoryScores;
  let target = wearFloor;

  if (wearFloor >= 6.5 && centering >= 7.5) {
    target = 6;
  } else if (wearFloor >= 6 && centering >= 7) {
    target = 5.5;
  } else if (wearFloor >= 5.5) {
    target = 5;
  }

  if (overall >= target) {
    return overall;
  }

  capAudit.push({ source: "vintage:ex_slab_band_recovery", floor: target });
  return target;
}

/**
 * Surface-weighted wear floor for vintage EX/VG (corners/edges no longer sole drivers).
 */
export function getOverallCategoryFloor(
  categoryScores,
  era,
  defects,
  analysis = null
) {
  const { corners, edges, surface } = categoryScores;
  const minPillar = Math.min(corners, edges, surface);

  if (era !== "vintage" || triggersPsa1Calibration(defects)) {
    return minPillar;
  }

  if (!isExVgBandProtected(categoryScores, defects, analysis)) {
    return minPillar;
  }

  const sorted = [corners, edges, surface].sort((a, b) => a - b);
  const medianPillar = sorted[1];
  const weighted = roundToHalf(
    clampGrade(corners * 0.2 + edges * 0.25 + surface * 0.55)
  );

  return Math.max(minPillar, Math.min(medianPillar, weighted));
}

/**
 * Prevent a single harsh corner/edge impact from dominating EX slab presentations.
 */
export function applyExCategoryImpactRelief(
  categoryScores,
  defects,
  analysis,
  capAudit
) {
  if (!analysis || !isExVgBandProtected(categoryScores, defects, analysis)) {
    return categoryScores;
  }

  const bandScores = analysis.visionCategoryScores || categoryScores;
  const adjusted = { ...categoryScores };
  const sideStrength = Math.min(bandScores.corners, bandScores.edges);

  if (adjusted.surface <= 4.5 && sideStrength >= 6) {
    const lifted = roundToHalf(
      clampGrade(Math.max(adjusted.surface, Math.min(6, sideStrength - 0.5)))
    );
    if (lifted > adjusted.surface) {
      adjusted.surface = lifted;
      capAudit.push({ source: "ex_band:surface_pillar_relief", floor: lifted });
    }
  }

  if (adjusted.edges <= 4.5 && adjusted.corners >= 6 && adjusted.surface >= 5.5) {
    const lifted = roundToHalf(clampGrade(Math.max(adjusted.edges, 5)));
    if (lifted > adjusted.edges) {
      adjusted.edges = lifted;
      capAudit.push({ source: "ex_band:edge_pillar_relief", floor: lifted });
    }
  }

  if (adjusted.corners <= 4.5 && adjusted.edges >= 6 && adjusted.surface >= 5.5) {
    const lifted = roundToHalf(clampGrade(Math.max(adjusted.corners, 5)));
    if (lifted > adjusted.corners) {
      adjusted.corners = lifted;
      capAudit.push({ source: "ex_band:corner_pillar_relief", floor: lifted });
    }
  }

  return adjusted;
}

/**
 * Cap uniform light-tag optimism on otherwise EX scans (Ryan-style inflation).
 */
export function applyExBandOptimismCeiling(
  overall,
  categoryScores,
  defects,
  capAudit,
  analysis = null
) {
  if (analysis && isExBackStainOnlyPresentation(categoryScores, defects, analysis)) {
    const bandScores = getWearBandScores(categoryScores, analysis);
    const wearFloor = getWearFloor(bandScores);
    const ceiling = Math.min(6, roundToHalf(clampGrade(wearFloor + 1)));
    const capped = Math.min(overall, ceiling);
    if (capped < overall) {
      capAudit.push({ source: "ex_band:back_stain_only_ceiling", cap: ceiling });
    }
    return capped;
  }

  if (countModeratePlusDefects(defects) > 0 || defects.length === 0) {
    return overall;
  }

  const wearFloor = getWearFloor(categoryScores);
  if (wearFloor < 7.5) {
    return overall;
  }

  const ryanStyleInflation =
    defects.length === 1 && defects[0]?.tag === "corner_wear_light";

  if (!ryanStyleInflation) {
    return overall;
  }

  const capped = Math.min(overall, 5);
  if (capped < overall) {
    capAudit.push({ source: "ex_band:uniform_light_optimism_ceiling", cap: 5 });
  }
  return capped;
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
