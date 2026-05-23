/**
 * Central defect registry. Caps are enforced in code, not prompt suggestions.
 */
export const DEFECT_REGISTRY = {
  corner_wear_light: {
    label: "Light corner wear",
    severityClass: "minor",
    capVintage: 8.0,
    capModern: 8.5,
  },
  corner_wear_moderate: {
    label: "Moderate corner wear",
    severityClass: "moderate",
    capVintage: 6.0,
    capModern: 6.5,
    categoryImpact: { corners: 6.0 },
  },
  rounded_corners_all: {
    label: "All four corners heavily rounded",
    severityClass: "moderate",
    capVintage: 4.0,
    capModern: 4.5,
    categoryImpact: { corners: 4.5 },
  },
  edge_wear_light: {
    label: "Light edge wear",
    severityClass: "minor",
    capVintage: 8.0,
    capModern: 8.5,
  },
  edge_fraying_major: {
    label: "Major edge fraying or chipping",
    severityClass: "severe",
    capVintage: 3.0,
    capModern: 3.5,
    categoryImpact: { edges: 3.5 },
  },
  moderate_crease: {
    label: "Moderate crease or wrinkle",
    severityClass: "moderate",
    capVintage: 3.0,
    capModern: 3.5,
    categoryImpact: { surface: 3.5 },
  },
  severe_crease: {
    label: "Severe crease or wrinkle",
    severityClass: "severe",
    capVintage: 2.0,
    capModern: 2.5,
    categoryImpact: { surface: 2.5 },
  },
  surface_scratch_light: {
    label: "Light surface scratch",
    severityClass: "minor",
    capVintage: 7.5,
    capModern: 8.0,
  },
  surface_scratch_moderate: {
    label: "Moderate surface scratching",
    severityClass: "moderate",
    capVintage: 5.5,
    capModern: 6.0,
    categoryImpact: { surface: 6.0 },
  },
  surface_wear: {
    label: "General surface wear",
    severityClass: "moderate",
    capVintage: 5.0,
    capModern: 5.5,
    categoryImpact: { surface: 5.5 },
  },
  print_line: {
    label: "Print line or roller mark",
    severityClass: "minor",
    capVintage: 8.0,
    capModern: 8.5,
  },
  print_line_severe: {
    label: "Heavy print line or manufacturing defect",
    severityClass: "moderate",
    capVintage: 6.5,
    capModern: 7.0,
    categoryImpact: { surface: 7.0 },
  },
  staining_light: {
    label: "Light staining or discoloration",
    severityClass: "minor",
    capVintage: 7.0,
    capModern: 7.5,
  },
  heavy_staining: {
    label: "Heavy staining or discoloration",
    severityClass: "severe",
    capVintage: 3.0,
    capModern: 3.5,
    categoryImpact: { surface: 3.5 },
  },
  wax_stain: {
    label: "Wax stain or residue",
    severityClass: "moderate",
    capVintage: 5.0,
    capModern: 5.5,
    categoryImpact: { surface: 5.5 },
  },
  paper_loss: {
    label: "Paper loss or peeling",
    severityClass: "severe",
    capVintage: 1.5,
    capModern: 2.0,
    categoryImpact: { surface: 2.0 },
  },
  hole_tear: {
    label: "Hole or tear",
    severityClass: "severe",
    capVintage: 1.5,
    capModern: 2.0,
    categoryImpact: { surface: 1.5 },
  },
  writing_mark: {
    label: "Writing, mark, or ink",
    severityClass: "moderate",
    capVintage: 3.0,
    capModern: 3.5,
    categoryImpact: { surface: 3.5 },
  },
  writing_mark_severe: {
    label: "Heavy writing or marking over significant area",
    severityClass: "severe",
    capVintage: 2.0,
    capModern: 2.5,
    categoryImpact: { surface: 2.5 },
  },
  gloss_loss: {
    label: "Gloss loss or print softness",
    severityClass: "moderate",
    capVintage: 6.0,
    capModern: 7.0,
    categoryImpact: { surface: 6.5 },
  },
  registration_issue: {
    label: "Registration or print alignment issue",
    severityClass: "minor",
    capVintage: 8.0,
    capModern: 8.5,
  },
  back_wear: {
    label: "Back wear or discoloration",
    severityClass: "moderate",
    capVintage: 5.5,
    capModern: 6.0,
    categoryImpact: { surface: 6.0 },
  },
  back_damage_severe: {
    label: "Severe back damage",
    severityClass: "severe",
    capVintage: 2.5,
    capModern: 3.0,
    categoryImpact: { surface: 3.0 },
  },
  trim_alteration_suspected: {
    label: "Suspected trim or alteration",
    severityClass: "disqualifying",
    capVintage: 1.0,
    capModern: 1.0,
  },
  centering_off_minor: {
    label: "Minor centering variance",
    severityClass: "minor",
    capVintage: 9.0,
    capModern: 9.0,
    categoryImpact: { centering: 9.0 },
  },
  centering_off_major: {
    label: "Major centering issue",
    severityClass: "moderate",
    capVintage: 8.0,
    capModern: 8.0,
    categoryImpact: { centering: 8.0 },
  },
};

export const DEFECT_TAGS = Object.keys(DEFECT_REGISTRY);

export function getDefectDefinition(tag) {
  return DEFECT_REGISTRY[tag] || null;
}

export function getDefectLabel(tag) {
  return DEFECT_REGISTRY[tag]?.label || tag;
}

export function getDefectCap(tag, era) {
  const defect = DEFECT_REGISTRY[tag];
  if (!defect) return 10;
  return era === "vintage" ? defect.capVintage : defect.capModern;
}

export function isSevereDefect(defect) {
  const definition = DEFECT_REGISTRY[defect.tag];
  if (!definition) return defect.severity === "severe";
  if (definition.severityClass === "severe" || definition.severityClass === "disqualifying") {
    return true;
  }
  return defect.severity === "severe";
}

export function isModerateDefect(defect) {
  const definition = DEFECT_REGISTRY[defect.tag];
  if (!definition) return defect.severity === "moderate";
  return definition.severityClass === "moderate" || defect.severity === "moderate";
}
