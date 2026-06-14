#!/usr/bin/env node
/**
 * Detailed manual-review report for PSA 4–6 cards still missing by >±1
 * after analyze.js + engine ranks 1–6.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

function sanitizeNote(text) {
  if (!text) return "";
  const s = String(text);
  const cut = s.search(/[^\x20-\x7E\n]/);
  return (cut >= 0 ? s.slice(0, cut) : s).replace(/\s+/g, " ").trim();
}

function sanitizeNotes(notes) {
  return Object.fromEntries(
    Object.entries(notes || {}).map(([k, v]) => [k, sanitizeNote(v)])
  );
}

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

function findBinding(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) return { rule: "overall_derivation", cap: null, detail: "" };
  const binding = capped.reduce((best, e) => {
    const v = e.cap ?? e.floor;
    const bv = best.cap ?? best.floor;
    return v < bv ? e : best;
  });
  return {
    rule: binding.source,
    cap: binding.cap ?? binding.floor,
    detail: binding.cap != null ? `cap ${binding.cap}` : `floor ${binding.floor}`,
  };
}

function explainRule(rule, ctx) {
  const {
    defects,
    normalizedDefects,
    visionScores,
    impactScores,
    categoryNotes,
    tagChanges,
  } = ctx;
  const defectTags = (normalizedDefects || defects).map((d) => d.tag);
  const notesText = Object.entries(categoryNotes || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const explanations = {
    "vintage:poor_band_notes_cluster": () => {
      const moderatePlus = defectTags.filter((t) =>
        /moderate|severe|major|crease|fray|writing/.test(t)
      ).length;
      return (
        `Fires when poor-band note keywords cluster (rounding, heavy, severe, chipping, affecting) ` +
        `with ≥2 moderate+ defects and wear floor ≤5.5. ` +
        `Normalized defects: ${defectTags.join(", ")} (${moderatePlus} harsh tags). ` +
        `Vision wear floor ${Math.min(...Object.values(visionScores).slice(0, 3)).toFixed(1)}; ` +
        `post-impact floor ${Math.min(...Object.values(impactScores).slice(0, 3)).toFixed(1)}.`
      );
    },
    "vintage:triad_light_wear_notes": () =>
      `Fires when ≥3 light-wear defects, triad pillar notes mention wear/scratches on corners+edges+surface, ` +
      `wear floor 5–7.5, and card is not EX-protected. ` +
      `All three pillars have light-wear notes; only minor tags present (${defectTags.join(", ")}).`,
    "compound:2plus_moderate_defects": () => {
      const mod = defectTags.filter((t) =>
        /moderate|severe|major/.test(t)
      );
      return (
        `Fires when ≥2 moderate+ defects on vintage card; cap 4.0 unless EX-protected branch (5.5). ` +
        `Moderate+ tags: ${mod.join(", ") || "none"}. ` +
        `EX branch did not apply — wear floor or note pattern still reads poor-band.`
      );
    },
    "categoryImpact:surface_wear:surface": () =>
      `Surface subgrade crushed by \`surface_wear\` tag category impact to cap 3. ` +
      `Tag ${tagChanges.removed.includes("surface_wear") ? "was downgraded by analyze" : "still present"}. ` +
      `Vision surface ${visionScores.surface}; impact surface ${impactScores.surface}.`,
    "defect:moderate_crease": () =>
      `Standard defect cap for \`moderate_crease\` at PSA ~3 vintage. ` +
      `Tag present: ${defectTags.includes("moderate_crease")}. ` +
      `Note language: "${categoryNotes?.surface || ""}".`,
    "defect:writing_mark_severe": () =>
      `Severe back/front writing cap at PSA ~2. Tags: ${defectTags.filter((t) => t.includes("writing")).join(", ")}. ` +
      `Edge note says "${categoryNotes?.edges || ""}" — may contradict severe writing severity.`,
    "defect:edge_fraying_major": () =>
      `Major edge fraying cap at PSA ~3. Analyze ${tagChanges.added.includes("edge_fraying_major") ? "promoted" : "kept"} edge_fraying_major ` +
      `(removed: ${tagChanges.removed.join(", ") || "none"}). Edge note: "${categoryNotes?.edges || ""}".`,
  };

  const key = Object.keys(explanations).find((k) => rule.startsWith(k) || rule === k);
  if (key) return explanations[key]();
  if (rule.startsWith("categoryImpact:")) {
    const [, tag, cat] = rule.split(":");
    return `Category impact from \`${tag}\` limits ${cat} subgrade to cap shown in audit.`;
  }
  if (rule.startsWith("defect:")) {
    return `Defect-level cap from tag \`${rule.slice(7)}\` in defects.js calibration table.`;
  }
  return `Binding rule \`${rule}\` applied per engine cap stack.`;
}

function assessMiss(ctx) {
  const { psaGrade, gemGrade, rule, categoryNotes, defects, normalizedDefects, tagChanges, eyeAppeal, bestAttribute } = ctx;
  const diff = gemGrade - psaGrade;
  const tags = (normalizedDefects || defects).map((d) => d.tag);
  const notes = Object.values(categoryNotes || {}).join(" ").toLowerCase();
  const appeal = `${eyeAppeal || ""} ${bestAttribute || ""}`.toLowerCase();

  // Heuristic assessments per known patterns
  if (rule === "vintage:poor_band_notes_cluster") {
    const harshNotes = /\b(rounding|rounded|fray|chipping|heavy|severe|multiple creases)\b/.test(notes);
    const lightEdgeNote = /\b(no severe fraying|light wear|minor|not severe)\b/.test(
      categoryNotes?.edges || ""
    );
    const hasFrayTag = tags.some((t) => /fray/.test(t));
    if (lightEdgeNote && hasFrayTag && psaGrade >= 5) {
      return {
        verdict: "incorrect",
        rationale:
          "Edge category note explicitly denies severe fraying/chipping, yet edge_fraying_major tag drives poor-band cluster. Analyze note/tag mismatch — fix inference before lowering cap.",
      };
    }
    if (psaGrade >= 6 && harshNotes && tags.some((t) => /fray|crease|moderate/.test(t))) {
      return {
        verdict: "too harsh",
        rationale:
          "Slab is EX (PSA 6) but vision returned poor-band notes + moderate tags. Likely vision over-tag or analyze promotion (e.g. edge_fraying_major). Engine cap is doing its job on bad vision input — fix may be vision/analyze or rank-12 edge inference, not cap value.",
      };
    }
    if (lightNotes && psaGrade >= 5) {
      return {
        verdict: "incorrect",
        rationale:
          "Category notes describe light/minor wear while poor-band cluster cap fires on keyword hits. Notes contradict poor-band severity — analyze note reconciliation or cap gate needed.",
      };
    }
    return {
      verdict: "too harsh",
      rationale:
        "Cap appropriate for poor-band vision but overshoots known slab by 3–4 grades. Vision/analyze input likely harsher than slab reality.",
    };
  }

  if (rule === "vintage:triad_light_wear_notes") {
    if (/\b(minor|light)\b/.test(notes) && tags.every((t) => /light|scratch/.test(t))) {
      return {
        verdict: "too harsh",
        rationale:
          "PSA-3-style triad cap written for optimistic light-wear clusters. Slab PSA 5 with uniform ~5.5 subgrades and only minor tags — cap 3.5 is too harsh (rank 2 skip did not apply: centering/wear floor in triad band).",
      };
    }
    return { verdict: "too harsh", rationale: "Triad cap on EX/VG presentation." };
  }

  if (rule === "compound:2plus_moderate_defects") {
    return {
      verdict: "too harsh",
      rationale:
        "Two moderate tags trigger cap 4.0; EX branch (5.5) did not qualify. Slab PSA 6 suggests single-flaw or light wear, not poor-band compound cluster — rank 3 partial fix insufficient.",
    };
  }

  if (rule.startsWith("categoryImpact:surface_wear")) {
    const lightSurface = /\b(faint wear|retains some gloss|light|minor)\b/.test(
      categoryNotes?.surface || ""
    );
    return {
      verdict: lightSurface ? "too harsh" : "too harsh",
      rationale:
        lightSurface
          ? "Surface note describes faint wear with gloss retention, but surface_wear impact caps surface at 3. Tag/note severity exceeds slab PSA 6 — rank 8 or analyze downgrade likely."
          : "Surface wear impact cap at 3 drives grade despite EX-level corners/edges on slab PSA 6. Vision surface_wear tag may be overstated (rank 8 deferred).",
    };
  }

  if (rule === "defect:moderate_crease") {
    const creaseInNotes = /\b(crease|wrinkle)\b/.test(notes);
    const softCrease = /\b(not deeply|light|minor|small)\b/.test(notes);
    if (psaGrade >= 5 && softCrease) {
      return {
        verdict: "too harsh",
        rationale:
          "Moderate crease cap at PSA 3; notes soften crease severity. Slab PSA 5–6 implies crease is allowance-level — rank 7 single-crease EX cap may help.",
      };
    }
    if (!creaseInNotes && tags.includes("moderate_crease")) {
      return {
        verdict: "incorrect",
        rationale:
          "Crease tag present but surface notes do not describe a crease — possible false tag from edge/corner inference.",
      };
    }
    return {
      verdict: psaGrade >= 6 ? "too harsh" : "correct",
      rationale:
        psaGrade >= 6
          ? "Cap logic correct for a true moderate crease, but slab grade suggests tag or severity is wrong."
          : "Moderate crease cap aligns with visible crease language.",
    };
  }

  if (rule === "defect:writing_mark_severe") {
    const backWriting = tags.some((t) => t.includes("writing"));
    const edgesMild = /\b(minor|light|not severe)\b/.test(categoryNotes?.edges || "");
    if (psaGrade >= 5 && edgesMild) {
      return {
        verdict: "incorrect",
        rationale:
          "Severe writing cap at PSA 2, but edge/corner notes are mild and slab is PSA 5–6. Likely vision misclassified back mark as severe writing — analyze or tag severity fix before engine.",
      };
    }
    if (psaGrade >= 6) {
      return {
        verdict: "incorrect",
        rationale:
          "PSA 6 slab with writing_mark_severe tag is almost certainly a vision false positive. Engine cap is correct given tag; tag is wrong.",
      };
    }
    return { verdict: "correct", rationale: "True severe writing should cap in poor band." };
  }

  if (rule === "defect:edge_fraying_major") {
    return {
      verdict: "too harsh",
      rationale:
        "Analyze promoted edge_wear_light → edge_fraying_major. Slab PSA 5; rank 12 edge inference may be root cause. Engine cap correct if tag is real.",
    };
  }

  const direction = diff < 0 ? "deflated" : "inflated";
  return {
    verdict: "uncertain",
    rationale: `Grade ${direction} by ${Math.abs(diff)}; manual image review recommended.`,
  };
}

function replayCard(card, cached) {
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
    scanQuality: grade.scanQuality || {},
    cardMeta: grade.cardMeta || {},
  };

  const normalized = normalizeAnalysis(raw, "vintage");
  const cleanNotes = sanitizeNotes(normalized.categoryNotes || raw.categoryNotes);
  const result = computeGrade(
    {
      ...normalized,
      visionCategoryScores,
      categoryNotes: cleanNotes,
    },
    "vintage"
  );

  const binding = findBinding(result.capAudit);
  const visionDefects = (grade.defects || []).map((d) => d.tag).sort();
  const normDefects = (normalized.defects || []).map((d) => d.tag).sort();
  const tagChanges = {
    removed: visionDefects.filter((t) => !normDefects.includes(t)),
    added: normDefects.filter((t) => !visionDefects.includes(t)),
  };

  return {
    psaGrade: card.psaGrade,
    gemGrade: result.psaGrade,
    internalGrade: result.internalGrade,
    diff: result.psaGrade - card.psaGrade,
    binding,
    capAudit: result.capAudit,
    primaryLimiter: result.primaryLimiter?.tag,
    visionScores: visionCategoryScores,
    impactScores: result.categoryScores,
    categoryNotes: cleanNotes,
    defects: grade.defects,
    normalizedDefects: normalized.defects,
    tagChanges,
    eyeAppeal: grade.eyeAppealSummary,
    bestAttribute: grade.bestAttribute,
  };
}

const manifest = JSON.parse(
  fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
);
const suite = manifest.suites.find((s) => s.id === "TEST 4 TO 6");
const reports = [];

for (const card of suite.cards) {
  const cachePath = resolveBenchmarkPath("cache", `${card.id}.json`);
  if (!fs.existsSync(cachePath)) continue;

  const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const replay = replayCard(card, cached);
  if (Math.abs(replay.diff) <= 1) continue;

  const why = explainRule(replay.binding.rule, replay);
  const assessment = assessMiss({ ...replay, rule: replay.binding.rule, psaGrade: card.psaGrade, gemGrade: replay.gemGrade });

  reports.push({
    fileLabel: card.fileLabel,
    ...replay,
    whyFired: why,
    assessment: assessment.verdict,
    assessmentRationale: assessment.rationale,
  });
}

reports.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

const md = [];
md.push("# PSA 4–6 Remaining Misses — Manual Review Report");
md.push("");
md.push(`Generated: ${new Date().toISOString()}`);
md.push("");
md.push(
  "Cards still **>±1** from slab after analyze.js fixes + engine calibration ranks 1–6. " +
    "Use this report to verify each miss before implementing ranks 7–12."
);
md.push("");
md.push(`**Count:** ${reports.length} cards`);
md.push("");
md.push("## Summary table");
md.push("");
md.push("| Card | PSA | GemGrade | Δ | Binding rule | Assessment |");
md.push("| --- | ---: | ---: | ---: | --- | --- |");
for (const r of reports) {
  md.push(
    `| ${r.fileLabel} | ${r.psaGrade} | ${r.gemGrade} | ${r.diff >= 0 ? "+" : ""}${r.diff} | \`${r.binding.rule}\` (${r.binding.detail}) | **${r.assessment}** |`
  );
}
md.push("");

for (const r of reports) {
  md.push(`---`);
  md.push("");
  md.push(`## ${r.fileLabel}`);
  md.push("");
  md.push("| Field | Value |");
  md.push("| --- | --- |");
  md.push(`| **PSA grade (slab)** | ${r.psaGrade} |`);
  md.push(`| **GemGrade** | ${r.gemGrade} (internal ${r.internalGrade}) |`);
  md.push(`| **Delta** | ${r.diff >= 0 ? "+" : ""}${r.diff} |`);
  md.push(`| **Binding rule** | \`${r.binding.rule}\` (${r.binding.detail}) |`);
  md.push(`| **Primary limiter** | \`${r.primaryLimiter}\` |`);
  md.push(`| **Assessment** | **${r.assessment}** |`);
  md.push("");
  md.push("### Category notes (after normalize)");
  md.push("");
  for (const [pillar, note] of Object.entries(r.categoryNotes || {})) {
    const clean = String(note).replace(/[^\x20-\x7E\n]/g, "").trim();
    md.push(`- **${pillar}:** ${clean || "—"}`);
  }
  md.push("");
  md.push("### Eye appeal");
  md.push("");
  md.push(`> ${r.eyeAppeal || "—"}`);
  if (r.bestAttribute) md.push(`> Best attribute: ${r.bestAttribute}`);
  md.push("");
  md.push("### Vision vs impact subgrades");
  md.push("");
  md.push("| Pillar | Vision (inferred) | Post-impact |");
  md.push("| --- | ---: | ---: |");
  for (const p of ["corners", "edges", "surface", "centering"]) {
    md.push(`| ${p} | ${r.visionScores[p]} | ${r.impactScores[p]} |`);
  }
  md.push("");
  md.push("### Defect tags");
  md.push("");
  md.push("**Vision (cached):** " + (r.defects || []).map((d) => `${d.tag} (${d.severity}, ${d.location})`).join("; "));
  md.push("");
  md.push("**After normalize:** " + (r.normalizedDefects || []).map((d) => `${d.tag} (${d.severity}, ${d.location})`).join("; "));
  if (r.tagChanges.removed.length || r.tagChanges.added.length) {
    md.push("");
    md.push(`**Analyze changes:** removed \`${r.tagChanges.removed.join("`, `") || "—"}\`; added \`${r.tagChanges.added.join("`, `") || "—"}\``);
  }
  md.push("");
  md.push("### Why the rule fired");
  md.push("");
  md.push(r.whyFired);
  md.push("");
  md.push("### Cap audit (binding and nearby caps)");
  md.push("");
  md.push("```");
  const sorted = [...(r.capAudit || [])]
    .filter((e) => e.cap != null || e.floor != null)
    .sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor));
  for (const e of sorted.slice(0, 12)) {
    md.push(`${e.source}: ${e.cap ?? e.floor}`);
  }
  md.push("```");
  md.push("");
  md.push("### Review verdict");
  md.push("");
  md.push(`**${r.assessment}** — ${r.assessmentRationale}`);
  md.push("");
}

md.push("---");
md.push("");
md.push("## Assessment legend");
md.push("");
md.push("- **correct** — Rule and cap match visible evidence; miss likely acceptable or slab variance.");
md.push("- **too harsh** — Rule fires logically but cap or trigger is too aggressive for this EX/VG slab.");
md.push("- **incorrect** — Tag, note, or rule trigger appears wrong relative to notes/slab; fix vision/analyze first.");
md.push("- **uncertain** — Needs manual image review.");
md.push("");
md.push("## Suggested rank mapping (deferred 7–12)");
md.push("");
md.push("| Miss pattern | Likely rank |");
md.push("| --- | --- |");
md.push("| moderate_crease cap 3 on PSA 5–6 slabs | Rank 7 — EX single-crease cap |");
md.push("| categoryImpact surface_wear → 3 | Rank 8 — surface_wear + exBandSurface |");
md.push("| triad_light_wear on Parker-style EX | Rank 2 extension / Rank 10 distributed_vg |");
md.push("| poor_band_notes on Cochrane/Henderson | Rank 1 partial + Rank 12 edge inference |");
md.push("| writing_mark_severe on Seaver PSA 6 | Analyze/vision — not engine rank |");
md.push("| compound 2plus_moderate on Seaver 1968 | Rank 3 extension |");

const outDir = resolveBenchmarkPath("reports");
fs.mkdirSync(outDir, { recursive: true });
const mdPath = path.join(outDir, "psa-4-6-remaining-misses.md");
const jsonPath = path.join(outDir, "psa-4-6-remaining-misses.json");

fs.writeFileSync(mdPath, `${md.join("\n")}\n`);
fs.writeFileSync(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: reports.length, reports }, null, 2)}\n`);

console.log(`Wrote ${reports.length} miss reports`);
console.log(`  ${mdPath}`);
console.log(`  ${jsonPath}`);
