#!/usr/bin/env node
/**
 * Replay cached or sample vision JSON through normalize + computeGrade with scratch diagnostics.
 * Does not call OpenAI. Does not change grading logic.
 *
 * Usage:
 *   node benchmarks/trace-scratch-pipeline.mjs --vision path/to/vision.json
 *   node benchmarks/trace-scratch-pipeline.mjs --wemby-generic
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import {
  createScratchDiagnosticTrace,
  finalizeScratchDiagnosticTrace,
  logScratchDiagnostics,
} from "../lib/grading/scratch-diagnostics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.resolve(__dirname, "reports");

const WEMBY_GENERIC_VISION = {
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
  bestAttribute: "Strong centering and sharp corners",
  eyeAppealSummary:
    "Light scratch present, affecting surface quality on this Bowman Chrome /299.",
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

function parseArgs(argv) {
  const options = { era: "modern", visionPath: null, wembyGeneric: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--vision") options.visionPath = path.resolve(argv[++i]);
    else if (arg === "--wemby-generic") options.wembyGeneric = true;
    else if (arg === "--era") options.era = argv[++i];
    else if (arg === "--out") options.out = path.resolve(argv[++i]);
  }
  return options;
}

function visionFromGradeCache(cached) {
  const grade = cached.grade || cached;
  return {
    categoryScores: { ...grade.categoryScores },
    defects: JSON.parse(JSON.stringify(grade.defects || [])),
    primaryLimiterTag: grade.primaryLimiter?.tag ?? null,
    primaryLimiterLabel: grade.primaryLimiter?.label,
    eyeAppealSummary: grade.eyeAppealSummary,
    bestAttribute: grade.bestAttribute,
    categoryNotes: grade.categoryNotes || {},
    scanQuality: grade.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: grade.cardMeta || {},
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let rawVision;

  if (options.wembyGeneric) {
    rawVision = WEMBY_GENERIC_VISION;
  } else if (options.visionPath) {
    const loaded = JSON.parse(fs.readFileSync(options.visionPath, "utf8"));
    rawVision = loaded.categoryScores ? loaded : visionFromGradeCache(loaded);
  } else {
    console.error(
      "Provide --vision <path.json> or --wemby-generic\n" +
        "Example: node benchmarks/trace-scratch-pipeline.mjs --wemby-generic"
    );
    process.exit(1);
  }

  const scratchDiagnostics = createScratchDiagnosticTrace(rawVision);
  const analysis = normalizeAnalysis(JSON.parse(JSON.stringify(rawVision)), options.era, {
    scratchDiagnostics,
  });
  const gradeResult = computeGrade(analysis, options.era);
  finalizeScratchDiagnosticTrace(scratchDiagnostics, analysis, gradeResult);

  const report = {
    generatedAt: new Date().toISOString(),
    era: options.era,
    grade: {
      psaGrade: gradeResult.psaGrade,
      internalGrade: gradeResult.internalGrade,
      primaryLimiter: gradeResult.primaryLimiter,
      surfaceScore: gradeResult.categoryScores.surface,
    },
    scratchDiagnostics,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outPath =
    options.out ||
    path.join(REPORT_DIR, `scratch-trace-${Date.now()}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  logScratchDiagnostics(scratchDiagnostics);
  console.log(`Wrote ${outPath}`);
  console.log(`Summary: ${scratchDiagnostics.summary?.hypothesis}`);
}

main();
