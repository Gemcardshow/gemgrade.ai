import { GRADING_PHILOSOPHY } from "./philosophy.js";
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

function normalizeAnalysis(raw) {
  return {
    scanQuality: {
      level: raw.scanQuality.level,
      visibilityIssues: raw.scanQuality.visibilityIssues || [],
      inspectionLimits: raw.scanQuality.inspectionLimits || [],
    },
    categoryScores: normalizeCategoryScores(raw.categoryScores),
    defects: raw.defects || [],
    primaryLimiterTag: raw.primaryLimiterTag,
    primaryLimiterLabel: raw.primaryLimiterLabel,
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

  return normalizeAnalysis(raw);
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
