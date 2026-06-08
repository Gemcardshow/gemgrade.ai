#!/usr/bin/env node
/**
 * Live re-vision benchmark for PSA 7–10 cards.
 * Does NOT use cached vision for grading — always calls OpenAI vision fresh.
 * Reads cache only for "before" tag baseline comparison.
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeCard } from "../api/grading/analyze.js";
import { computeGrade } from "../api/grading/engine.js";
import { resolveEra } from "../api/grading/era.js";
import { formatGradeResponse } from "../api/grading/response.js";
import { getWearFloor } from "../api/grading/psa-calibration.js";
import {
  BENCHMARKS_ROOT,
  imageToDataUrl,
  importOpenAI,
  loadEnvFiles,
  resolveBenchmarkPath,
} from "./lib/paths.js";

const TRACKED_TAGS = [
  "corner_wear_moderate",
  "surface_scratch_moderate",
  "back_damage_severe",
  "writing_mark",
];

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

function loadResumeRows() {
  const latest = resolveBenchmarkPath("live-runs", "psa710-live-latest.json");
  if (!fs.existsSync(latest)) return new Map();
  const report = JSON.parse(fs.readFileSync(latest, "utf8"));
  return new Map(report.rows.map((row) => [row.id, row]));
}

function cachePathFor(cardId) {
  return resolveBenchmarkPath("cache", `${cardId}.json`);
}

function readCache(cardId) {
  const p = cachePathFor(cardId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function countTags(defects, tag) {
  return (defects || []).filter((d) => d.tag === tag).length;
}

function countAllTracked(defects) {
  const counts = {};
  for (const tag of TRACKED_TAGS) {
    counts[tag] = countTags(defects, tag);
  }
  return counts;
}

function sumCounts(rows, field) {
  const totals = {};
  for (const tag of TRACKED_TAGS) totals[tag] = 0;
  for (const row of rows) {
    for (const tag of TRACKED_TAGS) {
      totals[tag] += row[field]?.[tag] || 0;
    }
  }
  return totals;
}

function bandStats(rows, psaGrade) {
  const band = rows.filter((r) => r.psaGrade === psaGrade);
  const n = band.length || 0;
  if (!n) {
    return { n: 0, meanError: null, withinOne: 0, exact: 0 };
  }
  const errors = band.map((r) => r.variance);
  const meanError = errors.reduce((a, b) => a + b, 0) / n;
  const withinOne = band.filter((r) => Math.abs(r.variance) <= 1).length;
  const exact = band.filter((r) => r.variance === 0).length;
  return { n, meanError, withinOne, exact };
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

async function gradeLive(client, card, { maxAttempts = 15, onRetry } = {}) {
  const frontPath = path.join(BENCHMARKS_ROOT, card.images.front);
  const backPath = path.join(BENCHMARKS_ROOT, card.images.back);
  const frontImage = imageToDataUrl(frontPath);
  const backImage = imageToDataUrl(backPath);

  const eraResult = await withRateLimitRetry(
    "era",
    () =>
      resolveEra(client, {
        frontImage,
        backImage,
        eraRequest: "auto",
      }),
    { maxAttempts, onRetry }
  );

  const analysis = await withRateLimitRetry(
    "vision",
    () =>
      analyzeCard(client, {
        frontImage,
        backImage,
        era: eraResult.era,
      }),
    { maxAttempts, onRetry }
  );

  const gradeResult = computeGrade(analysis, eraResult.era);
  return formatGradeResponse({
    gradeResult,
    analysis,
    eraSource: eraResult.eraSource,
    estimatedYear:
      eraResult.estimatedYear ?? analysis.cardMeta?.estimatedYear ?? null,
  });
}

function buildMarkdown(report) {
  const lines = [
    "# PSA 7–10 Live Re-Vision Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Live OpenAI vision (no cache replay). Cache read only for pre-run tag baseline.",
    "",
    "## Grade accuracy",
    "",
    "| Band | Cards | Mean error | Within ±1 | Exact |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const grade of [7, 8, 9, 10, "7-10"]) {
    const s = report.byPsaGrade[String(grade)];
    if (!s || !s.n) continue;
    lines.push(
      `| PSA ${grade} | ${s.n} | ${s.meanError?.toFixed(2) ?? "—"} | ${s.withinOne}/${s.n} | ${s.exact}/${s.n} |`
    );
  }

  lines.push(
    "",
    "## Tracked defect tags (card-instances)",
    "",
    "| Tag | Before (cached) | After (live) | Δ |",
    "| --- | ---: | ---: | ---: |"
  );

  for (const tag of TRACKED_TAGS) {
    const before = report.tagTotals.before[tag];
    const after = report.tagTotals.after[tag];
    lines.push(`| ${tag} | ${before} | ${after} | ${after - before} |`);
  }

  lines.push("", "## Per-card results", "");
  lines.push(
    "| Card | PSA | GemGrade | Δ | wearFloor | Before tags | After tags |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- |"
  );

  for (const row of report.rows) {
    const beforeStr = TRACKED_TAGS.filter((t) => row.beforeTags[t])
      .map((t) => `${t}:${row.beforeTags[t]}`)
      .join(", ") || "—";
    const afterStr = TRACKED_TAGS.filter((t) => row.afterTags[t])
      .map((t) => `${t}:${row.afterTags[t]}`)
      .join(", ") || "—";
    const diff = row.variance >= 0 ? `+${row.variance}` : String(row.variance);
    lines.push(
      `| ${row.fileLabel} | ${row.psaGrade} | ${row.gemGrade} | ${diff} | ${row.wearFloor?.toFixed(1) ?? "—"} | ${beforeStr} | ${afterStr} |`
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
    throw new Error("OPENAI_API_KEY is required for live re-vision benchmark.");
  }

  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  let cards = manifest.suites
    .filter((s) => PSA710_SUITES.has(s.id))
    .flatMap((s) => s.cards.map((c) => ({ ...c, suiteId: s.id })));

  if (options.card) {
    cards = cards.filter((c) => c.id === options.card);
  }
  if (options.limit != null && options.limit > 0) {
    cards = cards.slice(0, options.limit);
  }

  if (!cards.length) {
    throw new Error("No PSA 7–10 cards matched filters.");
  }

  const OpenAI = importOpenAI();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const reportsDir = resolveBenchmarkPath("reports");
  const liveDir = resolveBenchmarkPath("live-runs");
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(liveDir, { recursive: true });

  const latestJson = path.join(liveDir, "psa710-live-latest.json");
  const latestMd = path.join(reportsDir, "psa710-live-latest.md");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  function buildReport() {
    const byPsaGrade = {};
    for (const grade of [7, 8, 9, 10]) {
      byPsaGrade[String(grade)] = bandStats(rows, grade);
    }
    const all710 = {
      n: rows.length,
      meanError:
        rows.length > 0
          ? rows.reduce((s, r) => s + r.variance, 0) / rows.length
          : null,
      withinOne: rows.filter((r) => Math.abs(r.variance) <= 1).length,
      exact: rows.filter((r) => r.variance === 0).length,
    };
    byPsaGrade["7-10"] = all710;

    return {
      generatedAt: new Date().toISOString(),
      mode: "live-revision",
      cardsRequested: cards.length,
      cardsGraded: rows.length,
      cardsFailed: failures.length,
      byPsaGrade,
      tagTotals: {
        before: sumCounts(rows, "beforeTags"),
        after: sumCounts(rows, "afterTags"),
      },
      rows,
      failures,
    };
  }

  function writeReport(finalStamp = stamp) {
    const report = buildReport();
    const jsonPath = path.join(liveDir, `psa710-live-${finalStamp}.json`);
    const mdPath = path.join(reportsDir, `psa710-live-${finalStamp}.md`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`);
    fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(latestMd, `${buildMarkdown(report)}\n`);
    return { report, jsonPath, mdPath };
  }

  const resumeRows = options.resume ? loadResumeRows() : new Map();
  const rows = [...resumeRows.values()];
  const completedIds = new Set(rows.map((r) => r.id));
  const failures = [];

  const pending = cards.filter((c) => !completedIds.has(c.id));

  console.log(
    `PSA 7–10 live re-vision: ${pending.length} pending (${rows.length} resumed)\n`
  );

  for (let i = 0; i < pending.length; i += 1) {
    const card = pending[i];
    process.stdout.write(
      `  [${i + 1}/${pending.length}] ${card.fileLabel}... `
    );

    const cached = readCache(card.id);
    const beforeDefects = cached?.grade?.defects || [];
    const beforeTags = countAllTracked(beforeDefects);

    try {
      const started = Date.now();
      const result = await gradeLive(client, card, {
        onRetry: ({ label, attempt, maxAttempts, waitMs }) => {
          process.stdout.write(
            `\n    ${label} rate limit ${attempt}/${maxAttempts}, wait ${Math.round(waitMs / 1000)}s... `
          );
        },
      });
      const durationMs = Date.now() - started;
      const afterTags = countAllTracked(result.defects);
      const wearFloor = getWearFloor(result.categoryScores);
      const variance = result.psaGrade - card.psaGrade;

      rows.push({
        id: card.id,
        fileLabel: card.fileLabel,
        suiteId: card.suiteId,
        psaGrade: card.psaGrade,
        gemGrade: result.psaGrade,
        internalGrade: result.internalGrade,
        variance,
        wearFloor,
        categoryScores: result.categoryScores,
        beforeTags,
        afterTags,
        hadCacheBaseline: Boolean(cached?.grade),
        defects: result.defects,
        primaryLimiter: result.primaryLimiter?.tag,
        durationMs,
      });

      console.log(
        `PSA ${result.psaGrade} (Δ ${variance >= 0 ? "+" : ""}${variance}) wf=${wearFloor.toFixed(1)} [${Math.round(durationMs / 1000)}s]`
      );
      writeReport("partial");
    } catch (error) {
      console.log(`FAILED (${error.message})`);
      failures.push({
        id: card.id,
        fileLabel: card.fileLabel,
        psaGrade: card.psaGrade,
        error: error.message,
        beforeTags,
        hadCacheBaseline: Boolean(cached?.grade),
      });
    }

    if (i < pending.length - 1) {
      await sleep(options.delayMs);
    }
  }

  rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));

  const { report, jsonPath, mdPath } = writeReport();
  const all710 = report.byPsaGrade["7-10"];

  console.log("\n--- PSA 7–10 Live Results ---");
  for (const grade of [7, 8, 9, 10]) {
    const s = report.byPsaGrade[String(grade)];
    if (!s.n) continue;
    console.log(
      `  PSA ${grade}: n=${s.n} mean=${s.meanError.toFixed(2)} within±1=${s.withinOne}/${s.n} exact=${s.exact}/${s.n}`
    );
  }
  console.log(
    `  PSA 7–10 overall: n=${all710.n} mean=${all710.meanError?.toFixed(2)} within±1=${all710.withinOne}/${all710.n} exact=${all710.exact}/${all710.n}`
  );

  console.log("\n--- Tag counts (card-instances) ---");
  for (const tag of TRACKED_TAGS) {
    const b = report.tagTotals.before[tag];
    const a = report.tagTotals.after[tag];
    console.log(`  ${tag}: before=${b} after=${a} Δ=${a - b}`);
  }

  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
