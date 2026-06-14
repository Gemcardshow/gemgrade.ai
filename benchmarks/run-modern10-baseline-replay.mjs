#!/usr/bin/env node
/**
 * MODERN 10 production baseline replay — frozen visionRaw from modern10-diag cache.
 * No API calls. Re-scores via normalizeAnalysis + computeGrade (modern).
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const TRACKED = ["surface_scratch_light", "staining_light", "moderate_crease"];

function bindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) {
    return (capAudit || []).find((e) => e.source === "categoryFloor")?.source ?? null;
  }
  return capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]?.source ?? null;
}

function main() {
  const cacheDir = resolveBenchmarkPath("cache");
  const diagFiles = fs
    .readdirSync(cacheDir)
    .filter((name) => name.startsWith("modern10-diag-") && name.endsWith(".json"))
    .sort();

  if (diagFiles.length !== 32) {
    console.warn(`Expected 32 modern10-diag files, found ${diagFiles.length}`);
  }

  const rows = [];
  for (const file of diagFiles) {
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, file), "utf8"));
    const { card } = cached;
    const visionRaw = cached.grade?.scratchDiagnostics?.visionRaw;
    if (!visionRaw) {
      throw new Error(`No visionRaw in ${file}`);
    }
    const raw = {
      categoryScores: visionRaw.categoryScores,
      defects: JSON.parse(JSON.stringify(visionRaw.defects || [])),
      primaryLimiterTag: visionRaw.primaryLimiterTag,
      primaryLimiterLabel: visionRaw.primaryLimiterLabel,
      eyeAppealSummary: visionRaw.eyeAppealSummary,
      bestAttribute: visionRaw.bestAttribute,
      categoryNotes: visionRaw.categoryNotes || {},
      scanQuality: visionRaw.scanQuality || {
        level: "good",
        visibilityIssues: [],
        inspectionLimits: [],
      },
      cardMeta: visionRaw.cardMeta || {},
    };
    const analysis = normalizeAnalysis(raw, "modern");
    const result = computeGrade(analysis, "modern");
    const defectTags = new Set((analysis.defects || []).map((d) => d.tag));
    const trackedDefects = Object.fromEntries(
      TRACKED.map((tag) => [tag, defectTags.has(tag) || result.primaryLimiter?.tag === tag])
    );

    rows.push({
      id: card.id,
      cardName: card.cardName,
      psaGrade: card.psaGrade,
      gemGrade: result.psaGrade,
      internalGrade: result.internalGrade,
      difference: result.psaGrade - card.psaGrade,
      primaryLimiterTag: result.primaryLimiter?.tag ?? null,
      trackedDefects,
      bindingRule: bindingRule(result.capAudit),
      capAudit: result.capAudit,
    });
  }

  rows.sort((a, b) => a.cardName.localeCompare(b.cardName));
  const withinOne = rows.filter((row) => Math.abs(row.difference) <= 1).length;
  const falsePositives = Object.fromEntries(
    TRACKED.map((tag) => [tag, rows.filter((row) => row.trackedDefects[tag]).length])
  );

  const report = {
    generatedAt: new Date().toISOString(),
    suite: "MODERN 10",
    source: "benchmarks/cache/modern10-diag-*.json visionRaw replay",
    pipeline: "normalizeAnalysis(raw, modern) + computeGrade",
    metrics: {
      cards: rows.length,
      withinOne,
      withinOnePct: ((withinOne / rows.length) * 100).toFixed(1),
      falsePositives,
    },
    rows,
  };

  const outPath = resolveBenchmarkPath("reports", "modern10-baseline-replay-fix1-check.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("MODERN 10 baseline replay");
  console.log(`  Cards: ${rows.length}`);
  console.log(`  Within ±1: ${withinOne}/${rows.length} (${report.metrics.withinOnePct}%)`);
  console.log(`  surface_scratch_light FP: ${falsePositives.surface_scratch_light}`);
  console.log(`  staining_light FP: ${falsePositives.staining_light}`);
  console.log(`  moderate_crease FP: ${falsePositives.moderate_crease}`);
  console.log(`  Wrote ${outPath}`);
}

main();
