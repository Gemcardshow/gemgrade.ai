#!/usr/bin/env node
/**
 * Live PSA 7–10 benchmark with identical raw vision A/B:
 * - Captures raw OpenAI vision JSON (no cache for grading)
 * - Grades each card with LOOSE (post-NM/GEM) vs NARROW (targeted gating) normalizeAnalysis
 * - Writes comparison report
 */
import fs from "node:fs";
import path from "node:path";
import { callStructuredVision, normalizeAnalysis as normalizeNarrow } from "../api/grading/analyze.js";
import { normalizeAnalysis as normalizeLoose } from "./snapshots/analyze-loose-nmgem.js";
import { computeGrade } from "../api/grading/engine.js";
import { resolveEra } from "../api/grading/era.js";
import { getWearFloor } from "../api/grading/psa-calibration.js";
import { ANALYSIS_JSON_SCHEMA, buildAnalysisInstruction } from "../api/grading/prompts/core.js";
import { GRADING_PHILOSOPHY } from "../api/grading/philosophy.js";
import { MODERN_RUBRIC } from "../api/grading/prompts/modern.js";
import { VINTAGE_RUBRIC } from "../api/grading/prompts/vintage.js";
import {
  BENCHMARKS_ROOT,
  imageToDataUrl,
  importOpenAI,
  loadEnvFiles,
  resolveBenchmarkPath,
} from "./lib/paths.js";

const PSA710_SUITES = new Set(["TEST 7", "TEST 8", "TEST 9", "TEST 10"]);

function parseArgs(argv) {
  const options = { card: null, limit: null, delayMs: 90000, resume: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--card") options.card = argv[++i];
    else if (arg === "--limit") options.limit = Number.parseInt(argv[++i], 10);
    else if (arg === "--delay-ms") options.delayMs = Number.parseInt(argv[++i], 10);
    else if (arg === "--resume") options.resume = true;
  }
  return options;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(message) {
  const match = String(message).match(/try again in (\d+(?:\.\d+)?)(ms|s)/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return match[2].toLowerCase() === "s" ? value * 1000 + 500 : value + 500;
}

function isRateLimitError(message) {
  return /\b429\b/.test(message) || /rate limit/i.test(message);
}

function isTpmRateLimit(message) {
  return /tokens per min/i.test(message) || /\bTPM\b/.test(message);
}

async function withRateLimitRetry(label, fn, { maxAttempts = 15, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      if (!isRateLimitError(message) || attempt === maxAttempts) {
        throw error;
      }
      const parsed = parseRetryAfterMs(message);
      const waitMs = isTpmRateLimit(message)
        ? Math.max(parsed ?? 0, 90000)
        : parsed ?? 20000 * attempt;
      onRetry?.({ label, attempt, maxAttempts, waitMs, message });
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function visionSnapshotPath(cardId) {
  return resolveBenchmarkPath("live-runs", "vision-snapshots", `${cardId}.json`);
}

function loadResumeRows(reportPath) {
  if (!fs.existsSync(reportPath)) return new Map();
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  return new Map(report.rows.map((row) => [row.id, row]));
}

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
    internalGrade: result.internalGrade,
    wearFloor: getWearFloor(result.categoryScores),
    categoryScores: result.categoryScores,
    defects: analysis.defects,
    primaryLimiter: result.primaryLimiter?.tag,
  };
}

function statsForRows(rows, field) {
  const n = rows.length;
  if (!n) {
    return { n: 0, meanError: null, withinOne: 0, exact: 0, inflated: 0 };
  }
  const errors = rows.map((r) => r[field]);
  return {
    n,
    meanError: errors.reduce((a, b) => a + b, 0) / n,
    withinOne: rows.filter((r) => Math.abs(r[field]) <= 1).length,
    exact: rows.filter((r) => r[field] === 0).length,
    inflated: rows.filter((r) => r[field] > 0).length,
  };
}

function bandBreakdown(rows, mode) {
  const field = mode === "loose" ? "looseVariance" : "narrowVariance";
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

async function captureVision(client, card, { onRetry } = {}) {
  const frontPath = path.join(BENCHMARKS_ROOT, card.images.front);
  const backPath = path.join(BENCHMARKS_ROOT, card.images.back);
  const frontImage = imageToDataUrl(frontPath);
  const backImage = imageToDataUrl(backPath);

  const eraResult = await withRateLimitRetry(
    "era",
    () => resolveEra(client, { frontImage, backImage, eraRequest: "auto" }),
    { onRetry }
  );

  const pathRubric = eraResult.era === "vintage" ? VINTAGE_RUBRIC : MODERN_RUBRIC;
  const instruction = buildAnalysisInstruction({
    philosophy: GRADING_PHILOSOPHY,
    pathRubric,
  });

  const rawVision = await withRateLimitRetry(
    "vision",
    () =>
      callStructuredVision(client, {
        schema: ANALYSIS_JSON_SCHEMA,
        instruction,
        frontImage,
        backImage,
      }),
    { onRetry }
  );

  return {
    era: eraResult.era,
    eraSource: eraResult.eraSource,
    estimatedYear: eraResult.estimatedYear ?? rawVision.cardMeta?.estimatedYear ?? null,
    rawVision,
    capturedAt: new Date().toISOString(),
  };
}

function buildMarkdown(report) {
  const lines = [
    "# PSA 7–10 Live Gating A/B Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Identical raw OpenAI vision per card. **Loose** = post-NM/GEM guards. **Narrow** = targeted gating (current).",
    "",
    "## Summary",
    "",
    "| Mode | n | Mean error | Within ±1 | Exact | Over-slabs |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const [label, key] of [
    ["Loose (post-NM/GEM)", "loose"],
    ["Narrow (targeted gating)", "narrow"],
    ["Δ narrow − loose", "delta"],
  ]) {
    const s = report.summary[key];
    if (key === "delta") {
      lines.push(
        `| ${label} | ${report.summary.loose.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne >= 0 ? `${s.withinOne}` : "—"} | ${s.exact >= 0 ? `${s.exact}` : "—"} | — |`
      );
      continue;
    }
    lines.push(
      `| ${label} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} | ${s.inflated}/${s.n} |`
    );
  }

  lines.push("", "## By PSA band (narrow gating)", "");
  lines.push("| Band | n | Mean error | Within ±1 | Exact |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const grade of [7, 8, 9, 10, "7+"]) {
    const s = report.byBandNarrow[String(grade)];
    if (!s?.n) continue;
    lines.push(
      `| PSA ${grade} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} |`
    );
  }

  lines.push("", "## By PSA band (loose gating)", "");
  lines.push("| Band | n | Mean error | Within ±1 | Exact |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const grade of [7, 8, 9, 10, "7+"]) {
    const s = report.byBandLoose[String(grade)];
    if (!s?.n) continue;
    lines.push(
      `| PSA ${grade} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} |`
    );
  }

  lines.push("", "## Largest narrow-vs-loose regressions", "");
  for (const row of report.topRegressions.slice(0, 15)) {
    lines.push(
      `- **${row.fileLabel}** PSA ${row.psaGrade}: loose ${row.looseGem} → narrow ${row.narrowGem} (Δ${row.gradeDelta >= 0 ? "+" : ""}${row.gradeDelta})`
    );
  }

  lines.push("", "## Largest narrow-vs-loose improvements", "");
  for (const row of report.topImprovements.slice(0, 15)) {
    lines.push(
      `- **${row.fileLabel}** PSA ${row.psaGrade}: loose ${row.looseGem} → narrow ${row.narrowGem} (Δ${row.gradeDelta >= 0 ? "+" : ""}${row.gradeDelta})`
    );
  }

  if (report.failures.length) {
    lines.push("", "## Failures", "");
    for (const f of report.failures) {
      lines.push(`- **${f.fileLabel}**: ${f.error}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  let cards = manifest.suites
    .filter((s) => PSA710_SUITES.has(s.id))
    .flatMap((s) => s.cards.map((c) => ({ ...c, suiteId: s.id })));

  if (options.card) cards = cards.filter((c) => c.id === options.card);
  if (options.limit != null && options.limit > 0) cards = cards.slice(0, options.limit);

  if (!cards.length) throw new Error("No cards matched filters.");

  const OpenAI = importOpenAI();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const liveDir = resolveBenchmarkPath("live-runs");
  const reportsDir = resolveBenchmarkPath("reports");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");
  fs.mkdirSync(liveDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(snapDir, { recursive: true });

  const reportJson = path.join(liveDir, "psa710-gating-ab-latest.json");
  const reportMd = path.join(reportsDir, "psa710-gating-ab-comparison.md");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const resumeRows = options.resume ? loadResumeRows(reportJson) : new Map();
  const rows = [...resumeRows.values()];
  const completedIds = new Set(rows.map((r) => r.id));
  const failures = [];

  const pending = cards.filter((c) => !completedIds.has(c.id));
  console.log(
    `PSA 7–10 gating A/B live: ${pending.length} pending (${rows.length} resumed)\n`
  );

  for (let i = 0; i < pending.length; i += 1) {
    const card = pending[i];
    process.stdout.write(`  [${i + 1}/${pending.length}] ${card.fileLabel}... `);

    try {
      const started = Date.now();
      let capture;
      const snapPath = visionSnapshotPath(card.id);

      if (fs.existsSync(snapPath)) {
        capture = JSON.parse(fs.readFileSync(snapPath, "utf8"));
      } else {
        capture = await captureVision(client, card, {
          onRetry: ({ label, attempt, maxAttempts, waitMs }) => {
            process.stdout.write(
              `\n    ${label} rate limit ${attempt}/${maxAttempts}, wait ${Math.round(waitMs / 1000)}s... `
            );
          },
        });
        fs.writeFileSync(snapPath, `${JSON.stringify(capture, null, 2)}\n`);
      }

      const { rawVision, era } = capture;
      const loose = gradeFromRaw(rawVision, era, normalizeLoose);
      const narrow = gradeFromRaw(rawVision, era, normalizeNarrow);
      const durationMs = Date.now() - started;

      rows.push({
        id: card.id,
        fileLabel: card.fileLabel,
        suiteId: card.suiteId,
        psaGrade: card.psaGrade,
        looseGem: loose.gemGrade,
        narrowGem: narrow.gemGrade,
        looseVariance: loose.gemGrade - card.psaGrade,
        narrowVariance: narrow.gemGrade - card.psaGrade,
        gradeDelta: narrow.gemGrade - loose.gemGrade,
        looseWearFloor: loose.wearFloor,
        narrowWearFloor: narrow.wearFloor,
        looseScores: loose.categoryScores,
        narrowScores: narrow.categoryScores,
        rawVisionScores: rawVision.categoryScores,
        durationMs,
      });

      console.log(
        `loose=${loose.gemGrade} narrow=${narrow.gemGrade} slab=${card.psaGrade} Δ=${narrow.gemGrade - loose.gemGrade >= 0 ? "+" : ""}${narrow.gemGrade - loose.gemGrade} [${Math.round(durationMs / 1000)}s]`
      );

      const partial = buildReport(rows, failures, cards.length);
      fs.writeFileSync(reportJson, `${JSON.stringify(partial, null, 2)}\n`);
    } catch (error) {
      console.log(`FAILED (${error.message})`);
      failures.push({
        id: card.id,
        fileLabel: card.fileLabel,
        psaGrade: card.psaGrade,
        error: error.message,
      });
    }

    if (i < pending.length - 1) {
      await sleep(options.delayMs);
    }
  }

  rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));
  const report = buildReport(rows, failures, cards.length);
  const stampedJson = path.join(liveDir, `psa710-gating-ab-${stamp}.json`);
  const stampedMd = path.join(reportsDir, `psa710-gating-ab-${stamp}.md`);

  fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(stampedJson, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMd, `${buildMarkdown(report)}\n`);
  fs.writeFileSync(stampedMd, `${buildMarkdown(report)}\n`);

  printSummary(report);
  console.log(`\nWrote ${reportMd}`);
  if (failures.length) process.exitCode = 1;
}

function buildReport(rows, failures, cardsRequested) {
  const looseStats = statsForRows(rows, "looseVariance");
  const narrowStats = statsForRows(rows, "narrowVariance");
  return {
    generatedAt: new Date().toISOString(),
    mode: "live-vision-gating-ab",
    cardsRequested,
    cardsGraded: rows.length,
    cardsFailed: failures.length,
    summary: {
      loose: looseStats,
      narrow: narrowStats,
      delta: {
        meanError: narrowStats.meanError - looseStats.meanError,
        withinOne: narrowStats.withinOne - looseStats.withinOne,
        exact: narrowStats.exact - looseStats.exact,
      },
    },
    byBandLoose: bandBreakdown(rows, "loose"),
    byBandNarrow: bandBreakdown(rows, "narrow"),
    topRegressions: rows
      .filter((r) => r.gradeDelta < 0)
      .sort((a, b) => a.gradeDelta - b.gradeDelta)
      .slice(0, 20),
    topImprovements: rows
      .filter((r) => r.gradeDelta > 0)
      .sort((a, b) => b.gradeDelta - a.gradeDelta)
      .slice(0, 20),
    rows,
    failures,
  };
}

function printSummary(report) {
  const l = report.summary.loose;
  const n = report.summary.narrow;
  console.log("\n--- Gating A/B (identical live vision) ---");
  console.log(
    `  Loose:  mean=${l.meanError?.toFixed(2)} within±1=${l.withinOne}/${l.n} exact=${l.exact}/${l.n} over=${l.inflated}/${l.n}`
  );
  console.log(
    `  Narrow: mean=${n.meanError?.toFixed(2)} within±1=${n.withinOne}/${n.n} exact=${n.exact}/${n.n} over=${n.inflated}/${n.n}`
  );
  console.log(
    `  Δ:      mean=${report.summary.delta.meanError?.toFixed(2)} within±1=${report.summary.delta.withinOne} exact=${report.summary.delta.exact}`
  );
  for (const grade of [7, 8, 9, 10]) {
    const s = report.byBandNarrow[String(grade)];
    if (!s?.n) continue;
    const sl = report.byBandLoose[String(grade)];
    console.log(
      `  PSA ${grade} narrow: mean=${s.meanError?.toFixed(2)} ±1=${s.withinOne}/${s.n} exact=${s.exact}/${s.n} | loose ±1=${sl.withinOne}/${sl.n}`
    );
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
