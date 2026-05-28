import test from "node:test";
import assert from "node:assert/strict";
import { computeGrade } from "../grading/engine.js";
import { normalizeAnalysis } from "../grading/analyze.js";
import {
  applyCompoundHarshness,
  applyPsa1Calibration,
  triggersPsa1Calibration,
} from "../grading/psa-calibration.js";
import { resolveEra, eraFromYear, normalizeEraRequest } from "../grading/era.js";
import { snapToPsaGrade, formatLikelyRange } from "../grading/types.js";
import { formatGradeResponse } from "../grading/response.js";

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
