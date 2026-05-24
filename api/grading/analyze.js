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

function normalizeCategoryScores(categoryScores) {
  return {
    corners: roundToHalf(clampGrade(categoryScores.corners)),
    edges: roundToHalf(clampGrade(categoryScores.edges)),
    surface: roundToHalf(clampGrade(categoryScores.surface)),
    centering: roundToHalf(clampGrade(categoryScores.centering)),
  };
}

function dedupeDefects(defects, categoryScores, era) {
  const seen = new Set();
  const deduped = [];

  for (const defect of defects) {
    const normalized =
      era === "vintage"
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

  if (categoryScores.corners <= 6 && !hasWearTag(inferred, CORNER_WEAR_TAGS)) {
    addDefect(
      categoryScores.corners <= 5.5 ? "rounded_corners_all" : "corner_wear_moderate",
      "moderate"
    );
  }

  if (categoryScores.edges <= 6.5 && !hasWearTag(inferred, EDGE_WEAR_TAGS)) {
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
  const categoryScores = normalizeCategoryScores(raw.categoryScores);
  const initialDefects = dedupeDefects(raw.defects || [], categoryScores, era);
  const enrichedDefects = dedupeDefects(
    inferStructuralDefects(initialDefects, categoryScores, era),
    categoryScores,
    era
  );
  const limiter = resolvePrimaryLimiter(
    ensurePrimaryLimiterDefect(enrichedDefects, raw.primaryLimiterTag),
    era,
    raw.primaryLimiterTag,
    raw.primaryLimiterLabel
  );
  const defects = dedupeDefects(
    ensurePrimaryLimiterDefect(enrichedDefects, limiter.primaryLimiterTag),
    categoryScores,
    era
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

export { callStructuredVision, normalizeAnalysis, parseJsonResponse };
