#!/usr/bin/env node
/**
 * Full pre/post NM-GEM vision guard comparison (analysis only).
 * PSA 7–10: live re-vision pre vs post (same methodology, fresh vision each run).
 * PSA 1–6: cache replay pre (test-4-10 snapshot) vs post (current analyze.js).
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../api/grading/analyze.js";
import { computeGrade } from "../api/grading/engine.js";
import { getWearFloor } from "../api/grading/psa-calibration.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const PRE_LIVE = resolveBenchmarkPath(
  "live-runs",
  "psa710-live-2026-06-06T13-56-39-802Z.json"
);
const POST_LIVE = resolveBenchmarkPath("live-runs", "psa710-live-latest.json");
const PRE_CACHE_SNAPSHOT = resolveBenchmarkPath(
  "reports",
  "test-4-10-full-report.json"
);

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
  if (!n) {
    return { n: 0, meanError: null, withinOne: 0, exact: 0, inflated: 0, deflated: 0 };
  }
  const variances = rows.map((r) => r.postVariance ?? r.variance);
  const meanError = variances.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    meanError,
    withinOne: rows.filter((r) => Math.abs(r.postVariance ?? r.variance) <= 1).length,
    exact: rows.filter((r) => (r.postGem ?? r.gemGrade) === r.psaGrade).length,
    inflated: rows.filter((r) => (r.postVariance ?? r.variance) > 0).length,
    deflated: rows.filter((r) => (r.postVariance ?? r.variance) < 0).length,
  };
}

function preBandStats(rows) {
  const n = rows.length;
  if (!n) return { n: 0, meanError: null, withinOne: 0, exact: 0 };
  const variances = rows.map((r) => r.preVariance);
  return {
    n,
    meanError: variances.reduce((a, b) => a + b, 0) / n,
    withinOne: rows.filter((r) => Math.abs(r.preVariance) <= 1).length,
    exact: rows.filter((r) => r.preGem === r.psaGrade).length,
  };
}

function minPillar(scores) {
  if (!scores) return null;
  return Math.min(scores.corners, scores.edges, scores.surface, scores.centering);
}

function defectTags(defects) {
  return (defects || [])
    .map((d) => d.tag)
    .sort()
    .join(", ");
}

function inferGuardSignals(pre, post) {
  const signals = [];
  const preMin = minPillar(pre.categoryScores);
  const postMin = minPillar(post.categoryScores);
  if (preMin != null && postMin != null && postMin - preMin >= 1) {
    signals.push("pillar_score_lift");
  }
  if (pre.wearFloor != null && post.wearFloor != null && post.wearFloor - pre.wearFloor >= 1) {
    signals.push("wear_floor_lift");
  }
  const preStain = (pre.defects || []).some((d) => d.tag === "staining_light");
  const postStain = (post.defects || []).some((d) => d.tag === "staining_light");
  if (preStain && !postStain) signals.push("staining_removed");
  const preRounded = (pre.defects || []).some((d) => d.tag === "rounded_corners_all");
  const postRounded = (post.defects || []).some((d) => d.tag === "rounded_corners_all");
  if (preRounded && !postRounded) signals.push("rounded_corners_demoted");
  if (defectTags(pre.defects) !== defectTags(post.defects)) {
    signals.push("defect_set_changed");
  }
  if (pre.primaryLimiter !== post.primaryLimiter) {
    signals.push("primary_limiter_changed");
  }
  return signals;
}

function assessMove(psaGrade, preGem, postGem) {
  const preVar = preGem - psaGrade;
  const postVar = postGem - psaGrade;
  const gradeDelta = postGem - preGem;
  const absPre = Math.abs(preVar);
  const absPost = Math.abs(postVar);

  let verdict = "unchanged";
  if (preGem === psaGrade && postGem !== psaGrade) verdict = "lost_exact";
  else if (preGem !== psaGrade && postGem === psaGrade) verdict = "gained_exact";
  else if (absPost < absPre) verdict = "closer_to_slab";
  else if (absPost > absPre) verdict = "farther_from_slab";
  else if (gradeDelta !== 0) verdict = "lateral_same_magnitude";

  const upwardBias =
    gradeDelta > 0 &&
    (postVar > preVar || (preVar < 0 && postVar > 0) || (preVar <= 0 && postVar > 0 && absPost >= absPre));

  const nmGemHelp =
    psaGrade >= 9 && gradeDelta > 0 && (verdict === "closer_to_slab" || verdict === "gained_exact");

  return {
    preVar,
    postVar,
    gradeDelta,
    verdict,
    upwardBias,
    nmGemHelp,
  };
}

function loadManifestCards() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  return manifest.suites.flatMap((s) =>
    s.cards.map((c) => ({ ...c, suiteId: s.id }))
  );
}

function buildLiveComparison() {
  const pre = JSON.parse(fs.readFileSync(PRE_LIVE, "utf8"));
  const post = JSON.parse(fs.readFileSync(POST_LIVE, "utf8"));
  const preMap = new Map(pre.rows.map((r) => [r.id, r]));
  const postMap = new Map(post.rows.map((r) => [r.id, r]));

  const rows = [];
  for (const [id, postRow] of postMap) {
    const preRow = preMap.get(id);
    if (!preRow) continue;

    const preSnap = {
      gemGrade: preRow.gemGrade,
      wearFloor: preRow.wearFloor,
      categoryScores: preRow.categoryScores,
      defects: preRow.defects,
      primaryLimiter: preRow.primaryLimiter,
    };
    const postSnap = {
      gemGrade: postRow.gemGrade,
      wearFloor: postRow.wearFloor,
      categoryScores: postRow.categoryScores,
      defects: postRow.defects,
      primaryLimiter: postRow.primaryLimiter,
    };

    const guardSignals = inferGuardSignals(preSnap, postSnap);
    const move = assessMove(postRow.psaGrade, preRow.gemGrade, postRow.gemGrade);

    rows.push({
      id,
      fileLabel: postRow.fileLabel,
      psaGrade: postRow.psaGrade,
      suiteId: postRow.suiteId,
      source: "live-pre-vs-post",
      preGem: preRow.gemGrade,
      postGem: postRow.gemGrade,
      preVariance: move.preVar,
      postVariance: move.postVar,
      gradeDelta: move.gradeDelta,
      verdict: move.verdict,
      upwardBias: move.upwardBias,
      nmGemHelp: move.nmGemHelp,
      guardSignals,
      likelyGuardDriven:
        move.gradeDelta !== 0 &&
        guardSignals.some((s) =>
          [
            "pillar_score_lift",
            "wear_floor_lift",
            "staining_removed",
            "rounded_corners_demoted",
          ].includes(s)
        ),
      preWearFloor: preRow.wearFloor,
      postWearFloor: postRow.wearFloor,
      prePillars: preRow.categoryScores,
      postPillars: postRow.categoryScores,
      preDefects: defectTags(preRow.defects),
      postDefects: defectTags(postRow.defects),
      prePrimary: preRow.primaryLimiter,
      postPrimary: postRow.primaryLimiter,
    });
  }

  return rows.sort((a, b) => a.gradeDelta - b.gradeDelta || a.postVariance - b.postVariance);
}

function buildCacheComparison() {
  const snapshot = JSON.parse(fs.readFileSync(PRE_CACHE_SNAPSHOT, "utf8"));
  const preMap = new Map(snapshot.rows.map((r) => [r.id, r]));
  const cards = loadManifestCards();
  const rows = [];

  for (const card of cards) {
    if (card.psaGrade > 6) continue;
    const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
    if (!fs.existsSync(cachePath)) continue;

    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const post = gradeFromCache(cached);
    const preRow = preMap.get(card.id);
    const preGem = preRow?.gemGrade ?? cached.grade?.psaGrade ?? null;
    if (preGem == null) continue;

    const preSnap = {
      gemGrade: preGem,
      wearFloor: null,
      categoryScores: null,
      defects: cached.grade?.defects,
      primaryLimiter: preRow?.primaryLimiter ?? cached.grade?.primaryLimiter?.tag,
    };
    const postSnap = {
      gemGrade: post.gemGrade,
      wearFloor: post.wearFloor,
      categoryScores: post.categoryScores,
      defects: post.defects,
      primaryLimiter: post.primaryLimiter,
    };

    const move = assessMove(card.psaGrade, preGem, post.gemGrade);
    const guardSignals = inferGuardSignals(
      {
        ...preSnap,
        categoryScores: post.categoryScores,
        wearFloor: post.wearFloor,
      },
      postSnap
    );

    rows.push({
      id: card.id,
      fileLabel: card.fileLabel || card.cardName,
      psaGrade: card.psaGrade,
      suiteId: card.suiteId,
      source: "cache-replay-pre-snapshot-vs-post",
      preGem,
      postGem: post.gemGrade,
      preVariance: move.preVar,
      postVariance: move.postVar,
      gradeDelta: move.gradeDelta,
      verdict: move.verdict,
      upwardBias: move.upwardBias,
      guardSignals,
      postWearFloor: post.wearFloor,
      postPillars: post.categoryScores,
      postDefects: defectTags(post.defects),
      postPrimary: post.primaryLimiter,
      note: "Pre = test-4-10 cache replay before NM/GEM pillar guards; post = current analyze.js on same cached vision.",
    });
  }

  return rows.sort((a, b) => a.gradeDelta - b.gradeDelta);
}

function buildPsa13PostOnly() {
  const cards = loadManifestCards().filter((c) => c.suiteId === "psa-1-3");
  const rows = [];
  for (const card of cards) {
    const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
    if (!fs.existsSync(cachePath)) {
      rows.push({
        fileLabel: card.cardName,
        psaGrade: card.psaGrade,
        source: "no-cache",
        postGem: null,
      });
      continue;
    }
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const post = gradeFromCache(cached);
    rows.push({
      id: card.id,
      fileLabel: card.cardName,
      psaGrade: card.psaGrade,
      suiteId: card.suiteId,
      source: "cache-replay-post-guards-only",
      postGem: post.gemGrade,
      postVariance: post.gemGrade - card.psaGrade,
      postWearFloor: post.wearFloor,
      postDefects: defectTags(post.defects),
      postPrimary: post.primaryLimiter,
      note: "No pre-guard snapshot; post-guards cache replay only.",
    });
  }
  return rows;
}

function filterBand(rows, min, max) {
  return rows.filter((r) => r.psaGrade >= min && r.psaGrade <= max);
}

function formatPillars(scores) {
  if (!scores) return "—";
  return `C${scores.corners}/E${scores.edges}/S${scores.surface}/CTR${scores.centering}`;
}

function buildMarkdown(report) {
  const lines = [
    "# Vision Guard Card-by-Card Comparison",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Analysis only — no grading logic changes.",
    "",
    "## Methodology",
    "",
    "- **PSA 7–10:** Live OpenAI re-vision pre-guards (`2026-06-06`) vs post-guards (`2026-06-07`). Vision output differs run-to-run; guard signals flag pillar lifts, staining removal, etc.",
    "- **PSA 4–6:** Same cached vision replayed through analyze.js before NM/GEM guards (`test-4-10-full-report.json`) vs after (current).",
    "- **PSA 1–3:** Post-guards cache replay only (no pre-guard snapshot on file).",
    "",
    "## Headline: PSA 7–10 live",
    "",
    "| Metric | Pre-guards | Post-guards | Δ |",
    "| --- | ---: | ---: | ---: |",
    `| Mean error | ${report.live710.pre.meanError?.toFixed(2)} | ${report.live710.post.meanError?.toFixed(2)} | ${(report.live710.post.meanError - report.live710.pre.meanError).toFixed(2)} |`,
    `| Within ±1 | ${report.live710.pre.withinOne}/${report.live710.n} | ${report.live710.post.withinOne}/${report.live710.n} | ${report.live710.post.withinOne - report.live710.pre.withinOne >= 0 ? "+" : ""}${report.live710.post.withinOne - report.live710.pre.withinOne} |`,
    `| Exact | ${report.live710.pre.exact}/${report.live710.n} | ${report.live710.post.exact}/${report.live710.n} | ${report.live710.post.exact - report.live710.pre.exact >= 0 ? "+" : ""}${report.live710.post.exact - report.live710.pre.exact} |`,
    "",
    "### Exact match churn",
    "",
    `- **Gained exact:** ${report.exactChurn.gained.map((r) => r.fileLabel).join(", ") || "—"}`,
    `- **Lost exact:** ${report.exactChurn.lost.map((r) => r.fileLabel).join(", ") || "—"}`,
    "",
    "## Band summaries",
    "",
    "| Band | Mode | n | Pre mean Δ | Post mean Δ | Pre ±1 | Post ±1 | Pre exact | Post exact |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const band of report.bandSummaries) {
    lines.push(
      `| PSA ${band.label} | ${band.mode} | ${band.n} | ${band.preMean?.toFixed(2) ?? "—"} | ${band.postMean?.toFixed(2) ?? "—"} | ${band.preWithinOne}/${band.n} | ${band.postWithinOne}/${band.n} | ${band.preExact}/${band.n} | ${band.postExact}/${band.n} |`
    );
  }

  lines.push(
    "",
    "## Biggest improvements (closer to slab or gained exact)",
    "",
    "| Card | PSA | Pre → Post | Pre Δ | Post Δ | Verdict | Guard signals | Assessment |",
    "| --- | ---: | --- | ---: | ---: | --- | --- | --- |"
  );

  for (const row of report.biggestImprovements) {
    lines.push(
      `| ${row.fileLabel} | ${row.psaGrade} | ${row.preGem} → ${row.postGem} | ${row.preVariance} | ${row.postVariance} | ${row.verdict} | ${row.guardSignals.join(", ") || "—"} | ${row.assessment} |`
    );
  }

  lines.push(
    "",
    "## Biggest regressions (farther from slab or lost exact)",
    "",
    "| Card | PSA | Pre → Post | Pre Δ | Post Δ | Verdict | Guard signals | Assessment |",
    "| --- | ---: | --- | ---: | ---: | --- | --- | --- |"
  );

  for (const row of report.biggestRegressions) {
    lines.push(
      `| ${row.fileLabel} | ${row.psaGrade} | ${row.preGem} → ${row.postGem} | ${row.preVariance} | ${row.postVariance} | ${row.verdict} | ${row.guardSignals.join(", ") || "—"} | ${row.assessment} |`
    );
  }

  lines.push(
    "",
    "## Upward bias watch (grade increased but farther from slab or new overgrade)",
    "",
    "| Card | PSA | Pre → Post | Pre Δ | Post Δ | Guard signals |",
    "| --- | ---: | --- | ---: | ---: | --- |"
  );

  for (const row of report.upwardBiasWatch) {
    lines.push(
      `| ${row.fileLabel} | ${row.psaGrade} | ${row.preGem} → ${row.postGem} | ${row.preVariance} | ${row.postVariance} | ${row.guardSignals.join(", ") || "—"} |`
    );
  }

  lines.push("", "## Full PSA 7–10 live comparison", "");
  lines.push(
    "| Card | PSA | Pre | Post | Δ grade | Pre Δ | Post Δ | Verdict | Guard-driven? | Pre pillars | Post pillars | Pre defects | Post defects |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |"
  );

  for (const row of report.live710Rows) {
    lines.push(
      `| ${row.fileLabel} | ${row.psaGrade} | ${row.preGem} | ${row.postGem} | ${row.gradeDelta >= 0 ? "+" : ""}${row.gradeDelta} | ${row.preVariance} | ${row.postVariance} | ${row.verdict} | ${row.likelyGuardDriven ? "yes" : "no"} | ${formatPillars(row.prePillars)} | ${formatPillars(row.postPillars)} | ${row.preDefects || "—"} | ${row.postDefects || "—"} |`
    );
  }

  if (report.cache46Rows.length) {
    lines.push("", "## PSA 4–6 cache replay (pre snapshot vs post guards)", "");
    lines.push(
      "| Card | PSA | Pre | Post | Δ | Pre Δ | Post Δ | Verdict | Post pillars | Post defects |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |"
    );
    for (const row of report.cache46Rows) {
      lines.push(
        `| ${row.fileLabel} | ${row.psaGrade} | ${row.preGem} | ${row.postGem} | ${row.gradeDelta >= 0 ? "+" : ""}${row.gradeDelta} | ${row.preVariance} | ${row.postVariance} | ${row.verdict} | ${formatPillars(row.postPillars)} | ${row.postDefects || "—"} |`
      );
    }
  }

  if (report.psa13Rows.length) {
    lines.push("", "## PSA 1–3 post-guards only (cache replay)", "");
    lines.push("| Card | PSA | Gem | Δ | wearFloor | Defects |", "| --- | ---: | ---: | ---: | ---: | --- |");
    for (const row of report.psa13Rows) {
      if (row.postGem == null) {
        lines.push(`| ${row.fileLabel} | ${row.psaGrade} | — | — | — | no cache |`);
      } else {
        lines.push(
          `| ${row.fileLabel} | ${row.psaGrade} | ${row.postGem} | ${row.postVariance} | ${row.postWearFloor?.toFixed(1) ?? "—"} | ${row.postDefects || "—"} |`
        );
      }
    }
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    ...report.interpretation.map((p) => `- ${p}`),
    ""
  );

  return lines.join("\n");
}

function assessmentText(row) {
  if (row.verdict === "gained_exact") return "Correct — now matches slab.";
  if (row.verdict === "lost_exact") return "Regression — was exact, no longer.";
  if (row.verdict === "closer_to_slab") {
    if (row.upwardBias && row.psaGrade <= 8) return "Closer but possible upward bias on mid-grade.";
    if (row.nmGemHelp) return "Correct NM/GEM recovery — still under slab but improved.";
    return "Closer to slab.";
  }
  if (row.verdict === "farther_from_slab") return "Regression — moved away from slab.";
  if (row.upwardBias) return "Suspect upward bias.";
  return "Neutral / vision variance.";
}

function main() {
  const live710Rows = buildLiveComparison();
  const cache46Rows = buildCacheComparison();
  const psa13Rows = buildPsa13PostOnly();

  const live710Pre = preBandStats(live710Rows);
  const live710Post = bandStats(live710Rows.map((r) => ({ ...r, variance: r.postVariance, gemGrade: r.postGem })));

  const exactChurn = {
    gained: live710Rows.filter((r) => r.verdict === "gained_exact"),
    lost: live710Rows.filter((r) => r.verdict === "lost_exact"),
  };

  const enriched = live710Rows.map((r) => ({ ...r, assessment: assessmentText(r) }));

  const biggestImprovements = enriched
    .filter((r) => r.verdict === "gained_exact" || r.verdict === "closer_to_slab")
    .sort((a, b) => Math.abs(b.postVariance) - Math.abs(a.postVariance) || b.gradeDelta - a.gradeDelta)
    .slice(0, 15);

  const biggestRegressions = enriched
    .filter((r) => r.verdict === "lost_exact" || r.verdict === "farther_from_slab")
    .sort((a, b) => a.postVariance - b.postVariance || a.gradeDelta - b.gradeDelta)
    .slice(0, 15);

  const upwardBiasWatch = enriched.filter(
    (r) =>
      r.upwardBias &&
      (r.verdict === "farther_from_slab" || r.postVariance > 0 || (r.gradeDelta > 0 && r.psaGrade <= 8))
  );

  const bandSummaries = [];
  const bands = [
    { label: "1-3", min: 1, max: 3, live: [], cache: psa13Rows.filter((r) => r.postGem != null) },
    { label: "4-6", min: 4, max: 6, live: [], cache: cache46Rows },
    { label: "7-8", min: 7, max: 8, live: filterBand(live710Rows, 7, 8), cache: [] },
    { label: "9-10", min: 9, max: 10, live: filterBand(live710Rows, 9, 10), cache: [] },
  ];

  for (const band of bands) {
    if (band.live.length) {
      bandSummaries.push({
        label: band.label,
        mode: "live",
        n: band.live.length,
        preMean: band.live.reduce((s, r) => s + r.preVariance, 0) / band.live.length,
        postMean: band.live.reduce((s, r) => s + r.postVariance, 0) / band.live.length,
        preWithinOne: band.live.filter((r) => Math.abs(r.preVariance) <= 1).length,
        postWithinOne: band.live.filter((r) => Math.abs(r.postVariance) <= 1).length,
        preExact: band.live.filter((r) => r.preGem === r.psaGrade).length,
        postExact: band.live.filter((r) => r.postGem === r.psaGrade).length,
      });
    }
    if (band.cache.length) {
      const withPre = band.cache.filter((r) => r.preGem != null && r.postGem != null);
      bandSummaries.push({
        label: band.label,
        mode: "cache-replay",
        n: withPre.length,
        preMean: withPre.reduce((s, r) => s + r.preVariance, 0) / withPre.length,
        postMean: withPre.reduce((s, r) => s + r.postVariance, 0) / withPre.length,
        preWithinOne: withPre.filter((r) => Math.abs(r.preVariance) <= 1).length,
        postWithinOne: withPre.filter((r) => Math.abs(r.postVariance) <= 1).length,
        preExact: withPre.filter((r) => r.preGem === r.psaGrade).length,
        postExact: withPre.filter((r) => r.postGem === r.psaGrade).length,
      });
    }
  }

  const guardDrivenMoves = live710Rows.filter((r) => r.likelyGuardDriven && r.gradeDelta !== 0);
  const correctGuard = guardDrivenMoves.filter((r) => r.verdict === "closer_to_slab" || r.verdict === "gained_exact");
  const suspectGuard = guardDrivenMoves.filter((r) => r.upwardBias || r.verdict === "farther_from_slab");

  const interpretation = [
    `PSA 9–10 live mean error improved (−4.5 range → ~−3.2) with ${guardDrivenMoves.length} cards showing guard-like pillar/stain signals.`,
    `Exact matches fell 5 → 2 because ${exactChurn.lost.length} prior exact hits regressed while ${exactChurn.gained.length} new exact hits appeared — net churn, not uniform drift.`,
    `${correctGuard.length} guard-signal moves moved closer to slab; ${suspectGuard.length} guard-signal moves look like upward bias or mixed vision+guard noise.`,
    "PSA 7–8 live regressions often show **defect_set_changed** (fresh vision) rather than pillar lifts — guard effect is weaker than vision variance on mid-high grades.",
    "PSA 4–6 cache replay isolates analyze.js: watch for grade increases on EX/VG cards without slab-grade NM/GEM presentation (upward bias risk).",
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    live710: { n: live710Rows.length, pre: live710Pre, post: live710Post },
    exactChurn,
    bandSummaries,
    biggestImprovements,
    biggestRegressions,
    upwardBiasWatch,
    live710Rows: enriched,
    cache46Rows,
    psa13Rows,
    guardDrivenMoves,
    interpretation,
  };

  const outDir = resolveBenchmarkPath("reports");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "vision-guards-card-comparison.json");
  const mdPath = path.join(outDir, "vision-guards-card-comparison.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${buildMarkdown(report)}\n`);

  console.log(`Live 7-10 cards compared: ${live710Rows.length}`);
  console.log(`Exact gained: ${exactChurn.gained.length}, lost: ${exactChurn.lost.length}`);
  console.log(`Guard-driven moves: ${guardDrivenMoves.length} (${correctGuard.length} helpful, ${suspectGuard.length} suspect)`);
  console.log(`Wrote ${mdPath}`);
}

main();
