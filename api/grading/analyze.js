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

function isFairCardPattern(categoryScores) {
  const { corners, surface, centering } = categoryScores;
  return corners >= 6 && surface >= 6 && centering >= 7;
}

function reconcileFairCardOverTags(defects, categoryScores) {
  if (!isFairCardPattern(categoryScores)) {
    return { defects, categoryScores, edgeDowngraded: false };
  }

  let edgeDowngraded = false;
  const reconciled = defects.map((defect) => {
    if (defect.tag === "edge_fraying_major") {
      edgeDowngraded = true;
      return { ...defect, tag: "edge_wear_light", severity: "minor" };
    }
    if (defect.tag === "corner_wear_moderate" && categoryScores.corners >= 6) {
      return { ...defect, tag: "corner_wear_light", severity: "minor" };
    }
    if (defect.tag === "surface_scratch_moderate" && categoryScores.surface >= 6) {
      return { ...defect, tag: "surface_scratch_light", severity: "minor" };
    }
    return defect;
  });

  if (!edgeDowngraded) {
    return { defects: reconciled, categoryScores, edgeDowngraded: false };
  }

  const nmTargets =
    categoryScores.centering >= 8
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
    edgeDowngraded: true,
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

function dedupeDefects(defects, categoryScores, era, options = {}) {
  const seen = new Set();
  const deduped = [];

  for (const defect of defects) {
    const normalized =
      era === "vintage" && !options.skipEscalation
        ? escalateLightWearObservation(defect, categoryScores)
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

function inferStructuralDefects(defects, categoryScores, era) {
  if (era !== "vintage") return defects;

  const inferred = [...defects];
  const fairCard = isFairCardPattern(categoryScores);
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
    !hasWearTag(inferred, SURFACE_WEAR_TAGS)
  ) {
    addDefect("surface_wear", "severe");
  } else if (
    categoryScores.surface <= 4.5 &&
    hasWearTag(inferred, new Set(["surface_scratch_moderate", "surface_scratch_light"]))
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
    !hasWearTag(inferred, EDGE_WEAR_TAGS)
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

function normalizeAnalysis(raw, era) {
  let categoryScores = normalizeCategoryScores(raw.categoryScores);
  let initialDefects = raw.defects || [];
  let edgeDowngraded = false;

  if (era === "vintage") {
    const reconciled = reconcileFairCardOverTags(initialDefects, categoryScores);
    initialDefects = reconciled.defects;
    categoryScores = reconciled.categoryScores;
    edgeDowngraded = reconciled.edgeDowngraded;
  }

  const dedupeOptions = edgeDowngraded ? { skipEscalation: true } : {};

  const initialDeduped = dedupeDefects(initialDefects, categoryScores, era, dedupeOptions);
  const enrichedDefects = dedupeDefects(
    inferStructuralDefects(initialDeduped, categoryScores, era),
    categoryScores,
    era,
    dedupeOptions
  );
  const requestedPrimaryLimiterTag =
    edgeDowngraded && raw.primaryLimiterTag === "edge_fraying_major"
      ? null
      : raw.primaryLimiterTag;
  const limiter = resolvePrimaryLimiter(
    ensurePrimaryLimiterDefect(enrichedDefects, requestedPrimaryLimiterTag),
    era,
    requestedPrimaryLimiterTag,
    raw.primaryLimiterLabel
  );
  const defects = dedupeDefects(
    ensurePrimaryLimiterDefect(enrichedDefects, limiter.primaryLimiterTag),
    categoryScores,
    era,
    dedupeOptions
  );

  return {
    scanQuality: {
      level: raw.scanQuality.level,
      visibilityIssues: raw.scanQuality.visibilityIssues || [],
      inspectionLimits: raw.scanQuality.inspectionLimits || [],
    },
    categoryScores,
    defects,
    primaryLimiterTag: limiter.primaryLimiterTag,
    primaryLimiterLabel: limiter.primaryLimiterLabel,
    bestAttribute: raw.bestAttribute,
    eyeAppealSummary: raw.eyeAppealSummary,
    cardMeta: raw.cardMeta,
    categoryNotes: raw.categoryNotes,
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
