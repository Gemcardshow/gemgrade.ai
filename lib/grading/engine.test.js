import test from "node:test";
import assert from "node:assert/strict";
import { computeGrade } from "./engine.js";
import { normalizeAnalysis } from "./analyze.js";
import {
  applyCompoundHarshness,
  applyPsa1Calibration,
  triggersPsa1Calibration,
  qualifiesForNmBandVintageCapSkip,
} from "./psa-calibration.js";
import { resolveEra, eraFromYear, normalizeEraRequest } from "./era.js";
import { snapToPsaGrade, formatLikelyRange } from "./types.js";
import { formatGradeResponse } from "./response.js";

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
