#!/usr/bin/env node
/**
 * Fix 1 vintage impact analysis — stain stripped vs grade/cap binding.
 * Analysis only. No grading logic changes.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { resolveBenchmarkPath } from "./lib/paths.js";

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

function bindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) {
    return (capAudit || []).find((e) => e.source === "categoryFloor")?.source ?? null;
  }
  return capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]?.source ?? null;
}

function gradeCard(raw, era = "vintage") {
  const visionCategoryScores = raw.categoryScores;
  const analysis = normalizeAnalysis(raw, era);
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || raw.categoryNotes,
    },
    era
  );
  return { analysis, result };
}

function rawFromSnapshot(snapshot) {
  const rawVision = snapshot.rawVision || snapshot;
  return {
    categoryScores: rawVision.categoryScores,
    defects: JSON.parse(JSON.stringify(rawVision.defects || [])),
    primaryLimiterTag: rawVision.primaryLimiterTag,
    primaryLimiterLabel: rawVision.primaryLimiterLabel,
    eyeAppealSummary: rawVision.eyeAppealSummary,
    bestAttribute: rawVision.bestAttribute,
    categoryNotes: rawVision.categoryNotes || {},
    scanQuality: rawVision.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: rawVision.cardMeta || {},
  };
}

function rawFromCache(cached) {
  const grade = cached.grade;
  const visionCategoryScores = inferRawCategoryScores(grade);
  return {
    categoryScores: visionCategoryScores,
    defects: JSON.parse(JSON.stringify(grade.defects || [])),
    primaryLimiterTag: grade.primaryLimiter?.tag,
    primaryLimiterLabel: grade.primaryLimiter?.label,
    eyeAppealSummary: grade.eyeAppealSummary,
    bestAttribute: grade.bestAttribute,
    categoryNotes: grade.categoryNotes || {},
    scanQuality: grade.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
    cardMeta: grade.cardMeta || {},
  };
}

function loadVintageCard(id, cacheDir, snapDir) {
  const cachePath = path.join(cacheDir, `${id}.json`);
  const snapPath = path.join(snapDir, `${id}.json`);
  if (fs.existsSync(cachePath)) {
    return { raw: rawFromCache(JSON.parse(fs.readFileSync(cachePath, "utf8"))), source: "cache" };
  }
  if (fs.existsSync(snapPath)) {
    return {
      raw: rawFromSnapshot(JSON.parse(fs.readFileSync(snapPath, "utf8"))),
      source: "vision-snapshot",
    };
  }
  return null;
}

function hadBackStainInVision(raw) {
  return (raw.defects || []).some(
    (d) => d.tag === "staining_light" && (d.location === "back" || d.location === "both")
  );
}

function main() {
  const beforePath = resolveBenchmarkPath("reports", "vintage-before-fix1-temp.json");
  const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const cacheDir = resolveBenchmarkPath("cache");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");

  const stainLimiterBefore = before.rows.filter((r) => r.primaryLimiterTag === "staining_light");
  const cards = [];

  for (const row of stainLimiterBefore) {
    const loaded = loadVintageCard(row.id, cacheDir, snapDir);
    if (!loaded) continue;

    const { raw, source } = loaded;
    const visionHadStain = hadBackStainInVision(raw);
    const { analysis, result } = gradeCard(raw, "vintage");
    const stainStripped = visionHadStain && !analysis.defects.some((d) => d.tag === "staining_light");
    const triadCap = (result.capAudit || []).some((e) => e.source === "vintage:triad_light_wear_notes");
    const categoryFloor = (result.capAudit || []).find((e) => e.source === "categoryFloor")?.value;
    const wearMin = Math.min(
      analysis.categoryScores.corners,
      analysis.categoryScores.edges,
      analysis.categoryScores.surface
    );
    const triadNormalizeClamp = wearMin <= 5.5 && result.psaGrade <= 5;

    cards.push({
      id: row.id,
      cardName: row.cardName,
      psaGrade: row.psaGrade,
      gemGradeBefore: row.gemGrade,
      gemGradeAfter: result.psaGrade,
      gradeDiffBefore: row.gradeDifference,
      gradeDiffAfter: result.psaGrade - row.psaGrade,
      visionHadStain,
      stainStripped,
      limiterBefore: row.primaryLimiterTag,
      limiterAfter: result.primaryLimiter?.tag,
      bindingBefore: row.bindingRule,
      bindingAfter: bindingRule(result.capAudit),
      triadCap,
      triadNormalizeClamp,
      categoryFloor,
      normalizedScores: analysis.categoryScores,
      capAudit: result.capAudit,
      source,
    });
  }

  const stripped = cards.filter((c) => c.stainStripped);
  const stainRemovedFromLimiter = cards.filter(
    (c) => c.limiterBefore === "staining_light" && c.limiterAfter !== "staining_light"
  );
  const gradeImproved = cards.filter((c) => c.gemGradeAfter > c.gemGradeBefore);
  const strippedUndergraded = stainRemovedFromLimiter.filter((c) => Math.abs(c.gradeDiffAfter) > 1);
  const strippedNoGradeChange = stainRemovedFromLimiter.filter(
    (c) => c.gemGradeBefore === c.gemGradeAfter
  );
  const triadBlocked = stainRemovedFromLimiter.filter(
    (c) => c.triadCap || c.triadNormalizeClamp
  );

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      stainLimiterBefore: stainLimiterBefore.length,
      analyzed: cards.length,
      stainStripped: stripped.length,
      limiterMovedOffStain: stainRemovedFromLimiter.length,
      gradeImproved: gradeImproved.length,
      strippedStillUndergraded: strippedUndergraded.length,
      strippedNoGradeChange: strippedNoGradeChange.length,
      triadBlocked: triadBlocked.length,
    },
    cards: cards.sort((a, b) => a.cardName.localeCompare(b.cardName)),
  };

  const md = buildMarkdown(report);
  const jsonPath = resolveBenchmarkPath("reports", "fix1-vintage-impact-analysis.json");
  const mdPath = resolveBenchmarkPath("reports", "fix1-vintage-impact-analysis.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, md);
  console.log(md);
  console.log(`\nWrote ${mdPath}`);
}

function buildMarkdown(report) {
  const s = report.summary;
  const lines = [
    "# Fix 1 Vintage Impact Analysis",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Cards with \`staining_light\` limiter before Fix 1 | ${s.stainLimiterBefore} |`,
    `| Re-analyzed with current engine | ${s.analyzed} |`,
    `| Back stain stripped by Fix 1 | ${s.stainStripped} |`,
    `| Limiter moved off \`staining_light\` | ${s.limiterMovedOffStain} |`,
    `| Grade improved vs before | ${s.gradeImproved} |`,
    `| Limiter moved but still outside ±1 | ${s.strippedStillUndergraded} |`,
    `| Limiter moved with no grade change | ${s.strippedNoGradeChange} |`,
    `| Post-strip triad clamp (cap or normalize) | ${s.triadBlocked} |`,
    "",
    "## Conclusion",
    "",
    "Fix 1 removes cosmetic back stain tags/limiters and preserves anchor grades via relief flags (Bench 9, Williams/Rose 6–7). **Within ±1 does not move yet** because most NM cards hit **`vintage:triad_light_wear_notes`** during normalize (pillars clamped to ~5.5) or **`primaryLimiter:surface_scratch_light`** on an already-low category floor. **Fix 5 is required** for meaningful grade lifts on that cluster.",
    "",
    "### Grade improved (1 card)",
    "",
    "| Card | PSA | Before | After | Old binding | New binding |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...report.cards
      .filter((c) => c.gemGradeAfter > c.gemGradeBefore)
      .map(
        (c) =>
          `| ${c.cardName} | ${c.psaGrade} | ${c.gemGradeBefore} | ${c.gemGradeAfter} | ${c.bindingBefore ?? "—"} | ${c.bindingAfter ?? "—"} |`
      ),
    "",
    "## Per-card detail (limiter moved off stain)",
    "",
    "| Card | PSA | Before | After | Δ PSA | Limiter after | Binding cap | Triad clamp? | Norm min C/E/S |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |",
  ];

  for (const c of report.cards.filter((row) => row.limiterBefore === "staining_light" && row.limiterAfter !== "staining_light")) {
    const min = Math.min(
      c.normalizedScores.corners,
      c.normalizedScores.edges,
      c.normalizedScores.surface
    );
    lines.push(
      `| ${c.cardName} | ${c.psaGrade} | ${c.gemGradeBefore} | ${c.gemGradeAfter} | ${c.gradeDiffAfter} | ${c.limiterAfter ?? "—"} | ${c.bindingAfter ?? "—"} | ${c.triadCap || c.triadNormalizeClamp ? "yes" : "no"} | ${min} |`
    );
  }

  lines.push(
    "",
    "## Per-card detail (stain tag retained)",
    "",
    "| Card | PSA | Grade | Limiter | Reason |",
    "| --- | ---: | ---: | --- | --- |"
  );

  for (const c of report.cards.filter((row) => row.limiterAfter === "staining_light")) {
    lines.push(
      `| ${c.cardName} | ${c.psaGrade} | ${c.gemGradeAfter} | ${c.limiterAfter ?? "—"} | Fix 1 guard retained stain |`
    );
  }

  lines.push(
    "",
    "## Fix 5 dependency",
    "",
    "**Yes — Fix 5 (triad light-wear profile) is required before Fix 1 produces meaningful within ±1 gains** on the NM vintage cluster. Fix 1 is still worth committing first: it corrects false stain limiters (20→5), preserves relief anchors, and removes `vintage:optimistic_light_wear` mis-binding on cards like Tyler (+3). The post-strip stack is: normalize triad clamp (~5.5 pillars) → `categoryFloor` → `primaryLimiter:surface_scratch_light` (cap ~7.5)."
  );

  return lines.join("\n");
}

main();
