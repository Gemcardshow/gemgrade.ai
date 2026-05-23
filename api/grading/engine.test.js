import test from "node:test";
import assert from "node:assert/strict";
import { computeGrade } from "../grading/engine.js";
import {
  applyCompoundHarshness,
  applyPsa1Calibration,
  triggersPsa1Calibration,
} from "../grading/psa-calibration.js";
import { resolveEra, eraFromYear, normalizeEraRequest } from "../grading/era.js";
import { snapToPsaGrade, formatLikelyRange } from "../grading/types.js";

function baseAnalysis(overrides = {}) {
  return {
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    categoryScores: {
      corners: 8,
      edges: 8,
      surface: 8,
      centering: 9,
    },
    defects: [],
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "Light corner touch",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Clean presentation",
    cardMeta: {
      estimatedYear: 1987,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Minor touch",
      edges: "Clean",
      surface: "Clean",
      centering: "Well centered",
    },
    ...overrides,
  };
}

test("PSA 1 case: severe crease plus second severe defect caps at PSA 1", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 3, edges: 3, surface: 2.5, centering: 6 },
    defects: [
      {
        tag: "severe_crease",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "paper_loss",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "paper_loss",
    primaryLimiterLabel: "Paper loss on front",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 2.0);
  assert.ok(result.psaGrade <= 2);
});

test("PSA 1 case: paper loss alone stays in poor band", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 4, edges: 4, surface: 2, centering: 6 },
    defects: [
      {
        tag: "paper_loss",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "paper_loss",
  });

  const result = computeGrade(analysis, "vintage");
  assert.equal(result.psaGrade, 1);
  assert.ok(result.internalGrade <= 2.0);
});

test("PSA 2-3 case: moderate crease does not exceed vintage cap", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 5, edges: 5, surface: 3.5, centering: 7 },
    defects: [
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "moderate_crease",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 3.0);
  assert.ok(result.psaGrade <= 3);
});

test("modern clean card can reach PSA 9-10", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 10, edges: 10, surface: 10, centering: 10 },
    defects: [],
    primaryLimiterTag: "corner_wear_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: false, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.equal(result.internalGrade, 10);
  assert.equal(result.psaGrade, 10);
});

test("overall grade follows lowest severe category", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 7, edges: 6.5, surface: 3, centering: 9 },
    defects: [
      {
        tag: "surface_wear",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_wear",
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 3);
});

test("poor scan applies hard ceiling", () => {
  const analysis = baseAnalysis({
    scanQuality: { level: "poor", visibilityIssues: ["Low resolution"], inspectionLimits: [] },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 6.0);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "scanQuality" && entry.cap === 6.0)
  );
});

test("centering limits gem eligibility without driving poor grades", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 2, edges: 2, surface: 2, centering: 7 },
    defects: [
      {
        tag: "severe_crease",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "severe_crease",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 2.5);
});

test("compound harshness triggers with three severe defects", () => {
  const capAudit = [];
  const defects = [
    { tag: "severe_crease", severity: "severe", location: "front", confidence: "high" },
    { tag: "paper_loss", severity: "severe", location: "front", confidence: "high" },
    { tag: "hole_tear", severity: "severe", location: "back", confidence: "high" },
  ];

  assert.equal(triggersPsa1Calibration(defects), true);

  let overall = 4;
  overall = applyCompoundHarshness(overall, defects, "vintage", capAudit);
  overall = applyPsa1Calibration(overall, defects, capAudit);

  assert.ok(overall <= 1.5);
});

test("era override bypasses detection", async () => {
  const fakeClient = {};
  const vintage = await resolveEra(fakeClient, {
    frontImage: "front",
    backImage: "back",
    eraRequest: "vintage",
  });

  assert.equal(vintage.era, "vintage");
  assert.equal(vintage.eraSource, "override");
});

test("eraFromYear uses 1990 cutoff", () => {
  assert.equal(eraFromYear(1989), "vintage");
  assert.equal(eraFromYear(1990), "modern");
});

test("normalizeEraRequest defaults invalid values to auto", () => {
  assert.equal(normalizeEraRequest(undefined), "auto");
  assert.equal(normalizeEraRequest("invalid"), "auto");
});

test("PSA snap uses floor for harsh output", () => {
  assert.equal(snapToPsaGrade(2.5), 2);
  assert.equal(formatLikelyRange(2.5), "PSA 2–3");
});

test("cap audit records defect and overall derivation", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 2, edges: 2, surface: 2, centering: 5 },
    defects: [
      {
        tag: "severe_crease",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "severe_crease",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.capAudit.some((entry) => entry.source === "defect:severe_crease"));
  assert.ok(result.capAudit.some((entry) => entry.source === "overall_derivation"));
});
