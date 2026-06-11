import { GRADING_PHILOSOPHY, MODERN_GRADING_PHILOSOPHY } from "./philosophy.js";
import {
  getDefectDefinition,
  getDefectLabel,
  getEffectiveDefectCap,
  normalizeDefectObservation,
  resolveEffectiveDefectTag,
  escalateLightWearObservation,
} from "./defects.js";
import {
  ANALYSIS_JSON_SCHEMA,
  buildAnalysisInstruction,
  ERA_JSON_SCHEMA,
} from "./prompts/core.js";
import { MODERN_RUBRIC } from "./prompts/modern.js";
import { VINTAGE_RUBRIC } from "./prompts/vintage.js";
import { clampGrade, roundToHalf } from "./types.js";

function parseJsonResponse(outputText) {
  try {
    return JSON.parse(outputText);
  } catch {
    const match = outputText.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model did not return valid JSON analysis");
    }
    return JSON.parse(match[0]);
  }
}

async function callStructuredVision(client, { schema, instruction, frontImage, backImage }) {
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: schema,
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: frontImage } },
          { type: "image_url", image_url: { url: backImage } },
        ],
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from vision model");
  }

  return parseJsonResponse(content);
}

function isFairCardPattern(categoryScores, raw) {
  const { corners, surface, centering, edges } = categoryScores;
  if (raw && admitsDistributedWearAppeal(raw)) return false;
  return corners >= 6 && surface >= 6 && centering >= 7 && edges >= 5;
}

function admitsDistributedWearAppeal(raw) {
  const text = collectAppealText(raw);
  const mentionsWear = /\b(wear|chipping|rounding|scratch|stain)\b/.test(text);
  const mentionsCorners = /\bcorner/.test(text);
  const mentionsEdges = /\bedge/.test(text);
  const mentionsSurface = /\b(surface|scratch|scuff)\b/.test(text);
  const visibleModerate =
    /\b(visible|moderate|noticeable|significant)\b/.test(text) && mentionsWear;
  const minorMultiPillar =
    /\b(minor|light|slight)\b/.test(text) &&
    mentionsCorners &&
    mentionsSurface &&
    mentionsWear;

  const notesMultiPillarPoorWear =
    countNotesPillarsWithPoorWear(raw) >= 2 &&
    !hasBackWritingDefect(raw.defects || []);

  return (
    (visibleModerate && mentionsCorners && mentionsEdges && mentionsSurface) ||
    (minorMultiPillar && mentionsCorners && mentionsSurface) ||
    notesMultiPillarPoorWear
  );
}

function noteIndicatesPoorBandWear(text) {
  const normalized = String(text || "").toLowerCase();
  const negatesSeverity = (term) =>
    new RegExp(`\\b(no|not|without|none|absence of)\\s+${term}\\b`).test(normalized) ||
    new RegExp(`\\b${term}\\s+damage\\s+not\\b`).test(normalized);
  return (
    /\b(moderate wear|heavy wear|severe wear|heavy round|limits grade|reduces|affecting)\b/.test(
      normalized
    ) ||
    (/\bmoderate\b/.test(normalized) && /\bwear\b/.test(normalized)) ||
    (/\b(heavy|severe)\b/.test(normalized) &&
      !negatesSeverity("heavy") &&
      !negatesSeverity("severe") &&
      /\b(chipping|fray|wear|rounding|rounded)\b/.test(normalized)) ||
    /\b(chipping noted|visible chipping|minor chipping|some rounding|limits visual)\b/.test(
      normalized
    )
  );
}

function countNotesPillarsWithPoorWear(raw) {
  const notes = raw?.categoryNotes || {};
  return ["corners", "edges", "surface"].filter((pillar) =>
    noteIndicatesPoorBandWear(notes[pillar])
  ).length;
}

function hasBackWritingDefect(defects) {
  return defects.some(
    (defect) =>
      (defect.tag === "writing_mark" || defect.tag === "writing_mark_severe") &&
      defect.location === "back"
  );
}

function reconcileBackWritingSeverity(defects, categoryScores, raw, era) {
  if (era !== "vintage" || !hasBackWritingDefect(defects)) {
    return defects;
  }

  const text = [
    raw.primaryLimiterLabel,
    raw.eyeAppealSummary,
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();
  const definitiveInk = /\b(ink|pen|pencil|marker|scribble|autograph written)\b/.test(
    text
  );

  if (definitiveInk) {
    return defects;
  }

  return defects.map((defect) => {
    if (defect.tag !== "writing_mark_severe" || defect.location !== "back") {
      return defect;
    }

    return {
      ...defect,
      tag: "writing_mark",
      severity: "moderate",
    };
  });
}

function hasTriadLightWearProfile(raw, defects) {
  return (
    (defects || []).length > 0 &&
    (defects || []).every((defect) => LIGHT_WEAR_ONLY_TAGS.has(defect.tag)) &&
    countNotesPillarsWithWear(raw) >= 3
  );
}

function countNotesPillarsWithWear(raw) {
  const notes = raw?.categoryNotes || {};
  return ["corners", "edges", "surface"].filter((pillar) => {
    const text = String(notes[pillar] || "").toLowerCase();
    return /\b(wear|scratch(?:es)?|scuff(?:s)?|chipping|rounding|rounded|fray|stain(?:s)?|crease)\b/.test(
      text
    );
  }).length;
}

/**
 * PSA 4–6 EX slabs: soften note phrasing that falsely triggers poor-band clustering.
 */
function reconcileVintageExBandCategoryNotes(raw, categoryScores) {
  const notes = raw.categoryNotes || {};
  if (!Object.keys(notes).length || categoryScores.centering < 7) {
    return { categoryNotes: notes, reconciled: false };
  }
  if (
    raw.primaryLimiterTag === "back_wear" ||
    (raw.defects || []).some((defect) => defect.tag === "back_wear")
  ) {
    return { categoryNotes: notes, reconciled: false };
  }

  const adjusted = { ...notes };
  let reconciled = false;

  for (const pillar of ["corners", "edges", "surface"]) {
    const text = String(adjusted[pillar] || "");
    if (!text) continue;

    const lower = text.toLowerCase();
    if (
      /\b(affecting|reduces)\b/.test(lower) &&
      /\b(gloss|clarity|presentation|sheen|shine)\b/.test(lower) &&
      !/\b(grade|value|limit|overall)\b/.test(lower)
    ) {
      adjusted[pillar] = text.replace(/\baffecting\b/gi, "on");
      reconciled = true;
    }

    if (
      pillar === "corners" &&
      /\bmoderate wear\b/i.test(text) &&
      /\b(some rounding|slight rounding|rounding visible)\b/i.test(lower) &&
      !/\b(heavy|severe|all corners|limits grade|paper loss)\b/.test(lower)
    ) {
      adjusted[pillar] = text.replace(/\bmoderate wear\b/gi, "light wear");
      reconciled = true;
    }
  }

  return { categoryNotes: reconciled ? adjusted : notes, reconciled };
}

function edgeNoteDeniesMajorFraying(raw) {
  const edgesNote = String(raw.categoryNotes?.edges || "").toLowerCase();
  if (!edgesNote) {
    return false;
  }

  return (
    /\b(no|not|without)\s+(severe|major|heavy)\s+(fray(?:ing)?|chipping|chip)\b/.test(
      edgesNote
    ) ||
    /\b(no severe fraying|no severe chipping|not severe)\b/.test(edgesNote)
  );
}

function hasClearMajorEdgeLanguage(raw) {
  if (edgeNoteDeniesMajorFraying(raw)) {
    return false;
  }

  const text = [
    String(raw.categoryNotes?.edges || ""),
    String(raw.primaryLimiterLabel || ""),
    collectAppealText(raw),
  ]
    .join(" ")
    .toLowerCase();

  return (
    /\b(heavy|severe|major)(?:\s+\w+){0,4}\s+(fray(?:ing)?|chipping)\b/.test(text) ||
    /\b(heavy|severe|major)\s+edge\s+(fray(?:ing)?|chipping|wear)\b/.test(text) ||
    /\b(fray(?:ing)?|chipping)\s+(is\s+)?(heavy|severe|major)\b/.test(text) ||
    /\b(missing paper|paper loss|fiber loss|edge damage severe|severe edge damage)\b/.test(
      text
    )
  );
}

const VISION_EDGE_FRAYING_GUARD_STRUCTURAL = new Set([
  "moderate_crease",
  "severe_crease",
  "paper_loss",
  "hole_tear",
  "back_damage_severe",
  "trim_alteration_suspected",
]);

function hasVisionEdgeWearLightOnly(raw) {
  const visionDefects = raw.defects || [];
  return (
    visionDefects.some((defect) => defect.tag === "edge_wear_light") &&
    !visionDefects.some((defect) => defect.tag === "edge_fraying_major")
  );
}

function hasMajorStructuralInVision(raw) {
  return (raw.defects || []).some((defect) => {
    if (!VISION_EDGE_FRAYING_GUARD_STRUCTURAL.has(defect.tag)) {
      return false;
    }
    if (
      defect.tag === "writing_mark_severe" &&
      (defect.location === "back" || defect.location === "both")
    ) {
      return false;
    }
    return true;
  });
}

function hasMajorStructuralDefectPresent(defects) {
  return defects.some((defect) => {
    if (!VISION_EDGE_FRAYING_GUARD_STRUCTURAL.has(defect.tag)) {
      return false;
    }
    if (defect.tag === "writing_mark_severe" && defect.location === "back") {
      return false;
    }
    return true;
  });
}

function preservesExAppealForEdgeGuard(raw, categoryScores) {
  if (categoryScores.centering < 7) {
    return false;
  }

  const appeal = collectAppealText(raw).toLowerCase();
  const centeringNote = String(raw.categoryNotes?.centering || "").toLowerCase();

  if (
    /\b(poor condition|heavy wear|severe wear|heavily worn|significant damage)\b/.test(
      appeal
    )
  ) {
    return false;
  }

  return (
    /\b(vibrant|appealing|decent eye appeal|good centering|minor flaw|presents well|strong color|good visual|contributing positively)\b/.test(
      appeal
    ) ||
    /\b(good centering|well centered|strong centering|appealing)\b/.test(centeringNote)
  );
}

function qualifiesForVisionEdgeWearLightFrayingGuard(
  raw,
  categoryScores,
  defects,
  scanQuality
) {
  if (!hasVisionEdgeWearLightOnly(raw)) {
    return false;
  }
  if (categoryScores.centering < 7) {
    return false;
  }
  if (!preservesExAppealForEdgeGuard(raw, categoryScores)) {
    return false;
  }
  if (hasClearMajorEdgeLanguage(raw)) {
    return false;
  }
  if (hasMajorStructuralInVision(raw)) {
    return false;
  }
  if (hasMajorStructuralDefectPresent(defects)) {
    return false;
  }
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return false;
  }
  return true;
}

function demoteEdgeFrayingMajorToLightWear(defects, categoryScores) {
  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag !== "edge_fraying_major") {
      return defect;
    }
    adjusted = true;
    return { ...defect, tag: "edge_wear_light", severity: "minor" };
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5.5))),
    },
    reconciled: true,
  };
}

function reconcileVisionEdgeWearLightFrayingGuard(
  defects,
  categoryScores,
  raw,
  scanQuality
) {
  if (!defects.some((defect) => defect.tag === "edge_fraying_major")) {
    return { defects, categoryScores, reconciled: false };
  }
  if (
    !qualifiesForVisionEdgeWearLightFrayingGuard(
      raw,
      categoryScores,
      defects,
      scanQuality
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  return demoteEdgeFrayingMajorToLightWear(defects, categoryScores);
}

function hasAffirmativeMajorEdgeWearNote(raw) {
  return hasClearMajorEdgeLanguage(raw);
}

function hasLightEdgeCategoryNote(raw) {
  if (edgeNoteDeniesMajorFraying(raw)) {
    return true;
  }

  const edgesNote = String(raw.categoryNotes?.edges || "").toLowerCase();
  return (
    /\b(light|minor|slight)\b/.test(edgesNote) &&
    /\b(wear|edge|scuff|chipping|fray)\b/.test(edgesNote) &&
    !hasAffirmativeMajorEdgeWearNote(raw)
  );
}

function writingOnlyInAppealNotNotes(raw) {
  const appeal = collectAppealText(raw).toLowerCase();
  const notes = Object.values(raw.categoryNotes || {})
    .join(" ")
    .toLowerCase();

  return (
    /\b(writing|written|ink|pen|pencil|marker|scribble)\b/.test(appeal) &&
    !/\b(writing|written|ink|pen|pencil|marker|scribble|name written)\b/.test(
      notes
    )
  );
}

function categoryNotesContradictSevereWriting(raw) {
  const notes = raw.categoryNotes || {};
  const edgesNote = String(notes.edges || "").toLowerCase();
  const surfaceNote = String(notes.surface || "").toLowerCase();
  const mildEdges =
    edgeNoteDeniesMajorFraying(raw) ||
    (/\b(minor|light|slight)\b/.test(edgesNote) &&
      /\b(not severe|no severe)\b/.test(edgesNote));
  const lightSurface =
    /\b(light|minor|slight)\b/.test(surfaceNote) &&
    !/\b(severe|heavy|major)\b/.test(surfaceNote);

  return mildEdges && lightSurface && writingOnlyInAppealNotNotes(raw);
}

function reconcilePoorBandCategoryNotes(categoryScores, raw, era) {
  if (era !== "vintage") {
    return { categoryScores, reconciled: false };
  }

  const notes = raw.categoryNotes || {};
  let adjusted = { ...categoryScores };
  let reconciled = false;
  let poorPillarNotes = 0;

  for (const pillar of ["corners", "edges", "surface"]) {
    const text = String(notes[pillar] || "").toLowerCase();
    if (!text) continue;

    if (!noteIndicatesPoorBandWear(text)) continue;

    poorPillarNotes += 1;
    if (adjusted[pillar] > 5) {
      adjusted[pillar] = roundToHalf(clampGrade(Math.min(adjusted[pillar], 5)));
      reconciled = true;
    }
    if (
      /\b(heavy|severe|limits grade|paper loss|major chipping|heavy round)\b/.test(
        text
      ) &&
      adjusted[pillar] > 4
    ) {
      adjusted[pillar] = roundToHalf(clampGrade(Math.min(adjusted[pillar], 4)));
      reconciled = true;
    }
  }

  const floor = Math.min(adjusted.corners, adjusted.edges, adjusted.surface);
  if (poorPillarNotes >= 2 && floor >= 6) {
    adjusted = {
      ...adjusted,
      corners: roundToHalf(clampGrade(Math.min(adjusted.corners, 5.5))),
      edges: roundToHalf(clampGrade(Math.min(adjusted.edges, 5.5))),
      surface: roundToHalf(clampGrade(Math.min(adjusted.surface, 5))),
    };
    reconciled = true;
  }

  return { categoryScores: adjusted, reconciled };
}

const LIGHT_WEAR_ONLY_TAGS = new Set([
  "corner_wear_light",
  "edge_wear_light",
  "surface_scratch_light",
  "staining_light",
  "print_line",
  "gloss_loss",
  "registration_issue",
]);

function reconcileTriadLightWearProfile(categoryScores, defects, triadProfile) {
  if (!triadProfile) {
    return { categoryScores, defects, reconciled: false };
  }

  const softenedDefects = defects.map((defect) => {
    if (defect.tag === "corner_wear_moderate") {
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (defect.tag === "surface_scratch_moderate") {
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    return defect;
  });

  return {
    categoryScores: {
      ...categoryScores,
      corners: 5.5,
      edges: 5.5,
      surface: 5.5,
    },
    defects: softenedDefects,
    reconciled: true,
  };
}

function reconcileVintageVgLightWearUndertag(defects, categoryScores, raw) {
  if (hasTriadLightWearProfile(raw, defects)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (hasBackWritingDefect(defects)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (hasSoftEdgeWearAppeal(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    isStrongCenteringWearOverTagPattern(categoryScores, raw) ||
    isNmVintagePresentationCandidate(categoryScores, raw)
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  if (!admitsDistributedWearAppeal(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, edges, surface } = categoryScores;
  const floor = Math.min(corners, edges, surface);
  if (floor < 6 || floor > 7.5) {
    return { defects, categoryScores, reconciled: false };
  }

  const wearDefects = defects.filter((defect) =>
    LIGHT_WEAR_ONLY_TAGS.has(defect.tag) ||
    [
      "corner_wear_moderate",
      "edge_fraying_major",
      "surface_scratch_moderate",
    ].includes(defect.tag)
  );
  if (!wearDefects.length) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    defects.some((defect) =>
      [
        "severe_crease",
        "moderate_crease",
        "surface_wear",
        "paper_loss",
        "writing_mark_severe",
      ].includes(defect.tag)
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const inputAllLightWear = defects.every((defect) =>
    LIGHT_WEAR_ONLY_TAGS.has(defect.tag)
  );

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "corner_wear_light") {
      adjusted = true;
      return { ...defect, tag: "corner_wear_moderate", severity: "moderate" };
    }
    if (defect.tag === "edge_wear_light" && edges <= 7) {
      adjusted = true;
      const escalateToFraying =
        !inputAllLightWear &&
        edges <= 5.5 &&
        !(hasExAppealSignals(raw) && edges > 5.5) &&
        !hasSoftEdgeWearAppeal(raw) &&
        !qualifiesForVisionEdgeWearLightFrayingGuard(
          raw,
          categoryScores,
          defects,
          raw.scanQuality || { level: "good" }
        );
      return {
        ...defect,
        tag: escalateToFraying ? "edge_fraying_major" : "edge_wear_light",
        severity: escalateToFraying ? "severe" : "minor",
      };
    }
    if (defect.tag === "surface_scratch_light" && surface <= 7.5) {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_moderate", severity: "moderate" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return { defects: reconciled, categoryScores, reconciled: true };
}

const NM_RECONCILE_BLOCKERS = new Set([
  "severe_crease",
  "moderate_crease",
  "surface_wear",
  "paper_loss",
  "hole_tear",
  "writing_mark_severe",
  "writing_mark",
  "back_damage_severe",
  "rounded_corners_all",
]);

function canReconcileNmOverTags(defects, categoryScores) {
  const { corners, centering, edges, surface } = categoryScores;
  if (corners < 6 || centering < 7) return false;
  if (edges <= 4 && centering < 7) return false;
  if (defects.some((defect) => NM_RECONCILE_BLOCKERS.has(defect.tag))) {
    return false;
  }

  const hasCornerModerate = defects.some(
    (defect) => defect.tag === "corner_wear_moderate"
  );
  const hasEdgeFraying = defects.some(
    (defect) => defect.tag === "edge_fraying_major"
  );
  const hasOverTagCompanion = defects.some((defect) =>
    [
      "heavy_staining",
      "surface_scratch_moderate",
      "surface_scratch_light",
    ].includes(defect.tag)
  );

  if (hasCornerModerate && hasEdgeFraying && !hasOverTagCompanion) {
    return false;
  }

  return true;
}

function reconcileFairCardOverTags(defects, categoryScores, raw) {
  if (raw && admitsDistributedWearAppeal(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (countNotesPillarsWithPoorWear(raw) >= 2) {
    return { defects, categoryScores, reconciled: false };
  }

  if (defects.some((defect) => NM_RECONCILE_BLOCKERS.has(defect.tag))) {
    return { defects, categoryScores, reconciled: false };
  }

  const fullFair = isFairCardPattern(categoryScores, raw);
  const nmCandidate = canReconcileNmOverTags(defects, categoryScores);

  if (!fullFair && !nmCandidate) {
    return { defects, categoryScores, reconciled: false };
  }

  let edgeDowngraded = false;
  let stainDowngraded = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      edgeDowngraded = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "heavy_staining" && nmCandidate) {
      stainDowngraded = true;
      return { ...defect, tag: "staining_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && categoryScores.corners >= 6) {
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (
      defect.tag === "surface_scratch_moderate" &&
      (categoryScores.surface >= 6 || stainDowngraded)
    ) {
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    return defect;
  });

  const shouldApplyNmBump =
    (nmCandidate && stainDowngraded && edgeDowngraded) ||
    (nmCandidate &&
      categoryScores.corners >= 7 &&
      categoryScores.surface >= 7 &&
      edgeDowngraded) ||
    (nmCandidate &&
      edgeDowngraded &&
      !stainDowngraded &&
      categoryScores.centering >= 7 &&
      categoryScores.surface >= 6) ||
    (fullFair && edgeDowngraded);

  if (!shouldApplyNmBump) {
    return { defects, categoryScores, reconciled: false };
  }

  const vintageNmEdgeRecovery =
    nmCandidate &&
    edgeDowngraded &&
    !stainDowngraded &&
    categoryScores.centering >= 7 &&
    categoryScores.surface >= 6 &&
    (categoryScores.corners < 7 || categoryScores.surface < 7);

  const nmTargets = vintageNmEdgeRecovery
    ? { corners: 7, edges: 7, surface: 7 }
    : categoryScores.centering >= 8
      ? { corners: 7.5, edges: 7, surface: 7.5 }
      : { corners: 7, edges: 7, surface: 7 };

  const adjustedScores = {
    ...categoryScores,
    edges: roundToHalf(
      clampGrade(Math.max(categoryScores.edges, nmTargets.edges))
    ),
    corners: roundToHalf(
      clampGrade(Math.max(categoryScores.corners, nmTargets.corners))
    ),
    surface: roundToHalf(
      clampGrade(Math.max(categoryScores.surface, nmTargets.surface))
    ),
  };

  return {
    defects: reconciled,
    categoryScores: adjustedScores,
    reconciled: true,
  };
}

function normalizeCategoryScores(categoryScores) {
  return {
    corners: roundToHalf(clampGrade(categoryScores.corners)),
    edges: roundToHalf(clampGrade(categoryScores.edges)),
    surface: roundToHalf(clampGrade(categoryScores.surface)),
    centering: roundToHalf(clampGrade(categoryScores.centering)),
  };
}

function escalateVintageLightWear(defect, categoryScores, raw) {
  const normalized = escalateLightWearObservation(defect, categoryScores);
  if (
    normalized.tag === "edge_fraying_major" &&
    (hasSoftEdgeWearAppeal(raw) ||
      hasLightEdgeCategoryNote(raw) ||
      edgeNoteDeniesMajorFraying(raw)) &&
    categoryScores.edges > 5.5
  ) {
    return normalizeDefectObservation({
      ...defect,
      tag: "edge_wear_light",
      severity: "minor",
    });
  }

  if (
    normalized.tag === "edge_fraying_major" &&
    defect.tag === "edge_wear_light" &&
    qualifiesForVisionEdgeWearLightFrayingGuard(
      raw,
      categoryScores,
      [defect],
      raw.scanQuality || { level: "good" }
    )
  ) {
    return normalizeDefectObservation({
      ...defect,
      tag: "edge_wear_light",
      severity: "minor",
    });
  }

  if (
    normalized.tag === "edge_fraying_major" &&
    defect.tag === "edge_wear_light" &&
    (hasLightEdgeCategoryNote(raw) || edgeNoteDeniesMajorFraying(raw))
  ) {
    return normalizeDefectObservation({
      ...defect,
      tag: "edge_wear_light",
      severity: "minor",
    });
  }

  return normalized;
}

function dedupeDefects(defects, categoryScores, era, options = {}) {
  const seen = new Set();
  const deduped = [];

  for (const defect of defects) {
    const normalized =
      era === "vintage" && !options.skipEscalation
        ? options.raw
          ? escalateVintageLightWear(defect, categoryScores, options.raw)
          : escalateLightWearObservation(defect, categoryScores)
        : normalizeDefectObservation(defect);
    const key = `${normalized.tag}:${normalized.location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

function ensurePrimaryLimiterDefect(defects, primaryLimiterTag, raw = null) {
  if (!primaryLimiterTag) return defects;
  if (primaryLimiterTag === "surface_scratch_light") {
    const scratchDefect = defects.find((defect) => defect.tag === "surface_scratch_light");
    if (!scratchDefect || (raw && !hasConfirmedSurfaceScratchEvidence(raw, scratchDefect))) {
      return defects;
    }
  }
  if (defects.some((defect) => defect.tag === primaryLimiterTag)) {
    return defects;
  }

  const definition = getDefectDefinition(primaryLimiterTag);
  if (!definition) return defects;

  const severity =
    definition.severityClass === "severe" || definition.severityClass === "disqualifying"
      ? "severe"
      : definition.severityClass === "moderate"
        ? "moderate"
        : "minor";

  return [
    ...defects,
    {
      tag: primaryLimiterTag,
      severity,
      location: "both",
      confidence: "medium",
    },
  ];
}

function resolvePrimaryLimiter(defects, era, primaryLimiterTag, primaryLimiterLabel) {
  if (!defects.length) {
    return {
      primaryLimiterTag: null,
      primaryLimiterLabel: "None visible",
    };
  }

  let worstDefect = defects[0];
  let worstCap = getEffectiveDefectCap(worstDefect, era);

  for (const defect of defects.slice(1)) {
    const cap = getEffectiveDefectCap(defect, era);
    if (cap < worstCap) {
      worstDefect = defect;
      worstCap = cap;
    }
  }

  return {
    primaryLimiterTag: worstDefect.tag,
    primaryLimiterLabel:
      primaryLimiterLabel && worstDefect.tag === primaryLimiterTag
        ? primaryLimiterLabel
        : getDefectLabel(worstDefect.tag),
  };
}

const SURFACE_WEAR_TAGS = new Set([
  "surface_scratch_light",
  "surface_scratch_moderate",
  "surface_wear",
  "heavy_staining",
  "moderate_crease",
  "severe_crease",
  "paper_loss",
  "hole_tear",
  "wax_stain",
  "back_wear",
  "back_damage_severe",
]);

const SURFACE_SCRATCH_EXPLICIT_EVIDENCE = [
  /\b(linear|hairline) scratch/i,
  /\bscratch(es)? visible (at|from) (multiple )?angles/i,
  /\bscratch(es)? crossing (the )?(artwork|background|image|portrait|surface)/i,
  /\b(visible|clear|minor|light|small|faint|surface) scratch(es)?\b/i,
  /\bscratch(ed|es|ing)\b/i,
  /\bscuff(s|ed|ing)?\b/i,
  /\babrasion/i,
  /\bscrape(d|s|ing)?\b/i,
];

const CHROMIUM_STRONG_SCRATCH_EVIDENCE = [
  /\b(linear|hairline) scratch/i,
  /\bscratch(es)? crossing (the )?(artwork|background|image|portrait|surface)/i,
  /\bscratch(es)? (visible|seen) (at|from|under) (multiple )?angles?/i,
  /\bscratch(es)? visible under (angled|angle|tilted) light/i,
  /\bscratch extending across (the )?(surface|card|front|image|artwork)/i,
  /\bscratch visible (on|across|in|through) (the )?(front|back|surface|artwork|background|portrait|image)/i,
  /\b(visible|clear) scratch (on|across|in|crossing|through)/i,
  /\bscratch(es)? located (on|at|near|along|in|across)/i,
  /\bscratch(es)? on (the )?(front|back) surface/i,
  /\bscratch(es)?[\w\s]{0,48}under (angled|angle|tilted) light/i,
];

const CHROMIUM_GENERIC_SCRATCH_LANGUAGE = [
  /\blight scratch present/i,
  /\bminor surface scratch/i,
  /\bsurface scratch noted/i,
  /\bscratch affecting surface quality/i,
  /\blight scratch affecting/i,
  /\bminor scratch present/i,
  /\bsurface scratch light on (the )?front/i,
  /\b(light|minor|small|faint) scratch present/i,
  /\b(light|minor|small|faint) surface scratch/i,
  /\bscratch present[,.\s]/i,
  /\bscratch noted\b/i,
  /\baffecting surface quality\b/i,
  /\bminor surface mark/i,
];

const CHROME_ARTIFACT_FALSE_SCRATCH = [
  /\breflective pattern/i,
  /\bsparkle/i,
  /\bchrome effect/i,
  /\brefractor texture/i,
  /\bglare\b/i,
  /\blighting streak/i,
  /\bholographic background/i,
  /\bchrome artifact/i,
  /\brefractor artifact/i,
  /\bholographic (finish|effect|pattern|background|sheen)/i,
  /\bprizm (silver|finish|pattern|refractor)/i,
  /\bmosaic (finish|pattern|refractor)/i,
  /\boptic holo/i,
  /\bbowman chrome/i,
  /\btopps chrome/i,
  /\bselect chrome/i,
];

const SURFACE_CLEAN_SCRATCH_CONTRADICTION = [
  /\botherwise clean\b/i,
  /\bno significant surface (issues|flaws|problems|damage)\b/i,
  /\bsurface appears clean\b/i,
  /\bsurface is (clean|pristine|flawless)\b/i,
  /\boverall clean surface\b/i,
  /\bno surface issues\b/i,
  /\b(no visible scratches?|no scratches?( or marks)?|without scratches?)\b/i,
  /\bpristine (surface|presentation)\b/i,
];

const SURFACE_SCRATCH_DENIAL = [
  /\bno scratches?\b/i,
  /\bscratch.?free\b/i,
  /\bfree of (marks|scratches)\b/i,
  /\bwithout scratches?\b/i,
  /\bno (significant )?marks\b/i,
  /\bflawless\b/i,
  /\b(no scratches or marks|no marks or scratches)\b/i,
];

const CHROMIUM_FINISH_SIGNALS =
  /\b(bowman chrome|topps chrome|panini prizm|prizm silver|mosaic|select chrome|optic holo|refractor|chrome refractor|holo finish|chrome finish)\b/i;

const CHROMIUM_EXPLICIT_SCRATCH_LOCATION =
  /\bscratch(es)?\s+(on|at|near|along|in|across|through)\s+(the\s+)?(front|back|surface|artwork|background|portrait|image|left|right|upper|lower|center|border)/i;

function surfaceNoteText(raw) {
  return String(raw?.categoryNotes?.surface || "");
}

function isChromiumFinishCard(raw) {
  if (raw?.cardMeta?.isReflective === true) {
    return true;
  }
  const text = [
    raw?.cardMeta?.productLine,
    raw?.bestAttribute,
    raw?.eyeAppealSummary,
    raw?.categoryNotes?.surface,
  ]
    .filter(Boolean)
    .join(" ");
  return CHROMIUM_FINISH_SIGNALS.test(text);
}

function stripNegatedScratchLanguage(note) {
  if (!note) {
    return "";
  }
  return note
    .replace(
      /\b(no|without|free of|lack of)\s+[\w\s]{0,30}?scratch(es|ing)?[\w\s]{0,30}?\b/gi,
      ""
    )
    .replace(/\bno visible scratch[\w\s]{0,40}\b/gi, "")
    .replace(/\bscratch.?free\b/gi, "");
}

function hasChromiumStrongScratchEvidence(raw, defect = null) {
  const note = stripNegatedScratchLanguage(surfaceNoteText(raw));
  if (!note) {
    return false;
  }
  if (CHROMIUM_STRONG_SCRATCH_EVIDENCE.some((pattern) => pattern.test(note))) {
    return true;
  }
  return (
    defect?.confidence === "high" && CHROMIUM_EXPLICIT_SCRATCH_LOCATION.test(note)
  );
}

function isChromiumGenericScratchOnly(raw) {
  const note = stripNegatedScratchLanguage(surfaceNoteText(raw));
  const presentation = stripNegatedScratchLanguage(collectSurfaceScratchText(raw));
  const text = [note, presentation].filter(Boolean).join(" ");
  if (!text || !/\bscratch/i.test(text)) {
    return false;
  }
  const hasStrong = hasChromiumStrongScratchEvidence(raw);
  if (hasStrong) {
    return false;
  }
  return CHROMIUM_GENERIC_SCRATCH_LANGUAGE.some((pattern) => pattern.test(text));
}

function hasExplicitSurfaceScratchInNotes(raw, defect = null) {
  const surfaceNote = stripNegatedScratchLanguage(surfaceNoteText(raw));
  if (!surfaceNote) {
    return false;
  }
  if (isChromiumFinishCard(raw)) {
    if (isChromiumGenericScratchOnly(raw)) {
      return false;
    }
    return hasChromiumStrongScratchEvidence(raw, defect);
  }
  return SURFACE_SCRATCH_EXPLICIT_EVIDENCE.some((pattern) => pattern.test(surfaceNote));
}

function collectSurfaceScratchText(raw) {
  const notes = raw?.categoryNotes || {};
  return [notes.surface, raw?.eyeAppealSummary, raw?.bestAttribute]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasConfirmedSurfaceScratchEvidence(raw, defect) {
  const surfaceNote = surfaceNoteText(raw);
  const presentationText = collectSurfaceScratchText(raw);
  if (!surfaceNote && !presentationText) {
    return false;
  }

  if (SURFACE_SCRATCH_DENIAL.some((pattern) => pattern.test(presentationText))) {
    return false;
  }

  if (
    CHROME_ARTIFACT_FALSE_SCRATCH.some((pattern) => pattern.test(presentationText)) &&
    !hasExplicitSurfaceScratchInNotes(raw)
  ) {
    return false;
  }

  if (
    SURFACE_CLEAN_SCRATCH_CONTRADICTION.some((pattern) => pattern.test(presentationText)) &&
    !hasExplicitSurfaceScratchInNotes(raw)
  ) {
    return false;
  }

  if (!hasExplicitSurfaceScratchInNotes(raw, defect)) {
    return false;
  }

  if (
    /\b(print line|roller mark|factory line|refractor artifact|chrome artifact)\b/i.test(
      surfaceNote
    ) &&
    !/\bscratch/i.test(surfaceNote)
  ) {
    return false;
  }

  if (isChromiumFinishCard(raw) && isChromiumGenericScratchOnly(raw)) {
    return false;
  }

  return true;
}

function filterUnconfirmedSurfaceScratchDefects(defects, raw, era) {
  if (era !== "modern") {
    return defects;
  }
  return defects.filter((defect) => {
    if (defect.tag !== "surface_scratch_light") {
      return true;
    }
    return hasConfirmedSurfaceScratchEvidence(raw, defect);
  });
}

const MODERN_WEAR_POSITIVE_EVIDENCE = [
  /\bwhitening\b/i,
  /\b(rounding|rounded corners?)\b/i,
  /\bfraying\b/i,
  /\bchipping\b/i,
  /\btouch wear\b/i,
  /\bcorner touch\b/i,
  /\btouched corners?\b/i,
  /\bwear on (one or more|multiple|a couple|several) corners?\b/i,
  /\bedge roughness\b/i,
  /\brough edges?\b/i,
  /\bhandling wear\b/i,
  /\b(visible|clear|noticeable|obvious|material) (wear|rounding|whitening|chipping|fraying)\b/i,
  /\bminor touch wear\b/i,
  /\bslight touch wear\b/i,
];

const MODERN_WEAR_ARTIFACT_SIGNALS = [
  /\b(slab|holder|case) (artifact|glare|reflection)\b/i,
  /\b(photo|scan|scanner) artifact\b/i,
  /\bglare (artifact|misread)\b/i,
  /\bfalse positive\b/i,
  /\bcould be (holder|scan|glare|artifact)/i,
  /\bambiguous\b/i,
  /\bmay not be immediately visible\b/i,
  /\bdifficult to (see|confirm|verify)\b/i,
];

function collectModernWearText(raw, defectTag) {
  const notes = raw?.categoryNotes || {};
  const pillarNote =
    defectTag === "corner_wear_light"
      ? notes.corners
      : defectTag === "edge_wear_light"
        ? notes.edges
        : null;
  return [pillarNote, raw?.primaryLimiterLabel, raw?.eyeAppealSummary]
    .filter(Boolean)
    .join(" ");
}

function hasConfirmedModernWearEvidence(raw, defectTag) {
  const text = collectModernWearText(raw, defectTag);
  if (!text) {
    return false;
  }
  if (MODERN_WEAR_ARTIFACT_SIGNALS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return MODERN_WEAR_POSITIVE_EVIDENCE.some((pattern) => pattern.test(text));
}

function filterUnconfirmedModernWearDefects(defects, raw, era) {
  if (era !== "modern") {
    return defects;
  }
  return defects.filter((defect) => {
    if (defect.tag !== "corner_wear_light" && defect.tag !== "edge_wear_light") {
      return true;
    }
    return hasConfirmedModernWearEvidence(raw, defect.tag);
  });
}

const MODERN_HANDLING_WEAR_PILLAR_LANGUAGE = [
  /\bhandling wear\b/i,
  /\bhandling\b/i,
  /\bslight wear\b/i,
  /\bminor wear\b/i,
  /\bminimal wear\b/i,
  /\blight wear\b/i,
  /\btouch wear\b/i,
  /\bsoftening\b/i,
  /\bwhitening\b/i,
  /\bfraying\b/i,
  /\broughness\b/i,
  /\bchipping\b/i,
  /\bcorner touch\b/i,
  /\btouched corners?\b/i,
  /\bconsistent with handling\b/i,
  /\bwear detected\b/i,
  /\bminor touch\b/i,
  /\bslight touch\b/i,
  /\bedge wear\b/i,
  /\brough edges?\b/i,
  /\brounding\b/i,
  /\brounded corners?\b/i,
  /\bwear on (one or more|multiple|a couple|several) corners?\b/i,
  /\bminor signs of handling\b/i,
  /\bsigns of handling\b/i,
];

const MODERN_PILLAR_CLEAN_WEAR_DENIAL = [
  /\bno visible wear\b/i,
  /\bno noticeable wear\b/i,
  /\bno evidence of wear\b/i,
  /\bno wear detected\b/i,
  /\bno significant wear\b/i,
  /\bsharp with no wear\b/i,
  /\b(no|without) (visible |noticeable |significant )?wear\b/i,
  /\b(no|without) (touch wear|handling wear)\b/i,
  /\bclean with no (visible )?wear\b/i,
];

function stripModernPillarWearDenials(note) {
  return note
    .replace(/\b(no|without|free of|lack of) handling wear\b/gi, "")
    .replace(/\b(no|without) (visible|noticeable|significant) wear\b/gi, "")
    .replace(/\b(no|without) (touch wear|corner touch|minimal wear|slight wear)\b/gi, "");
}

function hasModernHandlingWearPillarLanguage(note) {
  if (!note) {
    return false;
  }
  const stripped = stripModernPillarWearDenials(note);
  if (
    MODERN_PILLAR_CLEAN_WEAR_DENIAL.some((pattern) => pattern.test(note)) &&
    !MODERN_HANDLING_WEAR_PILLAR_LANGUAGE.some((pattern) => pattern.test(stripped))
  ) {
    return false;
  }
  return MODERN_HANDLING_WEAR_PILLAR_LANGUAGE.some((pattern) => pattern.test(stripped));
}

function hasModernConfirmedVisibleWearInNote(note) {
  if (!note) {
    return false;
  }
  return MODERN_WEAR_POSITIVE_EVIDENCE.some((pattern) => pattern.test(note));
}

const MODERN_PILLAR_WEAR_CAP_SKIP = [
  /\bnot significant enough\b/i,
  /\bdoes not detract\b/i,
  /\bdoesn't detract\b/i,
  /\bdoes not significantly detract\b/i,
  /\bdoesn't significantly detract\b/i,
  /\b(still|remaining|mostly) (sharp|rounded|clean)\b/i,
  /\b(sharp|clean|well-defined) with no (visible |significant )?wear\b/i,
  /\bno visible wear\b/i,
  /\bno significant wear\b/i,
  /\bno noticeable wear\b/i,
  /\b(clean|sharp|well-defined).{0,40}\b(only |just )?(minimal|minor|light) wear\b/i,
];

const MODERN_CORNER_ISOLATED_WEAR_SKIP = [
  /\b(excellent|strong|very good).{0,50}(minor|minimal|light) wear.{0,40}(one corner|single corner|a corner)\b/i,
  /\b(minimal|minor|light) wear.{0,30}(remaining|still|mostly) (sharp|rounded|clean)\b/i,
  /\b(minimal|minor|light) wear noted on one corner\b/i,
  /\b(one|single|a) corner.{0,30}(minor|minimal|light) (wear|touch)\b/i,
];

function shouldSkipModernPillarWearCap(note, pillar = null) {
  if (!note) {
    return true;
  }
  if (
    pillar === "corners" &&
    MODERN_CORNER_ISOLATED_WEAR_SKIP.some((pattern) => pattern.test(note))
  ) {
    return true;
  }
  const stripped = stripModernPillarWearDenials(note);
  const hasWearLanguage = MODERN_HANDLING_WEAR_PILLAR_LANGUAGE.some((pattern) =>
    pattern.test(stripped)
  );
  if (!hasWearLanguage) {
    return true;
  }
  if (
    /\b(no visible wear|no significant wear|no noticeable wear)\b/i.test(note) &&
    !/\b(minimal|slight|minor|light|touch) wear\b/i.test(note)
  ) {
    return true;
  }
  if (MODERN_PILLAR_WEAR_CAP_SKIP.some((pattern) => pattern.test(note)) &&
    !/\b(whitening|chipping|fraying|softening)\b/i.test(note)
  ) {
    return true;
  }
  return false;
}

function capModernPillarForHandlingWear(score, note, defects, pillar) {
  if (shouldSkipModernPillarWearCap(note, pillar)) {
    return score;
  }
  const stripped = stripModernPillarWearDenials(note);
  const hasHandlingLanguage = MODERN_HANDLING_WEAR_PILLAR_LANGUAGE.some((pattern) =>
    pattern.test(stripped)
  );
  if (!hasHandlingLanguage) {
    return score;
  }

  const materialWear = /\b(whitening|chipping|fraying|softening|rough edges?|edge roughness)\b/i.test(
    note
  );
  if (pillar === "edges" && !materialWear) {
    const hasEdgeWearTag = defects.some((defect) => defect.tag === "edge_wear_light");
    if (!hasEdgeWearTag) {
      return score;
    }
  }

  if (materialWear) {
    return Math.min(score, 8.0);
  }

  if (hasModernConfirmedVisibleWearInNote(note)) {
    return Math.min(score, 8.5);
  }

  const hasAnyWearTag = defects.some((defect) =>
    ["corner_wear_light", "edge_wear_light"].includes(defect.tag)
  );
  if (!hasAnyWearTag) {
    return Math.min(score, 8.5);
  }

  return score;
}

function reconcileModernHandlingWearPillarScores(categoryScores, raw, era, defects) {
  if (era !== "modern") {
    return { categoryScores, reconciled: false };
  }

  const notes = raw?.categoryNotes || {};
  const nextCorners = capModernPillarForHandlingWear(
    categoryScores.corners,
    notes.corners,
    defects,
    "corners"
  );
  const nextEdges = capModernPillarForHandlingWear(
    categoryScores.edges,
    notes.edges,
    defects,
    "edges"
  );

  if (nextCorners === categoryScores.corners && nextEdges === categoryScores.edges) {
    return { categoryScores, reconciled: false };
  }

  return {
    categoryScores: normalizeCategoryScores({
      ...categoryScores,
      corners: nextCorners,
      edges: nextEdges,
    }),
    reconciled: true,
  };
}

const MODERN_CLEAN_CORNER_NOTE_LANGUAGE = [
  /\bclean\b/i,
  /\bcrisp\b/i,
  /\bsharp\b/i,
  /\bno visible wear\b/i,
  /\bno fraying\b/i,
  /\bno chipping\b/i,
  /\bno whitening\b/i,
  /\bno edge damage\b/i,
  /\bno corner damage\b/i,
];

const MODERN_CLEAN_EDGE_NOTE_LANGUAGE = [
  ...MODERN_CLEAN_CORNER_NOTE_LANGUAGE,
  /\bwell-defined\b/i,
  /\bsmooth\b/i,
  /\bintact\b/i,
  /\buniform\b/i,
  /\beven\b/i,
  /\bsharp-looking\b/i,
  /\bno obvious flaws\b/i,
  /\bno notable damage\b/i,
  /\bno visible issues\b/i,
  /\bconsistent (edge|edges|finish|appearance|throughout)\b/i,
  /\bedges? (are |appear )?(well-defined|smooth|intact|uniform|even|consistent)\b/i,
];

const MODERN_EDGE_RECONCILE_BLOCKERS = [
  /\bwhitening\b/i,
  /\bchipping\b/i,
  /\bfraying\b/i,
  /\broughness\b/i,
  /\blayering\b/i,
  /\bpeeling\b/i,
  /\bnick\b/i,
  /\bding\b/i,
  /\bvisible wear\b/i,
  /\bedge damage\b/i,
  /\btouched\b/i,
  /\bsoftened\b/i,
  /\blifted foil\b/i,
  /\bseparation\b/i,
  /\bdamage\b/i,
];

function stripNegatedPillarDamageLanguage(note) {
  if (!note) {
    return "";
  }
  return note
    .replace(
      /\b(no|without|free of|lack of)\s+[\w\s]{0,24}?(whitening|chipping|fraying|roughness|layering|peeling|nicks?|dings?|damage|wear|issues|flaws)\b/gi,
      ""
    )
    .replace(
      /\b(no|without)\s+(chipping|fraying|whitening|damage|wear)\s+or\s+(chipping|fraying|whitening|damage|wear)\b/gi,
      ""
    )
    .replace(
      /\b(no|without)\s+(visible|noticeable|significant|obvious|notable)\s+(wear|fraying|chipping|whitening|damage|issues|flaws)\b/gi,
      ""
    )
    .replace(/\b(no|without)\s+edge damage\b/gi, "")
    .replace(/\s+\bor\s+(chipping|fraying|whitening|damage|wear)\b/gi, "");
}

function hasModernCleanCornerNote(note) {
  if (!note) {
    return false;
  }
  return MODERN_CLEAN_CORNER_NOTE_LANGUAGE.some((pattern) => pattern.test(note));
}

function hasModernCleanEdgeNote(note) {
  if (!note) {
    return false;
  }
  if (MODERN_CLEAN_EDGE_NOTE_LANGUAGE.some((pattern) => pattern.test(note))) {
    return true;
  }
  return (
    /\bconsistent\b/i.test(note) && !/\bconsistent with handling\b/i.test(note)
  );
}

const MODERN_POSITIVE_HANDLING_WEAR = [
  /\bhandling wear\b/i,
  /\btouch wear\b/i,
  /\bedge wear\b/i,
  /\b(light|slight|minor|minimal|some|visible)\s+wear\b/i,
  /\bwear (present|detected|noted|visible)\b/i,
  /\bconsistent with handling\b/i,
  /\brounding\b/i,
  /\bsoftening\b/i,
  /\brough edges?\b/i,
  /\bedge roughness\b/i,
];

function hasModernEdgeReconcileBlockers(note) {
  if (!note) {
    return false;
  }
  const stripped = stripNegatedPillarDamageLanguage(note);
  if (MODERN_EDGE_RECONCILE_BLOCKERS.some((pattern) => pattern.test(stripped))) {
    return true;
  }
  const wearStripped = stripModernPillarWearDenials(stripped);
  return MODERN_POSITIVE_HANDLING_WEAR.some((pattern) => pattern.test(wearStripped));
}

function hasModernCornerReconcileBlockers(note) {
  if (!note) {
    return false;
  }
  const stripped = stripNegatedPillarDamageLanguage(note);
  if (MODERN_EDGE_RECONCILE_BLOCKERS.some((pattern) => pattern.test(stripped))) {
    return true;
  }
  const wearStripped = stripModernPillarWearDenials(stripped);
  return MODERN_POSITIVE_HANDLING_WEAR.some((pattern) => pattern.test(wearStripped));
}

const MODERN_SURFACE_RECONCILE_BLOCKERS = [
  /\bstain(ing|ed|s)?\b/i,
  /\bcrease\b/i,
  /\bdent\b/i,
  /\bgouge\b/i,
  /\bpaper loss\b/i,
  /\bsurface wear\b/i,
  /\bprint defect\b/i,
  /\bheavy\b/i,
  /\bmoderate\b/i,
  /\bdistracting\b/i,
  /\bdetrat(es|ing|ion)\b/i,
];

function hasModernCleanSurfaceNote(note) {
  if (!note) {
    return false;
  }
  const stripped = stripNegatedScratchLanguage(note);
  if (SURFACE_CLEAN_SCRATCH_CONTRADICTION.some((pattern) => pattern.test(stripped))) {
    return true;
  }
  return (
    /\b(clean|pristine|flawless|excellent|strong) surface\b/i.test(stripped) ||
    /\bsurface (is )?(clean|pristine|flawless)\b/i.test(stripped) ||
    /\bno (visible )?(surface issues|surface flaws|scratches)\b/i.test(stripped)
  );
}

function hasModernSurfaceReconcileBlockers(note, raw = null) {
  if (!note) {
    return false;
  }
  const scratchStripped = stripNegatedScratchLanguage(note);
  if (raw && isChromiumFinishCard(raw)) {
    if (
      hasChromiumStrongScratchEvidence(
        { ...raw, categoryNotes: { ...raw.categoryNotes, surface: note } },
        null
      )
    ) {
      return true;
    }
  } else if (
    SURFACE_SCRATCH_EXPLICIT_EVIDENCE.some((pattern) => pattern.test(scratchStripped))
  ) {
    return true;
  }
  return MODERN_SURFACE_RECONCILE_BLOCKERS.some((pattern) => pattern.test(scratchStripped));
}

const SURFACE_STRUCTURAL_DEFECT_TAGS = new Set([
  "surface_scratch_light",
  "surface_scratch_moderate",
  "surface_wear",
  "staining_light",
  "heavy_staining",
  "moderate_crease",
  "severe_crease",
  "dent",
  "indentation",
  "paper_loss",
  "hole_tear",
  "gloss_loss",
]);

function isReconcilableLowPillarScore(score) {
  return score === 8 || score === 8.5;
}

function hasSurfaceStructuralDefect(defects) {
  return (defects || []).some((defect) => SURFACE_STRUCTURAL_DEFECT_TAGS.has(defect.tag));
}

function reconcileModernCleanNotePillarScores(categoryScores, raw, era, defects = []) {
  if (era !== "modern") {
    return { categoryScores, reconciled: false, audit: [] };
  }

  const notes = raw?.categoryNotes || {};
  const audit = [];
  let nextCorners = categoryScores.corners;
  let nextEdges = categoryScores.edges;
  let nextSurface = categoryScores.surface;

  if (
    isReconcilableLowPillarScore(nextEdges) &&
    hasModernCleanEdgeNote(notes.edges) &&
    !hasModernEdgeReconcileBlockers(notes.edges)
  ) {
    audit.push({
      source: "modern_clean_note_pillar_reconcile",
      pillar: "edges",
      originalScore: nextEdges,
      newScore: 9.0,
    });
    nextEdges = 9.0;
  }

  if (
    isReconcilableLowPillarScore(nextCorners) &&
    hasModernCleanCornerNote(notes.corners) &&
    !hasModernCornerReconcileBlockers(notes.corners)
  ) {
    audit.push({
      source: "modern_clean_note_pillar_reconcile",
      pillar: "corners",
      originalScore: nextCorners,
      newScore: 9.0,
    });
    nextCorners = 9.0;
  }

  if (
    isReconcilableLowPillarScore(nextSurface) &&
    hasModernCleanSurfaceNote(notes.surface) &&
    !hasModernSurfaceReconcileBlockers(notes.surface, raw) &&
    !hasSurfaceStructuralDefect(defects)
  ) {
    audit.push({
      source: "modern_clean_note_pillar_reconcile",
      pillar: "surface",
      originalScore: nextSurface,
      newScore: 9.0,
    });
    nextSurface = 9.0;
  }

  if (!audit.length) {
    return { categoryScores, reconciled: false, audit: [] };
  }

  return {
    categoryScores: normalizeCategoryScores({
      ...categoryScores,
      corners: nextCorners,
      edges: nextEdges,
      surface: nextSurface,
    }),
    reconciled: true,
    audit,
  };
}

function finalizeSurfaceScratchAndLimiter(defects, categoryScores, era, raw, finalLimiter) {
  let nextDefects = filterUnconfirmedSurfaceScratchDefects(defects, raw, era);
  nextDefects = filterUnconfirmedModernWearDefects(nextDefects, raw, era);
  let nextLimiter = resolvePrimaryLimiter(
    nextDefects,
    era,
    finalLimiter.primaryLimiterTag,
    finalLimiter.primaryLimiterLabel
  );

  if (nextLimiter.primaryLimiterTag) {
    nextDefects = dedupeDefects(
      ensurePrimaryLimiterDefect(nextDefects, nextLimiter.primaryLimiterTag, raw),
      categoryScores,
      era,
      { skipEscalation: true, raw }
    );
    nextLimiter = resolvePrimaryLimiter(
      nextDefects,
      era,
      nextLimiter.primaryLimiterTag,
      nextLimiter.primaryLimiterLabel
    );
  }

  return { defects: nextDefects, finalLimiter: nextLimiter };
}

const CORNER_WEAR_TAGS = new Set([
  "corner_wear_light",
  "corner_wear_moderate",
  "rounded_corners_all",
]);

const EDGE_WEAR_TAGS = new Set([
  "edge_wear_light",
  "edge_fraying_major",
]);

function hasWearTag(defects, tagSet) {
  return defects.some((defect) =>
    tagSet.has(resolveEffectiveDefectTag(defect.tag, defect.severity))
  );
}

function inferStructuralDefects(defects, categoryScores, era, raw) {
  if (era !== "vintage") return defects;

  const inferred = [...defects];
  const fairCard = isFairCardPattern(categoryScores, raw);
  const addDefect = (tag, severity, location = "both") => {
    inferred.push({
      tag,
      severity,
      location,
      confidence: "medium",
    });
  };

  if (
    categoryScores.surface <= 4.5 &&
    !hasWearTag(inferred, SURFACE_WEAR_TAGS) &&
    !hasBackOnlyStaining(inferred) &&
    !isNmVintageCleanPresentation(categoryScores, raw) &&
    !hasMislabeledBackMarkNotes(raw)
  ) {
    addDefect("surface_wear", "severe");
  } else if (
    categoryScores.surface <= 4.5 &&
    hasWearTag(inferred, new Set(["surface_scratch_moderate", "surface_scratch_light"])) &&
    !hasBackOnlyStaining(inferred) &&
    !isNmVintageCleanPresentation(categoryScores, raw) &&
    !hasMislabeledBackMarkNotes(raw)
  ) {
    addDefect("surface_wear", "severe");
  }

  if (
    categoryScores.corners <= 6 &&
    !(fairCard && categoryScores.corners >= 6) &&
    !hasWearTag(inferred, CORNER_WEAR_TAGS)
  ) {
    addDefect(
      categoryScores.corners <= 5.5 ? "rounded_corners_all" : "corner_wear_moderate",
      "moderate"
    );
  }

  if (
    categoryScores.edges <= 6.5 &&
    !(fairCard && categoryScores.edges >= 5.5) &&
    !hasWearTag(inferred, EDGE_WEAR_TAGS) &&
    !(hasSoftEdgeWearAppeal(raw) && categoryScores.edges > 5.5) &&
    !isStrongCenteringWearOverTagPattern(categoryScores, raw) &&
    !isNmVintagePresentationCandidate(categoryScores, raw)
  ) {
    addDefect(
      categoryScores.edges <= 5.5 ? "edge_fraying_major" : "edge_wear_light",
      categoryScores.edges <= 5.5 ? "severe" : "moderate"
    );
  }

  if (
    categoryScores.surface <= 5 &&
    hasWearTag(inferred, new Set(["back_wear"])) &&
    hasSevereBackDamageEvidence(raw) &&
    !qualifiesForPsa810VisionCandidate(categoryScores, raw, inferred)
  ) {
    addDefect("back_damage_severe", "severe", "back");
  }

  return inferred;
}

function hasBackOnlyStaining(defects) {
  const hasBackStain = defects.some(
    (defect) =>
      (defect.tag === "heavy_staining" ||
        defect.tag === "staining_light" ||
        defect.tag === "wax_stain") &&
      defect.location === "back"
  );
  const hasFrontStain = defects.some(
    (defect) =>
      (defect.tag === "heavy_staining" ||
        defect.tag === "staining_light" ||
        defect.tag === "wax_stain") &&
      (defect.location === "front" || defect.location === "both")
  );

  return hasBackStain && !hasFrontStain;
}

function reconcileBackFoxingStaining(defects, categoryScores) {
  const hasBackHeavy = defects.some(
    (defect) => defect.tag === "heavy_staining" && defect.location === "back"
  );
  if (!hasBackHeavy || !hasBackOnlyStaining(defects)) {
    return { defects, categoryScores, reconciled: false };
  }

  const reconciled = defects.map((defect) => {
    if (defect.tag === "heavy_staining" && defect.location === "back") {
      return { ...defect, tag: "staining_light", severity: "minor" };
    }
    return defect;
  });

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      surface: roundToHalf(
        clampGrade(Math.max(categoryScores.surface, 6))
      ),
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5))),
    },
    reconciled: true,
  };
}

const EX_FOXING_RECONCILE_BLOCKERS = new Set([
  "severe_crease",
  "moderate_crease",
  "surface_wear",
  "paper_loss",
  "hole_tear",
  "writing_mark_severe",
  "writing_mark",
  "back_damage_severe",
  "rounded_corners_all",
]);

function reconcileVintageExSurfaceWearOverTag(defects, categoryScores, raw) {
  if (!defects.some((defect) => defect.tag === "surface_wear")) {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, edges, surface, centering } = categoryScores;
  const nmBand = corners >= 7 && edges >= 7 && surface >= 7 && centering >= 7;
  const exBand = corners >= 6 && edges >= 6 && centering >= 7;
  if (!nmBand && !exBand) {
    return { defects, categoryScores, reconciled: false };
  }

  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  const appeal = collectAppealText(raw);
  const lightSurfaceLanguage =
    /\b(minor|light|small|slight|few|imperfection|clean)\b/.test(surfaceNote) &&
    !/\b(heavy|severe|major|extensive|moderate wear)\b/.test(surfaceNote + " " + appeal);
  const strongAppeal =
    /\b(vibrant|presents well|minimal wear|strong color|clean surface|well.?preserved|well preserved)\b/.test(
      appeal
    ) || hasNmGemPresentationAppeal(raw);

  if (!lightSurfaceLanguage && !strongAppeal) {
    return { defects, categoryScores, reconciled: false };
  }

  const reconciled = defects.map((defect) => {
    if (defect.tag !== "surface_wear") {
      return defect;
    }
    return { ...defect, tag: "surface_scratch_light", severity: "minor" };
  });

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      surface: roundToHalf(
        clampGrade(Math.max(surface, nmBand ? 7 : 6))
      ),
    },
    reconciled: true,
  };
}

function reconcileVintageNoteEdgeFrayingOverTag(
  defects,
  categoryScores,
  scanQuality,
  raw
) {
  if (!defects.some((defect) => defect.tag === "edge_fraying_major")) {
    return { defects, categoryScores, reconciled: false };
  }
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return { defects, categoryScores, reconciled: false };
  }
  const visionEdgeGuardPath = qualifiesForVisionEdgeWearLightFrayingGuard(
    raw,
    categoryScores,
    defects,
    scanQuality
  );
  if (
    categoryScores.centering < 7 ||
    (!visionEdgeGuardPath &&
      !hasLightEdgeCategoryNote(raw) &&
      !edgeNoteDeniesMajorFraying(raw))
  ) {
    return { defects, categoryScores, reconciled: false };
  }
  if (
    hasDefinitiveHarshEdgeInspectionSignals(raw) &&
    hasAffirmativeMajorEdgeWearNote(raw)
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    qualifiesForVisionEdgeWearLightFrayingGuard(
      raw,
      categoryScores,
      defects,
      scanQuality
    )
  ) {
    return demoteEdgeFrayingMajorToLightWear(defects, categoryScores);
  }

  const reconciled = defects.map((defect) => {
    if (defect.tag !== "edge_fraying_major") {
      return defect;
    }
    return { ...defect, tag: "edge_wear_light", severity: "minor" };
  });

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5.5))),
    },
    reconciled: true,
  };
}

function reconcileVintageNoteWritingOverTag(defects, categoryScores, raw) {
  if (
    !defects.some((defect) =>
      ["writing_mark", "writing_mark_severe"].includes(defect.tag)
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const notesText = Object.values(raw.categoryNotes || {})
    .join(" ")
    .toLowerCase();
  if (
    /\b(ink|pen|pencil|marker|scribble|name written|autograph written)\b/.test(
      notesText
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const appealOnlyWriting = writingOnlyInAppealNotNotes(raw);
  const mildPresentation = categoryNotesContradictSevereWriting(raw);
  if (!appealOnlyWriting && !mildPresentation) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = [];
  for (const defect of defects) {
    if (defect.tag === "writing_mark_severe") {
      adjusted = true;
      reconciled.push({
        ...defect,
        tag: appealOnlyWriting ? "staining_light" : "writing_mark",
        severity: appealOnlyWriting ? "minor" : "moderate",
        location: "back",
      });
      continue;
    }
    if (appealOnlyWriting && defect.tag === "writing_mark") {
      adjusted = true;
      continue;
    }
    reconciled.push(defect);
  }

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      surface: roundToHalf(
        clampGrade(
          Math.max(categoryScores.surface, categoryScores.centering >= 7 ? 6.5 : 6)
        )
      ),
    },
    reconciled: true,
  };
}

function reconcileVintageExFoxingWear(defects, categoryScores) {
  if (defects.some((defect) => EX_FOXING_RECONCILE_BLOCKERS.has(defect.tag))) {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, centering } = categoryScores;
  if (corners < 6 || centering < 6) {
    return { defects, categoryScores, reconciled: false };
  }

  const hasOverTag = defects.some((defect) =>
    ["edge_fraying_major", "surface_scratch_moderate"].includes(defect.tag)
  );
  if (!hasOverTag) {
    return { defects, categoryScores, reconciled: false };
  }

  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "surface_scratch_moderate") {
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && corners >= 6) {
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    return defect;
  });

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5))),
      surface: roundToHalf(clampGrade(Math.max(categoryScores.surface, 6))),
    },
    reconciled: true,
  };
}

const EX_OVER_TAG_BLOCKERS = new Set([
  "severe_crease",
  "surface_wear",
  "paper_loss",
  "hole_tear",
  "writing_mark_severe",
  "writing_mark",
  "back_damage_severe",
  "rounded_corners_all",
  "heavy_staining",
]);

function collectHarshConditionText(raw) {
  return [
    ...(raw.scanQuality?.visibilityIssues || []),
    ...(raw.scanQuality?.inspectionLimits || []),
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();
}

function hasCleanFrontAppealSignals(raw) {
  return hasCleanPresentationAppeal(raw);
}

function hasCleanPresentationAppeal(raw) {
  const appealText = collectAppealText(raw);
  return /\b(clean appearance|clean overall|clean presentation|clean front|clean surface|visually appealing|appealing surface|aside from minor wear|well.?preserved|well preserved|sharp corners|primarily sharp)\b/.test(
    appealText
  );
}

function hasNmGemPresentationAppeal(raw) {
  const appeal = collectAppealText(raw).toLowerCase();
  return /\b(sharp corners|primarily sharp|well.?preserved|well preserved|clean surface|minimal wear|near.?mint|nm condition|strong color and|good imprint|intact corners)\b/.test(
    appeal
  );
}

function hasGemMintPresentationAppeal(raw) {
  const appeal = collectAppealText(raw).toLowerCase();
  return /\b(gem mint|gem.?mint|pristine|virtually flawless|pack fresh|flawless|razor sharp|museum quality|exceptionally sharp|nm-mt|nm\/mt)\b/.test(
    appeal
  );
}

function hasNmPresentationBlockers(raw) {
  const defects = raw.defects || [];
  if (
    raw.primaryLimiterTag === "back_wear" ||
    defects.some((defect) =>
      ["back_wear", "back_damage_severe"].includes(defect.tag)
    )
  ) {
    return true;
  }
  if (
    raw.primaryLimiterTag === "writing_mark_severe" ||
    hasExplicitWritingPrimaryLimiter(raw) ||
    defects.some((defect) => defect.tag === "writing_mark_severe")
  ) {
    return true;
  }

  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  return /\b(limits grade|heavy wear|severe wear|paper loss|back discoloration limits)\b/.test(
    surfaceNote
  );
}

function hasNmBandWearFloor(categoryScores) {
  const { corners, edges, surface } = categoryScores;
  return Math.min(corners, edges, surface) >= 7;
}

function noteIndicatesLightCornerWear(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    /\b(slight|minor|tiny|isolated|light touch|touch wear|mostly sharp|sharp|intact|small amount)\b/.test(
      normalized
    ) &&
    !/\b(moderate wear|heavy wear|severe|all corners|heavy round|rounded on all|noticeable softening)\b/.test(
      normalized
    )
  );
}

function noteIndicatesModerateCornerEvidence(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    /\b(moderate wear|heavy round|rounding visible on all|all corners|severely rounded|heavy corner|noticeable softening)\b/.test(
      normalized
    ) ||
    (/\bmoderate\b/.test(normalized) &&
      /\b(round|wear|softening)\b/.test(normalized) &&
      !/\b(minor|slight|tiny|isolated|light)\b/.test(normalized))
  );
}

function hasContinuousScratchEvidence(raw) {
  const text = [
    raw.categoryNotes?.surface,
    raw.primaryLimiterLabel,
    raw.eyeAppealSummary,
  ]
    .join(" ")
    .toLowerCase();
  return (
    /\b(deep scratch|long scratch|gouge|scoring line|continuous scratch|heavy scratch|scratch through|creased scratch)\b/.test(
      text
    ) && !/\b(print line|roller mark|factory line|gloss|artifact|scanner)\b/.test(text)
  );
}

function hasPrintLineOrArtifactSignals(raw, defects) {
  if (
    defects.some((defect) =>
      ["print_line", "print_line_severe"].includes(defect.tag)
    )
  ) {
    return true;
  }
  const text = `${collectHarshConditionText(raw)} ${collectAppealText(raw)}`.toLowerCase();
  return /\b(print line|roller mark|factory line|gloss variation|scanner artifact|holder glare|slab reflection|slab glare)\b/.test(
    text
  );
}

function hasSevereBackDamageEvidence(raw) {
  const text = [
    ...Object.values(raw.categoryNotes || {}),
    raw.eyeAppealSummary,
    ...(raw.scanQuality?.visibilityIssues || []),
    ...(raw.scanQuality?.inspectionLimits || []),
  ]
    .join(" ")
    .toLowerCase();
  return /\b(severe back|heavy back damage|paper loss|stock loss|major back damage|hole|tear|water damage|mold)\b/.test(
    text
  );
}

function primaryLimiterWasVisionReconciled(raw, defects) {
  const tag = raw.primaryLimiterTag;
  if (!tag) {
    return false;
  }
  return !defects.some((defect) => defect.tag === tag);
}

function noteIndicatesLightBackStain(text) {
  const normalized = String(text || "").toLowerCase();
  return (
    /\b(toning|foxing|stain|discoloration|spot|age.?related|light mark|minor mark)\b/.test(
      normalized
    ) &&
    !/\b(severe|heavy|extensive|large area|covers most)\b/.test(normalized)
  );
}

function isPsa16VisionProtected(categoryScores, raw, defects) {
  const floor = Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );
  if (
    defects.some((defect) =>
      [
        "severe_crease",
        "moderate_crease",
        "paper_loss",
        "hole_tear",
        "trim_alteration_suspected",
        "rounded_corners_all",
      ].includes(defect.tag)
    )
  ) {
    return true;
  }
  if (
    defects.some((defect) => defect.tag === "writing_mark_severe") &&
    (hasInkOrWritingInspectionSignals(raw) || hasExplicitWritingPrimaryLimiter(raw))
  ) {
    return true;
  }
  if (floor <= 4.5) {
    return true;
  }
  if (floor <= 5.5 && countNotesPillarsWithPoorWear(raw) >= 2) {
    return true;
  }
  if (
    noteIndicatesModerateCornerEvidence(raw.categoryNotes?.corners) &&
    categoryScores.corners <= 6
  ) {
    return true;
  }
  const appeal = collectAppealText(raw).toLowerCase();
  if (
    /\b(heavy wear|severe wear|poor condition|heavy crease|paper loss|significant damage)\b/.test(
      appeal
    ) &&
    floor <= 6
  ) {
    return true;
  }
  return false;
}

function qualifiesForPsa810VisionCandidate(categoryScores, raw, defects) {
  if (isPsa16VisionProtected(categoryScores, raw, defects)) {
    return false;
  }
  return categoryScores.centering >= 7;
}

function isBackWearLimitingPattern(categoryScores, raw, defects) {
  return (
    raw.primaryLimiterTag === "back_wear" &&
    categoryScores.corners >= 6 &&
    categoryScores.centering >= 7 &&
    categoryScores.surface <= 6.5 &&
    frontDefectsAreMinorOnly(defects) &&
    defects.some((defect) => defect.tag === "back_wear" && defect.location === "back")
  );
}

function shouldPreserveBackOnlyWritingMark(defects, categoryScores, raw) {
  if (
    !defects.some(
      (defect) => defect.tag === "writing_mark" && defect.location === "back"
    )
  ) {
    return false;
  }
  if (hasInkOrWritingInspectionSignals(raw) || hasExplicitWritingPrimaryLimiter(raw)) {
    return true;
  }
  const { corners, edges, surface, centering } = categoryScores;
  const floor = Math.min(corners, edges, surface);
  return (
    centering >= 7 &&
    floor >= 5 &&
    floor <= 6.5 &&
    corners <= 7.5 &&
    surface <= 6.5 &&
    frontDefectsAreMinorOnly(defects)
  );
}

const CORE_LIGHT_WEAR_TAGS = new Set([
  "corner_wear_light",
  "edge_wear_light",
  "surface_scratch_light",
]);

const HIGH_GRADE_LIGHT_WEAR_COMPANIONS = new Set([
  "staining_light",
  "print_line",
  "gloss_loss",
  "registration_issue",
]);

const HIGH_GRADE_MAJOR_DEFECT_TAGS = new Set([
  "corner_wear_moderate",
  "rounded_corners_all",
  "edge_fraying_major",
  "surface_scratch_moderate",
  "moderate_crease",
  "severe_crease",
  "surface_wear",
  "paper_loss",
  "hole_tear",
  "writing_mark",
  "writing_mark_severe",
  "back_damage_severe",
  "heavy_staining",
  "trim_alteration_suspected",
]);

const PILLAR_LIFT_COLLAPSE_MAX = 6.5;
const PILLAR_LIFT_RECOVERY_MIN_CENTERING = 8;
const PILLAR_LIFT_STRONG_CENTERING = 8.5;

function defectsAreHighGradeLightWearOnly(defects) {
  if (!defects?.length) {
    return false;
  }
  return defects.every(
    (defect) =>
      CORE_LIGHT_WEAR_TAGS.has(defect.tag) ||
      HIGH_GRADE_LIGHT_WEAR_COMPANIONS.has(defect.tag)
  );
}

function hasHighGradeMajorDefect(defects) {
  return (defects || []).some((defect) =>
    HIGH_GRADE_MAJOR_DEFECT_TAGS.has(defect.tag)
  );
}

function hasPillarLiftBlockingNotes(raw) {
  const notes = raw.categoryNotes || {};
  const cornersNote = String(notes.corners || "").toLowerCase();
  const edgesNote = String(notes.edges || "").toLowerCase();
  const surfaceNote = String(notes.surface || "").toLowerCase();
  const combined = `${cornersNote} ${edgesNote} ${surfaceNote}`;

  if (noteIndicatesModerateCornerEvidence(cornersNote)) {
    return true;
  }
  if (hasAffirmativeMajorEdgeWearNote(raw)) {
    return true;
  }
  return /\b(crease|wrinkle|paper loss|writing|written|ink mark|pen mark|pencil|tear|hole|heavy stain|severe stain|major fray|heavy corner|rounded heavily)\b/.test(
    combined
  );
}

function hasScannerOrImagingArtifactSignals(raw) {
  const text = `${collectHarshConditionText(raw)} ${collectAppealText(raw)} ${(
    raw.scanQuality?.visibilityIssues || []
  ).join(" ")}`.toLowerCase();
  return /\b(scanner|scan artifact|jpeg|compression|digital noise|color cast|white balance|slab glare|holder glare|reflection|haze|soft focus|image softness|autofocus|moire|pixelation|light bleed)\b/.test(
    text
  );
}

function hasVintageStockOrPrintTextureSignals(raw) {
  const text = `${collectHarshConditionText(raw)} ${collectAppealText(raw)}`.toLowerCase();
  return /\b(print line|roller mark|factory line|print irregular|registration|stock texture|paper texture|card stock|manufacturing|gloss variation|natural variation|off.?white|cream tone|vintage stock|ink pattern)\b/.test(
    text
  );
}

function hasVintagePaperVariationSignals(raw) {
  const text = `${collectHarshConditionText(raw)} ${collectAppealText(raw)}`.toLowerCase();
  return /\b(toning|foxing|paper tone|age.?related|off.?white|cream|natural variation|vintage paper|light discoloration|color shift)\b/.test(
    text
  );
}

function noteIndicatesSharpCornerPresentation(raw) {
  const cornersNote = String(raw.categoryNotes?.corners || "").toLowerCase();
  const appeal = collectAppealText(raw).toLowerCase();
  return (
    /\b(sharp|primarily sharp|intact|clean corners|strong corners|minimal corner|nice shape|generally sharp)\b/.test(
      `${cornersNote} ${appeal}`
    ) && !noteIndicatesModerateCornerEvidence(cornersNote)
  );
}

function noteIndicatesEdgeMicroChipping(raw) {
  const edgesNote = String(raw.categoryNotes?.edges || "").toLowerCase();
  if (!edgesNote) {
    return false;
  }
  return (
    /\b(chipping|chipped|micro.?chip|notched|rough edge|edge break)\b/.test(edgesNote) &&
    !/\b(no|not|without|minimal|light)\s+(chipping|chip|fray)/.test(edgesNote)
  );
}

function noteIndicatesCornerSoftening(raw) {
  const cornersNote = String(raw.categoryNotes?.corners || "").toLowerCase();
  if (!cornersNote) {
    return false;
  }
  if (noteIndicatesSharpCornerPresentation(raw)) {
    return false;
  }
  return /\b(softening|rounded|rounding|not sharp|fair corners|moderate wear)\b/.test(
    cornersNote
  );
}

function noteIndicatesSurfaceLimitingWear(raw) {
  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  if (!surfaceNote) {
    return false;
  }
  if (/\b(minor|light|slight|small|few|little)\b/.test(surfaceNote)) {
    return false;
  }
  return /\b(moderate|heavy|severe|extensive|deep|multiple|visible wear|limits grade)\b/.test(
    surfaceNote
  );
}

function noteIndicatesCenteringPrecision(categoryScores, raw) {
  if (categoryScores.centering >= 8.5) {
    return true;
  }
  if (categoryScores.centering < 8) {
    return false;
  }
  const centeringNote = String(raw.categoryNotes?.centering || "").toLowerCase();
  const appeal = collectAppealText(raw).toLowerCase();
  return /\b(strong centering|excellent centering|well.?centered|well centered|good centering)\b/.test(
    `${centeringNote} ${appeal}`
  );
}

function noteIndicatesCleanSurfaceProfile(raw) {
  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  const appeal = collectAppealText(raw).toLowerCase();
  if (noteIndicatesSurfaceLimitingWear(raw)) {
    return false;
  }
  return (
    /\b(clean surface|minimal wear|presents well|retains gloss|good color|bright|clear image|minor scratch)\b/.test(
      `${surfaceNote} ${appeal}`
    ) || (/\b(minor|light|slight)\b/.test(surfaceNote) && !/\bmoderate|heavy|severe\b/.test(surfaceNote))
  );
}

function isCosmeticPrintDefect(defect, raw) {
  if (!["print_line", "registration_issue", "gloss_loss"].includes(defect.tag)) {
    return false;
  }
  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  return (
    !/\b(severe|heavy|extensive|misregister|off.?center print)\b/.test(surfaceNote) &&
    (hasVintageStockOrPrintTextureSignals(raw) ||
      hasPrintLineOrArtifactSignals(raw, [defect]) ||
      defect.tag === "gloss_loss")
  );
}

function qualifiesForGemMintSlabProfile(defects, categoryScores, raw) {
  if (!defectsAreHighGradeLightWearOnly(defects)) {
    return false;
  }
  if (hasHighGradeMajorDefect(defects)) {
    return false;
  }
  if (!noteIndicatesCenteringPrecision(categoryScores, raw)) {
    return false;
  }
  if (noteIndicatesCornerSoftening(raw)) {
    return false;
  }
  if (noteIndicatesEdgeMicroChipping(raw)) {
    return false;
  }
  if (!noteIndicatesSharpCornerPresentation(raw)) {
    return false;
  }
  if (!noteIndicatesCleanSurfaceProfile(raw)) {
    return false;
  }
  if (countNotesPillarsWithPoorWear(raw) >= 1) {
    return false;
  }
  const appeal = collectAppealText(raw).toLowerCase();
  if (
    /\b(heavy wear|severe wear|poor condition|fair eye appeal|significant wear)\b/.test(
      appeal
    )
  ) {
    return false;
  }
  return true;
}

function qualifiesForMintSlabProfile(defects, categoryScores, raw) {
  if (qualifiesForGemMintSlabProfile(defects, categoryScores, raw)) {
    return false;
  }
  if (!defectsAreHighGradeLightWearOnly(defects)) {
    return false;
  }
  if (hasHighGradeMajorDefect(defects)) {
    return false;
  }
  if (categoryScores.centering < PILLAR_LIFT_RECOVERY_MIN_CENTERING) {
    return false;
  }
  if (noteIndicatesEdgeMicroChipping(raw)) {
    return false;
  }
  if (noteIndicatesSurfaceLimitingWear(raw)) {
    return false;
  }
  if (countNotesPillarsWithPoorWear(raw) >= 2) {
    return false;
  }
  return (
    hasNmGemPresentationAppeal(raw) ||
    isNmVintageCleanPresentation(categoryScores, raw) ||
    isNmVintagePresentationCandidate(categoryScores, raw)
  );
}

function shouldDemoteCosmeticStaining(defect, raw, categoryScores) {
  if (defect.tag !== "staining_light") {
    return false;
  }
  if (categoryScores.centering < 7) {
    return false;
  }
  const location = String(defect.location || "").toLowerCase();
  const backOnly = location === "back" || location === "both";
  const stainText = `${raw.categoryNotes?.surface || ""} ${raw.categoryNotes?.back || ""}`;
  const cosmeticEvidence =
    backOnly &&
    (noteIndicatesLightBackStain(stainText) ||
      hasVintagePaperVariationSignals(raw) ||
      hasScannerOrImagingArtifactSignals(raw));
  if (!cosmeticEvidence) {
    return false;
  }
  return (
    hasNmGemPresentationAppeal(raw) ||
    isNmVintagePresentationCandidate(categoryScores, raw) ||
    hasCleanPresentationAppeal(raw) ||
    categoryScores.centering >= 8
  );
}

function shouldDemoteRoundedCornersAsManufacturing(raw, categoryScores) {
  if (categoryScores.centering < 7) {
    return false;
  }
  const cornersNote = String(raw.categoryNotes?.corners || "");
  if (noteIndicatesModerateCornerEvidence(cornersNote)) {
    return false;
  }
  return (
    noteIndicatesSharpCornerPresentation(raw) ||
    ((hasNmGemPresentationAppeal(raw) || isNmVintageCleanPresentation(categoryScores, raw)) &&
      categoryScores.corners >= 6)
  );
}

function shouldReclassifyCornerWearAsPrintArtifact(defect, raw, categoryScores) {
  if (defect.tag !== "corner_wear_light") {
    return false;
  }
  if (categoryScores.centering < 7.5) {
    return false;
  }
  if (noteIndicatesModerateCornerEvidence(String(raw.categoryNotes?.corners || ""))) {
    return false;
  }
  return (
    hasPrintLineOrArtifactSignals(raw, [defect]) ||
    hasVintageStockOrPrintTextureSignals(raw) ||
    (noteIndicatesSharpCornerPresentation(raw) &&
      (hasNmGemPresentationAppeal(raw) || isNmVintagePresentationCandidate(categoryScores, raw)))
  );
}

const MODERN_REFLECTIVE_SCRATCH_DAMAGE_BLOCKERS = [
  /\bmultiple scratches\b/,
  /\bseveral scratches\b/,
  /\bnumerous scratches\b/,
  /\bdeep scratch/,
  /\bheavy scratch/,
  /\bsevere scratch/,
  /\bobvious wear\b/,
  /\bheavy scuff/,
  /\bsevere scuff/,
  /\bdistracting defect/,
  /\bhighly distracting\b/,
  /\bsignificant surface loss\b/,
  /\bdetract(s|ing)? significantly\b/,
  /\bimpacts visibility\b/,
  /\bcontinuous scratch/,
  /\bgouge\b/,
  /\bindentation\b/,
];

const MODERN_REFLECTIVE_SCRATCH_COSMETIC_SIGNALS = [
  /\bminor scratch/,
  /\blight scratch/,
  /\bminor surface mark/,
  /\bdoes not detract\b/,
  /\bdoesn't detract\b/,
  /\bdo not detract\b/,
  /\bdon't detract\b/,
  /\botherwise excellent\b/,
  /\bmostly clean\b/,
  /\bclean surface\b/,
  /\bgenerally clean\b/,
  /\blargely clean\b/,
  /\bglossy\b/,
  /\bfactory line\b/,
  /\bprint line\b/,
  /\broller mark/,
  /\bminor imperfection/,
  /\bslight wear\b/,
  /\bnot easily noticeable\b/,
  /\bunder (close )?inspection\b/,
  /\bsuperficial\b/,
  /\bhairline\b/,
  /\bfaint scratch/,
  /\bsmall scratch/,
  /\bvery clean\b/,
  /\bno significant scratch/,
  /\bshiny\b/,
  /\breflective\b/,
  /\bvibrant\b/,
  /\bexcellent surface\b/,
  /\bminor blemish/,
  /\bminimal scratch/,
];

function collectModernReflectiveSurfaceText(raw) {
  const notes = raw.categoryNotes || {};
  return [
    notes.surface,
    raw.eyeAppealSummary,
    raw.bestAttribute,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasModernReflectiveScratchDamageLanguage(raw) {
  const text = collectModernReflectiveSurfaceText(raw);
  return MODERN_REFLECTIVE_SCRATCH_DAMAGE_BLOCKERS.some((pattern) => pattern.test(text));
}

function hasModernReflectiveScratchCosmeticLanguage(raw) {
  const text = collectModernReflectiveSurfaceText(raw);
  return MODERN_REFLECTIVE_SCRATCH_COSMETIC_SIGNALS.some((pattern) => pattern.test(text));
}

function reconcileModernReflectiveScratchArtifacts(defects, raw, era) {
  if (era !== "modern" || !isChromiumFinishCard(raw)) {
    return { defects, audit: [], reconciled: false };
  }
  if (!defects.some((defect) => defect.tag === "surface_scratch_light")) {
    return { defects, audit: [], reconciled: false };
  }

  const presentationText = collectModernReflectiveSurfaceText(raw);
  const scratchDefects = defects.filter((defect) => defect.tag === "surface_scratch_light");
  const hasConfirmedScratch = scratchDefects.some((defect) =>
    hasConfirmedSurfaceScratchEvidence(raw, defect)
  );
  const chromeArtifactOnly =
    CHROME_ARTIFACT_FALSE_SCRATCH.some((pattern) => pattern.test(presentationText)) &&
    !hasConfirmedScratch;
  const cleanSurfaceContradiction =
    SURFACE_CLEAN_SCRATCH_CONTRADICTION.some((pattern) => pattern.test(presentationText)) &&
    !hasConfirmedScratch;

  if (chromeArtifactOnly || cleanSurfaceContradiction) {
    const audit = [];
    const reconciled = defects.filter((defect) => {
      if (defect.tag !== "surface_scratch_light") {
        return true;
      }
      if (hasConfirmedSurfaceScratchEvidence(raw, defect)) {
        return true;
      }
      audit.push({
        source: "modern_chromium_false_scratch_strip",
        originalTag: "surface_scratch_light",
        newTag: null,
      });
      return false;
    });
    if (!audit.length) {
      return { defects, audit: [], reconciled: false };
    }
    return { defects: reconciled, audit, reconciled: true };
  }

  if (hasModernReflectiveScratchDamageLanguage(raw)) {
    return { defects, audit: [], reconciled: false };
  }

  const strippedSurfaceNote = stripNegatedScratchLanguage(surfaceNoteText(raw));
  if (
    hasExplicitSurfaceScratchInNotes(raw) &&
    CHROMIUM_STRONG_SCRATCH_EVIDENCE.some((pattern) => pattern.test(strippedSurfaceNote))
  ) {
    return { defects, audit: [], reconciled: false };
  }

  if (!hasModernReflectiveScratchCosmeticLanguage(raw)) {
    return { defects, audit: [], reconciled: false };
  }
  if (!hasExplicitSurfaceScratchInNotes(raw)) {
    return { defects, audit: [], reconciled: false };
  }

  let adjusted = false;
  const audit = [];
  const reconciled = defects.map((defect) => {
    if (defect.tag !== "surface_scratch_light") {
      return defect;
    }
    adjusted = true;
    audit.push({
      source: "modern_reflective_artifact_reclass",
      originalTag: "surface_scratch_light",
      newTag: "print_line",
    });
    return normalizeDefectObservation({
      ...defect,
      tag: "print_line",
      severity: "minor",
    });
  });

  if (!adjusted) {
    return { defects, audit: [], reconciled: false };
  }

  return { defects: reconciled, audit, reconciled: true };
}

function qualifiesForNmGemStrongPresentation(categoryScores, raw, defects) {
  return qualifiesForGemMintSlabProfile(defects, categoryScores, raw);
}

function computeHighGradePillarFloors(defects, categoryScores, raw) {
  if (isPsa16VisionProtected(categoryScores, raw, defects)) {
    return null;
  }
  if (hasHighGradeMajorDefect(defects)) {
    return null;
  }
  if (countNotesPillarsWithPoorWear(raw) >= 2) {
    return null;
  }
  if (!defectsAreHighGradeLightWearOnly(defects)) {
    return null;
  }

  const appeal = collectAppealText(raw).toLowerCase();
  if (
    /\b(heavy wear|severe wear|poor condition|heavy crease|paper loss|rounded heavily|fair eye appeal)\b/.test(
      appeal
    )
  ) {
    return null;
  }

  const minPillar = Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );

  if (qualifiesForGemMintSlabProfile(defects, categoryScores, raw)) {
    return { corners: 8.5, edges: 8.5, surface: 8.5 };
  }

  const nmGemAppeal =
    hasNmGemPresentationAppeal(raw) || isNmVintageCleanPresentation(categoryScores, raw);

  if (
    categoryScores.centering >= PILLAR_LIFT_STRONG_CENTERING &&
    nmGemAppeal &&
    minPillar <= PILLAR_LIFT_COLLAPSE_MAX
  ) {
    return { corners: 7.5, edges: 7.5, surface: 7.5 };
  }

  if (
    minPillar <= PILLAR_LIFT_COLLAPSE_MAX &&
    qualifiesForMintSlabProfile(defects, categoryScores, raw)
  ) {
    return { corners: 8, edges: 8, surface: 8 };
  }

  return null;
}

function qualifiesForHighGradeTriadSkip(categoryScores, raw, defects) {
  if (qualifiesForGemMintSlabProfile(defects, categoryScores, raw)) {
    return true;
  }
  if (!defectsAreHighGradeLightWearOnly(defects)) {
    return false;
  }
  if (hasHighGradeMajorDefect(defects)) {
    return false;
  }
  if (categoryScores.centering < PILLAR_LIFT_STRONG_CENTERING) {
    return false;
  }
  if (countNotesPillarsWithPoorWear(raw) >= 2) {
    return false;
  }
  if (countNotesPillarsWithWear(raw) >= 3 && !hasNmGemPresentationAppeal(raw)) {
    return false;
  }
  return (
    qualifiesForMintSlabProfile(defects, categoryScores, raw) ||
    hasNmGemPresentationAppeal(raw) ||
    isNmVintageCleanPresentation(categoryScores, raw)
  );
}

function applyHighGradePillarFloors(categoryScores, floors) {
  if (!floors) {
    return categoryScores;
  }
  return {
    ...categoryScores,
    corners: roundToHalf(clampGrade(Math.max(categoryScores.corners, floors.corners))),
    edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, floors.edges))),
    surface: roundToHalf(clampGrade(Math.max(categoryScores.surface, floors.surface))),
  };
}

function reconcileHighGradeNmGemVisionCalibration(defects, categoryScores, raw) {
  if (categoryScores.centering < 7) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  let reconciled = (defects || []).flatMap((defect) => {
    if (shouldDemoteCosmeticStaining(defect, raw, categoryScores)) {
      adjusted = true;
      return [];
    }

    if (
      defect.tag === "rounded_corners_all" &&
      shouldDemoteRoundedCornersAsManufacturing(raw, categoryScores)
    ) {
      adjusted = true;
      if (hasVintageStockOrPrintTextureSignals(raw) || hasPrintLineOrArtifactSignals(raw, defects)) {
        return [{ ...defect, tag: "print_line", severity: "minor", location: "front" }];
      }
      return [{ ...defect, tag: "corner_wear_light", severity: "minor" }];
    }

    if (shouldReclassifyCornerWearAsPrintArtifact(defect, raw, categoryScores)) {
      adjusted = true;
      if (hasPrintLineOrArtifactSignals(raw, defects) || hasVintageStockOrPrintTextureSignals(raw)) {
        return [{ ...defect, tag: "print_line", severity: "minor" }];
      }
      return [defect];
    }

    if (
      defect.tag === "gloss_loss" &&
      categoryScores.centering >= 8 &&
      (qualifiesForGemMintSlabProfile(defects, categoryScores, raw) ||
        hasNmGemPresentationAppeal(raw) ||
        isNmVintageCleanPresentation(categoryScores, raw)) &&
      !/\b(severe|heavy|extensive)\b/.test(
        String(raw.categoryNotes?.surface || "").toLowerCase()
      )
    ) {
      adjusted = true;
      return [{ ...defect, tag: "print_line", severity: "minor" }];
    }

    if (
      qualifiesForGemMintSlabProfile(defects, categoryScores, raw) &&
      isCosmeticPrintDefect(defect, raw)
    ) {
      adjusted = true;
      return [];
    }

    return [defect];
  });

  const floors = computeHighGradePillarFloors(reconciled, categoryScores, raw);
  const nextScores = applyHighGradePillarFloors(categoryScores, floors);
  if (
    nextScores.corners !== categoryScores.corners ||
    nextScores.edges !== categoryScores.edges ||
    nextScores.surface !== categoryScores.surface
  ) {
    adjusted = true;
  }

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: nextScores,
    reconciled: true,
  };
}

function reconcileHighGradeVisionOverTags(defects, categoryScores, raw) {
  if (categoryScores.centering < 7) {
    return { defects, categoryScores, reconciled: false };
  }

  const wearProtected = isPsa16VisionProtected(categoryScores, raw, defects);
  const cornersNote = String(raw.categoryNotes?.corners || "");
  const surfaceNote = String(raw.categoryNotes?.surface || "");
  const backNote = String(
    raw.categoryNotes?.surface || raw.categoryNotes?.back || ""
  ).toLowerCase();
  const lightCornerNote = noteIndicatesLightCornerWear(cornersNote);
  const moderateCornerEvidence = noteIndicatesModerateCornerEvidence(cornersNote);
  const printOrArtifact = hasPrintLineOrArtifactSignals(raw, defects);
  const continuousScratch = hasContinuousScratchEvidence(raw);
  const nmPresentation =
    isNmVintagePresentationCandidate(categoryScores, raw) ||
    hasNmGemPresentationAppeal(raw) ||
    hasCleanPresentationAppeal(raw);
  const backOnlyStainCompanion =
    hasBackOnlyStaining(defects) && categoryScores.centering >= 7;
  const backStainScratchRelief =
    backOnlyStainCompanion && countNotesPillarsWithPoorWear(raw) < 2;
  const poorBandCluster = countNotesPillarsWithPoorWear(raw) >= 2;
  const surfaceNoteLower = String(raw.categoryNotes?.surface || "").toLowerCase();
  const backDiscolorationLimitsGrade =
    /\b(limits grade|back discoloration limits)\b/.test(surfaceNoteLower);

  let adjusted = false;
  let writingDemoted = false;
  let reconciled = defects.map((defect) => {
    if (
      !wearProtected &&
      !poorBandCluster &&
      defect.tag === "corner_wear_moderate" &&
      (lightCornerNote ||
        (!moderateCornerEvidence &&
          (nmPresentation || categoryScores.centering >= 7.5)))
    ) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }

    if (defect.tag === "surface_scratch_moderate") {
      if ((!wearProtected || backStainScratchRelief) && !poorBandCluster) {
        if (printOrArtifact) {
          adjusted = true;
          return { ...defect, tag: "print_line", severity: "minor" };
        }
        if (
          !continuousScratch &&
          (nmPresentation ||
            categoryScores.centering >= 7.5 ||
            backStainScratchRelief)
        ) {
          adjusted = true;
          return { ...defect, tag: "surface_scratch_light", severity: "minor" };
        }
      }
    }

    if (
      defect.tag === "back_damage_severe" &&
      !hasSevereBackDamageEvidence(raw)
    ) {
      adjusted = true;
      return {
        ...defect,
        tag: "staining_light",
        severity: "minor",
        location: "back",
      };
    }

    if (
      (defect.tag === "writing_mark" || defect.tag === "writing_mark_severe") &&
      !hasInkOrWritingInspectionSignals(raw) &&
      !hasExplicitWritingPrimaryLimiter(raw) &&
      !shouldPreserveBackOnlyWritingMark(defects, categoryScores, raw) &&
      !isBackWearLimitingPattern(categoryScores, raw, defects) &&
      raw.primaryLimiterTag !== "back_wear" &&
      (nmPresentation ||
        categoryScores.corners >= 7.5 ||
        hasMislabeledBackMarkNotes(raw) ||
        writingOnlyInAppealNotNotes(raw))
    ) {
      adjusted = true;
      writingDemoted = true;
      return {
        ...defect,
        tag: "staining_light",
        severity: "minor",
        location: defect.location === "front" ? "back" : defect.location,
      };
    }

    if (
      defect.tag === "heavy_staining" &&
      defect.location === "back" &&
      noteIndicatesLightBackStain(`${surfaceNote} ${backNote}`)
    ) {
      adjusted = true;
      return {
        ...defect,
        tag: "staining_light",
        severity: "minor",
        location: "back",
      };
    }

    if (
      defect.tag === "back_wear" &&
      defect.location === "back" &&
      !hasInkOrWritingInspectionSignals(raw) &&
      !hasSevereBackDamageEvidence(raw) &&
      !isBackWearLimitingPattern(categoryScores, raw, defects) &&
      !backDiscolorationLimitsGrade
    ) {
      adjusted = true;
      return {
        ...defect,
        tag: "staining_light",
        severity: "minor",
        location: "back",
      };
    }

    return defect;
  });

  if (
    nmPresentation &&
    reconciled.some((defect) => defect.tag === "surface_wear") &&
    categoryScores.surface >= 6
  ) {
    adjusted = true;
    reconciled = reconciled.map((defect) =>
      defect.tag === "surface_wear"
        ? { ...defect, tag: "surface_scratch_light", severity: "minor" }
        : defect
    );
  }

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  let nextScores = { ...categoryScores };
  if (writingDemoted) {
    nextScores = {
      ...nextScores,
      surface: noteIndicatesStructuralCrease(raw)
        ? nextScores.surface
        : roundToHalf(
            clampGrade(
              Math.max(nextScores.surface, nextScores.centering >= 8 ? 7 : 6.5)
            )
          ),
    };
    if (
      nextScores.centering >= 8 &&
      nmPresentation &&
      !hasPillarLiftBlockingNotes(raw) &&
      !hasHighGradeMajorDefect(reconciled)
    ) {
      nextScores = {
        ...nextScores,
        corners: roundToHalf(
          clampGrade(Math.max(nextScores.corners, 7))
        ),
        edges: roundToHalf(clampGrade(Math.max(nextScores.edges, 7))),
      };
    }
    const softenCompanionWear =
      hasMislabeledBackMarkNotes(raw) || isNmVintageCleanPresentation(nextScores, raw);
    if (softenCompanionWear) {
      const appealText = collectAppealText(raw);
      const lightScratchAppeal =
        /\b(scratch|scratches|scuff|scuffs)\b/.test(appealText) &&
        /\b(light|minor|slight)\b/.test(appealText);
      reconciled = reconciled.map((defect) => {
        if (defect.tag === "surface_scratch_moderate" && lightScratchAppeal) {
          return { ...defect, tag: "surface_scratch_light", severity: "minor" };
        }
        if (
          defect.tag === "corner_wear_moderate" &&
          (nextScores.corners >= 6 ||
            (/\b(corner|corners)\b/.test(appealText) &&
              /\b(light|minor|slight|touch)\b/.test(appealText)))
        ) {
          return { ...defect, tag: "corner_wear_light", severity: "minor" };
        }
        return defect;
      });
    }
  }

  return { defects: reconciled, categoryScores: nextScores, reconciled: true };
}

const NM_POOR_BAND_SKIP_BLOCKERS = new Set([
  "moderate_crease",
  "severe_crease",
  "paper_loss",
  "hole_tear",
  "back_damage_severe",
  "writing_mark_severe",
  "edge_fraying_major",
  "heavy_staining",
  "trim_alteration_suspected",
]);

function qualifiesForNmPoorBandNotesSkip(categoryScores, raw) {
  if (!hasNmBandWearFloor(categoryScores)) {
    return false;
  }
  const visionDefects = raw.defects || [];
  if (!visionDefects.length) {
    return false;
  }
  if (
    visionDefects.some((defect) => NM_POOR_BAND_SKIP_BLOCKERS.has(defect.tag))
  ) {
    return false;
  }
  return visionDefects.every((defect) => LIGHT_WEAR_ONLY_TAGS.has(defect.tag));
}

function reconcileNmBandVisionOverTags(defects, categoryScores, raw) {
  if (!hasNmBandWearFloor(categoryScores)) {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, edges, surface, centering } = categoryScores;
  const nmPresentation =
    isNmVintagePresentationCandidate(categoryScores, raw) ||
    hasNmGemPresentationAppeal(raw);
  const cornersNote = String(raw.categoryNotes?.corners || "").toLowerCase();
  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  const edgesNote = String(raw.categoryNotes?.edges || "").toLowerCase();
  const lightCornerNote =
    /\b(sharp|intact|minimal|light|minor|slight|touch)\b/.test(cornersNote) &&
    !/\b(heavy|severe|major|rounded|rounding)\b/.test(cornersNote);
  const lightSurfaceNote =
    /\b(clean|minor|light|small|slight|few|imperfection)\b/.test(surfaceNote) &&
    !/\b(heavy|severe|major|extensive|moderate wear)\b/.test(surfaceNote);
  const lightEdgeNote =
    /\b(clean|light|minor|slight|touch)\b/.test(edgesNote) &&
    !/\b(heavy|severe|major|chipping)\b/.test(edgesNote);

  let adjusted = false;
  let nextScores = { ...categoryScores };

  const reconciled = defects.map((defect) => {
    if (
      defect.tag === "corner_wear_moderate" &&
      corners >= 7 &&
      (lightCornerNote || nmPresentation)
    ) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (
      defect.tag === "surface_scratch_moderate" &&
      surface >= 7 &&
      countNotesPillarsWithPoorWear(raw) < 2 &&
      (lightSurfaceNote || nmPresentation)
    ) {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    if (
      defect.tag === "back_wear" &&
      defect.location === "back" &&
      nmPresentation &&
      !hasInkOrWritingInspectionSignals(raw) &&
      raw.primaryLimiterTag !== "back_wear"
    ) {
      adjusted = true;
      return { ...defect, tag: "staining_light", severity: "minor", location: "back" };
    }
    return defect;
  });

  if (
    reconciled.some((defect) => defect.tag === "surface_wear") &&
    surface >= 7 &&
    centering >= 7 &&
    (lightSurfaceNote || nmPresentation)
  ) {
    adjusted = true;
    const demoted = reconciled.map((defect) =>
      defect.tag === "surface_wear"
        ? { ...defect, tag: "surface_scratch_light", severity: "minor" }
        : defect
    );
    nextScores = {
      ...nextScores,
      surface: roundToHalf(clampGrade(Math.max(surface, 7))),
    };
    return { defects: demoted, categoryScores: nextScores, reconciled: true };
  }

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  if (corners >= 7) {
    nextScores.corners = roundToHalf(clampGrade(Math.max(nextScores.corners, corners)));
  }
  if (surface >= 7) {
    nextScores.surface = roundToHalf(clampGrade(Math.max(nextScores.surface, surface)));
  }
  if (edges >= 7 && lightEdgeNote) {
    nextScores.edges = roundToHalf(clampGrade(Math.max(nextScores.edges, edges)));
  }

  return { defects: reconciled, categoryScores: nextScores, reconciled: true };
}

function hasMislabeledBackMarkNotes(raw) {
  return (
    /\b(dark mark|smudge|blemish|spotting|print transfer)\b/.test(
      collectHarshConditionText(raw)
    ) && !hasInkOrWritingInspectionSignals(raw)
  );
}

function hasInkOrWritingInspectionSignals(raw) {
  return /\b(ink|written|writing|pen|pencil|scribble|marker|autograph|name written)\b/.test(
    collectHarshConditionText(raw).toLowerCase()
  );
}

function hasExplicitWritingPrimaryLimiter(raw) {
  const label = String(raw.primaryLimiterLabel || "").toLowerCase().trim();
  if (!label) {
    return false;
  }
  if (label === "writing, mark, or ink") {
    return false;
  }
  return /\b(ink|written|writing|pen|pencil|scribble|marker|autograph|name written|marking over|heavy writing)\b/.test(
    label
  );
}

function hasStainAppealSignals(raw) {
  return /\b(stain|staining|foxing|toning|discoloration|yellowing|spotting)\b/.test(
    collectAppealText(raw)
  );
}

export function isNmVintageStainPresentation(categoryScores, raw) {
  if (hasNmPresentationBlockers(raw)) {
    return false;
  }
  const { corners, edges, centering } = categoryScores;
  const nmBand = corners >= 7 && edges >= 7;
  if (centering < 7 || (!nmBand && (corners < 6 || edges < 6))) {
    return false;
  }
  if (hasInkOrWritingInspectionSignals(raw)) {
    return false;
  }

  return hasStainAppealSignals(raw);
}

export function isNmVintageCleanPresentation(categoryScores, raw) {
  if (hasNmPresentationBlockers(raw)) {
    return false;
  }
  const { corners, edges, centering, surface } = categoryScores;
  if (surface <= 6.5) {
    return false;
  }
  const nmBand = corners >= 7 && edges >= 7;
  if (centering < 7 || (!nmBand && (corners < 6 || edges < 6))) {
    return false;
  }
  if (hasInkOrWritingInspectionSignals(raw)) {
    return false;
  }

  const appeal = collectAppealText(raw);
  const centeringOk =
    centering >= 8 ||
    /\b(strong centering|solid centering|well centered|centering helps|good centering|balanced|straight alignment)\b/.test(
      appeal
    );

  return (
    (hasCleanPresentationAppeal(raw) || hasNmGemPresentationAppeal(raw)) &&
    centeringOk
  );
}

export function isNmVintagePresentationCandidate(categoryScores, raw) {
  return (
    isNmVintageStainPresentation(categoryScores, raw) ||
    isNmVintageCleanPresentation(categoryScores, raw)
  );
}

function reconcileFalseBackWriting(defects, categoryScores, raw) {
  const hasWriting = defects.some((defect) =>
    ["writing_mark", "writing_mark_severe"].includes(defect.tag)
  );
  if (!hasWriting) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    raw.primaryLimiterTag === "writing_mark_severe" ||
    hasExplicitWritingPrimaryLimiter(raw)
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    raw.primaryLimiterTag === "back_wear" ||
    isBackWearLimitingPattern(categoryScores, raw, defects)
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  if (hasInkOrWritingInspectionSignals(raw) && !writingOnlyInAppealNotNotes(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  const nmPresentation =
    isNmVintagePresentationCandidate(categoryScores, raw) ||
    hasMislabeledBackMarkNotes(raw);
  if (
    !nmPresentation &&
    !hasCleanPresentationAppeal(raw) &&
    !writingOnlyInAppealNotNotes(raw)
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const softenCompanionWear =
    isNmVintageCleanPresentation(categoryScores, raw) ||
    hasMislabeledBackMarkNotes(raw);
  const appealText = collectAppealText(raw);
  const lightScratchAppeal =
    /\b(scratch|scratches|scuff|scuffs)\b/.test(appealText) &&
    /\b(light|minor|slight)\b/.test(appealText);
  const lightCornerAppeal =
    /\b(corner|corners)\b/.test(appealText) &&
    /\b(light|minor|slight|touch)\b/.test(appealText);

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (["writing_mark", "writing_mark_severe"].includes(defect.tag)) {
      adjusted = true;
      return {
        ...defect,
        tag: "staining_light",
        severity: "minor",
        location: defect.location === "front" ? "back" : defect.location,
      };
    }
    if (
      softenCompanionWear &&
      defect.tag === "surface_scratch_moderate" &&
      lightScratchAppeal
    ) {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    if (
      softenCompanionWear &&
      defect.tag === "corner_wear_moderate" &&
      (lightCornerAppeal || categoryScores.corners >= 6)
    ) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  const surfaceTarget = categoryScores.centering >= 8 ? 7 : 6.5;

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      surface: noteIndicatesStructuralCrease(raw)
        ? categoryScores.surface
        : roundToHalf(
            clampGrade(Math.max(categoryScores.surface, surfaceTarget))
          ),
    },
    reconciled: true,
  };
}

function hasHarshConditionSignals(raw) {
  const text = collectHarshConditionText(raw);
  return /\b(visible crease|heavy crease|severe crease|deep crease|diagonal crease|horizontal crease|vertical crease|\bcrease\b|heavy round|major edge|heavy edge|paper loss|writing|poor condition|heavy wear|severe wear)\b/.test(
    text
  );
}

function hasDefinitiveHarshCreaseSignals(raw) {
  const text = [collectHarshConditionText(raw), collectAppealText(raw)].join(" ");
  return /\b(severe crease|heavy crease|deep crease|visible crease|diagonal crease|horizontal crease|vertical crease|crease through (the )?(image|face|center|player)|crease across|breaks color)\b/.test(
    text
  );
}

function noteIndicatesStructuralCrease(raw) {
  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  return (
    /\b(crease|creasing|fold|bent)\b/.test(surfaceNote) ||
    hasDefinitiveHarshCreaseSignals(raw)
  );
}

function hasSoftExWearAppeal(raw) {
  const text = collectAppealText(raw);
  if (/\b(severe|heavy|deep)\s+(crease|creasing|wear)\b/.test(text)) {
    return false;
  }
  if (/\b(poor condition|paper loss|writing| ink |pencil|marker|scribble)\b/.test(
    text
  )) {
    return false;
  }

  const decentPresentation =
    /\b(decent|good|overall presentation|centering helps|aesthetic|presentation)\b/.test(
      text
    );
  const mentionsWear = /\b(wear|creasing|crease|touch|rounding|chipping)\b/.test(
    text
  );

  return decentPresentation && mentionsWear;
}

function hasDefinitiveHarshEdgeInspectionSignals(raw) {
  return /\b(heavy edge|severe edge|major edge fray|fiber loss|heavy chipping)\b/.test(
    collectHarshConditionText(raw)
  );
}

export function isStrongCenteringWearOverTagPattern(categoryScores, raw) {
  const { corners, centering, surface } = categoryScores;
  if (centering < 7 || corners < 6 || surface < 6) {
    return false;
  }
  if (hasDefinitiveHarshCreaseSignals(raw)) {
    return false;
  }
  if (hasDefinitiveHarshEdgeInspectionSignals(raw)) {
    return false;
  }

  const appeal = collectAppealText(raw);
  return (
    /\b(strong centering|solid centering|well centered|centering helps|maintains strong centering)\b/.test(
      appeal
    ) || centering >= 7.5
  );
}

function collectAppealText(raw) {
  return [raw.eyeAppealSummary, raw.bestAttribute].join(" ").toLowerCase();
}

function hasExAppealSignals(raw) {
  const appealText = collectAppealText(raw);
  if (
    /\b(visible crease|heavy crease|severe crease|deep crease|paper loss|writing| ink |pencil|marker|scribble|poor condition)\b/.test(
      appealText
    )
  ) {
    return false;
  }

  const strongAppeal =
    /\b(vibrant|strong|relatively strong|clear imagery|solid eye appeal|good color|decent appeal|eye appeal)\b/.test(
      appealText
    );
  const lightWear =
    /\b(light edge|minor edge|slight edge|light wear|minor wear|light corner|light touch|minor touch|edge wear|minor surface)\b/.test(
      appealText
    ) ||
    (/\b(minor|light|slight)\b/.test(appealText) &&
      /\b(wear|chipping|scratch|rounding|flaw|touch)\b/.test(appealText));
  const exPresentation =
    /\b(attractive|appealing|decent|good)\b/.test(appealText) &&
    /\b(ex|excellent)\b/.test(appealText);

  return (strongAppeal && lightWear) || (exPresentation && lightWear);
}

export function hasVintageExAppealSignals(raw) {
  return hasExAppealSignals(raw);
}

function isVintageExOverTagCandidate(categoryScores, scanQuality, raw) {
  const { corners, centering, surface } = categoryScores;
  if (corners < 6 || centering < 7.5 || surface < 6) return false;
  if (hasHarshConditionSignals(raw)) return false;
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return false;
  }

  return hasExAppealSignals(raw);
}

function isVintageExCreaseOnlyCandidate(
  categoryScores,
  scanQuality,
  raw,
  defects = []
) {
  const { corners, edges, centering, surface } = categoryScores;
  if (corners < 6 || centering < 7) {
    return false;
  }

  const surfaceCreaseCrushed =
    surface < 6 &&
    defects.some((defect) => defect.tag === "moderate_crease") &&
    corners >= 6 &&
    centering >= 7;
  if (surface < 6 && !surfaceCreaseCrushed) {
    return false;
  }

  const edgeScoreCrushedByOverTag =
    edges <= 5.5 && corners >= 6 && centering >= 7;
  if (!edgeScoreCrushedByOverTag && edges < 5.5) {
    return false;
  }
  if (hasDefinitiveHarshCreaseSignals(raw)) {
    return false;
  }
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return false;
  }

  return hasExAppealSignals(raw) || hasSoftExWearAppeal(raw);
}

function reconcileVintageExCreaseOverTag(defects, categoryScores, scanQuality, raw) {
  if (!defects.some((defect) => defect.tag === "moderate_crease")) {
    return { defects, categoryScores, reconciled: false };
  }
  if (defects.some((defect) => defect.tag === "severe_crease")) {
    return { defects, categoryScores, reconciled: false };
  }
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return { defects, categoryScores, reconciled: false };
  }

  const creaseCompanionPath =
    !hasDefinitiveHarshCreaseSignals(raw) &&
    hasExAppealSignals(raw) &&
    defects.some((defect) => defect.tag === "edge_fraying_major");

  const creaseOnlyPath = isVintageExCreaseOnlyCandidate(
    categoryScores,
    scanQuality,
    raw,
    defects
  );

  if (!creaseCompanionPath && !creaseOnlyPath) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "moderate_crease") {
      adjusted = true;
      return { ...defect, tag: "print_line", severity: "minor" };
    }
    if (creaseCompanionPath && defect.tag === "edge_fraying_major") {
      adjusted = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && categoryScores.corners >= 6) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(
        clampGrade(Math.max(categoryScores.edges, creaseCompanionPath ? 5 : 5.5))
      ),
      surface: roundToHalf(clampGrade(Math.max(categoryScores.surface, 6))),
    },
    reconciled: true,
  };
}

function shouldSkipCreaseInference(defects, categoryScores, scanQuality, raw) {
  if (hasHarshConditionSignals(raw)) return false;

  if (
    isStrongCenteringWearOverTagPattern(categoryScores, raw) &&
    !noteIndicatesStructuralCrease(raw)
  ) {
    return true;
  }

  if (
    isVintageExOverTagCandidate(categoryScores, scanQuality, raw) &&
    !noteIndicatesStructuralCrease(raw)
  ) {
    return true;
  }

  if (
    defects.some((defect) => defect.tag === "moderate_crease") &&
    defects.some((defect) => defect.tag === "edge_fraying_major") &&
    hasExAppealSignals(raw) &&
    (scanQuality.level === "good" || scanQuality.level === "excellent")
  ) {
    return true;
  }

  const { centering, surface } = categoryScores;
  if (centering < 7 || surface < 6) return false;
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return false;
  }

  const text = [
    collectAppealText(raw),
    ...(raw.scanQuality?.visibilityIssues || []),
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();

  return /\b(light edge|minor edge|light roughness|light wear|minor touch|clean presentation|clean surface)\b/.test(
    text
  );
}

function hasLightEdgeAppealLanguage(raw) {
  const text = [
    collectAppealText(raw),
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();

  return /\b(light edge|minor edge|slight edge|light edge wear|light wear on edges?|minor edge wear|light factory roughness|light roughness)\b/.test(
    text
  );
}

function hasSoftEdgeWearAppeal(raw) {
  const text = [
    collectAppealText(raw),
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(major edge|heavy edge|edge fraying|severe edge|heavy chipping|major chipping|heavy edge wear)\b/.test(
      text
    )
  ) {
    return false;
  }

  if (hasLightEdgeAppealLanguage(raw)) {
    return true;
  }

  if (
    /\b(light roughness|light factory roughness|minor edge|slight edge|light edge)\b/.test(
      text
    )
  ) {
    return true;
  }

  if (
    /\b(light|minor|slight|minimal)\b/.test(text) &&
    /\b(edge wear|edges?)\b/.test(text)
  ) {
    return true;
  }

  if (admitsDistributedWearAppeal(raw)) {
    return false;
  }

  return /\bedge wear\b/.test(text);
}

function hasSurfacePillarWear(defects) {
  return defects.some((defect) =>
    [
      "surface_scratch_light",
      "surface_scratch_moderate",
      "surface_wear",
      "heavy_staining",
      "wax_stain",
    ].includes(defect.tag)
  );
}

/**
 * Distributed VG/EX appeal with corner escalation but no surface pillar wear should not
 * invent major edge fraying from moderate edge_wear_light severity escalation in dedupe.
 */
function reconcileVintageDistributedEdgeOverFraying(defects, categoryScores, raw) {
  if (!admitsDistributedWearAppeal(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  const floor = Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );
  if (floor < 6 || floor > 7.5 || categoryScores.edges <= 5.5) {
    return { defects, categoryScores, reconciled: false };
  }

  if (hasSurfacePillarWear(defects)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (!defects.some((defect) => defect.tag === "edge_fraying_major")) {
    return { defects, categoryScores, reconciled: false };
  }

  const reconciled = defects.map((defect) => {
    if (defect.tag !== "edge_fraying_major") {
      return defect;
    }

    return { ...defect, tag: "edge_wear_light", severity: "minor" };
  });

  return { defects: reconciled, categoryScores, reconciled: true };
}

function reconcileVintageNmCenteredSlabProfile(
  defects,
  categoryScores,
  raw,
  scanQuality
) {
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, edges, surface, centering } = categoryScores;
  if (centering < 8 || corners < 6.5 || edges < 6.5 || surface < 6) {
    return { defects, categoryScores, reconciled: false };
  }

  if (hasTriadLightWearProfile(raw, defects)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (!isNmVintagePresentationCandidate(categoryScores, raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  if (
    defects.some((defect) =>
      [
        "edge_fraying_major",
        "moderate_crease",
        "severe_crease",
        "writing_mark",
        "writing_mark_severe",
        "surface_wear",
        "paper_loss",
      ].includes(defect.tag)
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const appeal = collectAppealText(raw);
  if (
    /\b(heavy wear|severe wear|poor condition|heavy crease|severe crease|paper loss)\b/.test(
      appeal
    )
  ) {
    return { defects, categoryScores, reconciled: false };
  }

  const allMinorWear = defects.every((defect) => {
    const definition = getDefectDefinition(defect.tag);
    return (
      LIGHT_WEAR_ONLY_TAGS.has(defect.tag) ||
      definition?.severityClass === "minor"
    );
  });
  if (!allMinorWear || !defects.length) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects,
    categoryScores: {
      ...categoryScores,
      corners: roundToHalf(clampGrade(Math.max(corners, 7.5))),
      edges: roundToHalf(clampGrade(Math.max(edges, 7.5))),
      surface: roundToHalf(clampGrade(Math.max(surface, 7.5))),
    },
    reconciled: true,
  };
}

function reconcileVintageLightWearOnlyNoFraying(defects, categoryScores) {
  if (!defects.length) {
    return { defects, categoryScores, reconciled: false };
  }

  const onlyLightWear = defects.every((defect) =>
    LIGHT_WEAR_ONLY_TAGS.has(defect.tag)
  );
  if (!onlyLightWear || categoryScores.edges <= 5.5) {
    return { defects, categoryScores, reconciled: false };
  }

  const floor = Math.min(
    categoryScores.corners,
    categoryScores.edges,
    categoryScores.surface
  );
  if (floor < 6) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag !== "edge_fraying_major") {
      return defect;
    }

    adjusted = true;
    return { ...defect, tag: "edge_wear_light", severity: "minor" };
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return { defects: reconciled, categoryScores, reconciled: true };
}

function reconcileVintageAppealEdgeOverTag(
  defects,
  categoryScores,
  scanQuality,
  raw
) {
  if (!defects.some((defect) => defect.tag === "edge_fraying_major")) {
    return { defects, categoryScores, reconciled: false };
  }

  const strongCenteringPath = isStrongCenteringWearOverTagPattern(
    categoryScores,
    raw
  );

  if (!hasSoftEdgeWearAppeal(raw) && !strongCenteringPath) {
    return { defects, categoryScores, reconciled: false };
  }
  if (hasHarshConditionSignals(raw) && !strongCenteringPath) {
    return { defects, categoryScores, reconciled: false };
  }
  if (strongCenteringPath && hasDefinitiveHarshEdgeInspectionSignals(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  const { corners, centering, surface } = categoryScores;
  if (corners < 6 || centering < 7 || surface < 5) {
    return { defects, categoryScores, reconciled: false };
  }
  if (scanQuality.level !== "good" && scanQuality.level !== "excellent") {
    return { defects, categoryScores, reconciled: false };
  }

  const appealText = collectAppealText(raw);
  const lightScratchAppeal =
    /\b(scratch|scratches|scuff|scuffs)\b/.test(appealText) &&
    !/\b(heavy|severe|deep|major)\s+(surface\s+)?(scratch|scratches|scuff|scuffs)\b/.test(
      appealText
    );

  const nmEdgeRecovery =
    (hasExAppealSignals(raw) &&
      categoryScores.centering >= 7 &&
      categoryScores.surface >= 6) ||
    (hasSoftEdgeWearAppeal(raw) &&
      !admitsDistributedWearAppeal(raw) &&
      categoryScores.centering >= 7.5 &&
      categoryScores.corners >= 6 &&
      categoryScores.surface >= 6) ||
    (strongCenteringPath &&
      categoryScores.centering >= 7 &&
      categoryScores.corners >= 6 &&
      categoryScores.surface >= 6);

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      adjusted = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (
      defect.tag === "surface_scratch_moderate" &&
      (lightScratchAppeal || nmEdgeRecovery)
    ) {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && nmEdgeRecovery) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  const strongCenteringRecoveryTarget =
    strongCenteringPath && categoryScores.centering < 7.5 ? 6 : 7;

  const adjustedScores = nmEdgeRecovery
    ? {
        ...categoryScores,
        edges: roundToHalf(
          clampGrade(
            Math.max(categoryScores.edges, strongCenteringRecoveryTarget)
          )
        ),
        corners: roundToHalf(
          clampGrade(
            Math.max(categoryScores.corners, strongCenteringRecoveryTarget)
          )
        ),
        surface: roundToHalf(
          clampGrade(
            Math.max(categoryScores.surface, strongCenteringRecoveryTarget)
          )
        ),
      }
    : {
        ...categoryScores,
        edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 6))),
        surface: roundToHalf(
          clampGrade(Math.max(categoryScores.surface, surface >= 6 ? surface : 6))
        ),
      };

  return {
    defects: reconciled,
    categoryScores: adjustedScores,
    reconciled: true,
  };
}

function reconcileVintageExLightWearEscalation(
  defects,
  categoryScores,
  scanQuality,
  raw
) {
  if (!isVintageExOverTagCandidate(categoryScores, scanQuality, raw)) {
    return { defects, categoryScores, reconciled: false };
  }
  if (!hasExAppealSignals(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      adjusted = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && categoryScores.corners >= 6) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (
      defect.tag === "surface_scratch_moderate" &&
      categoryScores.surface >= 6
    ) {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5))),
    },
    reconciled: true,
  };
}

function reconcileVintageExOverTags(defects, categoryScores, scanQuality, raw) {
  if (defects.some((defect) => EX_OVER_TAG_BLOCKERS.has(defect.tag))) {
    return { defects, categoryScores, reconciled: false };
  }

  if (!isVintageExOverTagCandidate(categoryScores, scanQuality, raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  const hasOverTag = defects.some((defect) => defect.tag === "edge_fraying_major");
  if (!hasOverTag) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      adjusted = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "moderate_crease") {
      adjusted = true;
      return { ...defect, tag: "print_line", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && categoryScores.corners >= 6) {
      adjusted = true;
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (defect.tag === "surface_scratch_moderate") {
      adjusted = true;
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    return defect;
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 5))),
      surface: roundToHalf(clampGrade(Math.max(categoryScores.surface, 5.5))),
    },
    reconciled: true,
  };
}

const CREASE_INFERENCE_BLOCKERS = new Set([
  "surface_wear",
  "moderate_crease",
  "severe_crease",
  "paper_loss",
  "hole_tear",
  "heavy_staining",
  "back_damage_severe",
]);

function inferHeavyWearCrease(defects, categoryScores, era, raw) {
  if (era !== "vintage") return defects;
  if (hasBackOnlyStaining(defects)) {
    const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
    const hasCreaseNote = /\b(crease|creasing|fold|bent)\b/.test(surfaceNote);
    const poorStructuralBand =
      categoryScores.edges <= 4 || categoryScores.surface <= 4;
    if (!hasCreaseNote && !poorStructuralBand) {
      return defects;
    }
  }
  if (shouldSkipCreaseInference(defects, categoryScores, raw.scanQuality, raw)) {
    return defects;
  }
  if (hasWearTag(defects, new Set(["moderate_crease", "severe_crease"]))) {
    return defects;
  }
  if (hasWearTag(defects, CREASE_INFERENCE_BLOCKERS)) {
    return defects;
  }

  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  const hasCreaseNote = /\b(crease|creasing|fold|bent)\b/.test(surfaceNote);
  const hasEdgeCompanion = defects.some((defect) =>
    ["edge_fraying_major", "edge_wear_light", "corner_wear_moderate"].includes(
      defect.tag
    )
  );
  if (
    hasCreaseNote &&
    (categoryScores.surface <= 6 || noteIndicatesStructuralCrease(raw)) &&
    hasEdgeCompanion
  ) {
    const severeCrease =
      categoryScores.edges <= 3.5 ||
      /\b(severe|heavy|deep|through)\b/.test(surfaceNote);
    return [
      ...defects,
      {
        tag: severeCrease ? "severe_crease" : "moderate_crease",
        severity: severeCrease ? "severe" : "moderate",
        location: "front",
        confidence: "medium",
      },
    ];
  }

  const { corners, edges, surface } = categoryScores;
  if (
    edges <= 4 &&
    corners <= 6 &&
    surface <= 6 &&
    hasWearTag(defects, new Set(["corner_wear_moderate", "rounded_corners_all"])) &&
    hasWearTag(defects, new Set(["edge_fraying_major"]))
  ) {
    return [
      ...defects,
      {
        tag: edges <= 3.5 ? "severe_crease" : "moderate_crease",
        severity: edges <= 3.5 ? "severe" : "moderate",
        location: "front",
        confidence: "medium",
      },
    ];
  }

  return defects;
}

const FRONT_MINOR_WEAR_TAGS = new Set([
  "corner_wear_light",
  "surface_scratch_light",
  "edge_wear_light",
  "print_line",
  "staining_light",
  "gloss_loss",
  "registration_issue",
]);

function frontDefectsAreMinorOnly(defects) {
  const frontDefects = defects.filter(
    (defect) => defect.location === "front" || defect.location === "both"
  );
  if (!frontDefects.length) return true;

  return frontDefects.every((defect) => {
    const definition = getDefectDefinition(defect.tag);
    return (
      FRONT_MINOR_WEAR_TAGS.has(defect.tag) || definition?.severityClass === "minor"
    );
  });
}

function inferBackWearAsWriting(defects, categoryScores, raw, era) {
  if (era !== "vintage") return defects;

  const { corners, centering, surface } = categoryScores;
  const backWearLimiting = isBackWearLimitingPattern(categoryScores, raw, defects);

  if (
    qualifiesForPsa810VisionCandidate(categoryScores, raw, defects) &&
    !hasInkOrWritingInspectionSignals(raw) &&
    !backWearLimiting
  ) {
    return defects.map((defect) => {
      if (defect.tag !== "back_wear" || defect.location !== "back") {
        return defect;
      }
      return { ...defect, tag: "staining_light", severity: "minor", location: "back" };
    });
  }

  const text = [
    raw.primaryLimiterLabel,
    raw.eyeAppealSummary,
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();
  const inkSignals =
    /\b(ink|written|writing|pen|pencil|scribble|marker|autograph|name written)\b/;

  if (!backWearLimiting && !inkSignals.test(text)) {
    return defects;
  }

  return defects.map((defect) => {
    if (defect.tag !== "back_wear" || defect.location !== "back") {
      return defect;
    }

    const severe =
      inkSignals.test(text) ||
      defect.severity === "severe" ||
      (backWearLimiting && defect.severity === "moderate");

    return {
      ...defect,
      tag: severe ? "writing_mark_severe" : "writing_mark",
      severity: severe ? "severe" : "moderate",
    };
  });
}

function reconcileVintageSourceLightWearEscalation(
  defects,
  categoryScores,
  visionAllLightWear,
  raw
) {
  if (!visionAllLightWear || admitsDistributedWearAppeal(raw)) {
    return { defects, categoryScores, reconciled: false };
  }

  let adjusted = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag !== "edge_fraying_major") {
      return defect;
    }

    adjusted = true;
    return { ...defect, tag: "edge_wear_light", severity: "minor" };
  });

  if (!adjusted) {
    return { defects, categoryScores, reconciled: false };
  }

  return {
    defects: reconciled,
    categoryScores: {
      ...categoryScores,
      edges: roundToHalf(clampGrade(Math.max(categoryScores.edges, 6))),
    },
    reconciled: true,
  };
}

function normalizeAnalysis(raw, era) {
  const visionAllLightWear =
    era === "vintage" &&
    (raw.defects || []).length > 0 &&
    (raw.defects || []).every((defect) =>
      LIGHT_WEAR_ONLY_TAGS.has(defect.tag)
    );

  let categoryScores = normalizeCategoryScores(raw.categoryScores);
  const writingReliefBandScores = { ...categoryScores };
  let categoryNotes = raw.categoryNotes || {};
  let highGradeVisionReconciled = false;
  let highGradeNmGemReconciled = false;
  let nmBandVisionReconciled = false;
  if (era === "vintage") {
    const exBandNotes = reconcileVintageExBandCategoryNotes(raw, categoryScores);
    if (exBandNotes.reconciled) {
      categoryNotes = exBandNotes.categoryNotes;
      raw = { ...raw, categoryNotes };
    }
    const nmBandVision = reconcileNmBandVisionOverTags(
      raw.defects || [],
      writingReliefBandScores,
      raw
    );
    if (nmBandVision.reconciled) {
      nmBandVisionReconciled = true;
      raw = { ...raw, defects: nmBandVision.defects };
    }
    const highGradeVision = reconcileHighGradeVisionOverTags(
      raw.defects || [],
      writingReliefBandScores,
      raw
    );
    if (highGradeVision.reconciled) {
      highGradeVisionReconciled = true;
      categoryScores = highGradeVision.categoryScores;
      raw = { ...raw, defects: highGradeVision.defects };
    }
  }
  const skipNmPoorBand =
    era === "vintage" &&
    qualifiesForNmPoorBandNotesSkip(writingReliefBandScores, raw);
  const poorBandNotes = skipNmPoorBand
    ? { categoryScores, reconciled: false }
    : reconcilePoorBandCategoryNotes(categoryScores, raw, era);
  categoryScores = poorBandNotes.categoryScores;

  let initialDefects = raw.defects || [];
  let nmReconciled = false;
  let backFoxingReconciled = false;
  let exFoxingWearReconciled = false;
  let exOverTagReconciled = false;
  let exCreaseOverTagReconciled = false;
  let exLightWearReconciled = false;
  let appealEdgeReconciled = false;
  let stainWritingReconciled = false;

  if (era === "vintage") {
    initialDefects = reconcileBackWritingSeverity(
      initialDefects,
      categoryScores,
      raw,
      era
    );
    const noteWriting = reconcileVintageNoteWritingOverTag(
      initialDefects,
      categoryScores,
      raw
    );
    initialDefects = noteWriting.defects;
    categoryScores = noteWriting.categoryScores;
    if (noteWriting.reconciled) {
      stainWritingReconciled = true;
    }
    initialDefects = inferHeavyWearCrease(initialDefects, categoryScores, era, raw);
    const exSurfaceWear = reconcileVintageExSurfaceWearOverTag(
      initialDefects,
      categoryScores,
      raw
    );
    initialDefects = exSurfaceWear.defects;
    categoryScores = exSurfaceWear.categoryScores;
    if (exSurfaceWear.reconciled) {
      exFoxingWearReconciled = true;
    }

    const foxing = reconcileBackFoxingStaining(initialDefects, categoryScores);
    initialDefects = foxing.defects;
    categoryScores = foxing.categoryScores;
    backFoxingReconciled = foxing.reconciled;
    if (backFoxingReconciled) {
      const exWear = reconcileVintageExFoxingWear(initialDefects, categoryScores);
      initialDefects = exWear.defects;
      categoryScores = exWear.categoryScores;
      exFoxingWearReconciled = exWear.reconciled;
    }
    const exOver = reconcileVintageExOverTags(
      initialDefects,
      categoryScores,
      raw.scanQuality,
      raw
    );
    initialDefects = exOver.defects;
    categoryScores = exOver.categoryScores;
    exOverTagReconciled = exOver.reconciled;
    const exCrease = reconcileVintageExCreaseOverTag(
      initialDefects,
      categoryScores,
      raw.scanQuality,
      raw
    );
    initialDefects = exCrease.defects;
    categoryScores = exCrease.categoryScores;
    exCreaseOverTagReconciled = exCrease.reconciled;
    const noteEdgeFraying = reconcileVintageNoteEdgeFrayingOverTag(
      initialDefects,
      categoryScores,
      raw.scanQuality,
      raw
    );
    initialDefects = noteEdgeFraying.defects;
    categoryScores = noteEdgeFraying.categoryScores;
    if (noteEdgeFraying.reconciled) {
      exOverTagReconciled = true;
    }
    const appealEdge = reconcileVintageAppealEdgeOverTag(
      initialDefects,
      categoryScores,
      raw.scanQuality,
      raw
    );
    initialDefects = appealEdge.defects;
    categoryScores = appealEdge.categoryScores;
    appealEdgeReconciled = appealEdge.reconciled;
    const vgWear = reconcileVintageVgLightWearUndertag(
      initialDefects,
      categoryScores,
      raw
    );
    initialDefects = vgWear.defects;
    categoryScores = vgWear.categoryScores;
    const reconciled = reconcileFairCardOverTags(
      initialDefects,
      categoryScores,
      raw
    );
    initialDefects = reconciled.defects;
    categoryScores = reconciled.categoryScores;
    nmReconciled = reconciled.reconciled;
  }

  initialDefects = inferBackWearAsWriting(initialDefects, categoryScores, raw, era);
  const backWriting = reconcileFalseBackWriting(initialDefects, categoryScores, raw);
  initialDefects = backWriting.defects;
  categoryScores = backWriting.categoryScores;
  stainWritingReconciled = stainWritingReconciled || backWriting.reconciled;
  if (backWriting.reconciled) {
    initialDefects = inferHeavyWearCrease(initialDefects, categoryScores, era, raw);
  }

  const dedupeOptions =
    nmReconciled ||
    exFoxingWearReconciled ||
    exOverTagReconciled ||
    exCreaseOverTagReconciled ||
    appealEdgeReconciled ||
    stainWritingReconciled ||
    highGradeVisionReconciled ||
    highGradeNmGemReconciled
      ? { skipEscalation: true }
      : {};

  const initialDeduped = dedupeDefects(initialDefects, categoryScores, era, {
    ...dedupeOptions,
    raw,
  });
  const structuralDeduped = dedupeDefects(
    inferStructuralDefects(initialDeduped, categoryScores, era, raw),
    categoryScores,
    era,
    { ...dedupeOptions, raw }
  );
  let postStructuralDefects = structuralDeduped;
  if (era === "vintage") {
    const highGradeFinal = reconcileHighGradeVisionOverTags(
      structuralDeduped,
      categoryScores,
      raw
    );
    if (highGradeFinal.reconciled) {
      highGradeVisionReconciled = true;
      categoryScores = highGradeFinal.categoryScores;
      postStructuralDefects = highGradeFinal.defects;
    }
    const nmGemCalibration = reconcileHighGradeNmGemVisionCalibration(
      postStructuralDefects,
      categoryScores,
      raw
    );
    if (nmGemCalibration.reconciled) {
      highGradeNmGemReconciled = true;
      highGradeVisionReconciled = true;
      categoryScores = nmGemCalibration.categoryScores;
      postStructuralDefects = nmGemCalibration.defects;
    }
  }
  const exLightWear = reconcileVintageExLightWearEscalation(
    postStructuralDefects,
    categoryScores,
    raw.scanQuality,
    raw
  );
  let enrichedDefects = exLightWear.defects;
  categoryScores = exLightWear.categoryScores;
  exLightWearReconciled = exLightWear.reconciled;

  const appealEdgeFinal = reconcileVintageAppealEdgeOverTag(
    enrichedDefects,
    categoryScores,
    raw.scanQuality,
    raw
  );
  enrichedDefects = appealEdgeFinal.defects;
  categoryScores = appealEdgeFinal.categoryScores;
  if (appealEdgeFinal.reconciled) {
    appealEdgeReconciled = true;
  }

  const distributedEdge = reconcileVintageDistributedEdgeOverFraying(
    enrichedDefects,
    categoryScores,
    raw
  );
  enrichedDefects = distributedEdge.defects;
  categoryScores = distributedEdge.categoryScores;
  if (distributedEdge.reconciled) {
    appealEdgeReconciled = true;
  }

  const nmSlab = reconcileVintageNmCenteredSlabProfile(
    enrichedDefects,
    categoryScores,
    raw,
    raw.scanQuality
  );
  enrichedDefects = nmSlab.defects;
  categoryScores = nmSlab.categoryScores;
  if (nmSlab.reconciled) {
    appealEdgeReconciled = true;
  }

  const lightWearOnly = reconcileVintageLightWearOnlyNoFraying(
    enrichedDefects,
    categoryScores
  );
  enrichedDefects = lightWearOnly.defects;
  categoryScores = lightWearOnly.categoryScores;
  if (lightWearOnly.reconciled) {
    appealEdgeReconciled = true;
  }

  const noteWritingFinal = reconcileVintageNoteWritingOverTag(
    enrichedDefects,
    categoryScores,
    raw
  );
  enrichedDefects = noteWritingFinal.defects;
  categoryScores = noteWritingFinal.categoryScores;
  if (noteWritingFinal.reconciled) {
    stainWritingReconciled = true;
  }

  const finalDedupeOptions =
    nmReconciled ||
    exFoxingWearReconciled ||
    exOverTagReconciled ||
    exCreaseOverTagReconciled ||
    appealEdgeReconciled ||
    exLightWearReconciled ||
    stainWritingReconciled ||
    highGradeVisionReconciled ||
    highGradeNmGemReconciled
      ? { skipEscalation: true }
      : {};
  const suppressVisionReconciledPrimary =
    (highGradeVisionReconciled ||
      highGradeNmGemReconciled ||
      nmBandVisionReconciled ||
      stainWritingReconciled) &&
    primaryLimiterWasVisionReconciled(raw, enrichedDefects);
  const requestedPrimaryLimiterTag = suppressVisionReconciledPrimary
    ? null
    : stainWritingReconciled &&
        (raw.primaryLimiterTag === "writing_mark" ||
          raw.primaryLimiterTag === "writing_mark_severe")
      ? null
      : (nmReconciled || appealEdgeReconciled) &&
          (raw.primaryLimiterTag === "edge_fraying_major" ||
            raw.primaryLimiterTag === "heavy_staining")
        ? null
        : (backFoxingReconciled ||
            exFoxingWearReconciled ||
            nmBandVisionReconciled ||
            exOverTagReconciled ||
            exCreaseOverTagReconciled ||
            appealEdgeReconciled) &&
            (raw.primaryLimiterTag === "heavy_staining" ||
              raw.primaryLimiterTag === "edge_fraying_major" ||
              raw.primaryLimiterTag === "moderate_crease" ||
              raw.primaryLimiterTag === "surface_wear")
          ? null
          : initialDefects.some((defect) =>
              defect.tag === "writing_mark_severe" || defect.tag === "writing_mark"
            ) && raw.primaryLimiterTag === "back_wear"
          ? null
          : raw.primaryLimiterTag;
  const limiter = resolvePrimaryLimiter(
    ensurePrimaryLimiterDefect(enrichedDefects, requestedPrimaryLimiterTag),
    era,
    requestedPrimaryLimiterTag,
    raw.primaryLimiterLabel
  );
  const enforcedLimiterTag =
    suppressVisionReconciledPrimary ||
    (stainWritingReconciled &&
      ["writing_mark", "writing_mark_severe"].includes(limiter.primaryLimiterTag) &&
      !enrichedDefects.some((defect) => defect.tag === limiter.primaryLimiterTag))
      ? null
      : limiter.primaryLimiterTag;
  let defects = dedupeDefects(
    ensurePrimaryLimiterDefect(enrichedDefects, enforcedLimiterTag),
    categoryScores,
    era,
    { ...finalDedupeOptions, raw }
  );

  let finalLimiter = limiter;

  const visionEdgeGuard = reconcileVisionEdgeWearLightFrayingGuard(
    defects,
    categoryScores,
    raw,
    raw.scanQuality || { level: "good" }
  );
  defects = visionEdgeGuard.defects;
  categoryScores = visionEdgeGuard.categoryScores;
  const visionEdgeGuardActive = qualifiesForVisionEdgeWearLightFrayingGuard(
    raw,
    categoryScores,
    defects,
    raw.scanQuality || { level: "good" }
  );
  if (visionEdgeGuard.reconciled || visionEdgeGuardActive) {
    appealEdgeReconciled = true;
    if (
      !defects.some((defect) =>
        ["moderate_crease", "severe_crease"].includes(defect.tag)
      )
    ) {
      categoryScores = {
        ...categoryScores,
        edges: roundToHalf(
          clampGrade(Math.max(categoryScores.edges, writingReliefBandScores.edges))
        ),
        surface: roundToHalf(
          clampGrade(Math.max(categoryScores.surface, writingReliefBandScores.surface))
        ),
      };
    }
    finalLimiter = resolvePrimaryLimiter(
      defects,
      era,
      requestedPrimaryLimiterTag,
      raw.primaryLimiterLabel
    );
  }

  const sourceLightWear = reconcileVintageSourceLightWearEscalation(
    defects,
    categoryScores,
    visionAllLightWear,
    raw
  );
  defects = sourceLightWear.defects;
  categoryScores = sourceLightWear.categoryScores;
  if (sourceLightWear.reconciled) {
    appealEdgeReconciled = true;
    finalLimiter = resolvePrimaryLimiter(
      defects,
      era,
      requestedPrimaryLimiterTag,
      raw.primaryLimiterLabel
    );
    defects = dedupeDefects(
      ensurePrimaryLimiterDefect(defects, finalLimiter.primaryLimiterTag),
      categoryScores,
      era,
      { ...finalDedupeOptions, raw, skipEscalation: true }
    );
  }

  const triadProfile =
    era === "vintage" &&
    visionAllLightWear &&
    countNotesPillarsWithWear(raw) >= 3 &&
    !qualifiesForHighGradeTriadSkip(categoryScores, raw, defects);
  const triadClamp = reconcileTriadLightWearProfile(
    categoryScores,
    defects,
    triadProfile
  );
  if (triadClamp.reconciled) {
    categoryScores = triadClamp.categoryScores;
    defects = triadClamp.defects;
    finalLimiter = resolvePrimaryLimiter(
      defects,
      era,
      "surface_scratch_light",
      raw.primaryLimiterLabel
    );
    defects = dedupeDefects(
      ensurePrimaryLimiterDefect(defects, finalLimiter.primaryLimiterTag),
      categoryScores,
      era,
      { skipEscalation: true, raw }
    );
  }

  if (era === "vintage") {
    const nmGemFinal = reconcileHighGradeNmGemVisionCalibration(
      defects,
      categoryScores,
      raw
    );
    if (nmGemFinal.reconciled) {
      highGradeNmGemReconciled = true;
      categoryScores = nmGemFinal.categoryScores;
      defects = nmGemFinal.defects;
      finalLimiter = resolvePrimaryLimiter(
        defects,
        era,
        suppressVisionReconciledPrimary ? null : raw.primaryLimiterTag,
        raw.primaryLimiterLabel
      );
      defects = dedupeDefects(
        ensurePrimaryLimiterDefect(defects, finalLimiter.primaryLimiterTag),
        categoryScores,
        era,
        { skipEscalation: true, raw }
      );
    }
  }

  let visionReconciliationAudit = [];
  const reflectiveScratch = reconcileModernReflectiveScratchArtifacts(defects, raw, era);
  if (reflectiveScratch.reconciled) {
    defects = reflectiveScratch.defects;
    visionReconciliationAudit = reflectiveScratch.audit;
    finalLimiter = resolvePrimaryLimiter(
      defects,
      era,
      raw.primaryLimiterTag === "surface_scratch_light" ? null : raw.primaryLimiterTag,
      raw.primaryLimiterLabel
    );
    defects = dedupeDefects(
      ensurePrimaryLimiterDefect(defects, finalLimiter.primaryLimiterTag, raw),
      categoryScores,
      era,
      { skipEscalation: true, raw }
    );
  }

  ({ defects, finalLimiter } = finalizeSurfaceScratchAndLimiter(
    defects,
    categoryScores,
    era,
    raw,
    finalLimiter
  ));

  const handlingWearPillars = reconcileModernHandlingWearPillarScores(
    categoryScores,
    raw,
    era,
    defects
  );
  if (handlingWearPillars.reconciled) {
    categoryScores = handlingWearPillars.categoryScores;
  }

  const cleanNotePillars = reconcileModernCleanNotePillarScores(
    categoryScores,
    raw,
    era,
    defects
  );
  if (cleanNotePillars.reconciled) {
    categoryScores = cleanNotePillars.categoryScores;
    visionReconciliationAudit = [
      ...visionReconciliationAudit,
      ...cleanNotePillars.audit,
    ];
  }

  return {
    scanQuality: {
      level: raw.scanQuality.level,
      visibilityIssues: raw.scanQuality.visibilityIssues || [],
      inspectionLimits: raw.scanQuality.inspectionLimits || [],
    },
    categoryScores,
    writingReliefBandScores,
    defects,
    primaryLimiterTag: finalLimiter.primaryLimiterTag,
    primaryLimiterLabel: finalLimiter.primaryLimiterLabel,
    bestAttribute: raw.bestAttribute,
    eyeAppealSummary: raw.eyeAppealSummary,
    cardMeta: raw.cardMeta,
    categoryNotes,
    visionReconciliationAudit,
  };
}

/**
 * @param {import("openai").default} client
 * @param {{ frontImage: string, backImage: string, era: import("./types.js").Era }} params
 */
export async function analyzeCard(client, { frontImage, backImage, era }) {
  const pathRubric = era === "vintage" ? VINTAGE_RUBRIC : MODERN_RUBRIC;
  const instruction = buildAnalysisInstruction({
    philosophy: era === "modern" ? MODERN_GRADING_PHILOSOPHY : GRADING_PHILOSOPHY,
    pathRubric,
  });

  const raw = await callStructuredVision(client, {
    schema: ANALYSIS_JSON_SCHEMA,
    instruction,
    frontImage,
    backImage,
  });

  return normalizeAnalysis(raw, era);
}

export async function detectEraFromImages(client, { frontImage, backImage }) {
  const instruction = `
${GRADING_PHILOSOPHY}

Estimate the card production era from visible design cues, copyright/year print, set branding, stock type, and card construction.
Return estimatedYear as a 4-digit year when possible, otherwise null.
`.trim();

  return callStructuredVision(client, {
    schema: ERA_JSON_SCHEMA,
    instruction,
    frontImage,
    backImage,
  });
}

export { callStructuredVision, normalizeAnalysis, parseJsonResponse, reconcileFairCardOverTags };
