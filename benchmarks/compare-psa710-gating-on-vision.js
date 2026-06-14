#!/usr/bin/env node
/**
 * Replay loose vs narrow gating on captured live vision snapshots (no OpenAI).
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis as normalizeNarrow } from "../lib/grading/analyze.js";
import { normalizeAnalysis as normalizeLoose } from "./snapshots/analyze-loose-nmgem.js";
import { computeGrade } from "../lib/grading/engine.js";
import { getWearFloor } from "../lib/grading/psa-calibration.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const PSA710_SUITES = new Set(["TEST 7", "TEST 8", "TEST 9", "TEST 10"]);

function gradeFromRaw(rawVision, era, normalizeFn) {
  const analysis = normalizeFn(rawVision, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: rawVision.categoryScores,
      categoryNotes: analysis.categoryNotes || rawVision.categoryNotes,
    },
    era
  );
  return {
    gemGrade: result.psaGrade,
    wearFloor: getWearFloor(result.categoryScores),
    categoryScores: result.categoryScores,
  };
}

function statsForRows(rows, field) {
  const n = rows.length;
  if (!n) return { n: 0, meanError: null, withinOne: 0, exact: 0, inflated: 0 };
  const errors = rows.map((r) => r[field]);
  return {
    n,
    meanError: errors.reduce((a, b) => a + b, 0) / n,
    withinOne: rows.filter((r) => Math.abs(r[field]) <= 1).length,
    exact: rows.filter((r) => r[field] === 0).length,
    inflated: rows.filter((r) => r[field] > 0).length,
  };
}

function bandBreakdown(rows, field) {
  const out = {};
  for (const grade of [7, 8, 9, 10, "7+"]) {
    const band =
      grade === "7+"
        ? rows.filter((r) => r.psaGrade >= 7)
        : rows.filter((r) => r.psaGrade === grade);
    out[String(grade)] = statsForRows(band, field);
  }
  out["7-10"] = statsForRows(rows, field);
  return out;
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  const cards = manifest.suites
    .filter((s) => PSA710_SUITES.has(s.id))
    .flatMap((s) => s.cards.map((c) => ({ ...c, suiteId: s.id })));

  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");
  const rows = [];
  const missing = [];

  for (const card of cards) {
    const snapPath = path.join(snapDir, `${card.id}.json`);
    if (!fs.existsSync(snapPath)) {
      missing.push(card.fileLabel);
      continue;
    }
    const capture = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const { rawVision, era } = capture;
    const loose = gradeFromRaw(rawVision, era, normalizeLoose);
    const narrow = gradeFromRaw(rawVision, era, normalizeNarrow);
    rows.push({
      id: card.id,
      fileLabel: card.fileLabel,
      psaGrade: card.psaGrade,
      looseGem: loose.gemGrade,
      narrowGem: narrow.gemGrade,
      looseVariance: loose.gemGrade - card.psaGrade,
      narrowVariance: narrow.gemGrade - card.psaGrade,
      gradeDelta: narrow.gemGrade - loose.gemGrade,
    });
  }

  rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));

  const looseStats = statsForRows(rows, "looseVariance");
  const narrowStats = statsForRows(rows, "narrowVariance");
  const byBandLoose = bandBreakdown(rows, "looseVariance");
  const byBandNarrow = bandBreakdown(rows, "narrowVariance");

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "vision-snapshot-replay",
    cardsTotal: cards.length,
    cardsReplayed: rows.length,
    missing,
    summary: {
      loose: looseStats,
      narrow: narrowStats,
      delta: {
        meanError: narrowStats.meanError - looseStats.meanError,
        withinOne: narrowStats.withinOne - looseStats.withinOne,
        exact: narrowStats.exact - looseStats.exact,
      },
    },
    byBandLoose,
    byBandNarrow,
    regressions: rows.filter((r) => r.gradeDelta < 0).sort((a, b) => a.gradeDelta - b.gradeDelta),
    improvements: rows.filter((r) => r.gradeDelta > 0).sort((a, b) => b.gradeDelta - a.gradeDelta),
    rows,
  };

  const outJson = resolveBenchmarkPath("reports", "psa710-gating-vision-replay.json");
  const outMd = resolveBenchmarkPath("reports", "psa710-gating-vision-replay.md");

  const lines = [
    "# PSA 7–10 Gating A/B on Identical Live Vision",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Replayed **${rows.length}/${cards.length}** cards from \`live-runs/vision-snapshots/\`.`,
    "",
    "## Summary",
    "",
    "| Mode | n | Mean error | Within ±1 | Exact | Over-slabs |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| Loose (post-NM/GEM) | ${looseStats.n} | ${looseStats.meanError?.toFixed(2) ?? "—"} | ${looseStats.withinOne}/${looseStats.n} | ${looseStats.exact}/${looseStats.n} | ${looseStats.inflated}/${looseStats.n} |`,
    `| Narrow (targeted gating) | ${narrowStats.n} | ${narrowStats.meanError?.toFixed(2) ?? "—"} | ${narrowStats.withinOne}/${narrowStats.n} | ${narrowStats.exact}/${narrowStats.n} | ${narrowStats.inflated}/${narrowStats.n} |`,
    `| Δ narrow − loose | — | ${report.summary.delta.meanError?.toFixed(2) ?? "—"} | ${report.summary.delta.withinOne} | ${report.summary.delta.exact} | — |`,
    "",
    "## By band (narrow)",
    "",
    "| Band | n | Mean error | Within ±1 | Exact |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const grade of [7, 8, 9, 10, "7+"]) {
    const s = byBandNarrow[String(grade)];
    if (!s?.n) continue;
    lines.push(
      `| PSA ${grade} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} |`
    );
  }

  lines.push("", "## By band (loose)", "", "| Band | n | Mean error | Within ±1 | Exact |", "| --- | ---: | ---: | ---: | ---: |");
  for (const grade of [7, 8, 9, 10, "7+"]) {
    const s = byBandLoose[String(grade)];
    if (!s?.n) continue;
    lines.push(
      `| PSA ${grade} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} |`
    );
  }

  if (missing.length) {
    lines.push("", "## Pending live vision", "", missing.map((l) => `- ${l}`).join("\n"));
  }

  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`);

  console.log(`Replayed ${rows.length}/${cards.length} vision snapshots`);
  console.log(
    `Loose:  mean=${looseStats.meanError?.toFixed(2)} ±1=${looseStats.withinOne}/${looseStats.n} exact=${looseStats.exact}/${looseStats.n}`
  );
  console.log(
    `Narrow: mean=${narrowStats.meanError?.toFixed(2)} ±1=${narrowStats.withinOne}/${narrowStats.n} exact=${narrowStats.exact}/${narrowStats.n}`
  );
  console.log(`Wrote ${outMd}`);
}

main();
