import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeGrade } from "./engine.js";
import { normalizeAnalysis } from "./analyze.js";
import {
  applyCompoundHarshness,
  applyNmGemVintageBandRules,
  applyPsa1Calibration,
  triggersPsa1Calibration,
  qualifiesForNmBandVintageCapSkip,
  hasVintageTriadNormalizeClamp,
} from "./psa-calibration.js";
import { resolveEra, eraFromYear, normalizeEraRequest } from "./era.js";
import { snapToPsaGrade, formatLikelyRange } from "./types.js";
import { formatGradeResponse } from "./response.js";
import {
  createScratchDiagnosticTrace,
  finalizeScratchDiagnosticTrace,
} from "./scratch-diagnostics.js";

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

test("clean modern card with all 9s rejects unconfirmed surface_scratch_light limiter", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Sharp corners and clean surface",
    eyeAppealSummary: "Clean presentation with strong eye appeal.",
    cardMeta: { estimatedYear: 2023, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean crisp edges.",
      surface: "Clean surface with no scratches or marks.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);
  assert.equal(analysis.primaryLimiterLabel, "None visible");

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 9);
  assert.ok(result.psaGrade >= 9);
  assert.ok(
    !result.capAudit.some((entry) =>
      String(entry.source || "").includes("surface_scratch_light")
    )
  );
  assert.equal(result.primaryLimiter.label, "None visible");
});

test("confirmed surface_scratch_light remains when surface notes support it", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch on front",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Minor scratch under close inspection.",
    cardMeta: { estimatedYear: 2023, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Light scratch visible on front under close inspection.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, "surface_scratch_light");
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

test("escalates moderate crease with severe observation to severe crease cap", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 4, edges: 4, surface: 2.5, centering: 6 },
    defects: [
      {
        tag: "moderate_crease",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "moderate_crease",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 2.0);
});

test("multiple moderate structural defects apply compound cap", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 5, edges: 5, surface: 5, centering: 7 },
    defects: [
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "rounded_corners_all",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "moderate_crease",
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 4.0);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "compound:2plus_moderate_defects")
  );
});

test("1952 Topps Willie Mays PSA 1 anchor pattern does not overshoot above PSA 2", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 4, edges: 5, surface: 4, centering: 6 },
    defects: [
      {
        tag: "surface_wear",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_wear",
    primaryLimiterLabel: "Surface Wear is Moderate, Affecting Eye Appeal",
    scanQuality: {
      level: "fair",
      visibilityIssues: ["glare", "scratches", "limited detail"],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1952,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 2.0);
  assert.ok(result.psaGrade <= 2);
  assert.ok(
    result.capAudit.some(
      (entry) => entry.source === "vintage:multi_pillar_heavy_wear"
    )
  );
});

test("1980 Burger King Mike Schmidt PSA 3 anchor pattern caps at PSA 3", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 7.5, edges: 6, surface: 7, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1980,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 3.5);
  assert.ok(result.psaGrade <= 3);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "vintage:distributed_vg_wear" ||
        entry.source === "vintage:optimistic_light_wear"
    )
  );
});

test("1980 Burger King Mike Schmidt PSA 3 harsh vision stays at PSA 3 not PSA 1", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 6, edges: 3.5, surface: 3, centering: 8 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_wear",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1980,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade >= 3);
  assert.ok(result.internalGrade <= 3.5);
  assert.equal(result.psaGrade, 3);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "vintage:distributed_vg_wear")
  );
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:multi_pillar_heavy_wear"
    )
  );
});

test("1953 Topps Billy Martin back writing does not stack multi-pillar below writing cap", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 5, edges: 3.5, surface: 2.5, centering: 7 },
    defects: [
      {
        tag: "writing_mark_severe",
        severity: "severe",
        location: "back",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "writing_mark_severe",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1953,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.equal(result.psaGrade, 2);
  assert.equal(result.internalGrade, 2);
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:multi_pillar_heavy_wear"
    )
  );
  assert.ok(
    result.capAudit.some((entry) => entry.source === "primaryLimiter:writing_mark_severe")
  );
});

test("1972 Topps Tom Seaver PSA 8 harsh edge false-positive stays above PSA 3", () => {
  const raw = {
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1972,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Minor touch",
      edges: "Light roughness",
      surface: "Clean",
      centering: "Good",
    },
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    primaryLimiterLabel: "Major edge fraying",
    bestAttribute: "Centering",
    eyeAppealSummary: "Clean presentation",
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade >= 5);
  assert.ok(result.psaGrade >= 5);
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:distributed_vg_wear"
    )
  );
});

test("1972 Topps Tom Seaver harsh edge raw engine without normalize stays near PSA 3", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1972,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 3.5);
  assert.ok(result.psaGrade <= 3);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "isolated_pillar_outlier")
  );
});

test("1972 Topps Tom Seaver PSA 8 ideal vision reaches PSA 8", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 8, edges: 8, surface: 8, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_wear_light",
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: {
      estimatedYear: 1972,
      isReflective: false,
      isDarkBorder: false,
    },
  });

  const result = computeGrade(analysis, "vintage");
  assert.equal(result.psaGrade, 8);
  assert.equal(result.internalGrade, 8);
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:optimistic_light_wear"
    )
  );
});

test("1972 Topps Tom Seaver PSA 8 normalized scan reaches PSA 7-8", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Well-centered",
    eyeAppealSummary: "Good eye appeal with minor touch wear",
    cardMeta: {
      estimatedYear: 1972,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Minor touch",
      edges: "Light factory roughness",
      surface: "Clean",
      centering: "Well centered",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(analysis.categoryScores.edges >= 6.5);
  assert.ok(result.internalGrade >= 7);
  assert.ok(result.psaGrade >= 7);
});

test("1972 Topps Tom Seaver PSA 8 stain plus edge over-tags normalize to PSA 7+", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 3.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "heavy_staining",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Fair centering",
    eyeAppealSummary: "Moderate wear with acceptable eye appeal",
    cardMeta: {
      estimatedYear: 1972,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Minor touch",
      edges: "Light roughness",
      surface: "Small speck",
      centering: "Fair",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "heavy_staining"));
  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(result.internalGrade >= 7);
  assert.ok(result.psaGrade >= 7);
});

test("1967 Topps Mickey Mantle PSA 1 back wear mis-tag normalizes to poor band", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7, surface: 6, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "back_wear",
        severity: "moderate",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "back_wear",
    primaryLimiterLabel: "Back wear or discoloration",
    bestAttribute: "Centering is strong",
    eyeAppealSummary: "Solid eye appeal with vibrant colors",
    cardMeta: {
      estimatedYear: 1967,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Light touch",
      edges: "Minor wear",
      surface: "Back discoloration limits grade",
      centering: "Well centered",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some(
      (defect) =>
        defect.tag === "writing_mark_severe" || defect.tag === "writing_mark"
    )
  );
  assert.ok(result.internalGrade <= 2.5);
  assert.ok(result.psaGrade <= 2);
});

test("1969 Topps Pete Rose PSA 1 heavy wear with crease inference stays in poor band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Fair color retention",
    eyeAppealSummary: "Vibrant colors with moderate wear for age",
    cardMeta: {
      estimatedYear: 1969,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Rounded corners",
      edges: "Heavy edge chipping",
      surface: "Visible crease through image",
      centering: "Off center",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some(
      (defect) =>
        defect.tag === "severe_crease" || defect.tag === "moderate_crease"
    )
  );
  assert.ok(result.internalGrade <= 2.5);
  assert.ok(result.psaGrade <= 2);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "isolated_pillar_outlier")
  );
});

test("1909 T205 Sam Leever PSA 5 back foxing mis-tag normalizes to EX band", () => {
  const raw = {
    scanQuality: {
      level: "fair",
      visibilityIssues: ["some discoloration on the surface", "minor scuff marks"],
      inspectionLimits: ["back has minor staining"],
    },
    categoryScores: { corners: 6, edges: 3.5, surface: 3.5, centering: 6.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "medium",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "heavy_staining",
        severity: "severe",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "heavy_staining",
    primaryLimiterLabel: "heavy staining on the back",
    bestAttribute: "centering is reasonably strong",
    eyeAppealSummary: "Moderate imperfections but decent appeal for age",
    cardMeta: {
      estimatedYear: 1909,
      isReflective: false,
      isDarkBorder: true,
    },
    categoryNotes: {
      corners: "Rounded corners",
      edges: "Gold border chipping",
      surface: "Back foxing limits surface subgrade",
      centering: "Reasonably centered",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some(
      (defect) => defect.tag === "staining_light" && defect.location === "back"
    )
  );
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_wear"));
  assert.ok(result.internalGrade >= 4.5);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
});

test("1963 Topps Mickey Mantle PSA 5 edge and crease over-tags normalize to EX band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 3.5, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Eye appeal remains relatively strong",
    eyeAppealSummary:
      "Vibrant color and clear imagery but moderate corner rounding and light edge wear",
    cardMeta: {
      estimatedYear: 1963,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Rounded corners",
      edges: "Edge chipping on right",
      surface: "Light surface line across middle",
      centering: "Reasonably centered",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(!analysis.defects.some((defect) => defect.tag === "moderate_crease"));
  assert.ok(result.internalGrade >= 4.5);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
});

test("1963 Topps Mickey Mantle PSA 5 fair surface edge over-tags normalize to EX band", () => {
  const raw = {
    scanQuality: {
      level: "good",
      visibilityIssues: ["slight glare on front and back"],
      inspectionLimits: [],
    },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Strong centering at 7.5, enhancing overall appeal",
    eyeAppealSummary:
      "Despite some minor surface and edge wear, the card's strong centering contributes positively to its overall eye appeal.",
    cardMeta: {
      estimatedYear: 1963,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "Rounded corners",
      edges: "Border chipping",
      surface: "Minor scratches",
      centering: "Strong centering",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(result.internalGrade >= 4.5);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
});

test("1963 Topps Mickey Mantle PSA 5 cached vision downgrades false surface_wear", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7, surface: 7, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_wear",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_wear",
    primaryLimiterLabel: "General surface wear",
    bestAttribute: "Strong centering",
    eyeAppealSummary:
      "The card exhibits vibrant colors and minimal wear, presenting well overall.",
    categoryNotes: {
      corners: "Minor wear visible on corners, slight softening.",
      edges: "Light edge wear noted, primarily at the bottom.",
      surface: "Minor surface issues, with vibrant colors maintained.",
      centering: "Well-centered image, appealing presentation.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );

  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_wear"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade > 3);
});

test("1965 Topps Mickey Mantle PSA 5 cached vision downgrades light-edge fraying over-tag", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 5, centering: 8 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    bestAttribute: "Strong centering at 8.0",
    eyeAppealSummary:
      "The card has strong centering, but visible wear and creasing diminish its overall appeal.",
    categoryNotes: {
      corners: "Moderate wear observed; rounding is visible on all corners.",
      edges: "Light wear with some noticeable scuffing along borders.",
      surface:
        "Moderate scratching, with a noticeable crease across the front; some surface printing flaws present.",
      centering: "Well-centered for its age, likely above average.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(result.psaGrade >= 3);
});

test("1968 Topps Tom Seaver PSA 6 cached notes avoid false poor-band cluster", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 6.5, surface: 5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_moderate",
    bestAttribute: "Good centering",
    eyeAppealSummary:
      "Moderate wear with visible corner and surface issues, but still retains decent eye appeal.",
    categoryNotes: {
      corners: "Moderate wear with some rounding visible.",
      edges: "Light edge wear present, particularly on the left side.",
      surface: "Moderate scratches affecting surface gloss and clarity.",
      centering: "Good centering overall with slight off-center appearance.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:poor_band_notes_cluster"
    )
  );
  assert.ok(result.psaGrade >= 4);
});

test("1934 Goudey Cochrane PSA 6 cached vision keeps minor edge wear not major fraying", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 5.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "moderate_crease",
    bestAttribute: "Fair centering with vibrant colors.",
    eyeAppealSummary:
      "Despite multiple issues, the card retains decent eye appeal with bold graphics.",
    categoryNotes: {
      corners: "Moderate wear visible; softening and rounding apparent.",
      edges: "Visible fraying and minor chipping detected along edges.",
      surface:
        "Multiple creases noted, impacting surface visually, though not deeply cutting.",
      centering: "Fair centering with only minor alignment issues.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "edge_wear_light"));
});

test("1980 Topps Henderson PSA 6 cached edge note denies major fraying over-tag", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5.5, surface: 5.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    bestAttribute: "Strong centering with vibrant color",
    eyeAppealSummary:
      "The card has good eye appeal despite visible corner and crease wear.",
    categoryNotes: {
      corners: "Moderate wear visible, particularly on two corners.",
      edges: "Light wear observed along edges with no severe fraying or chipping.",
      surface:
        "Visible moderate creases affect overall surface, diminishing its quality.",
      centering: "Centering is strong, enhancing visual appeal.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "edge_wear_light"));
});

test("1969 Topps Seaver PSA 6 cached appeal-only writing downgrades to back stain", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5.5, surface: 8, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "writing_mark",
        severity: "moderate",
        location: "back",
        confidence: "high",
      },
      {
        tag: "writing_mark_severe",
        severity: "severe",
        location: "both",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "writing_mark_severe",
    bestAttribute: "Visual appeal is still decent despite visible wear.",
    eyeAppealSummary:
      "Card maintains some charm but shows significant evidence of wear on front corners and visible writing on the back.",
    categoryNotes: {
      corners: "Moderate rounding and wear are evident, impacting overall appearance.",
      edges: "Minor edge wear consistent with age, but not severe.",
      surface: "Light scratches and general surface wear, impacting aesthetics.",
      centering: "Centering appears decent, but not perfect.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "writing_mark_severe"));
  assert.ok(!analysis.defects.some((defect) => defect.tag === "writing_mark"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "staining_light"));
  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "defect:writing_mark_severe")
  );
});

test("1962 Topps Roger Maris PSA 1 heavy edge wear infers crease and stays in poor band", () => {
  const raw = {
    scanQuality: {
      level: "good",
      visibilityIssues: ["Some slight wear on edges", "Minor scratches on surface"],
      inspectionLimits: [],
    },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Decent eye appeal despite visible wear.",
    cardMeta: {
      estimatedYear: 1962,
      isReflective: false,
      isDarkBorder: true,
    },
    categoryNotes: {
      corners: "Heavy rounding",
      edges: "Major top edge chipping",
      surface: "Vertical crease at top",
      centering: "Strong centering",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some(
      (defect) => defect.tag === "severe_crease" || defect.tag === "moderate_crease"
    )
  );
  assert.ok(analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(result.internalGrade <= 2.5);
  assert.ok(result.psaGrade <= 2);
});

test("1962 Topps Roger Maris PSA 1 back writing mis-tag with poor surface stays in poor band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 3.5, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "writing_mark",
        severity: "moderate",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "strong centering with clean front surface aside from minor wear",
    eyeAppealSummary:
      "The card displays strong centering and a visually appealing surface despite some moderate defects.",
    cardMeta: {
      estimatedYear: 1962,
      isReflective: false,
      isDarkBorder: true,
    },
    categoryNotes: {
      corners: "Heavy rounding",
      edges: "Major edge chipping",
      surface: "Crease through top border",
      centering: "Strong centering",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some(
      (defect) =>
        defect.tag === "staining_light" && defect.location === "back"
    )
  );
  assert.ok(
    analysis.defects.some(
      (defect) => defect.tag === "severe_crease" || defect.tag === "moderate_crease"
    )
  );
  assert.ok(result.internalGrade <= 2.5);
  assert.ok(result.psaGrade <= 2);
});

test("1980 Topps Rickey Henderson PSA 3 distributed light wear stays in VG band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6.5, surface: 6.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining or discoloration",
    bestAttribute: "centering",
    eyeAppealSummary:
      "Card displays decent centering with visible surface, corner, and edge wear.",
    cardMeta: {
      estimatedYear: 1980,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "",
      edges: "",
      surface: "",
      centering: "",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    analysis.defects.some((defect) => defect.tag === "edge_fraying_major")
  );
  assert.ok(
    analysis.defects.some((defect) => defect.tag === "corner_wear_moderate")
  );
  assert.ok(result.internalGrade <= 4);
  assert.ok(result.psaGrade <= 4);
  assert.ok(result.psaGrade >= 2);
});

test("EX band moderate crease over-tag with decent appeal normalizes above PSA 3", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 6.5, surface: 3.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "moderate_crease",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "moderate_crease",
    primaryLimiterLabel: "Moderate crease on face",
    bestAttribute: "Decent centering and overall presentation",
    eyeAppealSummary:
      "Card shows visible wear and creasing, but centering helps its aesthetic.",
    cardMeta: { estimatedYear: 1965 },
    categoryNotes: {
      surface: "Crease through top border",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    !analysis.defects.some((defect) => defect.tag === "moderate_crease")
  );
  assert.ok(result.psaGrade >= 5);
  assert.ok(result.internalGrade >= 5.5);
});

test("EX band distributed wear without surface pillar does not default to PSA 3", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6, surface: 6.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "staining_light",
    bestAttribute: "centering",
    eyeAppealSummary:
      "Good eye appeal with visible corner, edge, and surface wear.",
    cardMeta: { estimatedYear: 1960 },
    categoryNotes: {},
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    !analysis.defects.some((defect) => defect.tag === "edge_fraying_major")
  );
  assert.ok(result.psaGrade >= 5);
  assert.ok(result.internalGrade >= 5.5);
});

test("1965 Topps Mickey Mantle PSA 5 optimistic NM vision stays in EX band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7, surface: 7.5, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining or discoloration",
    bestAttribute: "Strong centering and color",
    eyeAppealSummary:
      "Vibrant colors and solid centering; minor corner wear and light stain on jersey.",
    cardMeta: {
      estimatedYear: 1965,
      isReflective: false,
      isDarkBorder: true,
    },
    categoryNotes: {
      corners: "",
      edges: "",
      surface: "",
      centering: "",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.internalGrade >= 4.5);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "vintage:uniform_optimistic_light_wear" && entry.cap === 5.5
    )
  );
});

test("1965 Topps Mickey Mantle PSA 5 EX light wear with back toning stays in EX band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6, surface: 6.5, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining or discoloration",
    bestAttribute: "centering and color",
    eyeAppealSummary:
      "Attractive EX card with light corner touch and back toning.",
    cardMeta: {
      estimatedYear: 1965,
      isReflective: false,
      isDarkBorder: true,
    },
    categoryNotes: {
      corners: "light rounding",
      edges: "minor chipping",
      surface: "back foxing",
      centering: "",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(result.internalGrade >= 4.5);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
});

test("1957 Topps Whitey Ford vision variants stabilize in EX band", () => {
  const base = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    cardMeta: { estimatedYear: 1957 },
    categoryNotes: {},
  };

  const variants = [
    {
      eyeAppealSummary:
        "The card exhibits moderate corner wear, light edge wear, and some surface scratches, impacting its overall appeal but maintains strong centering.",
      bestAttribute: "strong centering",
    },
    {
      eyeAppealSummary:
        "Visible corner, edge, and surface wear with strong centering.",
      bestAttribute: "centering",
    },
    {
      eyeAppealSummary:
        "Major edge fraying and moderate corner wear with surface scratches.",
      bestAttribute: "strong centering",
    },
    {
      defects: [
        ...base.defects,
        {
          tag: "moderate_crease",
          severity: "moderate",
          location: "front",
          confidence: "high",
        },
      ],
      eyeAppealSummary: "Visible wear and creasing with strong centering.",
      bestAttribute: "decent centering and overall presentation",
      categoryNotes: { surface: "Crease through top border" },
    },
  ];

  for (const variant of variants) {
    const analysis = normalizeAnalysis({ ...base, ...variant }, "vintage");
    const result = computeGrade(analysis, "vintage");

    assert.ok(
      !analysis.defects.some((defect) => defect.tag === "edge_fraying_major"),
      variant.eyeAppealSummary
    );
    assert.ok(
      !analysis.defects.some((defect) => defect.tag === "severe_crease"),
      variant.eyeAppealSummary
    );
    assert.ok(result.psaGrade >= 4, variant.eyeAppealSummary);
    assert.ok(result.psaGrade <= 6, variant.eyeAppealSummary);
  }
});

test("1979 Burger King Jim Hunter clean appeal back mark not writing stays above PSA 3", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 6.5, surface: 3.5, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "writing_mark",
        severity: "moderate",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "writing_mark",
    primaryLimiterLabel: "Writing, mark, or ink",
    bestAttribute: "Good centering with minor edge wear.",
    eyeAppealSummary:
      "The card has a clean appearance overall with strong centering, but there are moderate corner wear and light surface scratches.",
    cardMeta: {
      estimatedYear: 1979,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      surface: "Dark mark on back near text",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    !analysis.defects.some((defect) => defect.tag === "writing_mark")
  );
  assert.ok(
    !analysis.defects.some((defect) => defect.tag === "surface_wear")
  );
  assert.ok(result.psaGrade >= 5);
  assert.ok(result.internalGrade >= 5.5);
});

test("1957 Topps Whitey Ford PSA 8 stain mislabeled as writing stays in NM band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6.5, surface: 3.5, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
      {
        tag: "writing_mark",
        severity: "moderate",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "writing_mark",
    primaryLimiterLabel: "Writing, mark, or ink",
    bestAttribute: "Good centering with minor surface scratches",
    eyeAppealSummary:
      "Good overall eye appeal but affected by heavy staining and some corner wear.",
    cardMeta: {
      estimatedYear: 1957,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {},
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(
    !analysis.defects.some((defect) => defect.tag === "writing_mark")
  );
  assert.ok(
    analysis.defects.some(
      (defect) => defect.tag === "staining_light" && defect.location === "back"
    )
  );
  assert.ok(result.psaGrade >= 7);
  assert.ok(result.internalGrade >= 7);
});

test("1957 Topps Whitey Ford PSA 8 light edge appeal contradicts edge fraying over-tag", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 3.5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_fraying_major",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_fraying_major",
    primaryLimiterLabel: "Major edge fraying or chipping",
    bestAttribute: "strong centering",
    eyeAppealSummary:
      "The card exhibits moderate corner wear, light edge wear, and some surface scratches, impacting its overall appeal but maintains strong centering.",
    cardMeta: {
      estimatedYear: 1957,
      isReflective: false,
      isDarkBorder: false,
    },
    categoryNotes: {
      corners: "",
      edges: "",
      surface: "",
      centering: "",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(
    analysis.defects.some((defect) => defect.tag === "edge_wear_light")
  );
  assert.ok(
    analysis.defects.some((defect) => defect.tag === "surface_scratch_light")
  );
  assert.ok(result.internalGrade >= 4);
  assert.ok(result.psaGrade >= 4);
  assert.ok(result.psaGrade <= 6);
});

test("benchmark 1934 Gehrig PSA 2 optimistic vision caps in poor band", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "back_wear",
        severity: "moderate",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "back_wear",
    primaryLimiterLabel: "Back wear or discoloration",
    bestAttribute: "Strong color retention and image clarity",
    eyeAppealSummary:
      "Overall, the card displays a vibrant front with only minor wear affecting corners and edges.",
    cardMeta: { estimatedYear: 1934, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Moderate wear evident, affecting overall sharpness.",
      edges: "Light wear with some minor chipping observed.",
      surface: "Good color; few minor scratches present.",
      centering: "Well-centered with good alignment.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade <= 3);
  assert.ok(result.internalGrade <= 3.5);
});

test("benchmark 1962 Maris PSA 1 moderate cluster caps at PSA 2", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 6, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_moderate",
    primaryLimiterLabel: "Moderate surface scratching",
    bestAttribute: "centering",
    eyeAppealSummary: "Overall moderate eye appeal due to wear and staining.",
    cardMeta: { estimatedYear: 1962, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Moderate wear evident with some rounding.",
      edges: "Minor wear with noticeable edge issues.",
      surface: "Light scratches present on front, affecting aesthetics.",
      centering: "Good centering overall.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade <= 2);
  assert.ok(result.internalGrade <= 2.5);
});

test("benchmark 1967 Mantle PSA 1 moderate cluster caps at PSA 2", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 6.5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_moderate",
    primaryLimiterLabel: "Moderate surface scratching",
    bestAttribute: "Decent eye appeal despite multiple visible flaws",
    eyeAppealSummary:
      "The card presents well but shows some wear on edges and corners affecting the overall look.",
    cardMeta: { estimatedYear: 1967, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Moderate wear limits visual quality; some rounding.",
      edges: "Light wear is visible; minor chipping noted.",
      surface: "Scratches reduce surface appeal; presents adequately at a glance.",
      centering: "Decent centering, slightly off but generally acceptable.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade <= 2);
});

test("benchmark 1980 Schmidt PSA 3 light wear triad caps at PSA 3", () => {
  const raw = {
    scanQuality: {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: ["Full view of corners and edges present"],
    },
    categoryScores: { corners: 7, edges: 6.5, surface: 6.5, centering: 7.5 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Overall appearance remains vibrant and attractive for age",
    eyeAppealSummary: "Card displays well with minor wear visible on edges and corners.",
    cardMeta: { estimatedYear: 1980, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor wear is visible on corners, no severe damage apparent.",
      edges: "Light edge wear noted, no significant chipping.",
      surface: "Minor surface scratches present, but overall surface is satisfactory.",
      centering: "Well-centered image, strong alignment.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade <= 3);
  assert.ok(result.internalGrade <= 3.5);
});

test("formatGradeResponse returns unified professional structure for all users", () => {
  const analysis = baseAnalysis({
    categoryNotes: {
      corners: "Light touch on two corners",
      edges: "Clean factory cut",
      surface: "Minor print speck",
      centering: "Well centered left-right",
    },
  });
  const gradeResult = computeGrade(analysis, "modern");

  const response = formatGradeResponse({
    gradeResult,
    analysis,
    eraSource: "auto",
    estimatedYear: 1987,
  });

  assert.equal(response.psaGrade, gradeResult.psaGrade);
  assert.equal(response.categoryNotes.corners, "Light touch on two corners");
  assert.ok(response.verdict.includes("Detailed Breakdown"));
  assert.ok(response.verdict.includes("Internal Grade"));
  assert.equal("mode" in response, false);
  assert.equal("proUpsellText" in response, false);
});

test("back-only moderate writing relief lifts EX-front Hodges-style slab to PSA 5", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7, edges: 5, surface: 5.5, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "writing_mark",
        severity: "moderate",
        location: "back",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "writing_mark",
    primaryLimiterLabel: "Writing, mark, or ink",
    bestAttribute: "centering",
    eyeAppealSummary: "Strong centering with minor edge and surface imperfections.",
    cardMeta: { estimatedYear: 1960, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Light wear noted on corners.",
      edges: "Minor wear along the edges; no severe fraying.",
      surface: "Light scratches detected on the front surface.",
      centering: "The card is well-centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.equal(result.psaGrade, 5);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "back_only_writing:writing_mark")
  );
});

test("front severe writing keeps harsh cap and skips back-only relief", () => {
  const analysis = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 3.5, centering: 6 },
    visionCategoryScores: { corners: 5, edges: 5, surface: 3.5, centering: 6 },
    defects: [
      {
        tag: "writing_mark_severe",
        severity: "severe",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "writing_mark_severe",
    primaryLimiterLabel: "Heavy writing on front",
    bestAttribute: "None significant",
    eyeAppealSummary: "Front ink dominates the card.",
    cardMeta: { estimatedYear: 1980, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      surface: "Heavy ink mark across the front image.",
    },
  };

  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade <= 3);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "back_only_writing:writing_mark_severe")
  );
});

test("back-only severe writing relief floors at PSA 4 not PSA 2", () => {
  const analysis = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7, edges: 7, surface: 2.5, centering: 7.5 },
    visionCategoryScores: { corners: 7, edges: 7, surface: 5.5, centering: 7.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "writing_mark_severe",
        severity: "severe",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "writing_mark_severe",
    primaryLimiterLabel: "Heavy writing on back",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Colors are vibrant, with some minor wear noted.",
    cardMeta: { estimatedYear: 1975, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Minor softening at tips; generally good.",
      edges: "Presenting light wear at edges.",
      surface: "Light scratches visible, particularly on arms and shoulders.",
      centering: "Well centered, slightly better than average.",
    },
  };

  const result = computeGrade(analysis, "vintage");

  assert.equal(result.psaGrade, 4);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "back_only_writing:writing_mark_severe")
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "psa1_calibration")
  );
});

test("Ryan-style both-location back writing relief reaches PSA 4 from cached vision", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7, edges: 7, surface: 7, centering: 7.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "writing_mark_severe",
        severity: "severe",
        location: "back",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "writing_mark_severe",
    primaryLimiterLabel: "Heavy writing or marking over significant area",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Colors are vibrant, with some minor wear noted.",
    cardMeta: { estimatedYear: 1975, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Minor softening at tips; generally good.",
      edges: "Presenting light wear at edges.",
      surface: "Light scratches visible, particularly on arms and shoulders.",
      centering: "Well centered, slightly better than average.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );

  assert.equal(result.psaGrade, 4);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "back_only_writing:writing_mark_severe")
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "psa1_calibration")
  );
});

test("T206 Rhodes cached vision keeps edge_wear_light and reaches PSA 5", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 6, centering: 7 },
    defects: [
      {
        tag: "corner_wear_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "corner_wear_moderate",
    primaryLimiterLabel: "Moderate corner wear observed",
    bestAttribute: "Good centering with minor flaws present",
    eyeAppealSummary:
      "Despite moderate wear, the colors remain vibrant and the centering is appealing, contributing to a decent eye appeal.",
    cardMeta: { estimatedYear: 1909, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Moderate wear is visible, showing rounding and softening.",
      edges: "Visible fraying on the edges, indicating moderate wear.",
      surface: "Some surface scratches and creases are present, affecting visual quality.",
      centering: "Centering is good, contributing positively to the overall presentation.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(!analysis.defects.some((defect) => defect.tag === "edge_fraying_major"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "edge_wear_light"));
  assert.equal(result.psaGrade, 5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:poor_band_notes_cluster")
  );
});

test("uniform EX light-wear triad skip lifts Mantle 1968-style slab above PSA 3", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7, edges: 6.5, surface: 6.5, centering: 8 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "staining_light",
        severity: "minor",
        location: "back",
        confidence: "minor",
      },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light back staining",
    bestAttribute: "Strong centering with minor wear",
    eyeAppealSummary: "Clean EX presentation with light wear on all pillars.",
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor wear visible on corners.",
      edges: "Light edge wear noted.",
      surface: "Light scratches on the front surface.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(analysis, "vintage");

  assert.ok(result.psaGrade >= 5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
});

test("NM-band cap skip avoids poor_band and triad caps on PSA 9-style light wear", () => {
  const categoryScores = { corners: 7.5, edges: 7, surface: 7.5, centering: 8 };
  const defects = [
    { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "staining_light", severity: "minor", location: "back", confidence: "medium" },
  ];
  const analysis = {
    visionCategoryScores: categoryScores,
    writingReliefBandScores: categoryScores,
    categoryNotes: {
      corners: "Sharp corners with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Clean surface with minor imperfections.",
      centering: "Well centered.",
    },
    eyeAppealSummary: "Well preserved NM presentation.",
    bestAttribute: "Strong centering",
  };

  assert.ok(qualifiesForNmBandVintageCapSkip(categoryScores, defects, analysis));

  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores,
    defects: [
      ...defects,
      { tag: "surface_wear", severity: "moderate", location: "front", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_wear",
    primaryLimiterLabel: "Surface wear",
    bestAttribute: "Strong centering with sharp corners",
    eyeAppealSummary: "Well preserved with vibrant color and minimal wear.",
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
    categoryNotes: analysis.categoryNotes,
  };

  const normalized = normalizeAnalysis(raw, "vintage");
  assert.ok(!normalized.defects.some((defect) => defect.tag === "surface_wear"));
  assert.ok(
    normalized.defects.some((defect) => defect.tag === "surface_scratch_light")
  );

  const result = computeGrade(
    { ...normalized, visionCategoryScores: categoryScores, writingReliefBandScores: categoryScores },
    "vintage"
  );
  assert.ok(result.psaGrade >= 7);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:poor_band_notes_cluster")
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
});

test("NM poor-band skip does not apply when moderate structural defects remain", () => {
  const categoryScores = { corners: 7, edges: 7, surface: 7, centering: 8 };
  const defects = [
    { tag: "corner_wear_moderate", severity: "moderate", location: "front", confidence: "high" },
  ];
  const analysis = { writingReliefBandScores: categoryScores };
  assert.ok(!qualifiesForNmBandVintageCapSkip(categoryScores, defects, analysis));
});

test("NM gem band lifts Henderson-style back-stain PSA 10 presentation", () => {
  const categoryScores = { corners: 8, edges: 8, surface: 8, centering: 9 };
  const defects = [
    { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "staining_light", severity: "minor", location: "back", confidence: "high" },
  ];
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores,
    defects,
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining or discoloration",
    bestAttribute: "Strong centering and color",
    eyeAppealSummary: "Well preserved with vibrant color and minimal wear.",
    cardMeta: { estimatedYear: 1981, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Clean surface with minor imperfections.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: categoryScores,
      writingReliefBandScores: categoryScores,
    },
    "vintage"
  );

  assert.ok(result.psaGrade >= 8);
  assert.ok(
    result.capAudit.some((entry) => entry.source.startsWith("nm_band:"))
  );
});

test("high-grade vision guard demotes false back_damage_severe on SO LEAD-style slab", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 5, centering: 7 },
    defects: [
      { tag: "corner_wear_moderate", severity: "moderate", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_moderate", severity: "moderate", location: "front", confidence: "high" },
      { tag: "back_wear", severity: "moderate", location: "back", confidence: "high" },
      { tag: "back_damage_severe", severity: "severe", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "back_damage_severe",
    primaryLimiterLabel: "Severe back damage",
    bestAttribute: "Good centering with slight wear on edges.",
    eyeAppealSummary: "Overall eye appeal is fair due to the moderate corner and surface wear.",
    cardMeta: { estimatedYear: 1978, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Moderate wear with noticeable softening.",
      edges: "Light wear on edges, with minor chipping.",
      surface: "Moderate scratches present, affecting visual quality.",
      centering: "Well centered for the card's age.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "back_damage_severe"));
  assert.ok(
    analysis.defects.some(
      (defect) => defect.tag === "staining_light" && defect.location === "back"
    )
  );
});

test("high-grade vision guard demotes false writing_mark on Robinson-style slab", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 8.5, edges: 8, surface: 6, centering: 9 },
    defects: [
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "writing_mark", severity: "moderate", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "writing_mark",
    primaryLimiterLabel: "Writing, mark, or ink",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Front appeal is strong with minor surface issues.",
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Corners appear mostly sharp with minor wear.",
      edges: "Edges show minimal wear; light chipping present.",
      surface: "Surface has light scratches that impact visual appeal.",
      centering: "Centering is excellent, slightly off but acceptable.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "writing_mark"));
});

test("high-grade vision guard demotes scratch_moderate with back-only stain companion", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 6, surface: 6, centering: 7 },
    defects: [
      { tag: "corner_wear_moderate", severity: "moderate", location: "front", confidence: "medium" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "surface_scratch_moderate", severity: "moderate", location: "front", confidence: "medium" },
      { tag: "staining_light", severity: "minor", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_scratch_moderate",
    primaryLimiterLabel: "Moderate surface scratching",
    bestAttribute: "fair eye appeal with moderate visible defects",
    eyeAppealSummary: "Good centering with moderate corner wear and surface scratches.",
    cardMeta: { estimatedYear: 1970, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Moderate wear visible with softening.",
      edges: "Light wear visible along the edges.",
      surface: "Moderate scratches and a few surface imperfections.",
      centering: "Well-centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_moderate"));
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("NM/GEM guard lifts Robinson-style PSA 10 light-wear pillar collapse above 5.5", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Well preserved with sharp corners and minimal wear.",
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Corners appear sharp with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Light scratches visible under close inspection.",
      centering: "Excellent centering.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );

  assert.ok(analysis.categoryScores.corners >= 8);
  assert.ok(analysis.categoryScores.surface >= 8);
  assert.ok(result.psaGrade >= 7);
});

test("NM/GEM guard removes cosmetic back staining_light on PSA 10 presentation", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "staining_light", severity: "minor", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining or discoloration",
    bestAttribute: "Strong centering and color",
    eyeAppealSummary: "Well preserved with vibrant color and minimal wear.",
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Clean surface; light back toning only.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
  assert.ok(Math.min(analysis.categoryScores.corners, analysis.categoryScores.surface) >= 8);
});

test("NM/GEM guard does not lift PSA 4-style poor-band presentation", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5, edges: 5, surface: 4.5, centering: 6.5 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Fair eye appeal",
    eyeAppealSummary: "Heavy wear visible across the card.",
    cardMeta: { estimatedYear: 1962, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Rounded corners with moderate wear.",
      edges: "Heavy edge wear and chipping.",
      surface: "Heavy surface wear throughout.",
      centering: "Off center.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.categoryScores.corners <= 6);
  assert.ok(analysis.categoryScores.surface <= 5.5);
});

test("NM/GEM guard does not lift EX-band PSA 7 presentation (Mantle-style)", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7, surface: 7, centering: 8 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "Light corner wear",
    bestAttribute: "Good color",
    eyeAppealSummary: "Well preserved with good color.",
    cardMeta: { estimatedYear: 1962, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor corner touch.",
      edges: "Light edge wear.",
      surface: "Clean with minor scratches.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.categoryScores.corners <= 7.5);
  assert.ok(analysis.categoryScores.edges <= 7.5);
  assert.ok(analysis.categoryScores.surface <= 7.5);
  assert.ok(analysis.categoryScores.corners < 8);
  assert.ok(analysis.categoryScores.surface < 8);
});

test("NM/GEM recovery does not lift PSA 1-3 low-grade vintage presentation", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 4, edges: 4, surface: 3.5, centering: 7 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Fair eye appeal",
    eyeAppealSummary: "Poor condition with heavy wear visible.",
    cardMeta: { estimatedYear: 1952, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Rounded corners with heavy wear.",
      edges: "Heavy edge wear.",
      surface: "Heavy surface wear throughout.",
      centering: "Off center.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.categoryScores.corners <= 5.5);
  assert.ok(analysis.categoryScores.surface <= 5.5);
});

test("NM/GEM recovery allows pillar lift on gem-mint collapsed presentation", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "staining_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Gem mint presentation with sharp corners.",
    cardMeta: { estimatedYear: 1975, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Light edge wear.",
      surface: "Light front staining visible.",
      centering: "Excellent centering.",
    },
  };

  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(Math.min(analysis.categoryScores.corners, analysis.categoryScores.surface) >= 8);
});

test("gem-mint slab profile lifts Robinson-style PSA 10 above mint PSA 9 path", () => {
  const robinson = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "medium" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    eyeAppealSummary: "Well preserved with sharp corners and minimal wear.",
    categoryNotes: {
      corners: "Corners appear sharp with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Clean surface; light scratches under inspection.",
      centering: "Excellent centering.",
    },
    cardMeta: { estimatedYear: 1968 },
  };
  const bench = {
    ...robinson,
    categoryScores: { corners: 7.5, edges: 7.5, surface: 7, centering: 8 },
    categoryNotes: {
      corners: "Slight softening observed but otherwise fair corners.",
      edges: "Good edges with minor wear noted.",
      surface: "Minor scratches present, primarily on the lower section.",
      centering: "Well-centered presentation indicative of higher grade potential.",
    },
    eyeAppealSummary: "The card maintains a bright and clear image with only minor visible flaws.",
  };

  const gemAnalysis = normalizeAnalysis(robinson, "vintage");
  const mintAnalysis = normalizeAnalysis(bench, "vintage");
  assert.ok(
    Math.min(
      gemAnalysis.categoryScores.corners,
      gemAnalysis.categoryScores.surface
    ) >= 8.5
  );
  assert.ok(
    Math.min(mintAnalysis.categoryScores.corners, mintAnalysis.categoryScores.surface) <= 8
  );
});

test("modern single corner_wear_light is not crushed by vintage Ryan optimism ceiling", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 8.5, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2018, isReflective: false, isDarkBorder: true },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 8);
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "ex_band:uniform_light_optimism_ceiling"
    )
  );
});

test("vintage Ryan optimism ceiling still caps single corner_wear_light inflation", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 8.5, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 1951, isReflective: false, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "ex_band:uniform_light_optimism_ceiling" && entry.cap === 4
    )
  );
});
test("modern surface_scratch_light uses 8.5 cap when NM recovery does not qualify", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 7.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.equal(result.internalGrade, 7.5);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "primaryLimiter:surface_scratch_light" && entry.cap === 8.5
    )
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("nm_modern:"))
  );
});

test("modern NM recovery lifts light scratch presentation to PSA 9 when pillars allow", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners with no handling wear.",
      edges: "Clean crisp edges.",
      surface: "Light factory refractor artifact under close inspection.",
      centering: "Well centered.",
    },
  });

  const result = computeGrade(analysis, "modern");
  assert.equal(result.internalGrade, 9);
  assert.equal(result.psaGrade, 9);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "nm_modern:primary:surface_scratch_light" && entry.cap === 9
    )
  );
});

test("modern NM recovery does not apply when wearFloor is below 8", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 7.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("nm_modern:"))
  );
});

test("vintage light scratch cap is unchanged by modern NM recovery", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 1968, isReflective: true, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners",
      edges: "Clean edges",
      surface: "Minor scratch under inspection",
      centering: "Well centered",
    },
  });

  const normalized = normalizeAnalysis(
    {
      ...analysis,
      scanQuality: analysis.scanQuality,
    },
    "vintage"
  );
  assert.ok(
    normalized.defects.some((defect) => defect.tag === "surface_scratch_light")
  );
  assert.ok(
    !normalized.visionReconciliationAudit?.some(
      (entry) => entry.source === "modern_reflective_artifact_reclass"
    )
  );

  const result = computeGrade(normalized, "vintage");
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("nm_modern:"))
  );
});

test("modern reflective false scratch strip removes unconfirmed chrome artifact tag", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Centering",
    eyeAppealSummary: "Mostly clean reflective presentation",
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "Sharp",
      edges: "Clean",
      surface: "Minor factory print line under the light; does not detract from display value.",
      centering: "Well centered",
    },
  };

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(
    !normalized.defects.some((defect) => defect.tag === "surface_scratch_light")
  );
  assert.equal(normalized.primaryLimiterTag, null);
});

test("modern reflective deep scratch language skips reflective reclass", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 7, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Centering",
    eyeAppealSummary: "Reflective card",
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "Sharp",
      edges: "Clean",
      surface: "Multiple scratches with deep scratch visible on the front.",
      centering: "Well centered",
    },
  };

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(normalized.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(!normalized.visionReconciliationAudit?.length);
});

test("modern non-reflective scratch is not reclassified", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Centering",
    eyeAppealSummary: "Clean paper stock",
    cardMeta: { estimatedYear: 2023, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp",
      edges: "Clean",
      surface: "Light scratch present on an otherwise mostly clean surface.",
      centering: "Well centered",
    },
  };

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(normalized.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(!normalized.visionReconciliationAudit?.length);
});

test("modern cosmetic print_line cap lifts to 9 when pillars and notes qualify", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean edges.",
      surface: "Minor factory print line under close inspection; does not detract.",
      centering: "Well centered.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.equal(result.internalGrade, 9);
  assert.equal(result.psaGrade, 9);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "modern_cosmetic:primary:print_line" && entry.cap === 9
    )
  );
});

test("modern cosmetic print_line cap lifts to 9 when surface pillar is 8.5", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean edges.",
      surface: "Minor factory print line under close inspection; does not detract.",
      centering: "Well centered.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.equal(result.internalGrade, 8.5);
  assert.ok(result.psaGrade >= 8);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "modern_cosmetic:primary:print_line" && entry.cap === 9
    )
  );
});

test("modern cosmetic print_line cap does not apply when surface below 8.5", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 8, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      surface: "Minor factory print line; does not detract.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("modern_cosmetic:"))
  );
});

test("modern cosmetic print_line cap blocked by eye appeal detracting language", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9.5 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      surface: "Minor scratch detracting slightly from overall appeal.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2025, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("modern_cosmetic:"))
  );
});

test("vintage print_line cap remains unchanged by modern cosmetic relief", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      surface: "Minor factory print line; does not detract.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 1980, isReflective: false, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "vintage");
  assert.ok(result.internalGrade <= 8);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("modern_cosmetic:"))
  );
});

test("modern nm recovery does not apply to corner_wear_light", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    categoryNotes: {
      corners: "Minor touch wear on a couple corners.",
      edges: "Clean edges.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: false, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("nm_modern:"))
  );
});

test("modern cosmetic print_line cap blocked by handling wear language", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      corners: "Slight touch wear on one corner.",
      edges: "Clean edges.",
      surface: "Minor factory print line under close inspection.",
      centering: "Well centered.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("modern_cosmetic:"))
  );
});

test("modern cosmetic print_line cap blocked by wear tag vs no-wear note contradiction", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "medium",
      },
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean edges with no noticeable wear.",
      surface: "Minor factory print line; does not detract.",
      centering: "Well centered.",
    },
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source?.startsWith("modern_cosmetic:"))
  );
});

test("modern normalize strips corner_wear_light from vague wear language only", () => {
  const raw = baseAnalysis({
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "Light corner wear",
    categoryNotes: {
      corners: "Corners appear sharp with slight wear consistent with handling.",
      edges: "Clean edges.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2024, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(!normalized.defects.some((defect) => defect.tag === "corner_wear_light"));
});

test("modern normalize keeps corner_wear_light when whitening is documented", () => {
  const raw = baseAnalysis({
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    categoryNotes: {
      corners: "Minor corner whitening visible on bottom left.",
      edges: "Clean edges.",
      surface: "Clean surface.",
    },
    cardMeta: { estimatedYear: 2024, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(normalized.defects.some((defect) => defect.tag === "corner_wear_light"));
});

test("modern psa7 light wear stack caps stacked wear at 7.5", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 8, edges: 8, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "corner_wear_light",
    categoryNotes: {
      corners: "Minor corner whitening on two corners.",
      edges: "Light edge fraying visible under close inspection.",
      surface: "Clean surface.",
    },
    cardMeta: { estimatedYear: 2022, isReflective: false, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 7.5);
  assert.ok(
    result.capAudit.some((entry) => entry.source === "modern:psa7_light_wear_stack")
  );
});

test("modern psa7 stack cap skipped for factory print_line only presentation", () => {
  const analysis = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "print_line",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "print_line",
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean edges.",
      surface: "Minor factory print line under close inspection; does not detract.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
  });

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 9);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "modern:psa7_light_wear_stack")
  );
});

test("modern normalize caps corner pillar when notes have vague handling wear only", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    primaryLimiterLabel: null,
    categoryNotes: {
      corners: "Corners appear sharp with slight wear consistent with handling.",
      edges: "Clean edges with no visible wear.",
      surface: "Clean factory surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(normalized.categoryScores.corners <= 8.5);
  assert.equal(normalized.categoryScores.edges, 9);
  assert.ok(!normalized.defects.some((defect) => defect.tag === "corner_wear_light"));
});

test("modern normalize caps corner pillar to 8 for confirmed whitening without wear tag", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    primaryLimiterLabel: null,
    categoryNotes: {
      corners: "Minor corner whitening visible on bottom left.",
      edges: "Clean edges.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2024, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.ok(normalized.categoryScores.corners <= 8.5);
  assert.ok(!normalized.defects.some((defect) => defect.tag === "corner_wear_light"));
});

test("modern handling wear pillar cap prevents inflated grade on vague wear notes", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9.5 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Minor corner wear detected, appears consistent with handling.",
      edges: "Edges appear clean with no visible wear.",
      surface: "Surface is well-maintained with no notable issues.",
      centering: "Centering is visually appealing.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const analysis = normalizeAnalysis(raw, "modern");
  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade <= 8.5);
  assert.ok(result.psaGrade <= 8);
});

test("modern clean note reconciliation raises edges 8 to 9 without changing defects", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    primaryLimiterLabel: null,
    categoryNotes: {
      corners: "Sharp corners with no visible wear.",
      edges: "Clean edges with no visible fraying or wear.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 9);
  assert.equal(normalized.defects.length, 0);
  assert.ok(
    normalized.visionReconciliationAudit?.some(
      (entry) =>
        entry.source === "modern_clean_note_pillar_reconcile" &&
        entry.pillar === "edges" &&
        entry.newScore === 9
    )
  );
});

test("modern clean note reconciliation raises edges 8 to 9 for well-defined language", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Edges are smooth and well-defined with no visible issues.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 9);
});

test("modern clean note reconciliation caps raise at 9.0 from 8.5 only", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8.5, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Intact edges with uniform appearance.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 9);
});

test("modern clean note reconciliation skips edges below 8", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 7, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Smooth well-defined edges with no visible issues.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 7);
});

test("modern clean note reconciliation handles no chipping or fraying phrasing", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges, well-defined with no chipping or fraying.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2018, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 9);
});

test("modern clean note reconciliation skips edges when touched language is present", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Smooth edges with touched corners visible on the left.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 8);
});

test("modern clean note reconciliation skips edges when damage language is present", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "both",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "edge_wear_light",
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges with minor edge fraying visible under close inspection.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.edges, 8);
});

test("modern clean note reconciliation raises corners 8 to 9 cautiously", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 8, edges: 9, surface: 9, centering: 9 },
    defects: [],
    primaryLimiterTag: null,
    categoryNotes: {
      corners: "Corners appear sharp and clean with no visible wear.",
      edges: "Clean edges.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "modern");
  assert.equal(normalized.categoryScores.corners, 9);
});

test("modern clean note reconciliation does not apply to vintage cards", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 8, surface: 9, centering: 9 },
    defects: [],
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges with no visible wear.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    cardMeta: { estimatedYear: 1968, isReflective: false, isDarkBorder: false },
  });

  const normalized = normalizeAnalysis(raw, "vintage");
  assert.ok(normalized.categoryScores.edges < 9);
  assert.ok(
    !normalized.visionReconciliationAudit?.some(
      (entry) => entry.source === "modern_clean_note_pillar_reconcile"
    )
  );
});

test("modern chromium false scratch strips tag when notes describe chrome finish only", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9, surface: 8, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Sharp corners and vibrant chrome presentation",
    eyeAppealSummary: "Strong Bowman Chrome refractor presentation.",
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "All corners sharp with no visible wear.",
      edges: "Edges clean and well-defined.",
      surface:
        "Bowman Chrome refractor finish shows reflective pattern and holographic background sparkle; surface appears clean with no significant surface issues.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);
  assert.ok(analysis.categoryScores.surface >= 9);
  assert.ok(
    analysis.visionReconciliationAudit?.some(
      (entry) => entry.source === "modern_chromium_false_scratch_strip"
    )
  );

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 9);
  assert.ok(result.psaGrade >= 9);
  assert.ok(
    !result.capAudit.some((entry) =>
      String(entry.source || "").includes("surface_scratch_light")
    )
  );
});

test("2023 G WEMBY Bowman Chrome false-positive scratch vision normalizes cleanly", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9, surface: 8, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Clean geometry with sharp corners",
    eyeAppealSummary: "Vibrant chrome refractor texture with strong eye appeal.",
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "All corners appear sharp with no visible wear or damage.",
      edges: "Edges are clean, sharp, and well-defined with no fraying or wear.",
      surface:
        "Chrome finish shows a lighting streak and refractor texture across the portrait; otherwise clean with no visible scratch crossing the artwork.",
      centering: "Centering is excellent.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);
  assert.ok(analysis.categoryScores.surface >= 9);

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 9);
  assert.ok(result.psaGrade >= 9);
  assert.equal(result.primaryLimiter.label, "None visible");
});

test("modern chromium scratch requires explicit note evidence not limiter label alone", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Centering",
    eyeAppealSummary: "Reflective Topps Chrome presentation.",
    cardMeta: { estimatedYear: 2024, isReflective: true, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Surface otherwise clean with chrome effect and glare under the light box.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("modern chromium confirmed hairline scratch remains with high confidence", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Hairline scratch on front",
    bestAttribute: "Centering",
    eyeAppealSummary: "Minor hairline scratch visible on chrome surface.",
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Hairline scratch visible crossing the background on the front.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, "surface_scratch_light");
});

test("2025 Bowman Chrome Wembanyama /299 rejects generic light scratch present language", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9, surface: 8, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Surface scratch light on the front",
    bestAttribute: "Strong centering and sharp corners",
    eyeAppealSummary: "Light scratch present, affecting surface quality on this Bowman Chrome /299.",
    cardMeta: {
      estimatedYear: 2025,
      isReflective: true,
      isDarkBorder: true,
      productLine: "2025 Bowman Chrome Victor Wembanyama /299",
    },
    categoryNotes: {
      corners: "All corners appear sharp with no visible wear.",
      edges: "Edges are clean, crisp, and well-defined.",
      surface:
        "2025 Bowman Chrome refractor finish. Light scratch present, affecting surface quality; otherwise clean chrome presentation.",
      centering: "Centering is excellent.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);
  assert.ok(analysis.categoryScores.surface >= 9);

  const result = computeGrade(analysis, "modern");
  assert.ok(result.internalGrade >= 9);
  assert.ok(result.psaGrade >= 9);
  assert.equal(result.primaryLimiter.label, "None visible");
});

test("modern chromium scratch with explicit located scratch and high confidence remains", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 8.5, centering: 9 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Scratch on front surface",
    bestAttribute: "Centering",
    eyeAppealSummary: "Bowman Chrome presentation.",
    cardMeta: { estimatedYear: 2025, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Scratch on the front surface near the lower border under angled light.",
      centering: "Well centered.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("Anthony Edwards Zero Gravity PSA 10 rejects generic surface scratch found near edge", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9.5, surface: 8.5, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Surface scratch found near the bottom edge",
    bestAttribute: "Strong centering and vibrant presentation",
    eyeAppealSummary:
      "Excellent eye appeal; surface scratch found near the bottom edge is the main limiter.",
    cardMeta: {
      estimatedYear: 2024,
      isReflective: false,
      isDarkBorder: false,
      productLine: "Panini Select Anthony Edwards Zero Gravity",
    },
    categoryNotes: {
      corners: "All four corners appear sharp with no visible whitening.",
      edges: "Edges are clean and well-defined throughout.",
      surface:
        "Glossy Zero Gravity insert finish. Surface scratch found near the bottom edge; otherwise clean glossy presentation.",
      centering: "Centering is excellent front to back.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);
  assert.ok(
    analysis.visionReconciliationAudit?.some(
      (entry) => entry.source === "modern_chromium_false_scratch_strip"
    )
  );

  const result = computeGrade(analysis, "modern");
  assert.ok(result.psaGrade >= 9);
  assert.ok(result.internalGrade >= 9);
  assert.ok(
    !result.capAudit.some((entry) =>
      String(entry.source || "").includes("surface_scratch_light")
    )
  );
});

test("2006 Topps Shaq PSA 10 rejects generic minor scratch on front surface", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9.5, surface: 9, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Minor scratch on the front surface",
    bestAttribute: "Strong centering",
    eyeAppealSummary:
      "Card presents well overall; minor scratch on the front surface limits the grade.",
    cardMeta: {
      estimatedYear: 2006,
      isReflective: false,
      isDarkBorder: false,
      productLine: "2006 Topps Shaquille O'Neal",
    },
    categoryNotes: {
      corners: "Corners appear sharp with minimal touch.",
      edges: "Edges are clean and crisp.",
      surface: "Glossy modern stock. Minor scratch on the front surface noted under inspection.",
      centering: "Centering is strong.",
    },
  };

  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, null);

  const result = computeGrade(analysis, "modern");
  assert.ok(result.psaGrade >= 9);
  assert.ok(result.internalGrade >= 9);
  assert.equal(result.primaryLimiter.label, "None visible");
});

function modern10EdgeFloorVision(overrides) {
  return {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: {
      corners: 9.5,
      edges: 8,
      surface: 9.5,
      centering: 10,
      ...overrides.categoryScores,
    },
    defects: [],
    primaryLimiterTag: null,
    primaryLimiterLabel: "None visible",
    bestAttribute: "Strong presentation",
    eyeAppealSummary: "Excellent eye appeal with clean geometry.",
    cardMeta: { estimatedYear: 2025, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "All corners appear sharp with no visible wear.",
      edges: "Clean edges.",
      surface: "Clean surface with no visible scratches.",
      centering: "Perfect centering.",
      ...overrides.categoryNotes,
    },
    ...overrides,
  };
}

test("2006 T ONEAL PSA 10 lifts false edge floor 8 to 9 from crisp clean edge note", () => {
  const raw = modern10EdgeFloorVision({
    categoryScores: { corners: 9.5, edges: 8, surface: 9.5, centering: 10 },
    cardMeta: { estimatedYear: 2006, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "All corners appear sharp and well-defined with no visible wear or damage.",
      edges: "Edges are crisp and clean with no evidence of wear, chipping, or roughness.",
      surface:
        "The front and back surfaces are free from scratches, dimples, or other imperfections.",
      centering: "The card is perfectly centered with no off-centering issues.",
    },
  });

  const analysis = normalizeAnalysis(raw, "modern");
  assert.equal(analysis.categoryScores.edges, 9);
  assert.ok(
    analysis.visionReconciliationAudit?.some(
      (entry) =>
        entry.source === "modern_clean_note_pillar_reconcile" && entry.pillar === "edges"
    )
  );

  const result = computeGrade(analysis, "modern");
  assert.equal(result.psaGrade, 9);
  assert.ok(result.internalGrade >= 9);
});

test("2024 D EDWARDS PSA 10 lifts false edge floor 8 to 9 from no chipping or roughness note", () => {
  const raw = modern10EdgeFloorVision({
    categoryScores: { corners: 9.5, edges: 8, surface: 9.5, centering: 9.5 },
    cardMeta: { estimatedYear: 2024, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "All corners appear sharp with no visible wear.",
      edges: "Edges are clean and well-defined with no visible chipping or roughness.",
      surface: "Surface is smooth and clear with no visible scratches or print lines.",
      centering: "Centering is excellent, maintaining visual symmetry.",
    },
  });

  const analysis = normalizeAnalysis(raw, "modern");
  assert.equal(analysis.categoryScores.edges, 9);

  const result = computeGrade(analysis, "modern");
  assert.equal(result.psaGrade, 9);
  assert.ok(result.internalGrade >= 9);
});

test("2025 B WOOD PSA 10 lifts false edge floor 8 to 9 from no wear fraying or chipping note", () => {
  const raw = modern10EdgeFloorVision({
    cardMeta: { estimatedYear: 2025, isReflective: true, isDarkBorder: false },
    categoryNotes: {
      corners: "All corners are sharp and appear in pristine condition with no visible wear.",
      edges: "Edges are factory-fresh, showing no signs of wear, fraying, or chipping.",
      surface: "Surface appears flawless with no visible scratches, scuffs, or print lines.",
      centering: "Centering is perfect, with even borders all around.",
    },
  });

  const analysis = normalizeAnalysis(raw, "modern");
  assert.equal(analysis.categoryScores.edges, 9);

  const result = computeGrade(analysis, "modern");
  assert.equal(result.psaGrade, 9);
  assert.ok(result.internalGrade >= 9);
});

test("2025 T MCDANIELS PSA 10 lifts false edge floor 8 to 9 from well-defined smooth edge note", () => {
  const raw = modern10EdgeFloorVision({
    cardMeta: { estimatedYear: 2023, isReflective: true, isDarkBorder: false },
    categoryNotes: {
      corners: "All corners appear sharp and clean with no visible wear or rounding.",
      edges:
        "Edges are well-defined and smooth, showing no signs of wear, chipping, or fraying.",
      surface:
        "The front surface is shiny and clear, free of scratches or surface imperfections.",
      centering: "The centering is perfect, allowing for even borders on all sides.",
    },
  });

  const analysis = normalizeAnalysis(raw, "modern");
  assert.equal(analysis.categoryScores.edges, 9);

  const result = computeGrade(analysis, "modern");
  assert.equal(result.psaGrade, 9);
  assert.ok(result.internalGrade >= 9);
});

test("scratch diagnostics trace records pipeline stages without changing grade", () => {
  const raw = {
    scanQuality: { level: "excellent", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9.5, edges: 9, surface: 8, centering: 9.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Surface scratch light on the front",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Light scratch present, affecting surface quality.",
    cardMeta: { estimatedYear: 2025, isReflective: true, isDarkBorder: true },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Light scratch present, affecting surface quality.",
      centering: "Well centered.",
    },
  };

  const without = normalizeAnalysis(JSON.parse(JSON.stringify(raw)), "modern");
  const withoutGrade = computeGrade(without, "modern");

  const trace = createScratchDiagnosticTrace(raw);
  const withTrace = normalizeAnalysis(JSON.parse(JSON.stringify(raw)), "modern", {
    scratchDiagnostics: trace,
  });
  const withGrade = computeGrade(withTrace, "modern");
  finalizeScratchDiagnosticTrace(trace, withTrace, withGrade);

  assert.equal(withGrade.psaGrade, withoutGrade.psaGrade);
  assert.equal(withGrade.internalGrade, withoutGrade.internalGrade);
  assert.ok(trace.visionRaw);
  assert.ok(trace.stages.length >= 5);
  assert.equal(trace.visionDefectTags.includes("surface_scratch_light"), true);
  assert.equal(trace.surfaceNoteBeforeReconciliation, raw.categoryNotes.surface);
  assert.ok(trace.summary?.hypothesis);
});

const __testDir = path.dirname(fileURLToPath(import.meta.url));
const benchmarksRoot = path.resolve(__testDir, "../../benchmarks");

function gradeVintageSnapshot(snapshotId) {
  const snapshotPath = path.join(
    benchmarksRoot,
    "live-runs/vision-snapshots",
    `${snapshotId}.json`
  );
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const rawVision = snapshot.rawVision || snapshot;
  const raw = {
    categoryScores: rawVision.categoryScores,
    defects: rawVision.defects || [],
    primaryLimiterTag: rawVision.primaryLimiterTag,
    primaryLimiterLabel: rawVision.primaryLimiterLabel,
    eyeAppealSummary: rawVision.eyeAppealSummary,
    bestAttribute: rawVision.bestAttribute,
    categoryNotes: rawVision.categoryNotes || {},
    scanQuality: rawVision.scanQuality || {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: rawVision.cardMeta || {},
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: raw.categoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  return { raw, analysis, result };
}

function inferRawCategoryScores(grade) {
  const scores = { ...(grade.categoryScores || {}) };
  for (const entry of grade.capAudit || []) {
    if (!entry.source?.startsWith("categoryImpact:")) continue;
    const category = entry.source.split(":")[2];
    if (category && entry.cap != null) {
      scores[category] = Math.max(scores[category] ?? 0, entry.cap + 2);
    }
  }
  const appeal = `${grade.eyeAppealSummary || ""} ${grade.bestAttribute || ""}`.toLowerCase();
  if (
    /\b(minimal wear|vibrant|presents well|clean surface|strong color)\b/.test(appeal) &&
    Math.min(scores.corners ?? 10, scores.edges ?? 10) >= 6
  ) {
    scores.surface = Math.max(scores.surface ?? 0, 7);
  }
  return scores;
}

function gradeVintageCache(cacheId) {
  const cachePath = path.join(benchmarksRoot, "cache", `${cacheId}.json`);
  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  const raw = {
    categoryScores: visionCategoryScores,
    defects: JSON.parse(JSON.stringify(grade.defects || [])),
    primaryLimiterTag: grade.primaryLimiter?.tag,
    primaryLimiterLabel: grade.primaryLimiter?.label,
    eyeAppealSummary: grade.eyeAppealSummary,
    bestAttribute: grade.bestAttribute,
    categoryNotes: grade.categoryNotes || {},
    scanQuality: grade.scanQuality || {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: grade.cardMeta || {},
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  return { raw, analysis, result };
}

// vintage calibration phase 2 — Fix 1: staining vs toning / yellow-back reconcile

test("F1-1 Eckersley PSA 9 — back toning not limiter", () => {
  const { analysis, result } = gradeVintageSnapshot("1978-t-eckersley-psa9");
  assert.notEqual(result.primaryLimiter.tag, "staining_light");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-2 Gibson PSA 9 — back toning not limiter", () => {
  const { analysis, result } = gradeVintageSnapshot("1981-t-gibson-psa9");
  assert.notEqual(result.primaryLimiter.tag, "staining_light");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-3 Winfield PSA 8 — stain demoted", () => {
  const { analysis, result } = gradeVintageSnapshot("1972-t-winfield-psa8");
  assert.notEqual(result.primaryLimiter.tag, "staining_light");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-4 Stargell PSA 7 — stain demoted", () => {
  const { analysis, result } = gradeVintageSnapshot("1972-t-stargell-psa7");
  assert.notEqual(result.primaryLimiter.tag, "staining_light");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-5 Williams PSA 6 — anchor unchanged", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "1951-b-williams-psa6.json");
  if (!fs.existsSync(cachePath)) {
    return;
  }
  const { result } = gradeVintageCache("1951-b-williams-psa6");
  assert.equal(result.psaGrade, 6);
});

test("F1-6 Smith PSA 6 — anchor unchanged", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "1951-p-smith-psa6.json");
  if (!fs.existsSync(cachePath)) {
    return;
  }
  const { result } = gradeVintageCache("1951-p-smith-psa6");
  assert.equal(result.psaGrade, 6);
});

test("F1-7 McCovey PSA 4 — true stain retained", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 4, edges: 3.5, surface: 2.5, centering: 7.5 },
    defects: [
      { tag: "writing_mark_severe", severity: "severe", location: "front", confidence: "high" },
      { tag: "edge_fraying_major", severity: "major", location: "front", confidence: "high" },
      { tag: "staining_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "writing_mark_severe",
    primaryLimiterLabel: "Severe writing on front",
    bestAttribute: "Fair centering",
    eyeAppealSummary: "Heavy front writing and heavy staining limit eye appeal.",
    cardMeta: { estimatedYear: 1980, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Rounded corners with moderate wear.",
      edges: "Heavy edge wear and chipping.",
      surface: "Heavy front stain and significant writing on the surface.",
      centering: "Well centered.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );
  assert.ok(result.psaGrade <= 2);
  assert.ok(analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-8 Mantle PSA 7 — stain demoted not limiter", () => {
  const { analysis, result } = gradeVintageSnapshot("1962-t-mantle-psa7");
  assert.notEqual(result.primaryLimiter.tag, "staining_light");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-N1 front stain on poor-band card retains staining_light", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 4, edges: 4, surface: 4, centering: 6 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "staining_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Heavy front stain",
    bestAttribute: "Fair eye appeal",
    eyeAppealSummary: "Heavy wear and heavy front staining visible.",
    cardMeta: { estimatedYear: 1962, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Rounded corners with heavy wear.",
      edges: "Heavy edge wear throughout.",
      surface: "Heavy front stain limits surface quality.",
      centering: "Off center.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-N2 moisture note present retains stain tag", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7, edges: 7, surface: 7, centering: 8 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "staining_light", severity: "minor", location: "back", confidence: "high" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Back moisture staining",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Water damage visible on the back.",
    cardMeta: { estimatedYear: 1975, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Light corner touch.",
      edges: "Clean edges.",
      surface: "Clean front surface.",
      back: "Water damage and warping on the back.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.defects.some((defect) => defect.tag === "staining_light"));
});

test("F1-N3 modern era card with back toning skips Fix 1 vintage reconcile", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9.5 },
    defects: [
      { tag: "staining_light", severity: "minor", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light back toning",
    bestAttribute: "Gem presentation",
    eyeAppealSummary: "Clean card with normal age toning on the back.",
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Clean surface.",
      back: "Yellowed back consistent with normal vintage discoloration.",
    },
  };
  const vintageAnalysis = normalizeAnalysis(JSON.parse(JSON.stringify(raw)), "vintage");
  const modernAnalysis = normalizeAnalysis(JSON.parse(JSON.stringify(raw)), "modern");
  assert.ok(!vintageAnalysis.defects.some((defect) => defect.tag === "staining_light"));
  assert.ok(modernAnalysis.defects.some((defect) => defect.tag === "staining_light"));
  assert.equal(modernAnalysis.vintageCosmeticBackStainRelief, false);
  assert.equal(modernAnalysis.vintageExBackStainOnlyReconciled, false);
});

// vintage calibration phase 2 — Fix 5: NM triad light-wear skip (conservative)

function assertNoTriadCap(result) {
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
}

test("F5-1 Marshall PSA 9 — no triad cap", () => {
  const { result } = gradeVintageSnapshot("1959-t-marshall-psa9");
  assert.ok(result.psaGrade >= 6);
  assertNoTriadCap(result);
});

test("F5-2 Tyler PSA 9 — no optimistic cap", () => {
  const { result } = gradeVintageSnapshot("1981-t-tyler-psa9");
  assert.ok(result.psaGrade >= 6);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:optimistic_light_wear")
  );
});

test("F5-3 Kennedy PSA 8 — triad skip", () => {
  const { result } = gradeVintageSnapshot("1953-t-kennedy-psa8");
  assert.ok(result.psaGrade >= 6);
  assertNoTriadCap(result);
});

test("F5-4 Superman PSA 8 — triad skip", () => {
  const { result } = gradeVintageSnapshot("1966-t-superman-psa8");
  assert.ok(result.psaGrade >= 6);
  assertNoTriadCap(result);
});

test("F5-5 Dykes PSA 7 — triad skip", () => {
  const { result } = gradeVintageSnapshot("1933-d-dykes-psa7");
  assert.ok(result.psaGrade >= 5);
  assertNoTriadCap(result);
});

test("F5-6 Groth PSA 7 — writing excluded", () => {
  const { analysis, result } = gradeVintageSnapshot("1953-t-groth-psa7");
  assert.ok(result.psaGrade <= 4);
  assert.ok(analysis.defects.some((defect) => defect.tag === "writing_mark_severe"));
});

test("F5-7 Ripken PSA 7 — NM scratch path", () => {
  const { result } = gradeVintageSnapshot("1982-t-ripken-psa7");
  assert.ok(result.psaGrade >= 6);
  assertNoTriadCap(result);
});

test("F5-8 Rose PSA 7 — anchor", () => {
  const { result } = gradeVintageSnapshot("1963-t-rose-psa7");
  assert.equal(result.psaGrade, 7);
});

test("F5-9 Eckersley PSA 9 — NM lift", () => {
  const { analysis, result } = gradeVintageSnapshot("1978-t-eckersley-psa9");
  assert.ok(result.psaGrade >= 7);
  const wearMin = Math.min(
    analysis.categoryScores.corners,
    analysis.categoryScores.edges,
    analysis.categoryScores.surface
  );
  assert.ok(wearMin >= 6.5);
});

test("F5-10 Gibson PSA 9 — NM lift", () => {
  const { result } = gradeVintageSnapshot("1981-t-gibson-psa9");
  assert.ok(result.psaGrade >= 6);
  assertNoTriadCap(result);
});

test("F5-11 Mantle EX-NM — within ±1", () => {
  const { result } = gradeVintageSnapshot("1962-t-mantle-psa7");
  assert.equal(result.psaGrade, 8);
  assertNoTriadCap(result);
});

test("2C-1 Mantle PSA 7 — gem stain relief capped at floor 8", () => {
  const { analysis, result } = gradeVintageSnapshot("1962-t-mantle-psa7");
  assert.equal(result.psaGrade, 8);
  assert.equal(analysis.vintageCosmeticBackStainRelief, true);
  const stainRelief = result.capAudit.find(
    (entry) => entry.source === "nm_band:gem_stain_relief"
  );
  assert.ok(stainRelief);
  assert.equal(stainRelief.floor, 8);
});

test("2C-2 Starr PSA 7 — full gem stain relief floor 9 preserved", () => {
  const { result } = gradeVintageSnapshot("1960-t-starr-psa7");
  const stainRelief = result.capAudit.find(
    (entry) => entry.source === "nm_band:gem_stain_relief"
  );
  assert.ok(stainRelief);
  assert.equal(stainRelief.floor, 9);
  assert.equal(result.psaGrade, 9);
});

test("2C-3 cosmetic back stain on 8/7.5/7.5 pillars caps stain relief at 8", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 8, edges: 7.5, surface: 7.5, centering: 8 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "medium" },
      { tag: "staining_light", severity: "minor", location: "back", confidence: "medium" },
    ],
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "minor corner wear",
    bestAttribute: "strong overall presentation with solid centering",
    eyeAppealSummary: "Beautiful visual appeal with minimal visible wear.",
    cardMeta: { estimatedYear: 1962, isReflective: false, isDarkBorder: true },
    categoryNotes: {
      corners: "Some light wear evident on the corners, consistent with age.",
      edges: "Edges show minor wear but primarily intact.",
      surface: "Surface remains overall clean; light back toning only.",
      centering: "Strong centering, well aligned.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: raw.categoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  const stainRelief = result.capAudit.find(
    (entry) => entry.source === "nm_band:gem_stain_relief"
  );
  assert.ok(stainRelief);
  assert.equal(stainRelief.floor, 8);
  assert.ok(result.psaGrade <= 8);
});

test("2C-4 surface below 8.5 blocks full gem stain relief floor", () => {
  const capAudit = [];
  const categoryScores = { corners: 8, edges: 8, surface: 8, centering: 8.5 };
  const bandScores = { corners: 8, edges: 8, surface: 8 };
  const defects = [
    { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
    { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
  ];
  const analysis = {
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "Light corner wear",
    vintageCosmeticBackStainRelief: true,
    visionCategoryScores: bandScores,
    eyeAppealSummary: "Well preserved NM presentation with vibrant color.",
    bestAttribute: "Strong centering and clean surfaces",
    categoryNotes: {
      corners: "Sharp corners with minor touch wear.",
      edges: "Light edge wear only.",
      surface: "Clean surface; light back toning only.",
      centering: "Well centered.",
    },
  };
  assert.ok(qualifiesForNmBandVintageCapSkip(categoryScores, defects, analysis));
  const overall = applyNmGemVintageBandRules(
    7,
    categoryScores,
    defects,
    capAudit,
    analysis,
    "vintage"
  );
  const stainRelief = capAudit.find((entry) => entry.source === "nm_band:gem_stain_relief");
  assert.ok(stainRelief);
  assert.equal(stainRelief.floor, 8);
  assert.equal(overall, 8);
});

test("2C-5 Howton PSA 8 — stain relief capped at floor 8", () => {
  const { result } = gradeVintageSnapshot("1957-t-howton-psa8");
  assert.equal(result.psaGrade, 8);
  const stainRelief = result.capAudit.find(
    (entry) => entry.source === "nm_band:gem_stain_relief"
  );
  assert.ok(stainRelief);
  assert.equal(stainRelief.floor, 8);
});

// vintage calibration phase 2 — Phase 2B: vision-aware triad skip companion

function assertTriadCompanionLift(result) {
  assert.ok(result.psaGrade >= 7);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "vintage:triad_skip_category_floor_relief" ||
        entry.source === "nm_band:mint_floor" ||
        (entry.source === "categoryFloor" && (entry.value ?? 0) >= 6.5)
    )
  );
}

test("F2B-1 Hunter PSA 9 — vision-aware triad skip lifts to within ±1", () => {
  const { analysis, result } = gradeVintageCache("1967-t-hunter-psa9");
  assert.ok(analysis.vintageTriadNormalizeClamp);
  assert.ok(hasVintageTriadNormalizeClamp(analysis, analysis.categoryScores));
  assertTriadCompanionLift(result);
});

test("F2B-2 Rose / Drysdale / Clemens PSA 9 cluster lift", () => {
  for (const id of ["1969-t-rose-psa9", "1968-t-drysdale-psa9", "1984-f-clemens-psa9"]) {
    const { result } = gradeVintageSnapshot(id);
    assert.ok(result.psaGrade >= 6, `${id} expected Gem >= 6`);
    assert.ok(
      !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes"),
      `${id} triad cap should be skipped`
    );
  }
  const { result: drysdale } = gradeVintageSnapshot("1968-t-drysdale-psa9");
  assert.ok(drysdale.psaGrade >= 7);
});

test("F2B-3 Cash / Henderson PSA 7 — nmCapSkip blocked triad path lifted", () => {
  const { result: cash } = gradeVintageCache("1971-t-cash-psa7");
  assert.ok(cash.psaGrade >= 6);
  const { result: henderson } = gradeVintageCache("1981-t-henderson-psa7");
  assert.ok(henderson.psaGrade >= 7);
});

test("F2B-4 Meyer / Seaver / Winfield lift", () => {
  const { result: meyer } = gradeVintageCache("1952-t-meyer-psa7");
  assert.ok(meyer.psaGrade >= 6);
  const { result: seaver } = gradeVintageCache("1983-t-seaver-psa9");
  assert.ok(seaver.psaGrade >= 5);
  assert.ok(seaver.psaGrade <= 5);
  const { result: winfield } = gradeVintageCache("1972-t-winfield-psa8");
  assert.ok(winfield.psaGrade >= 7);
});

test("F2B-5 Yount PSA 9 — triad clamp relief reaches within ±1", () => {
  const { result } = gradeVintageCache("1976-t-yount-psa9");
  assert.ok(result.psaGrade >= 8);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
});

// vintage calibration phase 3 — Phase 3A: triad clamp cap relief (Yount)

test("F3A-1 Yount PSA 9 — triad cap skipped with clamp floor relief", () => {
  const { analysis, result } = gradeVintageCache("1976-t-yount-psa9");
  assert.ok(analysis.vintageTriadNormalizeClamp);
  assert.ok(result.psaGrade >= 8);
  assert.ok(Math.abs(result.psaGrade - 9) <= 1);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
  assert.ok(
    result.capAudit.some(
      (entry) => entry.source === "vintage:triad_skip_category_floor_relief"
    )
  );
});

test("F3A-2 Carew / Brydge — moderate and crease stacks do not receive triad clamp relief", () => {
  const { result: carew } = gradeVintageSnapshot("1967-t-carew-psa7");
  assert.equal(carew.psaGrade, 2);
  const { result: brydge } = gradeVintageCache("1933-w-brydge-psa8");
  assert.equal(brydge.psaGrade, 3);
});

test("F3A-3 modern card skips vintage triad clamp relief path", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 7, edges: 6.5, surface: 6.5, centering: 8 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    categoryNotes: {
      corners: "Minor corner wear.",
      edges: "Light edge wear.",
      surface: "Light scratches but overall presents well.",
      centering: "Strong centering.",
    },
    eyeAppealSummary: "Good overall eye appeal.",
    cardMeta: { estimatedYear: 2018, isReflective: false, isDarkBorder: false },
  });
  const analysis = normalizeAnalysis(raw, "modern");
  const result = computeGrade(analysis, "modern");
  assert.ok(!analysis.vintageTriadNormalizeClamp);
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:triad_skip_category_floor_relief"
    )
  );
});

test("F2B-6 Dawson PSA 7 — uniform optimism companion skip", () => {
  const { result } = gradeVintageCache("1977-t-dawson-psa7");
  assert.ok(result.psaGrade >= 7);
  assert.ok(
    !result.capAudit.some(
      (entry) =>
        entry.source === "vintage:uniform_optimistic_light_wear" && entry.cap === 5.5
    )
  );
});

test("F2B-7 Carew PSA 7 — poor-band cluster unchanged", () => {
  const { result } = gradeVintageSnapshot("1967-t-carew-psa7");
  assert.equal(result.psaGrade, 2);
});

test("F2B-8 Moon / Brydge crease cards unchanged", () => {
  const { result: moon } = gradeVintageCache("1956-t-moon-psa7");
  assert.equal(moon.psaGrade, 2);
  const { result: brydge } = gradeVintageCache("1933-w-brydge-psa8");
  assert.equal(brydge.psaGrade, 3);
});

test("F2B-9 scratch gremlins non-regression", () => {
  const { result: eck } = gradeVintageCache("1978-t-eckersley-psa9");
  assert.ok(eck.psaGrade >= 7);
  const { result: expos } = gradeVintageCache("1971-t-expos-psa9");
  assert.ok(expos.psaGrade >= 7);
  const { result: morris } = gradeVintageCache("1978-t-morris-psa7");
  assert.ok(morris.psaGrade >= 5);
});

test("F2B-10 Starr PSA 7 — no inflation beyond 2C stain relief", () => {
  const { result } = gradeVintageCache("1960-t-starr-psa7");
  assert.ok(result.psaGrade <= 9);
});

test("F2B-11 Mantle PSA 7 — 2C stain relief cap preserved", () => {
  const { result } = gradeVintageSnapshot("1962-t-mantle-psa7");
  assert.ok(result.psaGrade >= 7);
  assert.ok(result.psaGrade <= 8);
  const stainRelief = result.capAudit.find(
    (entry) => entry.source === "nm_band:gem_stain_relief"
  );
  assert.ok(stainRelief);
  assert.ok(stainRelief.floor <= 8);
});

test("F2B-12 modern card skips vintage triad companion path", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
    ],
  });
  const analysis = normalizeAnalysis(raw, "modern");
  const result = computeGrade(analysis, "modern");
  assert.ok(!hasVintageTriadNormalizeClamp(analysis, analysis.categoryScores));
  assert.ok(
    !result.capAudit.some(
      (entry) => entry.source === "vintage:triad_skip_category_floor_relief"
    )
  );
});

test("F2B-13 PSA 4–6 inflation anchors unchanged", () => {
  const { result: bird } = gradeVintageCache("1989-f-bird-psa4");
  assert.ok(bird.psaGrade <= 5);
  assert.ok(
    !bird.capAudit.some((entry) => entry.source === "nm_band:mint_floor")
  );
  const { result: martin } = gradeVintageCache("1953-t-martin-psa5");
  assert.equal(martin.psaGrade, 2);
  const { result: ryan } = gradeVintageCache("1975-t-ryan-psa4");
  assert.equal(ryan.psaGrade, 4);
  const { result: howe } = gradeVintageCache("1965-t-howe-psa4");
  assert.ok(howe.psaGrade <= 4);
  const { result: williams } = gradeVintageCache("1951-b-williams-psa6");
  assert.equal(williams.psaGrade, 6);
  const { result: smith } = gradeVintageCache("1951-p-smith-psa6");
  assert.equal(smith.psaGrade, 6);
});

// vintage calibration phase 3 — Phase 3B-1: triad clamp floor recovery companion

test("F3B-1 Winfield PSA 8 — floor recovery lifts into within ±1", () => {
  const { analysis, result } = gradeVintageCache("1972-t-winfield-psa8");
  assert.ok(analysis.vintageTriadNormalizeClamp);
  assert.ok(result.psaGrade >= 7);
  assert.ok(Math.abs(result.psaGrade - 8) <= 1);
  const relief = result.capAudit.find(
    (entry) => entry.source === "vintage:triad_skip_category_floor_relief"
  );
  assert.ok(relief);
  assert.ok((relief.floor ?? 0) >= 7);
});

test("F3B-2 Rose PSA 9 — floor recovery lifts above crushed 5.5 floor", () => {
  const { result } = gradeVintageSnapshot("1969-t-rose-psa9");
  assert.ok(result.psaGrade >= 7);
  assert.ok(Math.abs(result.psaGrade - 9) <= 1);
  const floor = result.capAudit.find((entry) => entry.source === "categoryFloor");
  assert.ok((floor?.value ?? 0) >= 7);
});

test("F3B-3 Clemens PSA 9 — floor recovery improves deflated grade", () => {
  const { result } = gradeVintageSnapshot("1984-f-clemens-psa9");
  assert.ok(result.psaGrade >= 7);
  const relief = result.capAudit.find(
    (entry) => entry.source === "vintage:triad_skip_category_floor_relief"
  );
  assert.ok(relief);
  assert.ok((relief.floor ?? 0) >= 7);
});

test("F3B-1-N1 Seaver PSA 9 — deferred; no 3B-1 floor recovery", () => {
  const { result } = gradeVintageCache("1983-t-seaver-psa9");
  assert.ok(result.psaGrade <= 5);
  assert.ok(
    !result.capAudit.some(
      (entry) =>
        entry.source === "vintage:triad_skip_category_floor_relief" &&
        (entry.floor ?? 0) > 6
    )
  );
});

test("F3B-1-N2 Carew / Brydge — no triad floor recovery", () => {
  const { result: carew } = gradeVintageSnapshot("1967-t-carew-psa7");
  assert.equal(carew.psaGrade, 2);
  const { result: brydge } = gradeVintageCache("1933-w-brydge-psa8");
  assert.equal(brydge.psaGrade, 3);
});

test("F3B-1-N3 Bird PSA 4 — inflation guard preserved", () => {
  const { result } = gradeVintageCache("1989-f-bird-psa4");
  assert.ok(result.psaGrade <= 5);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "nm_band:mint_floor")
  );
});

test("F3B-1-N4 Yount PSA 9 — 3A floor relief regression", () => {
  const { result } = gradeVintageCache("1976-t-yount-psa9");
  assert.ok(result.psaGrade >= 8);
  assert.ok(Math.abs(result.psaGrade - 9) <= 1);
});

// vintage calibration phase 3 — Phase 3E: low-slab mint_floor guard (Bird inflation)

test("F3E-1 Bird PSA 4 — mint_floor blocked by Ryan-style optimism guard", () => {
  const { result } = gradeVintageCache("1989-f-bird-psa4");
  assert.ok(result.psaGrade <= 5);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "ex_band:uniform_light_optimism_ceiling" && entry.cap === 4
    )
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "nm_band:mint_floor")
  );
});

test("F3E-2 Ryan-style single corner tag does not receive nm_band mint_floor uplift", () => {
  const categoryScores = { corners: 8, edges: 7.5, surface: 8, centering: 8 };
  const defects = [
    {
      tag: "corner_wear_light",
      severity: "minor",
      location: "front",
      confidence: "high",
    },
  ];
  const analysis = baseAnalysis({
    categoryScores,
    defects,
    primaryLimiterTag: "corner_wear_light",
    cardMeta: { estimatedYear: 1989, isReflective: false, isDarkBorder: false },
  });
  const capAudit = [];
  const overall = applyNmGemVintageBandRules(
    4,
    categoryScores,
    defects,
    capAudit,
    analysis,
    "vintage"
  );
  assert.equal(overall, 4);
  assert.ok(!capAudit.some((entry) => entry.source === "nm_band:mint_floor"));
});

test("F3E-3 Hunter PSA 9 — NM lift via mint_floor or triad floor recovery", () => {
  const { result } = gradeVintageCache("1967-t-hunter-psa9");
  assert.ok(result.psaGrade >= 7);
  assert.ok(
    result.capAudit.some(
      (entry) =>
        entry.source === "nm_band:mint_floor" ||
        (entry.source === "vintage:triad_skip_category_floor_relief" &&
          (entry.floor ?? 0) >= 7)
    )
  );
});

test("F2B-14 triad normalize clamp sets vision evidence without direct pillar input", () => {
  const { analysis, result } = gradeVintageCache("1967-t-hunter-psa9");
  assert.ok(analysis.vintageTriadNormalizeClamp);
  assert.ok(analysis.preTriadClampWearScores);
  const normMin = Math.min(
    analysis.categoryScores.corners,
    analysis.categoryScores.edges,
    analysis.categoryScores.surface
  );
  const evidenceMin = Math.min(
    analysis.preTriadClampWearScores.corners,
    analysis.preTriadClampWearScores.edges,
    analysis.preTriadClampWearScores.surface
  );
  assert.ok(normMin <= 5.5);
  assert.ok(evidenceMin > 5.5);
  assert.ok(result.psaGrade >= 7);
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
});

test("F5-N1 Howe PSA 4 — triad cap may remain", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "1965-t-howe-psa4.json");
  if (!fs.existsSync(cachePath)) {
    const raw = {
      scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
      categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 7 },
      defects: [
        { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
      ],
      primaryLimiterTag: "corner_wear_light",
      primaryLimiterLabel: "Light corner wear",
      bestAttribute: "Decent centering for grade",
      eyeAppealSummary: "VG/EX presentation with light wear on all pillars.",
      cardMeta: { estimatedYear: 1965, isReflective: false, isDarkBorder: false },
      categoryNotes: {
        corners: "Light corner wear visible.",
        edges: "Minor edge wear noted.",
        surface: "Light surface scratches present.",
        centering: "Well centered.",
      },
    };
    const analysis = normalizeAnalysis(raw, "vintage");
    const result = computeGrade(
      { ...analysis, visionCategoryScores: raw.categoryScores },
      "vintage"
    );
    assert.ok(result.psaGrade <= 4);
    return;
  }
  const { result } = gradeVintageCache("1965-t-howe-psa4");
  assert.ok(result.psaGrade <= 4);
});

test("F5-N2 Killan PSA 6 — no inflation above slab", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "t206-killan-psa6.json");
  if (!fs.existsSync(cachePath)) {
    const raw = {
      scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
      categoryScores: { corners: 7.5, edges: 7, surface: 7.5, centering: 7 },
      defects: [
        { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
      ],
      primaryLimiterTag: "corner_wear_light",
      primaryLimiterLabel: "Light corner wear",
      bestAttribute: "Strong color",
      eyeAppealSummary: "EX presentation with light wear throughout.",
      cardMeta: { estimatedYear: 1909, isReflective: false, isDarkBorder: false },
      categoryNotes: {
        corners: "Light wear on corners.",
        edges: "Light edge wear.",
        surface: "Minor surface wear.",
        centering: "Fair centering.",
      },
    };
    const analysis = normalizeAnalysis(raw, "vintage");
    const result = computeGrade(
      { ...analysis, visionCategoryScores: raw.categoryScores },
      "vintage"
    );
    assert.ok(result.psaGrade <= 6);
    return;
  }
  const { result } = gradeVintageCache("t206-killan-psa6");
  assert.ok(result.psaGrade <= 6);
});

test("F5-N3 Bird PSA 4 — optimism ceiling intact", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6, edges: 5.5, surface: 6, centering: 8 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "corner_wear_light",
    primaryLimiterLabel: "Corner wear",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Clean colors with visible light wear.",
    cardMeta: { estimatedYear: 1989, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor corner wear.",
      edges: "Light edge wear.",
      surface: "Light scratches on surface.",
      centering: "Well centered.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );
  assert.ok(result.psaGrade <= 5);
});

test("F5-N4 Carew PSA 7 — moderate defects retained", () => {
  const { analysis, result } = gradeVintageSnapshot("1967-t-carew-psa7");
  assert.ok(
    analysis.defects.some((defect) =>
      ["corner_wear_moderate", "surface_scratch_moderate"].includes(defect.tag)
    )
  );
  assert.ok(result.psaGrade <= 5);
});

test("F5-N5 Henderson PSA 3 — VG distributed wear path preserved", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6.5, surface: 6.5, centering: 7 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "both", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "staining_light", severity: "minor", location: "back", confidence: "high" },
    ],
    primaryLimiterTag: "staining_light",
    primaryLimiterLabel: "Light staining",
    bestAttribute: "centering",
    eyeAppealSummary:
      "Card displays decent centering with visible surface, corner, and edge wear.",
    cardMeta: { estimatedYear: 1980, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "",
      edges: "",
      surface: "",
      centering: "",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );
  assert.ok(result.psaGrade <= 4);
  assert.ok(result.psaGrade >= 2);
});

test("F5-N6 modern era card skips vintage triad NM path", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7, surface: 7.5, centering: 9 },
    defects: [
      { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
      { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratches",
    bestAttribute: "Clean surface with minimal wear",
    eyeAppealSummary: "Well preserved NM presentation with light wear on all pillars.",
    cardMeta: { estimatedYear: 2020, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor corner wear.",
      edges: "Light edge wear.",
      surface: "Light scratches on surface.",
      centering: "Well centered.",
    },
  };
  const analysis = normalizeAnalysis(raw, "modern");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "modern"
  );
  assert.ok(
    !result.capAudit.some((entry) => entry.source === "vintage:triad_light_wear_notes")
  );
});

function vintageNmScratchFixture(overrides = {}) {
  return {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 7.5, edges: 7.5, surface: 7.5, centering: 8.5 },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    primaryLimiterLabel: "Light surface scratch",
    bestAttribute: "Strong centering",
    eyeAppealSummary: "Clean NM presentation with vibrant colors.",
    cardMeta: { estimatedYear: 1975, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Minor corner wear.",
      edges: "Light edge wear.",
      surface: "Clean surface.",
      centering: "Well centered.",
    },
    ...overrides,
  };
}

test("F3-1 vintage PSA 9 generic few minor scratches — strip surface_scratch_light", () => {
  const raw = vintageNmScratchFixture({
    categoryScores: { corners: 8, edges: 8, surface: 8, centering: 9 },
    categoryNotes: {
      corners: "Sharp corners.",
      edges: "Clean edges.",
      surface: "Generally clean surface with a few minor scratches.",
      centering: "Well centered.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-2 Boggs-like clean surface note — strip scratch tag", () => {
  const raw = vintageNmScratchFixture({
    categoryScores: { corners: 7, edges: 7, surface: 7, centering: 8 },
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Surface is clean with minimal visible issues.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.notEqual(analysis.primaryLimiterTag, "surface_scratch_light");
});

test("F3-3 Rose-like non-detraction generic scratch — strip tag", () => {
  const raw = vintageNmScratchFixture({
    categoryScores: { corners: 8, edges: 7.5, surface: 8, centering: 8.5 },
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface:
        "Generally clean surface with a few light scratches that do not detract significantly.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-4 Hunter-like otherwise clean surface — strip tag", () => {
  const raw = vintageNmScratchFixture({
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Light scratches detected; otherwise clean surface.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-5 linear/hairline scratch — retain surface_scratch_light", () => {
  const raw = vintageNmScratchFixture({
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "A hairline scratch crosses the lower background near the border.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-6 scratch crossing artwork — retain tag", () => {
  const raw = vintageNmScratchFixture({
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Visible scratch crossing the artwork on the front.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-7 Ripken PSA 7 snapshot — retain scratch within band", () => {
  const { analysis, result } = gradeVintageSnapshot("1982-t-ripken-psa7");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(result.psaGrade >= 6);
  assert.ok(Math.abs(result.psaGrade - 7) <= 1);
});

test("F3-8 PSA 5 EX moderate scratch — retain surface_scratch_moderate", () => {
  const raw = {
    scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
    categoryScores: { corners: 6.5, edges: 6.5, surface: 6, centering: 7.5 },
    defects: [
      {
        tag: "surface_scratch_moderate",
        severity: "moderate",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_moderate",
    primaryLimiterLabel: "Moderate surface scratching",
    bestAttribute: "Decent centering",
    eyeAppealSummary: "EX wear with visible surface scratching.",
    cardMeta: { estimatedYear: 1970, isReflective: false, isDarkBorder: false },
    categoryNotes: {
      corners: "Light corner wear.",
      edges: "Minor edge wear.",
      surface: "Continuous moderate scratching visible on the front surface.",
      centering: "Well centered.",
    },
  };
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(
    analysis.defects.some(
      (defect) =>
        defect.tag === "surface_scratch_moderate" || defect.tag === "surface_scratch_light"
    )
  );
});

test("F3-9 modern generic scratch — existing modern strip unchanged", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    cardMeta: { estimatedYear: 2020, isReflective: true, isDarkBorder: false },
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    categoryNotes: {
      corners: "Sharp.",
      edges: "Clean.",
      surface: "Light scratch present on the front surface.",
      centering: "Well centered.",
    },
    eyeAppealSummary: "Pristine chrome presentation aside from finish sparkle.",
    bestAttribute: "Strong centering",
  });
  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
});

test("F3-10 vintage scratch gate audit entry on strip", () => {
  const raw = vintageNmScratchFixture({
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Clean surface with a few minor scratches.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(
    (analysis.visionReconciliationAudit || []).some(
      (entry) => entry.source === "vintage_nm_scratch_skepticism_strip"
    )
  );
});

test("F3-11 filterUnconfirmedSurfaceScratchDefects remains modern-only", () => {
  const raw = vintageNmScratchFixture({
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Minor surface scratches noted.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(
    (analysis.visionReconciliationAudit || []).some(
      (entry) => entry.source === "vintage_nm_scratch_skepticism_strip"
    )
  );
});

test("F3-12 after strip primary limiter recalculates", () => {
  const raw = vintageNmScratchFixture({
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    categoryNotes: {
      corners: "Minor corner wear.",
      edges: "Light edge wear.",
      surface: "Few light scratches present.",
      centering: "Strong centering.",
    },
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.equal(analysis.primaryLimiterTag, "corner_wear_light");
});

test("F3-13 scratch stripped without blocking grade computation", () => {
  const raw = vintageNmScratchFixture({
    defects: [
      {
        tag: "surface_scratch_light",
        severity: "minor",
        location: "front",
        confidence: "medium",
      },
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
      {
        tag: "edge_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    primaryLimiterTag: "surface_scratch_light",
    categoryNotes: {
      corners: "Minor wear.",
      edges: "Light wear.",
      surface: "Few minor scratches on an otherwise clean card.",
      centering: "Strong centering.",
    },
    eyeAppealSummary: "Bright front presentation with strong centering.",
  });
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    { ...analysis, visionCategoryScores: raw.categoryScores },
    "vintage"
  );
  assert.ok(!analysis.defects.some((defect) => defect.tag === "surface_scratch_light"));
  assert.ok(
    (analysis.visionReconciliationAudit || []).some(
      (entry) => entry.source === "vintage_nm_scratch_skepticism_strip"
    )
  );
  assert.ok(result.psaGrade != null);
  assert.ok(result.psaGrade >= 5);
});

test("F3-14 Marshall PSA 9 — gate skips sub-NM pillar profile", () => {
  const { result, analysis } = gradeVintageSnapshot("1959-t-marshall-psa9");
  assert.ok(result.psaGrade >= 3);
  assert.ok(
    analysis.defects.some((defect) => defect.tag === "surface_scratch_light")
  );
});

test("F3-N1 Fix 1 Cobb snapshot — stain path unchanged", () => {
  const { analysis } = gradeVintageSnapshot("1950-c-cobb-psa9");
  assert.ok(
    analysis.defects.some(
      (defect) =>
        defect.tag === "staining_light" ||
        defect.tag === "surface_wear" ||
        defect.tag === "writing_mark"
    )
  );
});

test("F3-N2 Fix 5 Eckersley NM lift still applies", () => {
  const { analysis, result } = gradeVintageSnapshot("1978-t-eckersley-psa9");
  assert.ok(result.psaGrade >= 7);
  const wearMin = Math.min(
    analysis.categoryScores.corners,
    analysis.categoryScores.edges,
    analysis.categoryScores.surface
  );
  assert.ok(wearMin >= 6.5);
});

test("F3-N3 Howe PSA 4 — no scratch relief inflation", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "1965-t-howe-psa4.json");
  if (!fs.existsSync(cachePath)) {
    const raw = {
      scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
      categoryScores: { corners: 5.5, edges: 5.5, surface: 5.5, centering: 7 },
      defects: [
        { tag: "corner_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "edge_wear_light", severity: "minor", location: "front", confidence: "high" },
        { tag: "surface_scratch_light", severity: "minor", location: "front", confidence: "high" },
      ],
      primaryLimiterTag: "corner_wear_light",
      categoryNotes: {
        corners: "Light corner wear visible.",
        edges: "Minor edge wear noted.",
        surface: "Light surface scratches present.",
        centering: "Well centered.",
      },
      cardMeta: { estimatedYear: 1965, isReflective: false, isDarkBorder: false },
    };
    const analysis = normalizeAnalysis(raw, "vintage");
    const result = computeGrade(
      { ...analysis, visionCategoryScores: raw.categoryScores },
      "vintage"
    );
    assert.ok(result.psaGrade <= 4);
    return;
  }
  const { result } = gradeVintageCache("1965-t-howe-psa4");
  assert.ok(result.psaGrade <= 4);
});

test("F3-N4 modern card does not receive vintage scratch audit", () => {
  const raw = baseAnalysis({
    categoryScores: { corners: 9, edges: 9, surface: 9, centering: 9 },
    defects: [
      {
        tag: "corner_wear_light",
        severity: "minor",
        location: "front",
        confidence: "high",
      },
    ],
    categoryNotes: {
      corners: "Minor touch.",
      edges: "Clean.",
      surface: "Clean aside from refractor finish sparkle.",
      centering: "Well centered.",
    },
  });
  const analysis = normalizeAnalysis(raw, "modern");
  assert.ok(
    !(analysis.visionReconciliationAudit || []).some(
      (entry) => entry.source === "vintage_nm_scratch_skepticism_strip"
    )
  );
});

test("F3-N5 Carew PSA 7 — surface_scratch_moderate not stripped", () => {
  const cachePath = path.join(benchmarksRoot, "cache", "1967-t-carew-psa7.json");
  if (!fs.existsSync(cachePath)) {
    const raw = {
      scanQuality: { level: "good", visibilityIssues: [], inspectionLimits: [] },
      categoryScores: { corners: 6, edges: 6, surface: 6, centering: 7.5 },
      defects: [
        {
          tag: "surface_scratch_moderate",
          severity: "moderate",
          location: "front",
          confidence: "high",
        },
      ],
      primaryLimiterTag: "surface_scratch_moderate",
      categoryNotes: {
        corners: "Moderate wear.",
        edges: "Edge wear.",
        surface: "Continuous moderate scratching on the front.",
        centering: "Well centered.",
      },
      cardMeta: { estimatedYear: 1967, isReflective: false, isDarkBorder: false },
    };
    const analysis = normalizeAnalysis(raw, "vintage");
    assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_moderate"));
    return;
  }
  const { analysis } = gradeVintageCache("1967-t-carew-psa7");
  assert.ok(analysis.defects.some((defect) => defect.tag === "surface_scratch_moderate"));
});

test("F3-N6 Kennedy snapshot — no scratch limiter, Gem >= 6", () => {
  const { result } = gradeVintageSnapshot("1953-t-kennedy-psa8");
  assert.ok(result.psaGrade >= 6);
  assert.notEqual(result.primaryLimiter?.tag, "surface_scratch_light");
});
