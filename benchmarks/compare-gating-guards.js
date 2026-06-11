#!/usr/bin/env node
/**
 * Compare targeted NM/GEM gating (current analyze.js) vs post-guard live baseline.
 * PSA 7-10: cache replay with gating vs psa710-live-latest.json
 * PSA 4-6: cache replay with gating vs test-4-10-full-report snapshot
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { getWearFloor } from "../lib/grading/psa-calibration.js";
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
  const appeal = `${grade.eyeAppealSummary || ""} ${grade.bestAttribute || ""}`.toLowerCase();
  if (
    /\b(minimal wear|vibrant|presents well|clean surface|strong color)\b/.test(appeal) &&
    Math.min(scores.corners, scores.edges) >= 6
  ) {
    scores.surface = Math.max(scores.surface, 7);
  }
  return scores;
}

function gradeFromCache(cached) {
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  const raw = {
    categoryScores: visionCategoryScores,
    defects: grade.defects,
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
  const era = grade.era || "vintage";
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
    internalGrade: result.internalGrade,
    wearFloor: getWearFloor(result.categoryScores),
    categoryScores: result.categoryScores,
    defects: analysis.defects,
    primaryLimiter: result.primaryLimiter?.tag,
  };
}

function bandStats(rows) {
  const n = rows.length;
  if (!n) return { n: 0, meanError: null, withinOne: 0, exact: 0, inflated: 0 };
  const meanError = rows.reduce((s, r) => s + r.variance, 0) / n;
  return {
    n,
    meanError,
    withinOne: rows.filter((r) => Math.abs(r.variance) <= 1).length,
    exact: rows.filter((r) => r.variance === 0).length,
    inflated: rows.filter((r) => r.variance > 0).length,
  };
}

function compareRows(cards, baselineById, label) {
  const rows = [];
  for (const card of cards) {
    const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
    if (!fs.existsSync(cachePath)) continue;
    const baseline = baselineById.get(card.id);
    if (!baseline) continue;
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const post = gradeFromCache(cached);
    const preGem = baseline.gemGrade ?? baseline.postGem ?? baseline.preGem;
    rows.push({
      id: card.id,
      fileLabel: card.fileLabel,
      psaGrade: card.psaGrade,
      preGem,
      postGem: post.gemGrade,
      preVariance: preGem - card.psaGrade,
      postVariance: post.gemGrade - card.psaGrade,
      gradeDelta: post.gemGrade - preGem,
      wearFloorDelta: post.wearFloor - (baseline.wearFloor ?? 0),
    });
  }
  return { label, rows, stats: bandStats(rows.map((r) => ({ variance: r.postVariance }))), preStats: bandStats(rows.map((r) => ({ variance: r.preVariance }))) };
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );

  const postLivePath = resolveBenchmarkPath("live-runs", "psa710-live-latest.json");
  const postLive = fs.existsSync(postLivePath)
    ? JSON.parse(fs.readFileSync(postLivePath, "utf8"))
    : null;
  const postLiveById = new Map((postLive?.rows || []).map((r) => [r.id, r]));

  const snapshotPath = resolveBenchmarkPath("reports", "test-4-10-full-report.json");
  const snapshot = fs.existsSync(snapshotPath)
    ? JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
    : null;
  const snapshotById = new Map(
    (snapshot?.rows || snapshot?.cards || []).map((r) => [r.id, r])
  );

  const cards710 = manifest.suites
    .filter((s) => ["TEST 7", "TEST 8", "TEST 9", "TEST 10"].includes(s.id))
    .flatMap((s) => s.cards);
  const cards46 = manifest.suites
    .filter((s) => ["TEST 4", "TEST 5", "TEST 6"].includes(s.id))
    .flatMap((s) => s.cards);

  const cmp710 = compareRows(cards710, postLiveById, "PSA 7-10 vs post-guard live");
  const cmp46 = compareRows(cards46, snapshotById, "PSA 4-6 vs pre-guard snapshot");

  const upward710 = cmp710.rows.filter((r) => r.gradeDelta > 0 && r.psaGrade <= 7);
  const downward710 = cmp710.rows.filter((r) => r.gradeDelta < 0);
  const upward46 = cmp46.rows.filter((r) => r.gradeDelta > 0);

  const lines = [
    "# Targeted Gating Guard Comparison",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Compares **current targeted gating** (cache replay) vs **post-NM/GEM guard baseline**.",
    "",
    "## PSA 7–10 (cache replay, n=" + cmp710.rows.length + ")",
    "",
    "| Metric | Post-guard live (pre) | Gating (post) | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| Mean error | ${cmp710.preStats.meanError?.toFixed(2) ?? "—"} | ${cmp710.stats.meanError?.toFixed(2) ?? "—"} | ${((cmp710.stats.meanError ?? 0) - (cmp710.preStats.meanError ?? 0)).toFixed(2)} |`,
    `| Within ±1 | ${cmp710.preStats.withinOne}/${cmp710.rows.length} | ${cmp710.stats.withinOne}/${cmp710.rows.length} | — |`,
    `| Exact | ${cmp710.preStats.exact}/${cmp710.rows.length} | ${cmp710.stats.exact}/${cmp710.rows.length} | — |`,
    "",
    "### PSA 7–8 upward drift watch (gating lowered grade vs post-guard live)",
    "",
  ];

  for (const r of upward710.sort((a, b) => b.gradeDelta - a.gradeDelta).slice(0, 12)) {
    lines.push(
      `- **${r.fileLabel}** PSA ${r.psaGrade}: ${r.preGem} → ${r.postGem} (Δ${r.gradeDelta > 0 ? "+" : ""}${r.gradeDelta})`
    );
  }
  if (!upward710.length) lines.push("- None in cache overlap");

  lines.push("", "### PSA 7–10 grade reductions from gating (expected drift control)", "");
  for (const r of downward710.sort((a, b) => a.gradeDelta - b.gradeDelta).slice(0, 12)) {
    lines.push(
      `- **${r.fileLabel}** PSA ${r.psaGrade}: ${r.preGem} → ${r.postGem} (Δ${r.gradeDelta})`
    );
  }

  lines.push(
    "",
    "## PSA 4–6 (cache replay, n=" + cmp46.rows.length + ")",
    "",
    "| Metric | Pre-guard snapshot | Gating (post) | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| Mean error | ${cmp46.preStats.meanError?.toFixed(2) ?? "—"} | ${cmp46.stats.meanError?.toFixed(2) ?? "—"} | ${((cmp46.stats.meanError ?? 0) - (cmp46.preStats.meanError ?? 0)).toFixed(2)} |`,
    `| Within ±1 | ${cmp46.preStats.withinOne}/${cmp46.rows.length} | ${cmp46.stats.withinOne}/${cmp46.rows.length} | — |`,
    `| Exact | ${cmp46.preStats.exact}/${cmp46.rows.length} | ${cmp46.stats.exact}/${cmp46.rows.length} | — |`,
    "",
    "### PSA 4–6 upward moves (should be minimal)",
    ""
  );
  for (const r of upward46.sort((a, b) => b.gradeDelta - a.gradeDelta).slice(0, 10)) {
    lines.push(
      `- **${r.fileLabel}** PSA ${r.psaGrade}: ${r.preGem} → ${r.postGem} (Δ+${r.gradeDelta})`
    );
  }
  if (!upward46.length) lines.push("- None");

  const outDir = resolveBenchmarkPath("reports");
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "gating-guards-comparison.md");
  const jsonPath = path.join(outDir, "gating-guards-comparison.json");
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`);
  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ cmp710, cmp46, upward710, downward710, upward46 }, null, 2)}\n`
  );

  console.log("PSA 7-10 gating vs post-guard live:", cmp710.rows.length, "cards");
  console.log(
    "  mean error:",
    cmp710.preStats.meanError?.toFixed(2),
    "→",
    cmp710.stats.meanError?.toFixed(2)
  );
  console.log("PSA 4-6 gating vs snapshot:", cmp46.rows.length, "cards");
  console.log("Wrote", mdPath);
}

main();
