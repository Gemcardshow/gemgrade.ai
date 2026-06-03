import { GRADING_PHILOSOPHY } from "./philosophy.js";
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
  return (
    /\b(moderate wear|heavy wear|severe wear|heavy round|limits grade|reduces|affecting)\b/.test(
      normalized
    ) ||
    (/\bmoderate\b/.test(normalized) && /\bwear\b/.test(normalized)) ||
    (/\b(heavy|severe)\b/.test(normalized) &&
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

function hasAffirmativeMajorEdgeWearNote(raw) {
  const edgesNote = String(raw.categoryNotes?.edges || "").toLowerCase();
  if (!edgesNote || edgeNoteDeniesMajorFraying(raw)) {
    return false;
  }

  const withoutNegations = edgesNote.replace(
    /\b(no|not|without)\s+(severe|major|heavy)[^.]*/g,
    ""
  );

  if (
    /\b(major|heavy|severe)\s+(fray(?:ing)?|chipping|edge wear|edge)\b/.test(
      withoutNegations
    )
  ) {
    return true;
  }

  if (
    /\b(fray(?:ing)?|chipping)\b/.test(withoutNegations) &&
    !/\b(minor|light|slight)\b/.test(withoutNegations)
  ) {
    return true;
  }

  return false;
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
        !hasSoftEdgeWearAppeal(raw);
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

function ensurePrimaryLimiterDefect(defects, primaryLimiterTag) {
  if (!primaryLimiterTag) return defects;
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
      primaryLimiterTag: primaryLimiterTag || "corner_wear_light",
      primaryLimiterLabel: primaryLimiterLabel || "Visible wear",
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

  if (categoryScores.surface <= 5 && hasWearTag(inferred, new Set(["back_wear"]))) {
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
  if (corners < 6 || edges < 6 || centering < 7) {
    return { defects, categoryScores, reconciled: false };
  }

  const surfaceNote = String(raw.categoryNotes?.surface || "").toLowerCase();
  const appeal = collectAppealText(raw);
  const lightSurfaceLanguage =
    /\b(minor|light|small|slight|few)\b/.test(surfaceNote) &&
    !/\b(heavy|severe|major|extensive)\b/.test(surfaceNote + " " + appeal);
  const strongAppeal =
    /\b(vibrant|presents well|minimal wear|strong color|clean surface)\b/.test(
      appeal
    );

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
      surface: roundToHalf(clampGrade(Math.max(surface, 6))),
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
  if (
    categoryScores.centering < 7 ||
    (!hasLightEdgeCategoryNote(raw) && !edgeNoteDeniesMajorFraying(raw))
  ) {
    return { defects, categoryScores, reconciled: false };
  }
  if (
    hasDefinitiveHarshEdgeInspectionSignals(raw) &&
    hasAffirmativeMajorEdgeWearNote(raw)
  ) {
    return { defects, categoryScores, reconciled: false };
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
  return /\b(clean appearance|clean overall|clean presentation|clean front|clean surface|visually appealing|appealing surface|aside from minor wear)\b/.test(
    appealText
  );
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
    collectHarshConditionText(raw)
  );
}

function hasStainAppealSignals(raw) {
  return /\b(stain|staining|foxing|toning|discoloration|yellowing|spotting)\b/.test(
    collectAppealText(raw)
  );
}

export function isNmVintageStainPresentation(categoryScores, raw) {
  const { corners, edges, centering } = categoryScores;
  if (centering < 7 || corners < 6 || edges < 6) {
    return false;
  }
  if (hasInkOrWritingInspectionSignals(raw)) {
    return false;
  }

  return hasStainAppealSignals(raw);
}

export function isNmVintageCleanPresentation(categoryScores, raw) {
  const { corners, edges, centering } = categoryScores;
  if (centering < 7 || corners < 6 || edges < 6) {
    return false;
  }
  if (hasInkOrWritingInspectionSignals(raw)) {
    return false;
  }

  const appeal = collectAppealText(raw);
  return (
    hasCleanPresentationAppeal(raw) &&
    /\b(strong centering|solid centering|well centered|centering helps)\b/.test(
      appeal
    )
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
      surface: roundToHalf(
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

  if (isStrongCenteringWearOverTagPattern(categoryScores, raw)) {
    return true;
  }

  if (isVintageExOverTagCandidate(categoryScores, scanQuality, raw)) {
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
  if (hasBackOnlyStaining(defects)) return defects;
  if (shouldSkipCreaseInference(defects, categoryScores, raw.scanQuality, raw)) {
    return defects;
  }
  if (hasWearTag(defects, new Set(["moderate_crease", "severe_crease"]))) {
    return defects;
  }
  if (hasWearTag(defects, CREASE_INFERENCE_BLOCKERS)) {
    return defects;
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

  const text = [
    raw.primaryLimiterLabel,
    raw.eyeAppealSummary,
    ...Object.values(raw.categoryNotes || {}),
  ]
    .join(" ")
    .toLowerCase();
  const inkSignals =
    /\b(ink|written|writing|pen|pencil|scribble|marker|autograph|name written)\b/;

  const { corners, centering, surface } = categoryScores;
  const backWearLimiting =
    raw.primaryLimiterTag === "back_wear" &&
    corners >= 6 &&
    centering >= 7 &&
    surface <= 6.5 &&
    frontDefectsAreMinorOnly(defects) &&
    defects.some((defect) => defect.tag === "back_wear" && defect.location === "back");

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
  if (era === "vintage") {
    const exBandNotes = reconcileVintageExBandCategoryNotes(raw, categoryScores);
    if (exBandNotes.reconciled) {
      categoryNotes = exBandNotes.categoryNotes;
      raw = { ...raw, categoryNotes };
    }
  }
  const poorBandNotes = reconcilePoorBandCategoryNotes(
    categoryScores,
    raw,
    era
  );
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

  const dedupeOptions =
    nmReconciled ||
    exFoxingWearReconciled ||
    exOverTagReconciled ||
    exCreaseOverTagReconciled ||
    appealEdgeReconciled ||
    stainWritingReconciled
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
  const exLightWear = reconcileVintageExLightWearEscalation(
    structuralDeduped,
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
    stainWritingReconciled
      ? { skipEscalation: true }
      : {};
  const requestedPrimaryLimiterTag =
    stainWritingReconciled &&
    (raw.primaryLimiterTag === "writing_mark" ||
      raw.primaryLimiterTag === "writing_mark_severe")
      ? null
      : (nmReconciled || appealEdgeReconciled) &&
          (raw.primaryLimiterTag === "edge_fraying_major" ||
            raw.primaryLimiterTag === "heavy_staining")
        ? null
        : (backFoxingReconciled ||
            exFoxingWearReconciled ||
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
    stainWritingReconciled &&
    ["writing_mark", "writing_mark_severe"].includes(limiter.primaryLimiterTag)
      ? null
      : limiter.primaryLimiterTag;
  let defects = dedupeDefects(
    ensurePrimaryLimiterDefect(enrichedDefects, enforcedLimiterTag),
    categoryScores,
    era,
    { ...finalDedupeOptions, raw }
  );

  const sourceLightWear = reconcileVintageSourceLightWearEscalation(
    defects,
    categoryScores,
    visionAllLightWear,
    raw
  );
  defects = sourceLightWear.defects;
  categoryScores = sourceLightWear.categoryScores;
  let finalLimiter = limiter;
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
    era === "vintage" && visionAllLightWear && countNotesPillarsWithWear(raw) >= 3;
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
  };
}

/**
 * @param {import("openai").default} client
 * @param {{ frontImage: string, backImage: string, era: import("./types.js").Era }} params
 */
export async function analyzeCard(client, { frontImage, backImage, era }) {
  const pathRubric = era === "vintage" ? VINTAGE_RUBRIC : MODERN_RUBRIC;
  const instruction = buildAnalysisInstruction({
    philosophy: GRADING_PHILOSOPHY,
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
