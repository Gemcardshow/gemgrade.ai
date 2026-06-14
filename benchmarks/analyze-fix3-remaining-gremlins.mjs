#!/usr/bin/env node
/**
 * Fix 3 remaining scratch gremlin analysis — counterfactual only (no grading changes).
 *
 * Usage: node benchmarks/analyze-fix3-remaining-gremlins.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
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

function effectiveBinding(result) {
  const capAudit = result.capAudit || [];
  const categoryFloor = capAudit.find((e) => e.source === "categoryFloor");
  const overall = capAudit.find((e) => e.source === "overall_derivation");
  const capped = capAudit.filter((e) => e.cap != null || e.floor != null);
  const lowestCap = capped.length
    ? capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]
    : null;

  // Grade is rounded from categoryFloor / overall_derivation when pillar clamp binds below defect caps.
  if (categoryFloor?.value != null) {
    const rounded = Math.round(categoryFloor.value);
    if (rounded === result.psaGrade) {
      return {
        source: "categoryFloor",
        value: categoryFloor.value,
        note:
          lowestCap && (lowestCap.cap ?? lowestCap.floor) > categoryFloor.value
            ? `pillar clamp (${categoryFloor.value}) below ${lowestCap.source} (${lowestCap.cap ?? lowestCap.floor})`
            : null,
      };
    }
  }
  if (overall?.value != null && Math.round(overall.value) === result.psaGrade) {
    return { source: "overall_derivation", value: overall.value, note: null };
  }
  if (lowestCap) {
    return {
      source: lowestCap.source,
      value: lowestCap.cap ?? lowestCap.floor,
      note: null,
    };
  }
  return { source: null, value: null, note: null };
}

function loadRaw(card, cacheDir, snapDir) {
  const cachePath = path.join(cacheDir, `${card.id}.json`);
  const snapPath = path.join(snapDir, `${card.id}.json`);

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const grade = cached.grade;
    const visionCategoryScores = inferRawCategoryScores(grade);
    return {
      source: "cache",
      hasSnapshot: fs.existsSync(snapPath),
      raw: {
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
      },
      visionCategoryScores,
    };
  }

  if (fs.existsSync(snapPath)) {
    const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const rawVision = snapshot.rawVision || snapshot;
    return {
      source: "snapshot",
      hasSnapshot: true,
      raw: {
        categoryScores: rawVision.categoryScores,
        defects: JSON.parse(JSON.stringify(rawVision.defects || [])),
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
      },
      visionCategoryScores: rawVision.categoryScores,
    };
  }

  return null;
}

function gradeRaw(raw, visionCategoryScores) {
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  return { analysis, result };
}

function gradeWithoutScratchTags(raw, visionCategoryScores) {
  const clone = JSON.parse(JSON.stringify(raw));
  clone.defects = (clone.defects || []).filter(
    (d) => d.tag !== "surface_scratch_light" && d.tag !== "surface_scratch_moderate"
  );
  if (
    clone.primaryLimiterTag === "surface_scratch_light" ||
    clone.primaryLimiterTag === "surface_scratch_moderate"
  ) {
    clone.primaryLimiterTag = null;
    clone.primaryLimiterLabel = null;
  }
  return gradeRaw(clone, visionCategoryScores);
}

function classifyOutcome(row) {
  if (row.wouldImprove && row.withinOneIfNoScratch) {
    return "scratch_blocks_within_one";
  }
  if (row.wouldImprove && !row.withinOneIfNoScratch) {
    return "scratch_blocks_partial_lift";
  }
  if (!row.wouldImprove) {
    return "other_cap_dominates";
  }
  return "unchanged";
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
      const loaded = loadRaw(card, cacheDir, snapDir);
      if (!loaded) continue;

      const { analysis, result } = gradeRaw(loaded.raw, loaded.visionCategoryScores);
      const diff = result.psaGrade - card.psaGrade;
      const limiter = result.primaryLimiter?.tag;
      const isGremlin =
        (limiter === "surface_scratch_light" || limiter === "surface_scratch_moderate") &&
        card.psaGrade >= 7 &&
        diff <= -2;

      if (!isGremlin) continue;

      const without = gradeWithoutScratchTags(loaded.raw, loaded.visionCategoryScores);
      const tags = analysis.defects.map((d) => d.tag);
      const surfaceNote = loaded.raw.categoryNotes?.surface || "";

      const binding = effectiveBinding(result);
      const withoutBinding = effectiveBinding(without.result);

      const row = {
        id: card.id,
        cardName: card.cardName,
        psaGrade: card.psaGrade,
        gemGrade: result.psaGrade,
        gradeDifference: diff,
        primaryLimiter: limiter,
        effectiveBinding: binding.source,
        effectiveBindingValue: binding.value,
        effectiveBindingNote: binding.note,
        categoryFloor: (result.capAudit || []).find((e) => e.source === "categoryFloor")
          ?.value,
        lowestDefectCap: (result.capAudit || [])
          .filter((e) => e.cap != null)
          .sort((a, b) => a.cap - b.cap)[0],
        hasScratchLight: tags.includes("surface_scratch_light"),
        hasScratchModerate: tags.includes("surface_scratch_moderate"),
        defectTags: tags,
        scratchCapAudit: (result.capAudit || []).filter((e) =>
          /scratch/i.test(String(e.source || ""))
        ),
        surfaceNoteExcerpt: surfaceNote.slice(0, 120),
        withoutScratchGem: without.result.psaGrade,
        withoutScratchLimiter: without.result.primaryLimiter?.tag,
        withoutScratchBinding: withoutBinding.source,
        withoutScratchBindingValue: withoutBinding.value,
        withoutScratchDelta: without.result.psaGrade - result.psaGrade,
        withoutScratchDefectTags: without.analysis.defects.map((d) => d.tag),
        wouldImprove: without.result.psaGrade > result.psaGrade,
        withinOneIfNoScratch: Math.abs(without.result.psaGrade - card.psaGrade) <= 1,
        withinOneCurrent: Math.abs(diff) <= 1,
        replaySource: loaded.source,
        hasSnapshot: loaded.hasSnapshot,
      };
      row.outcomeClass = classifyOutcome(row);

      if (loaded.hasSnapshot) {
        const snapPath = path.join(snapDir, `${card.id}.json`);
        const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
        const rawVision = snapshot.rawVision || snapshot;
        const snapRaw = {
          categoryScores: rawVision.categoryScores,
          defects: JSON.parse(JSON.stringify(rawVision.defects || [])),
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
        const snapGraded = gradeRaw(snapRaw, rawVision.categoryScores);
        const snapBinding = effectiveBinding(snapGraded.result);
        row.snapshotGem = snapGraded.result.psaGrade;
        row.snapshotLimiter = snapGraded.result.primaryLimiter?.tag;
        row.snapshotScratchLight = snapGraded.analysis.defects.some(
          (d) => d.tag === "surface_scratch_light"
        );
        row.snapshotScratchModerate = snapGraded.analysis.defects.some(
          (d) => d.tag === "surface_scratch_moderate"
        );
        row.snapshotEffectiveBinding = snapBinding.source;
        row.snapshotEffectiveBindingValue = snapBinding.value;
        row.cacheSnapshotDrift =
          row.gemGrade !== row.snapshotGem ||
          row.primaryLimiter !== row.snapshotLimiter;
      }

      rows.push(row);
    }
  }

  rows.sort((a, b) => a.gradeDifference - b.gradeDifference);

  const summary = {
    generatedAt: new Date().toISOString(),
    fix: "Fix 3 remaining scratch_limiter_high_grade analysis",
    gremlinCount: rows.length,
    scratchBlocksWithinOne: rows.filter((r) => r.outcomeClass === "scratch_blocks_within_one")
      .length,
    scratchBlocksPartialLift: rows.filter(
      (r) => r.outcomeClass === "scratch_blocks_partial_lift"
    ).length,
    otherCapDominates: rows.filter((r) => r.outcomeClass === "other_cap_dominates").length,
    rows,
  };

  const outJson = resolveBenchmarkPath("reports", "fix3-remaining-scratch-gremlins.json");
  fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`Remaining scratch_limiter_high_grade gremlins: ${rows.length}`);
  console.log(`  scratch_blocks_within_one: ${summary.scratchBlocksWithinOne}`);
  console.log(`  scratch_blocks_partial_lift: ${summary.scratchBlocksPartialLift}`);
  console.log(`  other_cap_dominates: ${summary.otherCapDominates}`);
  console.log(`Wrote ${outJson}`);
}

main();
