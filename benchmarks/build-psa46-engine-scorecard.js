#!/usr/bin/env node
/**
 * Before/after scorecard: analyze.js-only baseline vs current engine (ranks 1–6).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveBenchmarkPath } from "./lib/paths.js";

function summarize(rows) {
  const ok = rows.filter((r) => r.gemGrade != null);
  const deltas = ok.map((r) => r.gemGrade - r.psaGrade);
  const abs = deltas.map(Math.abs);
  const n = ok.length || 1;

  return {
    graded: ok.length,
    exactMatch: ok.filter((r) => r.gemGrade === r.psaGrade).length,
    withinOne: ok.filter((r) => Math.abs(r.gemGrade - r.psaGrade) <= 1).length,
    meanDelta: deltas.reduce((a, b) => a + b, 0) / n,
    meanAbsDelta: abs.reduce((a, b) => a + b, 0) / n,
  };
}

const baselinePath = resolveBenchmarkPath(
  "reports",
  "psa-4-6-analyze-baseline.json"
);
const currentPath = resolveBenchmarkPath(
  "reports",
  "psa-4-6-analyze-scorecard.json"
);

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing baseline: ${baselinePath}`);
  process.exit(1);
}
if (!fs.existsSync(currentPath)) {
  console.error(`Missing current scorecard: ${currentPath}`);
  console.error("Run: npm run benchmark:psa46-scorecard");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));

const rows = current.rows
  .filter((r) => !r.error)
  .map((row) => {
    const beforeGem = baseline.rows[row.id];
    const afterGem = row.afterGem;
    const beforeDiff = beforeGem - row.psaGrade;
    const afterDiff = afterGem - row.psaGrade;
    const absBefore = Math.abs(beforeDiff);
    const absAfter = Math.abs(afterDiff);

    return {
      id: row.id,
      fileLabel: row.fileLabel,
      psaGrade: row.psaGrade,
      beforeGem,
      afterGem,
      beforeDiff,
      afterDiff,
      absBefore,
      absAfter,
      deltaImprovement: absBefore - absAfter,
      afterBindingRule: row.afterBindingRule,
      regressed: absAfter > absBefore,
      improved: absAfter < absBefore,
    };
  });

const beforeSummary = summarize(
  rows.map((r) => ({ psaGrade: r.psaGrade, gemGrade: r.beforeGem }))
);
const afterSummary = summarize(
  rows.map((r) => ({ psaGrade: r.psaGrade, gemGrade: r.afterGem }))
);

const improved = rows.filter((r) => r.improved).sort((a, b) => b.deltaImprovement - a.deltaImprovement);
const regressed = rows.filter((r) => r.regressed).sort((a, b) => b.absAfter - a.absAfter);

const md = [];
md.push("# PSA 4–6 Engine Calibration Scorecard (Ranks 1–6)");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push("");
md.push(
  "Compares **before** (analyze.js-only baseline, pre engine ranks 1–6) vs **after** (current `normalizeAnalysis` + engine ranks 1–6)."
);
md.push("");
md.push("## Headline metrics");
md.push("");
md.push("| Metric | Analyze-only | Engine (1–6) | Δ |");
md.push("| --- | ---: | ---: | ---: |");
md.push(
  `| Exact hit | ${beforeSummary.exactMatch}/${beforeSummary.graded} | ${afterSummary.exactMatch}/${afterSummary.graded} | ${afterSummary.exactMatch - beforeSummary.exactMatch >= 0 ? "+" : ""}${afterSummary.exactMatch - beforeSummary.exactMatch} |`
);
md.push(
  `| Within ±1 | ${beforeSummary.withinOne}/${beforeSummary.graded} | ${afterSummary.withinOne}/${afterSummary.graded} | ${afterSummary.withinOne - beforeSummary.withinOne >= 0 ? "+" : ""}${afterSummary.withinOne - beforeSummary.withinOne} |`
);
md.push(
  `| Mean error (signed) | ${beforeSummary.meanDelta.toFixed(2)} | ${afterSummary.meanDelta.toFixed(2)} | ${(afterSummary.meanDelta - beforeSummary.meanDelta).toFixed(2)} |`
);
md.push(
  `| Mean \\|error\\| | ${beforeSummary.meanAbsDelta.toFixed(2)} | ${afterSummary.meanAbsDelta.toFixed(2)} | ${(afterSummary.meanAbsDelta - beforeSummary.meanAbsDelta).toFixed(2)} |`
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
md.push("| Filename | PSA | Before | After | Before Δ | After Δ | Binding (after) |");
md.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
for (const row of rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel))) {
  md.push(
    `| ${row.fileLabel} | ${row.psaGrade} | ${row.beforeGem} | ${row.afterGem} | ${row.beforeDiff >= 0 ? "+" : ""}${row.beforeDiff} | ${row.afterDiff >= 0 ? "+" : ""}${row.afterDiff} | \`${row.afterBindingRule}\` |`
  );
}
md.push("");
md.push("## Engine wins (|Δ| improved vs analyze-only)");
md.push("");
if (improved.length) {
  for (const row of improved) {
    md.push(
      `- **${row.fileLabel}**: ${row.beforeGem} → ${row.afterGem} (PSA ${row.psaGrade}, |Δ| ${row.absBefore} → ${row.absAfter})`
    );
  }
} else {
  md.push("_None._");
}
md.push("");
md.push("## Regressions vs analyze-only");
md.push("");
if (regressed.length) {
  for (const row of regressed) {
    md.push(
      `- **${row.fileLabel}**: ${row.beforeGem} → ${row.afterGem} (PSA ${row.psaGrade}, |Δ| ${row.absBefore} → ${row.absAfter}) — \`${row.afterBindingRule}\``
    );
  }
} else {
  md.push("_None — no |Δ| regressions from analyze-only baseline._");
}

const outDir = resolveBenchmarkPath("reports");
const jsonPath = path.join(outDir, "psa-4-6-engine-scorecard.json");
const mdPath = path.join(outDir, "psa-4-6-engine-scorecard.md");

fs.writeFileSync(
  jsonPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      suiteId: "TEST 4 TO 6",
      engineRanks: "1-6",
      beforeSummary,
      afterSummary,
      improved: improved.length,
      regressed: regressed.length,
      rows,
    },
    null,
    2
  )}\n`
);
fs.writeFileSync(mdPath, `${md.join("\n")}\n`);

console.log("PSA 4–6 engine calibration scorecard (ranks 1–6)\n");
console.log(
  "Metric".padEnd(22),
  "Analyze".padStart(10),
  "Engine".padStart(10),
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
console.log(`\nImproved: ${improved.length}  Regressed: ${regressed.length}`);
console.log(`\nWrote ${mdPath}`);
console.log(`Wrote ${jsonPath}`);
