#!/usr/bin/env node
/**
 * Phase 2A — Vintage benchmark cache refresh (measurement hygiene only).
 * Prefers vision snapshots over stale cache when they disagree.
 * Does NOT modify grading logic.
 *
 * Usage: node benchmarks/run-vintage-cache-refresh-phase2a.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { eraFromYear } from "../lib/grading/era.js";
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

const VINTAGE_PHASE1_FREEZE = "fb4cf93";
const MODERN_FREEZE = "15a078c";

const PRIORITY_DRIFT_IDS = new Set([
  "1953-t-kennedy-psa8",
  "1983-t-boggs-psa7",
  "1974-t-parker-psa7",
  "1978-t-eckersley-psa9",
  "1983-t-seaver-psa9",
  "1975-t-luzinski-psa8",
  "1960-t-spahn-psa8",
  "1976-t-yount-psa9",
  "t206-young-psa8",
]);

const TRACKED_FP_TAGS = ["moderate_crease", "staining_light", "heavy_staining"];

const dryRun = process.argv.includes("--dry-run");

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

function gradeFromCached(cached) {
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  const raw = {
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
  };
  const year = grade.estimatedYear ?? raw.cardMeta?.estimatedYear ?? cached.card?.year;
  const era = grade.era || (year != null ? eraFromYear(year) : "vintage");
  const analysis = normalizeAnalysis(raw, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    era
  );
  return { result, analysis, raw, source: "cache-replay" };
}

function gradeFromSnapshot(snapshot) {
  const rawVision = snapshot.rawVision || snapshot;
  const year = snapshot.estimatedYear ?? rawVision.cardMeta?.estimatedYear ?? null;
  const era = snapshot.era || (year != null ? eraFromYear(year) : "vintage");
  const raw = {
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
  const analysis = normalizeAnalysis(raw, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores: raw.categoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    era
  );
  return { result, analysis, raw, source: "vision-snapshot" };
}

function bindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) {
    return (capAudit || []).find((e) => e.source === "categoryFloor")?.source ?? null;
  }
  return capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]?.source ?? null;
}

function notesText(notes) {
  return Object.values(notes || {}).join(" ").toLowerCase();
}

function detectGremlins(row) {
  const gremlins = [];
  const tags = new Set((row.defects || []).map((d) => d.tag));
  const notes = notesText(row.categoryNotes);
  const diff = row.gradeDifference;
  const absDiff = Math.abs(diff);

  if (
    (row.primaryLimiterTag === "surface_scratch_light" ||
      row.primaryLimiterTag === "surface_scratch_moderate") &&
    row.psaGrade >= 7 &&
    diff <= -2
  ) {
    gremlins.push({ id: "scratch_limiter_high_grade" });
  }

  if (tags.has("moderate_crease")) {
    const creaseInNotes = /\b(crease|fold|wrinkle)\b/i.test(notes);
    if (!creaseInNotes) {
      gremlins.push({ id: "false_moderate_crease" });
    }
    if (row.primaryLimiterTag === "moderate_crease" && row.psaGrade >= 4 && diff <= -1) {
      gremlins.push({ id: "moderate_crease_limiter" });
    }
  }

  const vintageCapAny = (row.capAudit || []).find((e) => e.source?.startsWith("vintage:"));
  if (vintageCapAny && row.psaGrade >= 4 && diff <= -1) {
    gremlins.push({ id: "vintage_calibration_cap", source: vintageCapAny.source });
  }

  const categoryFloor = (row.capAudit || []).find((e) => e.source === "categoryFloor");
  const minPillar = Math.min(
    row.categoryScores?.corners ?? 10,
    row.categoryScores?.edges ?? 10,
    row.categoryScores?.surface ?? 10
  );
  if (categoryFloor && absDiff >= 2 && minPillar <= row.psaGrade - 2) {
    gremlins.push({ id: "min_pillar_category_floor" });
  }

  if ((row.capAudit || []).some((e) => e.source === "vintage:triad_light_wear_notes")) {
    gremlins.push({ id: "triad_cap_present" });
  }

  return gremlins;
}

function buildBenchmarkRows(manifest, cacheDir, snapDir, preferSnapshot = false) {
  const rows = [];
  const ungraded = [];

  for (const suite of manifest.suites.filter((s) => VINTAGE_SUITE_IDS.has(s.id))) {
    for (const card of suite.cards) {
      const cachePath = path.join(cacheDir, `${card.id}.json`);
      const snapPath = path.join(snapDir, `${card.id}.json`);
      const hasCache = fs.existsSync(cachePath);
      const hasSnap = fs.existsSync(snapPath);

      let graded;
      let source;
      if (preferSnapshot && hasSnap) {
        graded = gradeFromSnapshot(JSON.parse(fs.readFileSync(snapPath, "utf8")));
        source = "vision-snapshot";
      } else if (hasCache) {
        graded = gradeFromCached(JSON.parse(fs.readFileSync(cachePath, "utf8")));
        source = "cache-replay";
      } else if (hasSnap) {
        graded = gradeFromSnapshot(JSON.parse(fs.readFileSync(snapPath, "utf8")));
        source = "vision-snapshot";
      } else {
        ungraded.push(card);
        continue;
      }

      const { result, analysis } = graded;
      const gradeDifference = result.psaGrade - card.psaGrade;
      const row = {
        id: card.id,
        cardName: card.cardName,
        suiteId: suite.id,
        psaGrade: card.psaGrade,
        gemGrade: result.psaGrade,
        internalGrade: result.internalGrade,
        gradeDifference,
        primaryLimiterTag: result.primaryLimiter?.tag ?? null,
        defects: analysis.defects,
        categoryScores: result.categoryScores,
        capAudit: result.capAudit,
        bindingRule: bindingRule(result.capAudit),
        categoryNotes: analysis.categoryNotes,
        source,
        gremlins: [],
      };
      row.gremlins = detectGremlins(row);
      rows.push(row);
    }
  }

  return { rows, ungraded };
}

function summarizeBenchmark(rows, label) {
  const ok = rows.filter((r) => r.gemGrade != null);
  const n = ok.length || 1;
  const deltas = ok.map((r) => r.gradeDifference);
  const withinOne = ok.filter((r) => Math.abs(r.gradeDifference) <= 1).length;

  const primaryLimiterCounts = {};
  for (const row of ok) {
    const tag = row.primaryLimiterTag || "(none)";
    primaryLimiterCounts[tag] = (primaryLimiterCounts[tag] || 0) + 1;
  }

  const scratchGremlins = ok.filter((r) =>
    r.gremlins.some((g) => g.id === "scratch_limiter_high_grade")
  ).length;

  const creaseTagCount = ok.filter((r) =>
    r.defects.some((d) => d.tag === "moderate_crease")
  ).length;

  const creaseGremlins = ok.filter((r) =>
    r.gremlins.some((g) => g.id === "moderate_crease_limiter" || g.id === "false_moderate_crease")
  ).length;

  const triadCapCount = ok.filter((r) =>
    (r.capAudit || []).some((e) => e.source === "vintage:triad_light_wear_notes")
  ).length;

  const pillarClampGremlins = ok.filter((r) =>
    r.gremlins.some((g) => g.id === "min_pillar_category_floor")
  ).length;

  const vintageCapCount = ok.filter((r) =>
    r.gremlins.some((g) => g.id === "vintage_calibration_cap")
  ).length;

  const categoryFloor55 = ok.filter((r) => {
    const floor = (r.capAudit || []).find((e) => e.source === "categoryFloor")?.value;
    return floor != null && floor <= 5.5;
  }).length;

  const fpCounts = Object.fromEntries(
    TRACKED_FP_TAGS.map((tag) => [
      tag,
      ok.filter(
        (r) => r.defects.some((d) => d.tag === tag) || r.primaryLimiterTag === tag
      ).length,
    ])
  );

  return {
    label,
    graded: ok.length,
    withinOne,
    withinOnePct: ((withinOne / n) * 100).toFixed(1),
    exactMatch: ok.filter((r) => r.gradeDifference === 0).length,
    meanError: deltas.reduce((s, v) => s + v, 0) / n,
    meanAbsError: deltas.reduce((s, v) => s + Math.abs(v), 0) / n,
    inflated: ok.filter((r) => r.gradeDifference > 0).length,
    deflated: ok.filter((r) => r.gradeDifference < 0).length,
    primaryLimiterCounts,
    scratchGremlins,
    creaseTagCount,
    creaseGremlins,
    triadCapCount,
    pillarClampGremlins,
    vintageCapCount,
    categoryFloor55,
    falsePositiveTags: fpCounts,
  };
}

function defectTagSet(defects) {
  return [...new Set((defects || []).map((d) => d.tag))].sort().join(",");
}

function compareDrift(card, cachePath, snapPath) {
  if (!fs.existsSync(cachePath) || !fs.existsSync(snapPath)) {
    return {
      id: card.id,
      cardName: card.cardName,
      psaGrade: card.psaGrade,
      hasCache: fs.existsSync(cachePath),
      hasSnapshot: fs.existsSync(snapPath),
      comparable: false,
      priority: PRIORITY_DRIFT_IDS.has(card.id),
    };
  }

  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const cacheGraded = gradeFromCached(cached);
  const snapGraded = gradeFromSnapshot(snapshot);

  const cacheTags = defectTagSet(cacheGraded.analysis.defects);
  const snapTags = defectTagSet(snapGraded.analysis.defects);
  const gemDelta = cacheGraded.result.psaGrade - snapGraded.result.psaGrade;
  const limiterDiff = cacheGraded.result.primaryLimiter?.tag !== snapGraded.result.primaryLimiter?.tag;

  const disagrees =
    cacheGraded.result.psaGrade !== snapGraded.result.psaGrade ||
    cacheTags !== snapTags ||
    limiterDiff;

  return {
    id: card.id,
    cardName: card.cardName,
    psaGrade: card.psaGrade,
    hasCache: true,
    hasSnapshot: true,
    comparable: true,
    priority: PRIORITY_DRIFT_IDS.has(card.id),
    cacheGem: cacheGraded.result.psaGrade,
    snapshotGem: snapGraded.result.psaGrade,
    gemDelta,
    cacheLimiter: cacheGraded.result.primaryLimiter?.tag ?? null,
    snapshotLimiter: snapGraded.result.primaryLimiter?.tag ?? null,
    cacheDefectTags: cacheTags,
    snapshotDefectTags: snapTags,
    cacheBinding: bindingRule(cacheGraded.result.capAudit),
    snapshotBinding: bindingRule(snapGraded.result.capAudit),
    disagrees,
    refreshRecommended: disagrees,
  };
}

function buildRefreshedCache(cached, snapshot) {
  const rawVision = snapshot.rawVision || snapshot;
  const grade = cached.grade || {};
  return {
    ...cached,
    cachedAt: new Date().toISOString(),
    visionRefresh: {
      phase: "2A",
      refreshedAt: new Date().toISOString(),
      previousCachedAt: cached.cachedAt ?? null,
      visionSource: "live-runs/vision-snapshots",
      snapshotCapturedAt: snapshot.capturedAt ?? null,
      engineCommit: VINTAGE_PHASE1_FREEZE,
      modernFreeze: MODERN_FREEZE,
    },
    grade: {
      estimatedYear: snapshot.estimatedYear ?? rawVision.cardMeta?.estimatedYear ?? grade.estimatedYear,
      era: snapshot.era ?? grade.era ?? "vintage",
      eraSource: snapshot.eraSource ?? grade.eraSource ?? "auto",
      categoryScores: { ...rawVision.categoryScores },
      defects: JSON.parse(JSON.stringify(rawVision.defects || [])),
      primaryLimiter: rawVision.primaryLimiterTag
        ? {
            tag: rawVision.primaryLimiterTag,
            label: rawVision.primaryLimiterLabel ?? rawVision.primaryLimiterTag,
          }
        : null,
      eyeAppealSummary: rawVision.eyeAppealSummary ?? grade.eyeAppealSummary,
      bestAttribute: rawVision.bestAttribute ?? grade.bestAttribute,
      categoryNotes: { ...(rawVision.categoryNotes || {}) },
      scanQuality: rawVision.scanQuality || grade.scanQuality,
      cardMeta: { ...(rawVision.cardMeta || grade.cardMeta || {}) },
    },
  };
}

function writeMarkdownReport(report) {
  const lines = [
    "# Vintage Benchmark Cache Refresh — Phase 2A Report",
    "",
    `**Generated:** ${report.generatedAt}`,
    `**Branch:** ${report.branch}`,
    `**Vintage freeze:** \`${VINTAGE_PHASE1_FREEZE}\` | **Modern freeze:** \`${MODERN_FREEZE}\``,
    `**Dry run:** ${report.dryRun ? "yes (no cache files written)" : "no"}`,
    "",
    "## Summary",
    "",
    "Phase 2A refreshes stale `benchmarks/cache/` vision inputs from `live-runs/vision-snapshots/` where they disagree. **No grading logic was modified.**",
    "",
    "### Before / After (cache-first replay @ current engine)",
    "",
    "| Metric | Before (stale cache) | After (refreshed cache) | Δ |",
    "|--------|---------------------:|------------------------:|--:|",
    `| Within ±1 | ${report.before.withinOne}/${report.before.graded} (${report.before.withinOnePct}%) | **${report.after.withinOne}/${report.after.graded} (${report.after.withinOnePct}%)** | **${report.delta.withinOne >= 0 ? "+" : ""}${report.delta.withinOne}** |`,
    `| Exact match | ${report.before.exactMatch} | ${report.after.exactMatch} | ${report.delta.exactMatch >= 0 ? "+" : ""}${report.delta.exactMatch} |`,
    `| Mean error (Gem − PSA) | ${report.before.meanError.toFixed(2)} | ${report.after.meanError.toFixed(2)} | ${report.delta.meanError.toFixed(2)} |`,
    `| Mean \\|error\\| | ${report.before.meanAbsError.toFixed(2)} | ${report.after.meanAbsError.toFixed(2)} | ${report.delta.meanAbsError.toFixed(2)} |`,
    `| Scratch gremlins | ${report.before.scratchGremlins} | **${report.after.scratchGremlins}** | ${report.delta.scratchGremlins >= 0 ? "+" : ""}${report.delta.scratchGremlins} |`,
    `| \`moderate_crease\` tag count | ${report.before.creaseTagCount} | ${report.after.creaseTagCount} | ${report.delta.creaseTagCount >= 0 ? "+" : ""}${report.delta.creaseTagCount} |`,
    `| Crease-related gremlins | ${report.before.creaseGremlins} | ${report.after.creaseGremlins} | ${report.delta.creaseGremlins >= 0 ? "+" : ""}${report.delta.creaseGremlins} |`,
    `| Triad cap (\`vintage:triad_light_wear_notes\`) | ${report.before.triadCapCount} | ${report.after.triadCapCount} | ${report.delta.triadCapCount >= 0 ? "+" : ""}${report.delta.triadCapCount} |`,
    `| Pillar-clamp gremlins | ${report.before.pillarClampGremlins} | ${report.after.pillarClampGremlins} | ${report.delta.pillarClampGremlins >= 0 ? "+" : ""}${report.delta.pillarClampGremlins} |`,
    `| categoryFloor ≤ 5.5 | ${report.before.categoryFloor55} | ${report.after.categoryFloor55} | ${report.delta.categoryFloor55 >= 0 ? "+" : ""}${report.delta.categoryFloor55} |`,
    "",
    "### Drift inventory",
    "",
    `| | Count |`,
    `|--|------:|`,
    `| Vintage manifest cards | ${report.driftInventory.totalCards} |`,
    `| Cache + snapshot comparable | ${report.driftInventory.comparable} |`,
    `| Disagree (refresh candidates) | **${report.driftInventory.disagreeCount}** |`,
    `| Refreshed this run | **${report.refreshed.length}** |`,
    `| Priority cards refreshed | ${report.refreshed.filter((r) => r.priority).length}/${PRIORITY_DRIFT_IDS.size} |`,
    "",
    "## Priority drift cards",
    "",
    "| Card | PSA | Cache Gem | Snap Gem | Δ | Cache limiter | Snap limiter | Refreshed |",
    "|------|----:|----------:|---------:|--:|---------------|--------------|:---------:|",
  ];

  for (const row of report.priorityDrift) {
    lines.push(
      `| ${row.cardName} | ${row.psaGrade} | ${row.cacheGem ?? "—"} | ${row.snapshotGem ?? "—"} | ${row.gemDelta ?? "—"} | ${row.cacheLimiter ?? "—"} | ${row.snapshotLimiter ?? "—"} | ${row.refreshed ? "✓" : row.hasSnapshot ? (row.disagrees ? "—" : "n/a") : "no snap"} |`
    );
  }

  lines.push(
    "",
    "## All disagreeing cards (refreshed)",
    "",
    "| Card | PSA | Before Gem | After Gem | Before limiter | After limiter |",
    "|------|----:|-----------:|----------:|----------------|---------------|"
  );

  for (const row of report.refreshed) {
    lines.push(
      `| ${row.cardName} | ${row.psaGrade} | ${row.beforeGem} | ${row.afterGem} | ${row.beforeLimiter ?? "—"} | ${row.afterLimiter ?? "—"} |`
    );
  }

  lines.push(
    "",
    "## Primary limiter shifts (before → after)",
    "",
    "| Limiter | Before | After | Δ |",
    "|---------|-------:|------:|--:|"
  );

  const allLimiters = new Set([
    ...Object.keys(report.before.primaryLimiterCounts),
    ...Object.keys(report.after.primaryLimiterCounts),
  ]);
  for (const tag of [...allLimiters].sort()) {
    const b = report.before.primaryLimiterCounts[tag] || 0;
    const a = report.after.primaryLimiterCounts[tag] || 0;
    if (b !== a) {
      lines.push(`| \`${tag}\` | ${b} | ${a} | ${a - b >= 0 ? "+" : ""}${a - b} |`);
    }
  }

  lines.push(
    "",
    "## Phase 2 baseline recommendation",
    "",
    report.phase2BaselineRecommendation,
    "",
    "## Artifacts",
    "",
    "| File | Purpose |",
    "|------|---------|",
    "| `benchmarks/reports/vintage-cache-refresh-latest.json` | Machine-readable full report |",
    "| `benchmarks/cache/_archive/pre-phase2a/` | Pre-refresh cache backups |",
    "| `benchmarks/run-vintage-cache-refresh-phase2a.mjs` | Reproducible refresh script |",
    "",
    "## Verification",
    "",
    "```bash",
    "npm run test:api",
    "node benchmarks/run-vintage-calibration-phase1.mjs",
    "node benchmarks/run-modern10-baseline-replay.mjs",
    "```",
    "",
    "**Do not attribute post-refresh ±1 gains to Phase 2B/C/D implementation.** Measurement correction only.",
    ""
  );

  return lines.join("\n");
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  const cacheDir = resolveBenchmarkPath("cache");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");
  const archiveDir = resolveBenchmarkPath("cache", "_archive", "pre-phase2a");
  const reportsDir = resolveBenchmarkPath("reports");

  let branch = "phase2/vintage-research";
  try {
    branch = execSync("git branch --show-current", { encoding: "utf8" }).trim();
  } catch {
    // ignore
  }

  const allCards = manifest.suites
    .filter((s) => VINTAGE_SUITE_IDS.has(s.id))
    .flatMap((s) => s.cards);

  // Drift analysis
  const driftRows = allCards.map((card) =>
    compareDrift(card, path.join(cacheDir, `${card.id}.json`), path.join(snapDir, `${card.id}.json`))
  );
  const comparable = driftRows.filter((r) => r.comparable);
  const disagree = comparable.filter((r) => r.disagrees);
  const priorityDrift = driftRows.filter((r) => r.priority);

  // Before benchmark (current cache)
  const beforeBench = buildBenchmarkRows(manifest, cacheDir, snapDir, false);
  const beforeSummary = summarizeBenchmark(beforeBench.rows, "before");

  // Refresh cache from snapshots
  if (!dryRun && disagree.length > 0) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const refreshed = [];
  for (const drift of disagree) {
    const cachePath = path.join(cacheDir, `${drift.id}.json`);
    const snapPath = path.join(snapDir, `${drift.id}.json`);
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));

    const beforeRow = beforeBench.rows.find((r) => r.id === drift.id);

    if (!dryRun) {
      const backupPath = path.join(archiveDir, `${drift.id}.json`);
      fs.writeFileSync(backupPath, `${JSON.stringify(cached, null, 2)}\n`);
      const refreshedCache = buildRefreshedCache(cached, snapshot);
      fs.writeFileSync(cachePath, `${JSON.stringify(refreshedCache, null, 2)}\n`);
    }

    refreshed.push({
      id: drift.id,
      cardName: drift.cardName,
      psaGrade: drift.psaGrade,
      priority: drift.priority,
      beforeGem: beforeRow?.gemGrade ?? drift.cacheGem,
      beforeLimiter: beforeRow?.primaryLimiterTag ?? drift.cacheLimiter,
      afterGem: drift.snapshotGem,
      afterLimiter: drift.snapshotLimiter,
    });
  }

  // After benchmark (refreshed cache — or simulate via preferSnapshot if dry-run)
  let afterBench;
  if (dryRun) {
    afterBench = buildBenchmarkRows(manifest, cacheDir, snapDir, true);
    // Only use snapshot for disagreeing cards; for agree keep cache
    for (const row of afterBench.rows) {
      const d = disagree.find((x) => x.id === row.id);
      if (!d) {
        const cacheRow = beforeBench.rows.find((r) => r.id === row.id);
        if (cacheRow) Object.assign(row, cacheRow);
      }
    }
  } else {
    afterBench = buildBenchmarkRows(manifest, cacheDir, snapDir, false);
  }
  const afterSummary = summarizeBenchmark(afterBench.rows, "after");

  const delta = {
    withinOne: afterSummary.withinOne - beforeSummary.withinOne,
    exactMatch: afterSummary.exactMatch - beforeSummary.exactMatch,
    meanError: afterSummary.meanError - beforeSummary.meanError,
    meanAbsError: afterSummary.meanAbsError - beforeSummary.meanAbsError,
    scratchGremlins: afterSummary.scratchGremlins - beforeSummary.scratchGremlins,
    creaseTagCount: afterSummary.creaseTagCount - beforeSummary.creaseTagCount,
    creaseGremlins: afterSummary.creaseGremlins - beforeSummary.creaseGremlins,
    triadCapCount: afterSummary.triadCapCount - beforeSummary.triadCapCount,
    pillarClampGremlins: afterSummary.pillarClampGremlins - beforeSummary.pillarClampGremlins,
    categoryFloor55: afterSummary.categoryFloor55 - beforeSummary.categoryFloor55,
  };

  const phase2BaselineRecommendation = [
    `Adopt **${afterSummary.withinOne}/${afterSummary.graded} (${afterSummary.withinOnePct}%)** within ±1 as the Phase 2 implementation baseline (was ${beforeSummary.withinOne}/${beforeSummary.graded} pre-refresh).`,
    `Scratch gremlins: **${afterSummary.scratchGremlins}** (was ${beforeSummary.scratchGremlins}).`,
    `Mean error: **${afterSummary.meanError.toFixed(2)}** (was ${beforeSummary.meanError.toFixed(2)}).`,
    "Proceed to Phase 2C (Mantle guard) and 2D (Martin writing) only after confirming refreshed cache replay matches this report.",
    "MODERN 10 control remains 31/32 — unchanged by cache refresh.",
  ].join("\n\n");

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "2A",
    branch,
    dryRun,
    vintageFreeze: VINTAGE_PHASE1_FREEZE,
    modernFreeze: MODERN_FREEZE,
    driftInventory: {
      totalCards: allCards.length,
      comparable: comparable.length,
      disagreeCount: disagree.length,
      agreeCount: comparable.length - disagree.length,
      cacheOnly: driftRows.filter((r) => r.hasCache && !r.hasSnapshot).length,
      snapshotOnly: driftRows.filter((r) => !r.hasCache && r.hasSnapshot).length,
      neither: driftRows.filter((r) => !r.hasCache && !r.hasSnapshot).length,
    },
    driftRows,
    priorityDrift: priorityDrift.map((p) => ({
      ...p,
      refreshed: refreshed.some((r) => r.id === p.id),
    })),
    refreshed,
    before: beforeSummary,
    after: afterSummary,
    delta,
    beforeRows: beforeBench.rows,
    afterRows: afterBench.rows,
    ungradedBefore: beforeBench.ungraded,
    ungradedAfter: afterBench.ungraded,
    phase2BaselineRecommendation,
  };

  const jsonPath = path.join(reportsDir, "vintage-cache-refresh-latest.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const mdPath = path.join(reportsDir, "vintage-cache-refresh-report.md");
  fs.writeFileSync(mdPath, writeMarkdownReport(report));

  // Update Phase 2 planning report baseline section
  const planningPath = path.join(reportsDir, "vintage-phase2-planning-report.md");
  if (fs.existsSync(planningPath)) {
    let planning = fs.readFileSync(planningPath, "utf8");
    const baselineSection = [
      "",
      "---",
      "",
      "## Phase 2A Baseline (post–cache refresh)",
      "",
      `**Updated:** ${report.generatedAt}`,
      "",
      "| Metric | Pre-refresh (Phase 1 @ \`fb4cf93\`) | Post–2A refresh |",
      "|--------|-----------------------------------:|----------------:|",
      `| Within ±1 | ${beforeSummary.withinOne}/${beforeSummary.graded} | **${afterSummary.withinOne}/${afterSummary.graded}** |`,
      `| Mean error | ${beforeSummary.meanError.toFixed(2)} | ${afterSummary.meanError.toFixed(2)} |`,
      `| Scratch gremlins | ${beforeSummary.scratchGremlins} | **${afterSummary.scratchGremlins}** |`,
      `| Crease tag count | ${beforeSummary.creaseTagCount} | ${afterSummary.creaseTagCount} |`,
      `| Triad cap count | ${beforeSummary.triadCapCount} | ${afterSummary.triadCapCount} |`,
      `| Pillar-clamp gremlins | ${beforeSummary.pillarClampGremlins} | ${afterSummary.pillarClampGremlins} |`,
      "",
      `**${disagree.length}** cache files refreshed from snapshots; backups in \`benchmarks/cache/_archive/pre-phase2a/\`.`,
      "",
      "**Phase 2 implementation gates** should use post–2A metrics, not pre-refresh Phase 1 headline (33/72).",
      "",
      "See `benchmarks/reports/vintage-cache-refresh-report.md` for full before/after.",
      "",
    ].join("\n");

    if (planning.includes("## Phase 2A Baseline (post–cache refresh)")) {
      planning = planning.replace(
        /\n---\n\n## Phase 2A Baseline \(post–cache refresh\)[\s\S]*$/,
        baselineSection
      );
    } else {
      planning += baselineSection;
    }
    fs.writeFileSync(planningPath, planning);
  }

  console.log("Vintage Phase 2A cache refresh complete");
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Comparable: ${comparable.length} | Disagree: ${disagree.length} | Refreshed: ${refreshed.length}`);
  console.log(`  Within ±1: ${beforeSummary.withinOne} → ${afterSummary.withinOne} (${delta.withinOne >= 0 ? "+" : ""}${delta.withinOne})`);
  console.log(`  Scratch gremlins: ${beforeSummary.scratchGremlins} → ${afterSummary.scratchGremlins}`);
  console.log(`  Mean error: ${beforeSummary.meanError.toFixed(2)} → ${afterSummary.meanError.toFixed(2)}`);
  console.log(`  Wrote ${mdPath}`);
  console.log(`  Wrote ${jsonPath}`);
}

main();
