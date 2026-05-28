#!/usr/bin/env node
/**
 * Run GemGrade against benchmark manifest and write comparison report.
 * Usage: node benchmarks/run-benchmark.js [--suite psa-1-3] [--card id] [--dry-run]
 *
 * Requires OPENAI_API_KEY (loaded from .env at repo root if present).
 */
import fs from "node:fs";
import path from "node:path";
import { runGradingPipeline } from "../api/grading/pipeline.js";
import { scanBenchmarkSuites } from "./lib/scan.js";
import {
  BENCHMARKS_ROOT,
  REPO_ROOT,
  imageToDataUrl,
  importOpenAI,
  loadEnvFiles,
  resolveBenchmarkPath,
} from "./lib/paths.js";
import {
  detectCalibrationPatterns,
  summarizePatternFrequency,
} from "./lib/patterns.js";

function parseArgs(argv) {
  const options = {
    suite: null,
    card: null,
    dryRun: false,
    refreshManifest: false,
    fromCache: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--from-cache") options.fromCache = true;
    else if (arg === "--refresh-manifest") options.refreshManifest = true;
    else if (arg === "--suite") options.suite = argv[++i];
    else if (arg === "--card") options.card = argv[++i];
  }

  return options;
}

function loadManifest(refresh) {
  if (refresh) {
    return scanBenchmarkSuites();
  }

  const manifestPath = resolveBenchmarkPath("manifest.json");
  if (fs.existsSync(manifestPath)) {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }

  return scanBenchmarkSuites();
}

function formatTable(rows) {
  const headers = ["Card", "PSA", "GemGrade", "Diff", "Internal", "Era", "Patterns"];
  const data = rows.map((row) => [
    row.card,
    String(row.psaGrade),
    String(row.gemGrade),
    row.gradeDifference >= 0 ? `+${row.gradeDifference}` : String(row.gradeDifference),
    String(row.internalGrade),
    row.era,
    row.patterns.map((p) => p.id).join(", ") || "—",
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...data.map((row) => row[index].length))
  );

  const pad = (value, width) => value.padEnd(width);

  const lines = [
    headers.map((header, index) => pad(header, widths[index])).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...data.map((row) => row.map((cell, index) => pad(cell, widths[index])).join("  ")),
  ];

  return lines.join("\n");
}

function buildMarkdownReport(report) {
  const lines = [
    `# GemGrade Benchmark Report`,
    ``,
    `Generated: ${report.generatedAt}`,
    `Suite: ${report.suiteId}`,
    `Cards: ${report.summary.total} · Mean |Δ|: ${report.summary.meanAbsDelta.toFixed(2)} · Within ±1: ${report.summary.withinOne}/${report.summary.total}`,
    ``,
    `| Card | PSA | GemGrade | Diff | Internal | Era | Patterns |`,
    `| --- | ---: | ---: | ---: | ---: | --- | --- |`,
  ];

  for (const row of report.rows) {
    const diff =
      row.gradeDifference >= 0
        ? `+${row.gradeDifference}`
        : String(row.gradeDifference);
    const patternIds = row.patterns.map((p) => p.id).join(", ") || "—";
    lines.push(
      `| ${row.card} | ${row.psaGrade} | ${row.gemGrade} | ${diff} | ${row.internalGrade} | ${row.era} | ${patternIds} |`
    );
  }

  if (report.patternSummary.length > 0) {
    lines.push("", "## Calibration pattern summary", "");
    for (const item of report.patternSummary) {
      lines.push(
        `- **${item.label}** (${item.count}): ${item.cards.join(", ")}`
      );
    }
  }

  lines.push("", "## Per-card notes", "");
  for (const row of report.rows) {
    lines.push(`### ${row.card}`);
    lines.push(`- PSA slab: ${row.psaGrade}`);
    lines.push(`- GemGrade: ${row.gemGrade} (Δ ${row.gradeDifference >= 0 ? "+" : ""}${row.gradeDifference})`);
    lines.push(`- Primary limiter: ${row.primaryLimiter.label} (\`${row.primaryLimiter.tag}\`)`);
    lines.push(
      `- Subgrades: C ${row.categoryScores.corners} / E ${row.categoryScores.edges} / S ${row.categoryScores.surface} / CTR ${row.categoryScores.centering}`
    );
    if (row.patterns.length > 0) {
      lines.push(`- Patterns:`);
      for (const pattern of row.patterns) {
        lines.push(`  - ${pattern.label}: ${pattern.detail}`);
      }
    } else {
      lines.push(`- Patterns: none flagged`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function cachePathFor(cardId) {
  return resolveBenchmarkPath("cache", `${cardId}.json`);
}

function readCachedGrade(cardId) {
  const cachePath = cachePathFor(cardId);
  if (!fs.existsSync(cachePath)) return null;
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function writeCachedGrade(cardId, payload) {
  const cacheDir = resolveBenchmarkPath("cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    cachePathFor(cardId),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(message) {
  const match = String(message).match(/try again in (\d+)ms/i);
  return match ? Number.parseInt(match[1], 10) + 250 : null;
}

async function gradeBenchmarkCard(client, card, { maxAttempts = 5 } = {}) {
  const frontPath = path.join(BENCHMARKS_ROOT, card.images.front);
  const backPath = path.join(BENCHMARKS_ROOT, card.images.back);
  const params = {
    frontImage: imageToDataUrl(frontPath),
    backImage: imageToDataUrl(backPath),
    eraRequest: "auto",
  };

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runGradingPipeline(client, params);
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      const isRateLimit = /\b429\b/.test(message) || /rate limit/i.test(message);
      if (!isRateLimit || attempt === maxAttempts) {
        throw error;
      }
      const retryAfter = parseRetryAfterMs(message) ?? 2000 * attempt;
      await sleep(retryAfter);
    }
  }

  throw lastError;
}

function rowFromGradeResult(card, result, durationMs) {
  const gradeDifference = result.psaGrade - card.psaGrade;
  return {
    id: card.id,
    card: card.cardName,
    suiteId: card.suiteId,
    psaGrade: card.psaGrade,
    gemGrade: result.psaGrade,
    internalGrade: result.internalGrade,
    gradeDifference,
    era: result.era,
    eraSource: result.eraSource,
    estimatedYear: result.estimatedYear,
    categoryScores: result.categoryScores,
    primaryLimiter: result.primaryLimiter,
    defects: result.defects,
    capAudit: result.capAudit,
    eyeAppealSummary: result.eyeAppealSummary,
    likelyRange: result.likelyRange,
    patterns: detectCalibrationPatterns({
      psaGrade: card.psaGrade,
      gemGrade: result.psaGrade,
      internalGrade: result.internalGrade,
      categoryScores: result.categoryScores,
      defects: result.defects,
      primaryLimiter: result.primaryLimiter,
      eyeAppealSummary: result.eyeAppealSummary,
      capAudit: result.capAudit,
    }),
    durationMs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles();

  const manifest = loadManifest(options.refreshManifest);
  let suites = manifest.suites;

  if (options.suite) {
    suites = suites.filter((suite) => suite.id === options.suite);
    if (suites.length === 0) {
      throw new Error(`Suite not found: ${options.suite}`);
    }
  }

  const cards = suites.flatMap((suite) =>
    suite.cards.map((card) => ({ ...card, suiteId: suite.id }))
  );

  const filtered = options.card
    ? cards.filter((card) => card.id === options.card)
    : cards;

  if (filtered.length === 0) {
    throw new Error("No benchmark cards matched filters.");
  }

  if (options.dryRun) {
    console.log(`Dry run: ${filtered.length} card(s) ready.`);
    for (const card of filtered) {
      console.log(`  ${card.suiteId}/${card.id} — PSA ${card.psaGrade}`);
    }
    return;
  }

  const useCacheOnly = options.fromCache;
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY);

  if (!useCacheOnly && !hasApiKey) {
    const allCached = filtered.every((card) => readCachedGrade(card.id));
    if (allCached) {
      console.log("No OPENAI_API_KEY — using benchmark cache for all cards.\n");
      options.fromCache = true;
    } else {
      throw new Error(
        "OPENAI_API_KEY is required for live runs. Set it in .env at the repo root, or pass --from-cache after a prior successful run."
      );
    }
  }

  /** @type {import("openai").default | null} */
  let client = null;
  if (!options.fromCache) {
    const OpenAI = importOpenAI();
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const rows = [];

  console.log(
    options.fromCache
      ? `Replaying ${filtered.length} cached benchmark result(s)...\n`
      : `Running GemGrade on ${filtered.length} benchmark card(s)...\n`
  );

  for (const card of filtered) {
    process.stdout.write(`  Grading ${card.cardName} (PSA ${card.psaGrade})... `);
    const started = Date.now();

    try {
      let result;
      if (options.fromCache) {
        const cached = readCachedGrade(card.id);
        if (!cached?.grade) {
          throw new Error(`No cache for ${card.id}. Run a live benchmark first.`);
        }
        result = cached.grade;
        console.log(`cache`);
      } else {
        result = await gradeBenchmarkCard(client, card);
        writeCachedGrade(card.id, {
          cachedAt: new Date().toISOString(),
          card,
          grade: result,
        });
      }

      const row = rowFromGradeResult(card, result, Date.now() - started);
      rows.push(row);
      console.log(
        `PSA ${result.psaGrade} (Δ ${row.gradeDifference >= 0 ? "+" : ""}${row.gradeDifference}) [${row.durationMs}ms]`
      );
    } catch (error) {
      console.log("FAILED");
      rows.push({
        id: card.id,
        card: card.cardName,
        suiteId: card.suiteId,
        psaGrade: card.psaGrade,
        error: error.message,
        patterns: [],
      });
    }

    if (!options.fromCache && filtered.indexOf(card) < filtered.length - 1) {
      await sleep(3000);
    }
  }

  const successful = rows.filter((row) => !row.error);
  const deltas = successful.map((row) => row.gradeDifference);
  const absDeltas = deltas.map(Math.abs);

  const report = {
    generatedAt: new Date().toISOString(),
    suiteId: options.suite || suites.map((s) => s.id).join(","),
    repoRoot: REPO_ROOT,
    rows: successful,
    failures: rows.filter((row) => row.error),
    summary: {
      total: successful.length,
      failed: rows.length - successful.length,
      meanDelta:
        deltas.length > 0
          ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
          : 0,
      meanAbsDelta:
        absDeltas.length > 0
          ? absDeltas.reduce((sum, value) => sum + value, 0) / absDeltas.length
          : 0,
      exactMatch: successful.filter((row) => row.gradeDifference === 0).length,
      withinOne: successful.filter((row) => Math.abs(row.gradeDifference) <= 1)
        .length,
      inflated: successful.filter((row) => row.gradeDifference > 0).length,
      deflated: successful.filter((row) => row.gradeDifference < 0).length,
    },
    patternSummary: summarizePatternFrequency(successful),
  };

  const reportsDir = resolveBenchmarkPath("reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(reportsDir, `report-${stamp}.json`);
  const mdPath = path.join(reportsDir, `report-${stamp}.md`);
  const latestJsonPath = path.join(reportsDir, "latest.json");
  const latestMdPath = path.join(reportsDir, "latest.md");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdownReport(report)}\n`, "utf8");
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMdPath, `${buildMarkdownReport(report)}\n`, "utf8");

  console.log("\n" + formatTable(successful));
  console.log("\nSummary:");
  console.log(`  Mean delta: ${report.summary.meanDelta >= 0 ? "+" : ""}${report.summary.meanDelta.toFixed(2)}`);
  console.log(`  Mean |delta|: ${report.summary.meanAbsDelta.toFixed(2)}`);
  console.log(`  Exact match: ${report.summary.exactMatch}/${report.summary.total}`);
  console.log(`  Within ±1: ${report.summary.withinOne}/${report.summary.total}`);
  console.log(`  Inflated: ${report.summary.inflated} · Deflated: ${report.summary.deflated}`);

  if (report.patternSummary.length > 0) {
    console.log("\nCalibration patterns:");
    for (const item of report.patternSummary) {
      console.log(`  - ${item.label}: ${item.count} (${item.cards.join(", ")})`);
    }
  }

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Latest: ${latestJsonPath}`);

  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
