#!/usr/bin/env node
/**
 * Merge PSA 4-6 benchmark rows from cache + initial batch report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBenchmarkPath, BENCHMARKS_ROOT } from "./lib/paths.js";
import { detectCalibrationPatterns } from "./lib/patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
);
const suite = manifest.suites.find((s) => s.id === "TEST 4 TO 6");
const cacheDir = resolveBenchmarkPath("cache");

const rows = [];

for (const card of suite.cards) {
  const cachePath = path.join(cacheDir, `${card.id}.json`);
  let row = null;

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const grade = cached.grade;
    row = {
      id: card.id,
      card: card.cardName,
      fileLabel: card.fileLabel,
      psaGrade: card.psaGrade,
      gemGrade: grade.psaGrade,
      internalGrade: grade.internalGrade,
      gradeDifference: grade.psaGrade - card.psaGrade,
      era: grade.era,
      categoryScores: grade.categoryScores,
      primaryLimiter: grade.primaryLimiter,
      defects: grade.defects,
      capAudit: grade.capAudit,
      eyeAppealSummary: grade.eyeAppealSummary,
      patterns: detectCalibrationPatterns({
        psaGrade: card.psaGrade,
        gemGrade: grade.psaGrade,
        internalGrade: grade.internalGrade,
        categoryScores: grade.categoryScores,
        defects: grade.defects,
        primaryLimiter: grade.primaryLimiter,
        eyeAppealSummary: grade.eyeAppealSummary,
        capAudit: grade.capAudit,
      }),
    };
  }

  if (!row) {
    rows.push({
      id: card.id,
      fileLabel: card.fileLabel,
      psaGrade: card.psaGrade,
      gemGrade: null,
      gradeDifference: null,
      error: "No result (rate limit or not run)",
    });
    continue;
  }

  rows.push({
    ...row,
    fileLabel: card.fileLabel,
  });
}

rows.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));

const successful = rows.filter((r) => r.gemGrade != null);
const deltas = successful.map((r) => r.gradeDifference);
const abs = deltas.map(Math.abs);

const md = [];
md.push("# GemGrade PSA 4–6 Benchmark Report");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push(`Suite: TEST 4 TO 6 · Cards: ${suite.cardCount} · Graded: ${successful.length}`);
md.push("");
md.push("| Filename | GemGrade | Expected PSA | Difference |");
md.push("| --- | ---: | ---: | ---: |");

for (const row of rows) {
  const diff =
    row.gradeDifference == null
      ? "—"
      : row.gradeDifference >= 0
        ? `+${row.gradeDifference}`
        : String(row.gradeDifference);
  const gem = row.gemGrade ?? "FAILED";
  md.push(`| ${row.fileLabel} | ${gem} | ${row.psaGrade} | ${diff} |`);
}

md.push("");
md.push("## Summary");
md.push("");
if (successful.length) {
  md.push(`- Mean delta: ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2)}`);
  md.push(`- Mean |delta|: ${(abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(2)}`);
  md.push(`- Within ±1: ${successful.filter((r) => Math.abs(r.gradeDifference) <= 1).length}/${successful.length}`);
  md.push(`- Exact match: ${successful.filter((r) => r.gradeDifference === 0).length}/${successful.length}`);
  md.push(
    `- Deflated (GemGrade < slab): ${successful.filter((r) => r.gradeDifference < 0).length}/${successful.length}`
  );
  md.push(
    `- Inflated (GemGrade > slab): ${successful.filter((r) => r.gradeDifference > 0).length}/${successful.length}`
  );
}

/** @type {Map<string, number>} */
const capHits = new Map();
for (const row of successful) {
  for (const entry of row.capAudit || []) {
    const source = entry.source;
    if (
      !source ||
      (!source.startsWith("compound:") && !source.startsWith("vintage:"))
    ) {
      continue;
    }
    capHits.set(source, (capHits.get(source) || 0) + 1);
  }
}

const calibrationCaps = [...capHits.entries()].sort((a, b) => b[1] - a[1]);

md.push("");
md.push("## Calibration cap frequency (PSA 4–6 suite)");
md.push("");
if (calibrationCaps.length) {
  md.push("| Cap source | Cards |");
  md.push("| --- | ---: |");
  for (const [key, count] of calibrationCaps) {
    md.push(`| \`${key}\` | ${count} |`);
  }
} else {
  md.push("_No compound/vintage caps recorded._");
}

md.push("");
md.push("## Error patterns");
md.push("");
md.push(
  "### 1. Systematic EX-band deflation (20/21 cards below slab; mean delta −2.19)"
);
md.push("");
md.push(
  "Poor-band and compound calibration added for PSA 1–3 is firing on EX/VG slabs. Typical drivers:"
);
md.push("");
md.push(
  "- **`compound:3plus_structural_defects`** (cap 3.5 vintage) — triggered when `wearFloor ≤ 5.5` or any pillar ≤ 5.5, even if other pillars are mid-tier. Cards like Harris PSA 5 (edges 3.5, corners 5) land at GemGrade 3."
);
md.push(
  "- **`vintage:triad_light_wear_notes`** (cap 3.5) — three category notes mentioning wear/scratch/chipping with ≥3 light wear tags and no moderate+ defects. Hits Mantle PSA 5, Parker PSA 5, Henderson PSA 6 despite slab EX/VG."
);
md.push(
  "- **`vintage:poor_band_notes_cluster`** / **`vintage:multi_pillar_heavy_wear`** — note-keyword clusters and multi-pillar floors written for poor band; pull Aaron 1970, Leever, Bauer, Clemente to PSA 1–2."
);
md.push(
  "- **`compound:2plus_moderate_defects`** (cap 4.0 vintage) — two moderate+ tags on otherwise EX presentation (Cochrane, Dean, Mantle 1965, Bender)."
);
md.push("");
md.push("### 2. Single severe inflation — 1978 T Ryan PSA 4 → GemGrade 8 (+4)");
md.push("");
md.push(
  "Vision returned uniformly high subgrades (8/8/8/9), a single `corner_wear_light` (minor), excellent scan quality, and **no** compound or vintage caps. This is the opposite failure mode: PSA 1–3 harshness absent, no EX-band ceiling when optimism is uniform and tags are all light."
);
md.push("");
md.push("### 3. Vision / tag severity mismatch");
md.push("");
md.push(
  "- **`edge_fraying_major`** with severity `severe` on multiple EX cards drives structural compound stacks."
);
md.push(
  "- **`writing_mark`** / back marks on Martin PSA 5 stack with `compound:2_severe_defects`."
);
md.push(
  "- Unit-test anchors (Leever, Mantle 1963/1965, Henderson) exist in `engine.test.js` but live benchmark grades diverge — expect run-to-run vision variance until caps are band-aware."
);
md.push("");
md.push("## Recommended code changes (no engine rewrite)");
md.push("");
md.push(
  "Target **`api/grading/psa-calibration.js`** and **`api/grading/analyze.js`** only; keep `engine.js` pipeline intact."
);
md.push("");
md.push(
  "1. **Add an EX/VG band gate** — New helper e.g. `isExBandPresentation(categoryScores, defects)` when wear floor ≥ 4.5 and no PSA-1 triggers. Skip or soften: `vintage:triad_light_wear_notes`, `vintage:poor_band_notes_cluster`, `vintage:optimistic_light_wear`, and `compound:optimistic_moderate_cluster` when EX band is detected."
);
md.push(
  "2. **Relax `compound:3plus_structural_defects`** — Prefer `compound:3plus_structural_ex_band` (cap 5.0) when wear floor ≥ 5.0 and at most one pillar ≤ 5.5; reserve harsh 3.5 cap for true poor-band floors (≤ 4.5 on two+ pillars)."
);
md.push(
  "3. **EX-band optimism ceiling** — When all wear tags are light/minor, subgrades ≥ 7, and no crease/severe back damage: cap overall at **slab-agnostic** `min(overall, 6.5)` or `wearFloor + 1.5` so Ryan-style NM hallucinations cannot exceed ~PSA 6–7 without slab input."
);
md.push(
  "4. **Tighten `hasTriadLightWearNotes`** — Require moderate language in ≥2 pillars or moderate+ defects before 3.5 cap; generic “light wear” on EX cards should not alone trigger triad cap."
);
md.push(
  "5. **Reconcile `edge_fraying_major`** — Down-rank to moderate structural count when category note says light edge wear only; avoids false 3-defect structural stacks on T205/T206 EX cards."
);
md.push(
  "6. **Extend `benchmarks/lib/patterns.js`** — Add `ex_band_deflation` and `ex_band_inflation` detectors for future regression runs on this suite."
);
md.push("");
md.push("## Artifacts");
md.push("");
md.push("- JSON: `benchmarks/reports/psa-4-6-benchmark.json`");
md.push("- Per-card cache: `benchmarks/cache/<card-id>.json`");
md.push("- Regenerate: `node benchmarks/build-psa46-report.js`");

const outJson = {
  generatedAt: new Date().toISOString(),
  suiteId: "TEST 4 TO 6",
  rows,
  summary: {
    total: rows.length,
    graded: successful.length,
    meanDelta: successful.length
      ? deltas.reduce((a, b) => a + b, 0) / deltas.length
      : 0,
    meanAbsDelta: successful.length
      ? abs.reduce((a, b) => a + b, 0) / abs.length
      : 0,
    withinOne: successful.filter((r) => Math.abs(r.gradeDifference) <= 1)
      .length,
    exactMatch: successful.filter((r) => r.gradeDifference === 0).length,
    inflated: successful.filter((r) => r.gradeDifference > 0).length,
    deflated: successful.filter((r) => r.gradeDifference < 0).length,
  },
};

const outDir = resolveBenchmarkPath("reports");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "psa-4-6-benchmark.json");
fs.writeFileSync(jsonPath, `${JSON.stringify(outJson, null, 2)}\n`);
fs.copyFileSync(jsonPath, path.join(outDir, "psa-4-6-latest.json"));
fs.writeFileSync(
  path.join(outDir, "psa-4-6-benchmark.md"),
  `${md.join("\n")}\n`
);

console.log(md.join("\n"));
