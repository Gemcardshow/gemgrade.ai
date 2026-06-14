#!/usr/bin/env node
/**
 * Fix 3 scratch research — vintage PSA 7–9 surface_scratch_light skepticism.
 *
 * Usage: node benchmarks/analyze-fix3-scratch-research.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAnalysis } from "../lib/grading/analyze.js";
import { computeGrade } from "../lib/grading/engine.js";
import { formatGradeResponse } from "../lib/grading/response.js";
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

const CONFIRMED_SCRATCH_PATTERNS = [
  { id: "linear_hairline", re: /\b(linear|hairline) scratch/i },
  { id: "scratch_crossing", re: /\bscratch(es)? crossing (the )?(artwork|background|image|portrait|surface)/i },
  { id: "multi_angle", re: /\bscratch(es)? (visible|seen) (at|from|under) (multiple )?angles?/i },
  { id: "angled_light", re: /\bscratch(es)?[\w\s]{0,48}under (angled|angle|tilted) light/i },
  { id: "visible_clear_scratch", re: /\b(visible|clear) scratch (on|across|in|crossing|through)/i },
  { id: "generic_scratch_word", re: /\bscratch(ed|es|ing)?\b/i },
  { id: "scuff_abrasion", re: /\b(scuff(s|ed|ing)?|abrasion|scrape(d|s|ing)?)\b/i },
];

const NON_CONFIRMING_PATTERNS = [
  { id: "print_line_roller", re: /\b(print line|roller mark|factory line|ripple)\b/i },
  { id: "clean_pristine", re: /\b(clean surface|pristine|flawless|presents well|well-preserved|no major)\b/i },
  { id: "scratch_denial", re: /\b(no scratches?|no major creases|without scratches?|scratch.?free)\b/i },
  { id: "general_wear", re: /\b(general wear|light wear|minor wear|age-appropriate)\b/i },
  { id: "gloss_scanner", re: /\b(gloss|glare|scanner|shadow|reflection|lighting)\b/i },
  { id: "marks_only", re: /\b(marks?|blemish|imperfection)\b(?!.*scratch)/i },
];

const GENERIC_SCRATCH_ONLY = [
  /\blight scratch present/i,
  /\bminor surface scratch/i,
  /\bsurface scratch noted/i,
  /\bminor scratch on (the )?(front|back) surface/i,
  /\b(light|minor|small|faint) scratch(es)?\b/i,
  /\ba few light scratches\b/i,
  /\bslight surface scratch/i,
];

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

function loadRawVision(card, cacheDir, snapDir) {
  const cachePath = path.join(cacheDir, `${card.id}.json`);
  const snapPath = path.join(snapDir, `${card.id}.json`);
  let snapshotRaw = null;
  if (fs.existsSync(snapPath)) {
    const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    snapshotRaw = snapshot.rawVision || snapshot;
  }

  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    const grade = cached.grade;
    const visionCategoryScores = inferRawCategoryScores(grade);
    return {
      replayRaw: {
        categoryScores: visionCategoryScores,
        defects: JSON.parse(JSON.stringify(grade.defects || [])),
        primaryLimiterTag: grade.primaryLimiter?.tag,
        primaryLimiterLabel: grade.primaryLimiter?.label,
        eyeAppealSummary: grade.eyeAppealSummary,
        bestAttribute: grade.bestAttribute,
        categoryNotes: grade.categoryNotes || {},
        scanQuality: grade.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
        cardMeta: grade.cardMeta || {},
      },
      snapshotRaw,
      visionCategoryScores,
      replaySource: "cache",
      hasSnapshot: Boolean(snapshotRaw),
    };
  }

  if (snapshotRaw) {
    return {
      replayRaw: {
        categoryScores: snapshotRaw.categoryScores,
        defects: JSON.parse(JSON.stringify(snapshotRaw.defects || [])),
        primaryLimiterTag: snapshotRaw.primaryLimiterTag,
        primaryLimiterLabel: snapshotRaw.primaryLimiterLabel,
        eyeAppealSummary: snapshotRaw.eyeAppealSummary,
        bestAttribute: snapshotRaw.bestAttribute,
        categoryNotes: snapshotRaw.categoryNotes || {},
        scanQuality: snapshotRaw.scanQuality || { level: "good", visibilityIssues: [], inspectionLimits: [] },
        cardMeta: snapshotRaw.cardMeta || {},
      },
      snapshotRaw,
      visionCategoryScores: snapshotRaw.categoryScores,
      replaySource: "snapshot",
      hasSnapshot: true,
    };
  }
  return null;
}

function hasScratchTag(defects) {
  return (defects || []).some(
    (d) => d.tag === "surface_scratch_light" || d.tag === "surface_scratch_moderate"
  );
}

function extractScratchWording(raw) {
  const fields = {
    surface: raw.categoryNotes?.surface || "",
    eyeAppeal: raw.eyeAppealSummary || "",
    bestAttribute: raw.bestAttribute || "",
    primaryLimiterLabel: raw.primaryLimiterLabel || "",
  };
  const combined = Object.values(fields).join(" ");
  const sentences = combined
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const scratchRelated = sentences.filter((s) => /\b(scratch|scuff|abrasion|scrape|mark)\b/i.test(s));
  return { fields, scratchRelatedSentences: scratchRelated, combinedText: combined };
}

function classifyLanguage(text) {
  const confirmed = CONFIRMED_SCRATCH_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  const nonConfirming = NON_CONFIRMING_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  const structuralConfirmed = confirmed.some((id) =>
    ["linear_hairline", "scratch_crossing", "multi_angle", "angled_light", "visible_clear_scratch"].includes(id)
  );
  const genericScratchOnly =
    !structuralConfirmed &&
    (confirmed.includes("generic_scratch_word") || GENERIC_SCRATCH_ONLY.some((re) => re.test(text)));
  const scratchDenied = nonConfirming.includes("scratch_denial");
  const cleanContradiction =
    nonConfirming.includes("clean_pristine") &&
    !confirmed.some((id) =>
      ["linear_hairline", "scratch_crossing", "visible_clear_scratch"].includes(id)
    );
  return {
    confirmed,
    nonConfirming,
    structuralConfirmed,
    genericScratchOnly,
    scratchDenied,
    cleanContradiction,
  };
}

function classifyOrigin(replayRaw, snapshotRaw, normalizedDefects) {
  const trueVision = snapshotRaw || replayRaw;
  const visionHad = hasScratchTag(trueVision.defects);
  const replayHad = hasScratchTag(replayRaw.defects);
  const normalizedHas = hasScratchTag(normalizedDefects);

  if (!normalizedHas) {
    if (visionHad || replayHad) return "downstream_stripped_or_escalated";
    return "none";
  }
  if (visionHad) {
    if (snapshotRaw && !replayHad) return "snapshot_only_scratch";
    return "vision_persisted";
  }
  if (replayHad && !visionHad && snapshotRaw) return "cache_drift_from_snapshot";
  if (replayHad) return "vision_persisted";
  return "downstream_inferred";
}

function bindingRule(capAudit) {
  const capped = (capAudit || []).filter((e) => e.cap != null || e.floor != null);
  if (!capped.length) {
    return (capAudit || []).find((e) => e.source === "categoryFloor")?.source ?? null;
  }
  return capped.sort((a, b) => (a.cap ?? a.floor) - (b.cap ?? b.floor))[0]?.source ?? null;
}

function scratchCapAudit(capAudit) {
  return (capAudit || []).filter((e) => /scratch/i.test(String(e.source || "")));
}

function gradeCard(card, cacheDir, snapDir) {
  const loaded = loadRawVision(card, cacheDir, snapDir);
  if (!loaded) return null;

  const { replayRaw, snapshotRaw, visionCategoryScores, replaySource, hasSnapshot } = loaded;
  const analysis = normalizeAnalysis(replayRaw, "vintage");
  const result = computeGrade(
    {
      ...analysis,
      visionCategoryScores,
      categoryNotes: analysis.categoryNotes || replayRaw.categoryNotes,
    },
    "vintage"
  );
  const response = formatGradeResponse({
    gradeResult: result,
    analysis,
    eraSource: "auto",
    estimatedYear: card.year ?? replayRaw.cardMeta?.estimatedYear ?? null,
  });

  const trueVision = snapshotRaw || replayRaw;
  const wording = extractScratchWording(trueVision);
  const language = classifyLanguage(wording.combinedText);
  const origin = classifyOrigin(replayRaw, snapshotRaw, analysis.defects);
  const binding = bindingRule(result.capAudit);
  const scratchCaps = scratchCapAudit(result.capAudit);
  const scratchIsBinding =
    binding?.includes("scratch") ||
    scratchCaps.some((e) => e.source === binding);

  const scratchTag =
    analysis.defects.find((d) => d.tag === "surface_scratch_light" || d.tag === "surface_scratch_moderate")
      ?.tag ?? null;

  const row = {
    id: card.id,
    cardName: card.cardName,
    suiteId: card.suiteId,
    psaGrade: card.psaGrade,
    gemGrade: result.psaGrade,
    internalGrade: result.internalGrade,
    gradeDifference: result.psaGrade - card.psaGrade,
    withinOne: Math.abs(result.psaGrade - card.psaGrade) <= 1,
    replaySource,
    hasSnapshot,
    visionHadScratch: hasScratchTag(trueVision.defects),
    replayHadScratch: hasScratchTag(replayRaw.defects),
    normalizedHasScratch: hasScratchTag(analysis.defects),
    scratchTag,
    primaryLimiterTag: result.primaryLimiter?.tag,
    scratchIsPrimaryLimiter: ["surface_scratch_light", "surface_scratch_moderate"].includes(
      result.primaryLimiter?.tag
    ),
    origin,
    scratchWording: wording,
    language,
    bindingRule: binding,
    scratchIsBinding,
    scratchCapAudit: scratchCaps,
    capAuditFull: result.capAudit,
    categoryScores: result.categoryScores,
    visionCategoryScores,
    defectTags: analysis.defects.map((d) => d.tag),
    outputMentionsScratch: /scratch/i.test(
      [
        response.primaryLimiter?.label,
        response.verdict,
        ...(response.defects || []).map((d) => d.tag),
      ].join(" ")
    ),
    visionReconciliationAudit: analysis.visionReconciliationAudit || [],
    gremlinScratchLimiter:
      card.psaGrade >= 7 &&
      ["surface_scratch_light", "surface_scratch_moderate"].includes(result.primaryLimiter?.tag) &&
      result.psaGrade - card.psaGrade <= -2,
  };

  row.likelyFalsePositiveScratch =
    card.psaGrade >= 7 &&
    row.normalizedHasScratch &&
    (language.scratchDenied ||
      language.cleanContradiction ||
      (!language.structuralConfirmed && language.genericScratchOnly) ||
      (!language.structuralConfirmed && !language.confirmed.length && row.scratchIsPrimaryLimiter));

  row.appearsInInvestigation =
    card.psaGrade >= 7 &&
    card.psaGrade <= 9 &&
    (row.normalizedHasScratch ||
      row.scratchIsPrimaryLimiter ||
      row.scratchCapAudit.length > 0 ||
      row.outputMentionsScratch ||
      row.visionHadScratch ||
      row.replayHadScratch);

  return row;
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(resolveBenchmarkPath("manifest.json"), "utf8")
  );
  const cacheDir = resolveBenchmarkPath("cache");
  const snapDir = resolveBenchmarkPath("live-runs", "vision-snapshots");
  const allRows = [];
  const missing = [];

  for (const suite of manifest.suites.filter((s) => VINTAGE_SUITE_IDS.has(s.id))) {
    for (const card of suite.cards) {
      if (card.psaGrade < 7 || card.psaGrade > 9) continue;
      const row = gradeCard(card, cacheDir, snapDir);
      if (row) allRows.push(row);
      else missing.push(card.id);
    }
  }

  const investigationRows = allRows.filter((r) => r.appearsInInvestigation);
  investigationRows.sort((a, b) => a.gradeDifference - b.gradeDifference);

  const scratchLimiterMisses = investigationRows.filter((r) => r.gremlinScratchLimiter);
  const scratchBinding = investigationRows.filter((r) => r.scratchIsBinding);
  const falsePositives = investigationRows.filter((r) => r.likelyFalsePositiveScratch);
  const triadBinding = investigationRows.filter((r) => r.bindingRule === "vintage:triad_light_wear_notes");
  const scratchLimiterButTriad = scratchLimiterMisses.filter(
    (r) => r.bindingRule === "vintage:triad_light_wear_notes"
  );

  const byOrigin = {};
  for (const row of investigationRows) {
    byOrigin[row.origin] = (byOrigin[row.origin] || 0) + 1;
  }

  const byBinding = {};
  for (const row of investigationRows.filter((r) => !r.withinOne)) {
    byBinding[row.bindingRule] = (byBinding[row.bindingRule] || 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    fix: "Vintage Phase 1 Fix 3 — NM Scratch Skepticism (research only)",
    status: "research_in_progress",
    deferredFix2Note: "Fix 2 (moderate_crease) deferred — see benchmarks/vintage-fix2-deferred.md",
    totals: {
      psa7to9Graded: allRows.length,
      investigationCardCount: investigationRows.length,
      normalizedHasScratch: investigationRows.filter((r) => r.normalizedHasScratch).length,
      scratchPrimaryLimiter: investigationRows.filter((r) => r.scratchIsPrimaryLimiter).length,
      gremlinScratchLimiterMisses: scratchLimiterMisses.length,
      scratchBindingCount: scratchBinding.length,
      triadBindingOnMisses: triadBinding.length,
      scratchLimiterButTriadBinds: scratchLimiterButTriad.length,
      likelyFalsePositiveScratch: falsePositives.length,
      withinOne: investigationRows.filter((r) => r.withinOne).length,
    },
    byOrigin,
    byBindingOnMisses: byBinding,
    keyCodeFinding:
      "filterUnconfirmedSurfaceScratchDefects applies era==='modern' only; vintage retains unconfirmed surface_scratch_light tags that modern would strip.",
    minimumEvidenceGateRecommendation: {
      retainScratchWhen:
        "Structural scratch language (linear/hairline scratch, scratch crossing artwork, multi-angle visibility) OR high-confidence vision tag with explicit scratch in surface note AND no clean-surface contradiction.",
      demoteOrStripWhen:
        "PSA 7–9 NM presentation with clean/presents-well notes, scratch denial, print-line-only language, or generic 'light scratch' without structural evidence — mirror modern hasConfirmedSurfaceScratchEvidence on vintage-only path.",
      doNotStripWhen:
        "surface_scratch_moderate with continuous/deep scratch language; poor-band PSA 4–6 cards; confirmed multi-angle or crossing-artwork evidence.",
    },
    investigationRows,
    scratchLimiterMisses,
    falsePositives,
    missing,
  };

  const reportsDir = resolveBenchmarkPath("reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const outJson = path.join(reportsDir, "fix3-scratch-research-latest.json");
  fs.writeFileSync(outJson, `${JSON.stringify(summary, null, 2)}\n`);

  console.log("Fix 3 scratch research (PSA 7–9 vintage)");
  console.log(`  Graded PSA 7–9: ${allRows.length}`);
  console.log(`  Investigation cards: ${investigationRows.length}`);
  console.log(`  scratch primary limiter: ${summary.totals.scratchPrimaryLimiter}`);
  console.log(`  gremlin scratch_limiter (Δ≤-2): ${scratchLimiterMisses.length}`);
  console.log(`  scratch binds grade: ${scratchBinding.length}`);
  console.log(`  triad binds (not scratch): ${triadBinding.length} of misses`);
  console.log(`  likely false positive scratch: ${falsePositives.length}`);
  console.log(`  Wrote ${outJson}`);
}

main();
