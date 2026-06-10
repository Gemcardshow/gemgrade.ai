#!/usr/bin/env node
/**
 * Card-by-card root cause for PSA 4-6 benchmark misses |diff| > 1.
 * Uses post-calibration replay when available, else prior cache cap audit.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveBenchmarkPath } from "./lib/paths.js";

function inferRawCategoryScores(grade) {
  const scores = { ...grade.categoryScores };
  for (const entry of grade.capAudit || []) {
    if (!entry.source?.startsWith("categoryImpact:")) {
      continue;
    }
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

function explainBinding(capAudit, cats, internalGrade) {
  const floor = capAudit?.find((e) => e.source === "categoryFloor")?.value;
  const minCap = (capAudit || [])
    .filter((e) => e.cap != null)
    .sort((a, b) => a.cap - b.cap)[0];
  const cal = (capAudit || []).filter(
    (e) =>
      e.source?.startsWith("compound:") ||
      e.source?.startsWith("vintage:") ||
      e.source?.startsWith("psa1_") ||
      e.source?.startsWith("ex_band:")
  );

  const parts = [];
  if (floor != null) {
    parts.push(
      `Category floor ${floor} (C ${cats.corners} / E ${cats.edges} / S ${cats.surface}; min-pillar drives overall before centering ${cats.centering}).`
    );
  }
  if (minCap) {
    parts.push(`Tightest defect/limiter cap: \`${minCap.source}\` at ${minCap.cap}.`);
  }
  if (cal.length) {
    parts.push(
      `Calibration stack: ${cal.map((e) => `\`${e.source}\`${e.cap != null ? ` (${e.cap})` : e.floor != null ? ` (floor ${e.floor})` : ""}`).join(" → ")}.`
    );
  }
  parts.push(`Final internal ${internalGrade}.`);
  return parts.join(" ");
}

function classifyMechanism(bindingRule, capAudit, cats) {
  if (bindingRule?.includes("categoryFloor") || bindingRule?.includes("categoryImpact")) {
    const minP = Math.min(cats.corners, cats.edges, cats.surface);
    const maxP = Math.max(cats.corners, cats.edges, cats.surface);
    if (cats.surface === minP && maxP - cats.surface >= 2) {
      return "Surface under-score / categoryImpact (corners & edges overpowering surface)";
    }
    if (cats.edges === minP || cats.corners === minP) {
      return "Corner/edge pillar dominates categoryFloor (weighted EX floor not yet applied on this run)";
    }
    return "Min-pillar categoryFloor";
  }
  if (bindingRule?.startsWith("vintage:")) {
    return "Note-count / multi-pillar vintage calibration cap";
  }
  if (bindingRule?.startsWith("compound:")) {
    return "Compound structural or moderate-defect stack";
  }
  if (bindingRule?.startsWith("psa1_")) {
    return "PSA-1 style severe/back writing stack (true poor-band)";
  }
  if (bindingRule?.includes("optimism_ceiling")) {
    return "EX optimism ceiling (inflation control)";
  }
  return "Defect ceiling / limiter chain";
}

const manifest = JSON.parse(
  fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
);
const suite = manifest.suites.find((s) => s.id === "TEST 4 TO 6");

let replayRows = [];
const replayPath = resolveBenchmarkPath("reports/psa-4-6-replay.json");
if (fs.existsSync(replayPath)) {
  replayRows = JSON.parse(fs.readFileSync(replayPath, "utf8")).rows || [];
}
const replayById = new Map(replayRows.map((r) => [r.id, r]));

const misses = [];

for (const card of suite.cards) {
  const replay = replayById.get(card.id);
  const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
  const cached = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
    : null;

  const psaGrade = card.psaGrade;
  const gemGrade = replay?.gemGrade ?? cached?.grade?.psaGrade;
  const diff = gemGrade != null ? gemGrade - psaGrade : null;

  if (gemGrade == null || Math.abs(diff) <= 1) {
    continue;
  }

  const cats =
    replay?.categoryScores ??
    cached?.grade?.categoryScores ??
    {};
  const capAudit = replay?.capAudit ?? cached?.grade?.capAudit ?? [];
  const bindingRule =
    replay?.bindingRule ??
    capAudit
      .filter((e) => e.cap != null)
      .sort((a, b) => a.cap - b.cap)[0]?.source ??
    "unknown";
  const rawInferred = cached ? inferRawCategoryScores(cached.grade) : null;

  misses.push({
    fileLabel: card.fileLabel,
    psaGrade,
    gemGrade,
    diff,
    cats,
    rawInferred,
    primaryLimiter:
      replay?.primaryLimiter ?? cached?.grade?.primaryLimiter?.tag,
    mechanism: classifyMechanism(bindingRule, capAudit, cats),
    narrative: explainBinding(capAudit, cats, replay?.internalGrade ?? cached?.grade?.internalGrade),
    bindingRule,
  });
}

const md = [];
md.push("# PSA 4–6 Benchmark — Root Cause Report (|Δ| > 1)");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push(`Misses analyzed: ${misses.length}`);
md.push("");
md.push(
  "Each row is a card where GemGrade differed from the PSA slab by more than one grade. Binding rule is the tightest cap/floor in the audit trail."
);
md.push("");

for (const miss of misses.sort((a, b) => a.diff - b.diff)) {
  md.push(`## ${miss.fileLabel}`);
  md.push("");
  md.push(`| Field | Value |`);
  md.push(`| --- | --- |`);
  md.push(`| Expected PSA | ${miss.psaGrade} |`);
  md.push(`| GemGrade | ${miss.gemGrade} |`);
  md.push(`| Difference | ${miss.diff >= 0 ? "+" : ""}${miss.diff} |`);
  md.push(`| Subgrades (C/E/S/CTR) | ${miss.cats.corners} / ${miss.cats.edges} / ${miss.cats.surface} / ${miss.cats.centering} |`);
  if (miss.rawInferred) {
    md.push(
      `| Inferred raw vision (C/E/S) | ${miss.rawInferred.corners} / ${miss.rawInferred.edges} / ${miss.rawInferred.surface} |`
    );
  }
  md.push(`| Primary limiter | \`${miss.primaryLimiter}\` |`);
  md.push(`| Mechanism | ${miss.mechanism} |`);
  md.push(`| Binding rule | \`${miss.bindingRule}\` |`);
  md.push("");
  md.push(miss.narrative);
  md.push("");
}

md.push("## Cross-cutting findings");
md.push("");
md.push(
  "1. **Min-pillar categoryFloor** — Overall grade starts at `min(corners, edges, surface)`, so one harsh edge or surface subgrade caps the card even when centering and other pillars are strong."
);
md.push(
  "2. **categoryImpact** — Tags like `surface_wear`, `edge_fraying_major`, and `moderate_crease` crush pillar scores before calibration; vision often over-tags EX cards."
);
md.push(
  "3. **Vintage multi-pillar caps** — `vintage:multi_pillar_heavy_wear`, `vintage:distributed_vg_wear`, and `vintage:triad_light_wear_notes` still fire on note-keyword patterns."
);
md.push(
  "4. **Compound stacks** — `compound:2plus_moderate_defects` and `compound:3plus_structural_defects` layer on top of low pillar floors."
);
md.push(
  "5. **PSA 1-style stacks** — Cards with `writing_mark_severe` / multiple severe tags correctly stay poor-band (Martin, Seaver 1969); not EX calibration targets."
);
md.push(
  "6. **Category weighting** — Corners and edges currently influence the floor as much as surface; centering only affects gem ceiling, not wear floor."
);

const outPath = resolveBenchmarkPath("reports/psa-4-6-root-cause.md");
fs.writeFileSync(outPath, `${md.join("\n")}\n`);
console.log(`Wrote ${outPath} (${misses.length} misses)`);
