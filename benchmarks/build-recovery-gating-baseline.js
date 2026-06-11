#!/usr/bin/env node
/**
 * Regenerate benchmarks/baselines/recovery-gating-v1.json from cache + vision snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

function inferRawCategoryScores(grade) {
  const scores = { ...grade.categoryScores };
  for (const entry of grade.capAudit || []) {
    if (!entry.source?.startsWith("categoryImpact:")) continue;
    const category = entry.source.split(":")[2];
    if (category && entry.cap != null) {
      scores[category] = Math.max(scores[category], entry.cap + 2);
    }
  }
  return scores;
}

function gradeFromCache(cached) {
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  const era = grade.era || "vintage";
  const raw = {
    categoryScores: visionCategoryScores,
    defects: grade.defects,
    primaryLimiterTag: grade.primaryLimiter?.tag,
    eyeAppealSummary: grade.eyeAppealSummary,
    bestAttribute: grade.bestAttribute,
    categoryNotes: grade.categoryNotes || {},
    scanQuality: grade.scanQuality || { level: "good" },
    cardMeta: grade.cardMeta || {},
  };
  const analysis = normalizeAnalysis(raw, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    era
  );
  return {
    gemGrade: result.psaGrade,
    variance: result.psaGrade - grade.psaGrade,
  };
}

function gradeFromVision(rawVision, era, psaGrade) {
  const analysis = normalizeAnalysis(rawVision, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: rawVision.categoryScores,
      categoryNotes: analysis.categoryNotes || rawVision.categoryNotes,
    },
    era
  );
  return { gemGrade: result.psaGrade, variance: result.psaGrade - psaGrade };
}

function stats(rows) {
  const n = rows.length;
  if (!n) {
    return { n: 0, meanError: null, withinOne: 0, exact: 0, inflated: 0 };
  }
  return {
    n,
    meanError: rows.reduce((sum, row) => sum + row.variance, 0) / n,
    withinOne: rows.filter((row) => Math.abs(row.variance) <= 1).length,
    exact: rows.filter((row) => row.variance === 0).length,
    inflated: rows.filter((row) => row.variance > 0).length,
  };
}

function bandStats(rows, minGrade) {
  const band =
    minGrade === 10
      ? rows.filter((row) => row.psaGrade === 10)
      : rows.filter((row) => row.psaGrade >= minGrade);
  return stats(band);
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  const psa46 = manifest.suites
    .filter((suite) => ["TEST 4", "TEST 5", "TEST 6"].includes(suite.id))
    .flatMap((suite) => suite.cards);
  const psa710 = manifest.suites
    .filter((suite) => ["TEST 7", "TEST 8", "TEST 9", "TEST 10"].includes(suite.id))
    .flatMap((suite) => suite.cards);

  const cacheDir = resolveBenchmarkPath("cache");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");

  const rows46 = [];
  for (const card of psa46) {
    const cachePath = path.join(cacheDir, `${card.id}.json`);
    if (!fs.existsSync(cachePath)) continue;
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const graded = gradeFromCache(cached);
    rows46.push({ id: card.id, psaGrade: card.psaGrade, ...graded });
  }

  const rows710 = [];
  for (const card of psa710) {
    const snapPath = path.join(snapDir, `${card.id}.json`);
    if (!fs.existsSync(snapPath)) continue;
    const capture = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const graded = gradeFromVision(capture.rawVision, capture.era, card.psaGrade);
    rows710.push({ id: card.id, psaGrade: card.psaGrade, ...graded });
  }

  const baseline = {
    tag: "recovery-gating-baseline-v1",
    label: "Recovery gating primary path (gem-mint vs mint slab profiles)",
    generatedAt: new Date().toISOString(),
    analyzeSnapshot: "benchmarks/snapshots/analyze-recovery-baseline.js",
    mode: {
      psa46: "cache-replay",
      psa710: "live-vision-snapshots",
    },
    summary: {
      psa46: stats(rows46),
      psa710: stats(rows710),
    },
    byBand: {
      psa710: {
        "7+": bandStats(rows710, 7),
        "8+": bandStats(rows710, 8),
        "9+": bandStats(rows710, 9),
        10: bandStats(rows710, 10),
      },
    },
    rows: { psa46: rows46, psa710: rows710 },
  };

  const outPath = resolveBenchmarkPath("baselines", "recovery-gating-v1.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`);

  console.log(`Wrote ${outPath}`);
  console.log(
    `PSA 4-6: n=${rows46.length} mean=${baseline.summary.psa46.meanError?.toFixed(2)}`
  );
  console.log(
    `PSA 7-10: n=${rows710.length} mean=${baseline.summary.psa710.meanError?.toFixed(2)}`
  );
}

main();
