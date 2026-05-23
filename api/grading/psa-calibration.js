import { getDefectDefinition } from "./defects.js";
import { clampGrade, roundToHalf } from "./types.js";

const PSA1_TRIGGER_TAGS = new Set([
  "paper_loss",
  "hole_tear",
  "trim_alteration_suspected",
  "writing_mark_severe",
]);

export function countSevereDefects(defects) {
  return defects.filter((defect) => {
    const definition = getDefectDefinition(defect.tag);
    if (!definition) return defect.severity === "severe";
    return (
      definition.severityClass === "severe" ||
      definition.severityClass === "disqualifying" ||
      defect.severity === "severe"
    );
  }).length;
}

export function hasSevereBackDamage(defects) {
  return defects.some(
    (defect) =>
      defect.tag === "back_damage_severe" &&
      (defect.severity === "severe" ||
        getDefectDefinition(defect.tag)?.severityClass === "severe")
  );
}

export function hasModerateFrontWear(defects) {
  const frontWearTags = new Set([
    "corner_wear_moderate",
    "edge_fraying_major",
    "moderate_crease",
    "surface_wear",
    "surface_scratch_moderate",
  ]);

  return defects.some(
    (defect) =>
      frontWearTags.has(defect.tag) &&
      (defect.location === "front" || defect.location === "both") &&
      (defect.severity === "moderate" || defect.severity === "severe")
  );
}

export function triggersPsa1Calibration(defects) {
  const severeCount = countSevereDefects(defects);

  if (severeCount >= 3) return true;

  if (defects.some((defect) => PSA1_TRIGGER_TAGS.has(defect.tag))) {
    return true;
  }

  const hasSevereCrease = defects.some((defect) => defect.tag === "severe_crease");
  if (hasSevereCrease && severeCount >= 2) return true;

  return false;
}

export function applyCompoundHarshness(overall, defects, era, capAudit) {
  let adjusted = overall;
  const severeCount = countSevereDefects(defects);

  if (severeCount >= 2) {
    adjusted = Math.min(adjusted, 2.5);
    capAudit.push({ source: "compound:2_severe_defects", cap: 2.5 });
  }

  if (severeCount >= 3) {
    adjusted = Math.min(adjusted, 1.5);
    capAudit.push({ source: "compound:3plus_severe_defects", cap: 1.5 });
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
