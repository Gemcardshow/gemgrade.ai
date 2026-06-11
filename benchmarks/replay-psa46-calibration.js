#!/usr/bin/env node
/**
 * Replay PSA 4-6 benchmark cards through computeGrade using cached vision output.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

function inferRawCategoryScores(grade) {
  const scores = { ...grade.categoryScores };

  for (const entry of grade.capAudit || []) {
    if (!entry.source?.startsWith("categoryImpact:")) {
      continue;
    }
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

function analysisFromCache(cached) {
  const grade = cached.grade;
  return {
    categoryScores: inferRawCategoryScores(grade),
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
}

function findBindingRule(capAudit, internalGrade) {
  const capped = (capAudit || []).filter(
    (entry) => entry.cap != null || entry.floor != null
  );
  if (!capped.length) {
    return { rule: "categoryFloor / defect stack", detail: `Derived ${internalGrade}` };
  }

  const binding = capped.reduce((best, entry) => {
    const value = entry.cap ?? entry.floor;
    if (best == null || value < (best.cap ?? best.floor)) {
      return entry;
    }
    return best;
  }, null);

  return {
    rule: binding.source,
    detail:
      binding.cap != null
        ? `Cap ${binding.cap}`
        : `Floor ${binding.floor}`,
  };
}

const manifest = JSON.parse(
  fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
);
const suite = manifest.suites.find((s) => s.id === "TEST 4 TO 6");
const rows = [];

for (const card of suite.cards) {
  const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
  if (!fs.existsSync(cachePath)) {
    rows.push({ card, error: "missing cache" });
    continue;
  }

  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const raw = analysisFromCache(cached);
  const analysis = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: raw.categoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  const diff = result.psaGrade - card.psaGrade;
  const binding = findBindingRule(result.capAudit, result.internalGrade);

  rows.push({
    id: card.id,
    fileLabel: card.fileLabel,
    psaGrade: card.psaGrade,
    gemGrade: result.psaGrade,
    internalGrade: result.internalGrade,
    gradeDifference: diff,
    categoryScores: result.categoryScores,
    primaryLimiter: result.primaryLimiter.tag,
    bindingRule: binding.rule,
    bindingDetail: binding.detail,
    capAudit: result.capAudit,
  });
}

rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));

const successful = rows.filter((r) => r.gemGrade != null);
const deltas = successful.map((r) => r.gradeDifference);
const abs = deltas.map(Math.abs);

const summary = {
  total: rows.length,
  meanDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
  meanAbsDelta: abs.reduce((a, b) => a + b, 0) / abs.length,
  withinOne: successful.filter((r) => Math.abs(r.gradeDifference) <= 1).length,
  withinOnePct: (
    (successful.filter((r) => Math.abs(r.gradeDifference) <= 1).length /
      successful.length) *
    100
  ).toFixed(1),
  exactMatch: successful.filter((r) => r.gradeDifference === 0).length,
  inflated: successful.filter((r) => r.gradeDifference > 0).length,
  deflated: successful.filter((r) => r.gradeDifference < 0).length,
};

const outDir = resolveBenchmarkPath("reports");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "psa-4-6-replay.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows, summary }, null, 2)}\n`
);

console.log("PSA 4-6 calibration replay (cached vision)\n");
console.log(
  "Filename".padEnd(28),
  "PSA",
  "Gem",
  "Diff",
  "Binding rule"
);
for (const row of rows) {
  console.log(
    row.fileLabel.padEnd(28),
    String(row.psaGrade).padStart(3),
    String(row.gemGrade).padStart(4),
    `${row.gradeDifference >= 0 ? "+" : ""}${row.gradeDifference}`.padStart(4),
    row.bindingRule?.slice(0, 40) || row.error
  );
}

console.log("\nSummary:");
console.log(`  Mean delta: ${summary.meanDelta.toFixed(2)}`);
console.log(`  Mean |delta|: ${summary.meanAbsDelta.toFixed(2)}`);
console.log(
  `  Within ±1: ${summary.withinOne}/${summary.total} (${summary.withinOnePct}%)`
);
console.log(`  Exact match: ${summary.exactMatch}/${summary.total}`);
console.log(`  Inflated: ${summary.inflated} · Deflated: ${summary.deflated}`);
