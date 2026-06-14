#!/usr/bin/env node
/**
 * Before/after scorecard: cached benchmark grades (before analyze fixes)
 * vs replay through current normalizeAnalysis + computeGrade (after).
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
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

function analysisFromCache(cached) {
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  return {
    visionCategoryScores,
    raw: {
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
    },
  };
}

function summarize(rows) {
  const ok = rows.filter((r) => r.psaGrade != null && r.gemGrade != null);
  const deltas = ok.map((r) => r.gemGrade - r.psaGrade);
  const abs = deltas.map(Math.abs);
  const n = ok.length || 1;

  return {
    total: rows.length,
    graded: ok.length,
    exactMatch: ok.filter((r) => r.gemGrade === r.psaGrade).length,
    exactMatchPct: ((ok.filter((r) => r.gemGrade === r.psaGrade).length / n) * 100).toFixed(1),
    withinOne: ok.filter((r) => Math.abs(r.gemGrade - r.psaGrade) <= 1).length,
    withinOnePct: (
      (ok.filter((r) => Math.abs(r.gemGrade - r.psaGrade) <= 1).length / n) *
      100
    ).toFixed(1),
    meanDelta: deltas.reduce((a, b) => a + b, 0) / n,
    meanAbsDelta: abs.reduce((a, b) => a + b, 0) / n,
    inflated: ok.filter((r) => r.gemGrade - r.psaGrade > 0).length,
    deflated: ok.filter((r) => r.gemGrade - r.psaGrade < 0).length,
  };
}

function findBindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) return { rule: "overall_derivation", detail: "" };
  const binding = capped.reduce((best, e) => {
    const v = e.cap ?? e.floor;
    const bv = best.cap ?? best.floor;
    return v < bv ? e : best;
  });
  return {
    rule: binding.source,
    detail: binding.cap != null ? `cap ${binding.cap}` : `floor ${binding.floor}`,
  };
}

function defectTags(defects) {
  return (defects || []).map((d) => d.tag).sort();
}

function tagDiff(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    removed: [...b].filter((t) => !a.has(t)),
    added: [...a].filter((t) => !b.has(t)),
  };
}

function needsEngineFix(row) {
  const rule = row.afterBindingRule || "";
  const engineCap =
    rule.startsWith("vintage:") ||
    rule.startsWith("compound:") ||
    rule.startsWith("ex_band:") ||
    rule.startsWith("categoryFloor") ||
    rule.startsWith("categoryImpact:");

  if (Math.abs(row.afterDiff) <= 1) {
    return { needed: false, reason: "Within ±1 after analyze replay" };
  }

  if (row.tagChanges.removed.length && row.afterDiff > row.beforeDiff) {
    return {
      needed: row.afterDiff !== 0,
      reason: engineCap
        ? `Tags improved but ${rule} still binds grade`
        : `Tags improved; ${rule} or defect stack still off slab`,
    };
  }

  if (row.afterDiff > 1) {
    return {
      needed: true,
      reason: `Inflation (+${row.afterDiff}); likely engine optimism ceiling (e.g. Ryan)`,
    };
  }

  if (engineCap) {
    return {
      needed: true,
      reason: `Engine cap \`${rule}\` (${row.afterBindingDetail})`,
    };
  }

  if (row.tagChanges.added.some((t) => /severe|crease|fray|surface_wear/.test(t))) {
    return {
      needed: false,
      reason: "Harsh vision tags or analyze inference remain — vision/analyze path",
    };
  }

  return {
    needed: true,
    reason: `Defect cap \`${rule}\` after normalize`,
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
    rows.push({
      id: card.id,
      fileLabel: card.fileLabel,
      psaGrade: card.psaGrade,
      error: "missing cache",
    });
    continue;
  }

  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const beforeGem = cached.grade.psaGrade;
  const beforeDiff = beforeGem - card.psaGrade;
  const visionDefects = defectTags(cached.grade.defects);

  const { visionCategoryScores, raw } = analysisFromCache(cached);
  const normalized = normalizeAnalysis(raw, "vintage");
  const result = computeGrade(
    {
      ...normalized,
      visionCategoryScores,
      categoryNotes: normalized.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );

  const afterGem = result.psaGrade;
  const afterDiff = afterGem - card.psaGrade;
  const binding = findBindingRule(result.capAudit);
  const normDefects = defectTags(normalized.defects);
  const changes = tagDiff(visionDefects, normDefects);

  const row = {
    id: card.id,
    fileLabel: card.fileLabel,
    psaGrade: card.psaGrade,
    beforeGem,
    afterGem,
    beforeDiff,
    afterDiff,
    deltaImprovement: Math.abs(beforeDiff) - Math.abs(afterDiff),
    beforeBinding: findBindingRule(cached.grade.capAudit).rule,
    afterBindingRule: binding.rule,
    afterBindingDetail: binding.detail,
    afterPrimaryLimiter: result.primaryLimiter?.tag,
    tagChanges: changes,
    analyzeFixedTags: changes.removed.filter((t) =>
      ["surface_wear", "edge_fraying_major", "moderate_crease"].includes(t)
    ),
  };
  row.engineFix = needsEngineFix(row);
  rows.push(row);
}

rows.sort((a, b) => (a.fileLabel || "").localeCompare(b.fileLabel || ""));

const beforeRows = rows.map((r) => ({
  psaGrade: r.psaGrade,
  gemGrade: r.beforeGem,
}));
const afterRows = rows.map((r) => ({
  psaGrade: r.psaGrade,
  gemGrade: r.afterGem,
}));

const beforeSummary = summarize(beforeRows);
const afterSummary = summarize(afterRows);

const biggestMisses = rows
  .filter((r) => r.afterGem != null)
  .sort((a, b) => Math.abs(b.afterDiff) - Math.abs(a.afterDiff))
  .slice(0, 10);

const engineCards = rows
  .filter((r) => r.engineFix?.needed && r.afterGem != null)
  .sort((a, b) => Math.abs(b.afterDiff) - Math.abs(a.afterDiff));

const improved = rows.filter(
  (r) => r.afterGem != null && Math.abs(r.afterDiff) < Math.abs(r.beforeDiff)
);
const regressed = rows.filter(
  (r) => r.afterGem != null && Math.abs(r.afterDiff) > Math.abs(r.beforeDiff)
);

const md = [];
md.push("# PSA 4–6 Analyze.js Before/After Scorecard");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push("");
md.push(
  "Compares **before** (GemGrade stored in benchmark cache at vision run time) vs **after** (same cached vision re-graded through current `normalizeAnalysis` + unchanged `computeGrade`)."
);
md.push("");
md.push("## Headline metrics");
md.push("");
md.push("| Metric | Before | After | Δ |");
md.push("| --- | ---: | ---: | ---: |");
md.push(
  `| Exact hit rate | ${beforeSummary.exactMatch}/${beforeSummary.graded} (${beforeSummary.exactMatchPct}%) | ${afterSummary.exactMatch}/${afterSummary.graded} (${afterSummary.exactMatchPct}%) | ${afterSummary.exactMatch - beforeSummary.exactMatch >= 0 ? "+" : ""}${afterSummary.exactMatch - beforeSummary.exactMatch} |`
);
md.push(
  `| Within ±1 | ${beforeSummary.withinOne}/${beforeSummary.graded} (${beforeSummary.withinOnePct}%) | ${afterSummary.withinOne}/${afterSummary.graded} (${afterSummary.withinOnePct}%) | ${afterSummary.withinOne - beforeSummary.withinOne >= 0 ? "+" : ""}${afterSummary.withinOne - beforeSummary.withinOne} |`
);
md.push(
  `| Mean error (signed) | ${beforeSummary.meanDelta.toFixed(2)} | ${afterSummary.meanDelta.toFixed(2)} | ${(afterSummary.meanDelta - beforeSummary.meanDelta).toFixed(2)} |`
);
md.push(
  `| Mean \\|error\\| | ${beforeSummary.meanAbsDelta.toFixed(2)} | ${afterSummary.meanAbsDelta.toFixed(2)} | ${(afterSummary.meanAbsDelta - beforeSummary.meanAbsDelta).toFixed(2)} |`
);
md.push(
  `| Deflated / Inflated | ${beforeSummary.deflated}↓ ${beforeSummary.inflated}↑ | ${afterSummary.deflated}↓ ${afterSummary.inflated}↑ | — |`
);
md.push(
  `| Cards improved (\\|Δ\\|) | — | ${improved.length}/${afterSummary.graded} | — |`
);
md.push(
  `| Cards regressed (\\|Δ\\|) | — | ${regressed.length}/${afterSummary.graded} | — |`
);
md.push("");
md.push("## Per-card results");
md.push("");
md.push(
  "| Filename | PSA | Before | After | Before Δ | After Δ | Analyze tag fixes | Binding (after) |"
);
md.push("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");

for (const row of rows) {
  if (row.error) {
    md.push(`| ${row.fileLabel} | ${row.psaGrade} | — | — | — | — | ${row.error} | — |`);
    continue;
  }
  const fixes =
    row.analyzeFixedTags.length > 0
      ? row.analyzeFixedTags.join(", ")
      : row.tagChanges.removed.length
        ? row.tagChanges.removed.join(", ")
        : "—";
  md.push(
    `| ${row.fileLabel} | ${row.psaGrade} | ${row.beforeGem} | ${row.afterGem} | ${row.beforeDiff >= 0 ? "+" : ""}${row.beforeDiff} | ${row.afterDiff >= 0 ? "+" : ""}${row.afterDiff} | ${fixes} | \`${row.afterBindingRule}\` |`
  );
}

md.push("");
md.push("## Biggest remaining misses (after analyze.js)");
md.push("");
md.push("| Filename | PSA | After | Δ | Primary limiter | Binding |");
md.push("| --- | ---: | ---: | ---: | --- | --- |");
for (const row of biggestMisses) {
  md.push(
    `| ${row.fileLabel} | ${row.psaGrade} | ${row.afterGem} | ${row.afterDiff >= 0 ? "+" : ""}${row.afterDiff} | \`${row.afterPrimaryLimiter}\` | \`${row.afterBindingRule}\` |`
  );
}

md.push("");
md.push("## Cards still needing engine-level fixes");
md.push("");
md.push(
  "These remain >±1 from slab after analyze replay, with binding rules in `psa-calibration.js` / `engine.js` (not fixable by tag normalize alone)."
);
md.push("");
md.push("| Filename | PSA | After | Δ | Reason |");
md.push("| --- | ---: | ---: | ---: | --- |");
for (const row of engineCards) {
  md.push(
    `| ${row.fileLabel} | ${row.psaGrade} | ${row.afterGem} | ${row.afterDiff >= 0 ? "+" : ""}${row.afterDiff} | ${row.engineFix.reason} |`
  );
}

md.push("");
md.push("## Analyze-only wins (|Δ| improved, no engine change needed for direction)");
md.push("");
for (const row of improved.sort((a, b) => b.deltaImprovement - a.deltaImprovement)) {
  md.push(
    `- **${row.fileLabel}**: ${row.beforeGem} → ${row.afterGem} (PSA ${row.psaGrade}, |Δ| ${Math.abs(row.beforeDiff)} → ${Math.abs(row.afterDiff)})${row.analyzeFixedTags.length ? ` — removed \`${row.analyzeFixedTags.join("`, `")}\`` : ""}`
  );
}
if (!improved.length) {
  md.push("_None._");
}

const outDir = resolveBenchmarkPath("reports");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "psa-4-6-analyze-scorecard.json");
const mdPath = path.join(outDir, "psa-4-6-analyze-scorecard.md");

fs.writeFileSync(
  jsonPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      suiteId: "TEST 4 TO 6",
      beforeSummary,
      afterSummary,
      improved: improved.length,
      regressed: regressed.length,
      rows,
      engineCards: engineCards.map((r) => ({
        fileLabel: r.fileLabel,
        psaGrade: r.psaGrade,
        afterGem: r.afterGem,
        afterDiff: r.afterDiff,
        reason: r.engineFix.reason,
      })),
    },
    null,
    2
  )}\n`
);
fs.writeFileSync(mdPath, `${md.join("\n")}\n`);

console.log("PSA 4–6 analyze.js before/after scorecard\n");
console.log(
  "Metric".padEnd(22),
  "Before".padStart(10),
  "After".padStart(10),
  "Change".padStart(10)
);
console.log(
  "Exact hit".padEnd(22),
  `${beforeSummary.exactMatch}/${beforeSummary.graded}`.padStart(10),
  `${afterSummary.exactMatch}/${afterSummary.graded}`.padStart(10),
  `${afterSummary.exactMatch - beforeSummary.exactMatch >= 0 ? "+" : ""}${afterSummary.exactMatch - beforeSummary.exactMatch}`.padStart(10)
);
console.log(
  "Within ±1".padEnd(22),
  `${beforeSummary.withinOne}/${beforeSummary.graded}`.padStart(10),
  `${afterSummary.withinOne}/${afterSummary.graded}`.padStart(10),
  `${afterSummary.withinOne - beforeSummary.withinOne >= 0 ? "+" : ""}${afterSummary.withinOne - beforeSummary.withinOne}`.padStart(10)
);
console.log(
  "Mean error".padEnd(22),
  beforeSummary.meanDelta.toFixed(2).padStart(10),
  afterSummary.meanDelta.toFixed(2).padStart(10),
  (afterSummary.meanDelta - beforeSummary.meanDelta).toFixed(2).padStart(10)
);
console.log(
  "Mean |error|".padEnd(22),
  beforeSummary.meanAbsDelta.toFixed(2).padStart(10),
  afterSummary.meanAbsDelta.toFixed(2).padStart(10),
  (afterSummary.meanAbsDelta - beforeSummary.meanAbsDelta).toFixed(2).padStart(10)
);
console.log(`\nWrote ${mdPath}`);
console.log(`Wrote ${jsonPath}`);
