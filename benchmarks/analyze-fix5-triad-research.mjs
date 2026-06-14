#!/usr/bin/env node
/**
 * Fix 5 triad research — replay vintage benchmark cards and classify triad
 * normalize clamp vs calibration cap vs NM skip outcomes.
 *
 * Usage: node benchmarks/analyze-fix5-triad-research.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import {
  qualifiesForNmBandVintageCapSkip,
  qualifiesForVintageNmTriadCapSkip,
} from "../lib/grading/psa-calibration.js";
import { eraFromYear } from "../lib/grading/era.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const VINTAGE_SUITE_IDS = new Set([
  "psa-1-3",
  "TEST 4",
  "TEST 5",
  "TEST 6",
  "TEST 7",
  "TEST 8",
  "TEST 9",
  "psa7-8",
]);

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

function bindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) {
    return (capAudit || []).find((e) => e.source === "categoryFloor")?.source ?? null;
  }
  return capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]?.source ?? null;
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

function loadAndGrade(card, cacheDir, snapDir) {
  const cachePath = path.join(cacheDir, `${card.id}.json`);
  const snapPath = path.join(snapDir, `${card.id}.json`);
  let raw;
  let visionCategoryScores;
  let source;

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const grade = cached.grade;
    visionCategoryScores = inferRawCategoryScores(grade);
    raw = {
      categoryScores: visionCategoryScores,
      defects: JSON.parse(JSON.stringify(grade.defects || [])),
      primaryLimiterTag: grade.primaryLimiter?.tag,
      primaryLimiterLabel: grade.primaryLimiter?.label,
      eyeAppealSummary: grade.eyeAppealSummary,
      bestAttribute: grade.bestAttribute,
      categoryNotes: grade.categoryNotes || {},
      scanQuality: grade.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
      cardMeta: grade.cardMeta || {},
    };
    source = "cache";
  } else if (fs.existsSync(snapPath)) {
    const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const rawVision = snapshot.rawVision || snapshot;
    visionCategoryScores = rawVision.categoryScores;
    raw = {
      categoryScores: rawVision.categoryScores,
      defects: JSON.parse(JSON.stringify(rawVision.defects || [])),
      primaryLimiterTag: rawVision.primaryLimiterTag,
      primaryLimiterLabel: rawVision.primaryLimiterLabel,
      eyeAppealSummary: rawVision.eyeAppealSummary,
      bestAttribute: rawVision.bestAttribute,
      categoryNotes: rawVision.categoryNotes || {},
      scanQuality: rawVision.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
      cardMeta: rawVision.cardMeta || {},
    };
    source = "snapshot";
  } else {
    return null;
  }

  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );

  const visionMin = Math.min(
    visionCategoryScores.corners,
    visionCategoryScores.edges,
    visionCategoryScores.surface
  );
  const normMin = Math.min(
    analysis.categoryScores.corners,
    analysis.categoryScores.edges,
    analysis.categoryScores.surface
  );
  const triadNormalizeClamp = normMin <= 5.5 && visionMin > 5.5;
  const triadCap = (result.capAudit || []).some((e) => e.source === "vintage:triad_light_wear_notes");
  const optimisticCap = (result.capAudit || []).some((e) => e.source === "vintage:optimistic_light_wear");
  const nmCapSkip = qualifiesForNmBandVintageCapSkip(
    analysis.categoryScores,
    analysis.defects,
    { ...analysis, visionCategoryScores }
  );
  const nmTriadCapSkip = qualifiesForVintageNmTriadCapSkip(
    analysis.categoryScores,
    analysis.defects,
    { ...analysis, visionCategoryScores }
  );

  return {
    id: card.id,
    cardName: card.cardName,
    suiteId: card.suiteId,
    psaGrade: card.psaGrade,
    gemGrade: result.psaGrade,
    internalGrade: result.internalGrade,
    gradeDifference: result.psaGrade - card.psaGrade,
    withinOne: Math.abs(result.psaGrade - card.psaGrade) <= 1,
    primaryLimiterTag: result.primaryLimiter?.tag,
    bindingRule: bindingRule(result.capAudit),
    triadCap,
    optimisticCap,
    triadNormalizeClamp,
    triadNormalizeClampOnly: triadNormalizeClamp && !triadCap,
    nmCapSkip,
    nmTriadCapSkip,
    gemStainRelief: (result.capAudit || []).some(
      (e) => e.source === "nm_band:gem_stain_relief"
    ),
    visionMin,
    normMin,
    visionCategoryScores,
    normalizedScores: analysis.categoryScores,
    notesPillarsWithWear: countNotesPillarsWithWear(raw),
    defectTags: (analysis.defects || []).map((d) => d.tag),
    capAudit: result.capAudit,
    source,
  };
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  const cacheDir = resolveBenchmarkPath("cache");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");
  const rows = [];

  for (const suite of manifest.suites.filter((s) => VINTAGE_SUITE_IDS.has(s.id))) {
    for (const card of suite.cards) {
      const row = loadAndGrade(card, cacheDir, snapDir);
      if (row) rows.push(row);
    }
  }

  rows.sort((a, b) => a.cardName.localeCompare(b.cardName));

  const triadCapRows = rows.filter((r) => r.triadCap);
  const triadNormalizeRows = rows.filter((r) => r.triadNormalizeClamp);
  const triadEither = rows.filter((r) => r.triadCap || r.triadNormalizeClamp);
  const psa7plus = rows.filter((r) => r.psaGrade >= 7);
  const psa46 = rows.filter((r) => r.psaGrade >= 4 && r.psaGrade <= 6);

  const triadCapPsa7Miss = triadCapRows.filter((r) => r.psaGrade >= 7 && !r.withinOne);
  const triadNormPsa7Miss = triadNormalizeRows.filter((r) => r.psaGrade >= 7 && !r.withinOne);
  const nmSkipBlocked = rows.filter(
    (r) => r.psaGrade >= 7 && !r.nmCapSkip && r.normMin <= 5.5 && r.visionMin >= 6.5
  );

  const report = {
    generatedAt: new Date().toISOString(),
    checkpoint: "Fix 5 conservative (uncommitted)",
    summary: {
      totalGraded: rows.length,
      withinOne: rows.filter((r) => r.withinOne).length,
      triadCapCount: triadCapRows.length,
      triadNormalizeClampCount: triadNormalizeRows.length,
      triadEitherCount: triadEither.length,
      psa7plusWithinOne: psa7plus.filter((r) => r.withinOne).length,
      psa7plusTotal: psa7plus.length,
      triadCapPsa7Miss: triadCapPsa7Miss.length,
      triadNormPsa7Miss: triadNormPsa7Miss.length,
      nmSkipBlockedCount: nmSkipBlocked.length,
      psa46TriadCap: triadCapRows.filter((r) => r.psaGrade >= 4 && r.psaGrade <= 6).length,
    },
    triadCapRows,
    triadNormalizeRows,
    triadEither,
    nmSkipBlocked,
    allRows: rows,
  };

  const outJson = resolveBenchmarkPath("reports", "fix5-triad-research-latest.json");
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);

  console.log("Fix 5 triad research");
  console.log(`  Graded: ${rows.length}`);
  console.log(`  Within ±1: ${report.summary.withinOne}/${rows.length}`);
  console.log(`  triad_light_wear_notes cap: ${triadCapRows.length}`);
  console.log(`  triad normalize clamp (5.5): ${triadNormalizeRows.length}`);
  console.log(`  PSA 7+ triad cap misses: ${triadCapPsa7Miss.length}`);
  console.log(`  PSA 7+ normalize clamp misses: ${triadNormPsa7Miss.length}`);
  console.log(`  PSA 7+ nmCapSkip blocked (vision≥6.5, norm=5.5): ${nmSkipBlocked.length}`);
  console.log(`  PSA 4-6 with triad cap (guardrail risk): ${report.summary.psa46TriadCap}`);
  console.log(`  Wrote ${outJson}`);
}

main();
