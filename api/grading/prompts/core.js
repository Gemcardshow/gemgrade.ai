import { DEFECT_TAGS } from "../defects.js";

export const ANALYSIS_JSON_SCHEMA = {
  name: "card_condition_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scanQuality: {
        type: "object",
        additionalProperties: false,
        properties: {
          level: { type: "string", enum: ["excellent", "good", "fair", "poor"] },
          visibilityIssues: { type: "array", items: { type: "string" } },
          inspectionLimits: { type: "array", items: { type: "string" } },
        },
        required: ["level", "visibilityIssues", "inspectionLimits"],
      },
      categoryScores: {
        type: "object",
        additionalProperties: false,
        properties: {
          corners: { type: "number" },
          edges: { type: "number" },
          surface: { type: "number" },
          centering: { type: "number" },
        },
        required: ["corners", "edges", "surface", "centering"],
      },
      defects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            tag: { type: "string", enum: DEFECT_TAGS },
            severity: { type: "string", enum: ["minor", "moderate", "severe"] },
            location: { type: "string", enum: ["front", "back", "both"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["tag", "severity", "location", "confidence"],
        },
      },
      primaryLimiterTag: { type: "string", enum: DEFECT_TAGS },
      primaryLimiterLabel: { type: "string" },
      bestAttribute: { type: "string" },
      eyeAppealSummary: { type: "string" },
      cardMeta: {
        type: "object",
        additionalProperties: false,
        properties: {
          estimatedYear: { type: ["number", "null"] },
          isReflective: { type: "boolean" },
          isDarkBorder: { type: "boolean" },
        },
        required: ["estimatedYear", "isReflective", "isDarkBorder"],
      },
      categoryNotes: {
        type: "object",
        additionalProperties: false,
        properties: {
          corners: { type: "string" },
          edges: { type: "string" },
          surface: { type: "string" },
          centering: { type: "string" },
        },
        required: ["corners", "edges", "surface", "centering"],
      },
    },
    required: [
      "scanQuality",
      "categoryScores",
      "defects",
      "primaryLimiterTag",
      "primaryLimiterLabel",
      "bestAttribute",
      "eyeAppealSummary",
      "cardMeta",
      "categoryNotes",
    ],
  },
};

export const ERA_JSON_SCHEMA = {
  name: "card_era_detection",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      estimatedYear: { type: ["number", "null"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      signals: { type: "array", items: { type: "string" } },
    },
    required: ["estimatedYear", "confidence", "signals"],
  },
};

export function buildAnalysisInstruction({ philosophy, pathRubric }) {
  return `
${philosophy}

${pathRubric}

DEFECT DETECTION REQUIREMENTS:
- Inspect front and back independently.
- Tag every visible flaw using the allowed defect enum.
- Use severe_crease for heavy visible creasing; moderate_crease for lighter creases.
- Use paper_loss, hole_tear, writing_mark, or writing_mark_severe when visible.
- Use back_damage_severe or back_wear for back-specific issues.
- Tag corner, edge, surface, staining, and print issues separately when present.
- Set defect severity to match visible damage, not eye appeal.
- Set primaryLimiterTag to the single most severe detected defect tag.
- If a flaw limits the card, it must appear in the defects array.

Return structured JSON only.
Use 0.5 increments from 1.0 to 10.0 for categoryScores.
Use only defect tags from the allowed enum.
Do not output an overall grade.
`.trim();
}
