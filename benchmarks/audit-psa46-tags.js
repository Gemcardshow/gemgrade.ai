#!/usr/bin/env node
/**
 * Tag accuracy audit for PSA 4-6 benchmark cards.
 * Compares vision output (from cache) → normalizeAnalysis → computeGrade.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../api/grading/analyze.js";
import { computeGrade } from "../api/grading/engine.js";
import { hasPoorBandNoteSignals } from "../api/grading/psa-calibration.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

const CARD_IDS = [
  "1963-t-mantle-psa5",
  "1951-b-williams-psa6",
  "1965-t-mantle-psa5",
  "1968-t-seaver-psa6",
];

const TARGET_TAGS = new Set([
  "surface_wear",
  "moderate_crease",
  "edge_fraying_major",
]);

function visionRawFromCache(cached) {
  const g = cached.grade;
  const scores = { ...g.categoryScores };
  for (const entry of g.capAudit || []) {
    if (entry.source?.startsWith("categoryImpact:")) {
      const cat = entry.source.split(":")[2];
      if (cat && entry.cap != null) {
        scores[cat] = Math.max(scores[cat], entry.cap + 1.5);
      }
    }
  }
  return {
    categoryScores: scores,
    defects: JSON.parse(JSON.stringify(g.defects || [])),
    primaryLimiterTag: g.primaryLimiter?.tag,
    primaryLimiterLabel: g.primaryLimiter?.label,
    eyeAppealSummary: g.eyeAppealSummary,
    bestAttribute: g.bestAttribute,
    categoryNotes: g.categoryNotes || {},
    scanQuality: g.scanQuality || {
      level: "good",
      visibilityIssues: [],
      inspectionLimits: [],
    },
    cardMeta: g.cardMeta || {},
  };
}

function formatDefect(d) {
  return `${d.tag} (${d.severity}, ${d.location}, ${d.confidence || "?"})`;
}

function defectDiff(before, after) {
  const b = before.map(formatDefect).sort();
  const a = after.map(formatDefect).sort();
  if (b.join("; ") === a.join("; ")) return null;
  return { before: b, after: a };
}

function bindingCap(capAudit) {
  const capped = (capAudit || []).filter(
    (e) => e.cap != null || e.floor != null
  );
  if (!capped.length) return null;
  return capped.reduce((best, e) => {
    const v = e.cap ?? e.floor;
    const bv = best.cap ?? best.floor;
    return v < bv ? e : best;
  });
}

function noteEvidence(notes, tag) {
  const map = {
    surface_wear: notes.surface,
    moderate_crease: notes.surface,
    edge_fraying_major: notes.edges,
    surface_scratch_moderate: notes.surface,
    corner_wear_moderate: notes.corners,
  };
  return map[tag] || Object.values(notes).join(" | ");
}

function analyzePromotionRisk(raw, normalized) {
  const risks = [];
  const notes = raw.categoryNotes || {};
  const appeal = `${raw.eyeAppealSummary || ""} ${raw.bestAttribute || ""}`.toLowerCase();

  for (const d of normalized.defects) {
    if (!TARGET_TAGS.has(d.tag) && d.tag !== "surface_scratch_moderate") continue;

    const visionHad = raw.defects.find((v) => v.tag === d.tag);
    const lightInNotes =
      /\b(light|minor|slight|minimal)\b/.test(
        (noteEvidence(notes, d.tag) || "").toLowerCase()
      );
    const moderateInNotes =
      /\b(moderate|heavy|severe|crease|fray|chipping)\b/.test(
        (noteEvidence(notes, d.tag) || "").toLowerCase()
      );
    const appealMismatch =
      /\b(minimal wear|vibrant|presents well|strong centering|clean)\b/.test(
        appeal
      ) &&
      ["surface_wear", "edge_fraying_major", "moderate_crease"].includes(d.tag);

    if (!visionHad && TARGET_TAGS.has(d.tag)) {
      risks.push(`INFERRED (not in vision list): ${d.tag}`);
    }
    if (visionHad?.severity === "minor" && d.severity !== "minor") {
      risks.push(`SEVERITY ESCALATION: ${d.tag} ${visionHad.severity} → ${d.severity}`);
    }
    if (lightInNotes && !moderateInNotes && TARGET_TAGS.has(d.tag)) {
      risks.push(`NOTE/TAG MISMATCH: light language in notes but tag ${d.tag}`);
    }
    if (appealMismatch) {
      risks.push(`APPEAL/TAG MISMATCH: positive appeal vs harsh tag ${d.tag}`);
    }
  }

  return risks;
}

function inferAnalyzePath(raw, normalized, diff) {
  const paths = [];
  const notes = raw.categoryNotes || {};
  const { corners, edges, surface, centering } = raw.categoryScores;

  if (diff) {
    const after = diff.after.map((d) => formatDefect(d));
    const before = diff.before.map((d) => formatDefect(d));
    if (
      after.some((d) => d.includes("corner_wear_moderate")) &&
      before.some((d) => d.includes("corner_wear_light"))
    ) {
      paths.push(
        "reconcileVintageVgLightWearUndertag: corner_wear_light → corner_wear_moderate when admitsDistributedWearAppeal + floor 6–7.5"
      );
    }
    if (
      after.some((d) => d.includes("edge_fraying_major")) &&
      before.some((d) => d.includes("edge_wear_light"))
    ) {
      paths.push(
        "reconcileVintageVgLightWearUndertag: edge_wear_light → edge_fraying_major (severe) when edges ≤5.5 and not soft-edge appeal"
      );
    }
    if (
      after.some((d) => d.includes("surface_scratch_moderate")) &&
      before.some((d) => d.includes("surface_scratch_light"))
    ) {
      paths.push(
        "reconcileVintageVgLightWearUndertag: surface_scratch_light → surface_scratch_moderate when surface ≤7.5"
      );
    }
    if (after.some((d) => d.includes("surface_wear"))) {
      paths.push(
        "inferStructuralDefects: adds surface_wear (severe) when surface ≤4.5 and scratches present, OR vision tagged surface_wear directly"
      );
    }
    if (after.some((d) => d.includes("moderate_crease"))) {
      paths.push(
        "inferHeavyWearCrease OR vision crease tag; reconcileVintageExCreaseOverTag may downgrade if EX appeal (not applied if crease stays)"
      );
    }
    if (
      after.some((d) => d.includes("edge_fraying_major")) &&
      !before.some((d) => d.includes("edge_fraying"))
    ) {
      paths.push(
        "inferStructuralDefects: adds edge_fraying_major when edges ≤6.5 without edge tag and no soft-edge appeal"
      );
    }
  }

  for (const tag of normalized.defects.map((d) => d.tag)) {
    if (tag === "surface_wear" && raw.defects.some((d) => d.tag === "surface_wear")) {
      paths.push("Vision returned surface_wear; reconcileVintageExSurfaceWearOverTag skipped or blocked");
    }
  }

  if (hasPoorBandNoteSignals(normalized)) {
    paths.push(
      "hasPoorBandNoteSignals: ≥2 category notes with moderate/heavy wear keywords → enables vintage:poor_band_notes_cluster in engine"
    );
  }

  const ns = normalized.categoryScores;
  if (Math.min(ns.corners, ns.edges, ns.surface) <= 4.5) {
    paths.push(
      "Low normalized pillars (≤4.5) enable vintage:multi_pillar_heavy_wear in engine when C/E/S align"
    );
  }

  if (
    diff &&
    diff.before.some((d) => d.includes("surface_wear")) &&
    diff.after.some((d) => d.includes("surface_scratch_light"))
  ) {
    paths.push(
      "reconcileVintageExSurfaceWearOverTag: surface_wear → surface_scratch_light (light surface notes + strong appeal)"
    );
  }
  if (
    diff &&
    diff.before.some((d) => d.includes("edge_fraying_major")) &&
    diff.after.some((d) => d.includes("edge_wear_light"))
  ) {
    paths.push(
      "reconcileVintageNoteEdgeFrayingOverTag: edge_fraying_major → edge_wear_light (light edge note + centering≥7)"
    );
  }

  if (!paths.length) {
    paths.push("No major analyze.js tag mutations detected; grade driven by vision tags + scores as-is");
  }

  return paths;
}

const report = [];

for (const id of CARD_IDS) {
  const cachePath = resolveBenchmarkPath("cache", `${id}.json`);
  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const raw = visionRawFromCache(cached);
  const normalized = normalizeAnalysis(raw, "vintage");
  const grade = computeGrade(
    {
      ...normalized,
      visionCategoryScores: raw.categoryScores,
      categoryNotes: normalized.categoryNotes || raw.categoryNotes,
    },
    "vintage"
  );
  const diff = defectDiff(raw.defects, normalized.defects);
  const bind = bindingCap(grade.capAudit);

  const tagRows = [];
  const allTags = new Set([
    ...raw.defects.map((d) => d.tag),
    ...normalized.defects.map((d) => d.tag),
  ]);

  for (const tag of [...allTags].sort()) {
    const vd = raw.defects.filter((d) => d.tag === tag);
    const nd = normalized.defects.filter((d) => d.tag === tag);
    if (
      !TARGET_TAGS.has(tag) &&
      tag !== "surface_scratch_moderate" &&
      tag !== "corner_wear_moderate"
    ) {
      continue;
    }

    const present = nd.length ? nd[0] : vd[0];
    if (!present && !vd.length && !nd.length) continue;

    const engineCaps = (grade.capAudit || []).filter(
      (e) =>
        e.source?.includes(tag) ||
        (tag === "surface_wear" && e.source?.includes("surface")) ||
        (tag === "edge_fraying_major" && e.source?.includes("edge"))
    );

    tagRows.push({
      tag,
      vision: vd.length ? formatDefect(vd[0]) : "—",
      normalized: nd.length ? formatDefect(nd[0]) : "— (removed or never present)",
      evidence: noteEvidence(raw.categoryNotes, tag),
      promotionRisks: analyzePromotionRisk(raw, normalized),
      gradeImpact: engineCaps
        .map((e) => `${e.source}${e.cap != null ? ` cap ${e.cap}` : e.floor != null ? ` floor ${e.floor}` : ""}`)
        .join("; ") || (bind?.source?.includes(tag) ? `via ${bind.source}` : "indirect via categoryFloor"),
    });
  }

  report.push({
    id,
    label: cached.card.fileLabel,
    psaSlab: cached.card.psaGrade,
    visionScores: raw.categoryScores,
    normalizedScores: normalized.categoryScores,
    poorBandNotes: hasPoorBandNoteSignals(normalized),
    visionDefects: raw.defects.map(formatDefect),
    normalizedDefects: normalized.defects.map(formatDefect),
    defectDiff: diff,
    analyzePaths: inferAnalyzePath(raw, normalized, diff),
    gemGrade: grade.psaGrade,
    delta: grade.psaGrade - cached.card.psaGrade,
    bindingRule: bind?.source,
    bindingDetail: bind?.cap ?? bind?.floor,
    capAudit: grade.capAudit,
    tagRows,
  });
}

const md = [];
md.push("# PSA 4–6 Vision Tag Audit (analyze.js)");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push("");
md.push("## Scope");
md.push("");
md.push(
  "Audits **surface_wear**, **moderate_crease**, **edge_fraying_major**, and engine caps **vintage:multi_pillar_heavy_wear** / **vintage:poor_band_notes_cluster**. Vision input is reconstructed from benchmark cache (stored model output). **normalizeAnalysis** is re-run; compare to cached run for drift."
);
md.push("");
md.push("## analyze.js — promotion paths (summary)");
md.push("");
md.push(
  "| Function | Promotes light → harsh when |"
);
md.push(
  "| --- | --- |"
);
md.push(
  "| `reconcileVintageVgLightWearUndertag` | `admitsDistributedWearAppeal` + wear floor 6–7.5: `corner_wear_light`→`moderate`, `edge_wear_light`→`edge_fraying_major` (severe) if edges≤5.5, `surface_scratch_light`→`moderate` if surface≤7.5 |"
);
md.push(
  "| `inferStructuralDefects` | Invents `surface_wear` (severe) if surface≤4.5; `edge_fraying_major` (severe) if edges≤6.5; `corner_wear_moderate` if corners≤6 |"
);
md.push(
  "| `inferHeavyWearCrease` | Invents crease when edges≤4, corners≤6, surface≤6 + corner moderate + edge fraying |"
);
md.push(
  "| `escalateLightWearObservation` / dedupe | `edge_wear_light`+severe observation → `edge_fraying_major` per defects.js SEVERITY_ESCALATION |"
);
md.push(
  "| `reconcileVintageExCreaseOverTag` | **Downgrades** `moderate_crease`→`print_line` when EX appeal (often blocked if model already tagged crease + fraying) |"
);
md.push(
  "| `reconcileVintageExSurfaceWearOverTag` | **Downgrades** `surface_wear`→`surface_scratch_light` when C/E≥6, centering≥7, light surface notes |"
);
md.push(
  "| `hasPoorBandNoteSignals` (engine) | ≥2 notes with \"moderate wear\" / heavy+wear keywords — not a tag, drives `poor_band_notes_cluster` |"
);
md.push("");

for (const card of report) {
  md.push(`## ${card.label} (slab PSA ${card.psaSlab})`);
  md.push("");
  md.push(`| | Vision scores (C/E/S/CTR) | After normalize |`);
  md.push(`| --- | --- | --- |`);
  const v = card.visionScores;
  const n = card.normalizedScores;
  md.push(
    `| Subgrades | ${v.corners} / ${v.edges} / ${v.surface} / ${v.centering} | ${n.corners} / ${n.edges} / ${n.surface} / ${n.centering} |`
  );
  md.push(`| Poor-band note cluster (engine) | — | ${card.poorBandNotes} |`);
  md.push(`| GemGrade (replay) | — | **${card.gemGrade}** (Δ ${card.delta >= 0 ? "+" : ""}${card.delta}) |`);
  md.push(`| Binding rule | — | \`${card.bindingRule}\` (${card.bindingDetail}) |`);
  md.push("");
  md.push("### Vision defects → normalized defects");
  md.push("");
  md.push("```");
  md.push(`Vision:     ${card.visionDefects.join("; ") || "none"}`);
  md.push(`Normalized: ${card.normalizedDefects.join("; ") || "none"}`);
  if (card.defectDiff) {
    md.push(
      `Changed:    ${card.defectDiff.before.join("; ")} → ${card.defectDiff.after.join("; ")}`
    );
  }
  md.push("```");
  md.push("");
  md.push("### analyze.js paths implicated");
  md.push("");
  for (const p of card.analyzePaths) {
    md.push(`- ${p}`);
  }
  md.push("");
  md.push("### Tag-by-tag");
  md.push("");
  md.push("| Tag | Vision | After normalize | Evidence (category notes) | Grade impact |");
  md.push("| --- | --- | --- | --- | --- |");
  for (const row of card.tagRows) {
    const risks =
      row.promotionRisks.length > 0
        ? row.promotionRisks.join("<br>")
        : "—";
    md.push(
      `| \`${row.tag}\` | ${row.vision} | ${row.normalized} | ${row.evidence || "—"} | ${row.gradeImpact}<br>${risks} |`
    );
  }
  md.push("");
}

const outPath = resolveBenchmarkPath("reports/psa-4-6-tag-audit.md");
fs.writeFileSync(outPath, `${md.join("\n")}\n`);
console.log(`Wrote ${outPath}`);
for (const c of report) {
  console.log(`\n${c.label}: vision → norm, Gem ${c.gemGrade} (PSA ${c.psaSlab})`);
  if (c.defectDiff) console.log(`  CHANGED: ${c.defectDiff.before} → ${c.defectDiff.after}`);
}
