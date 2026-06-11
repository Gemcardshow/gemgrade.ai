/**
 * Scratch-defect pipeline tracing (diagnostics only — does not alter grades).
 * Enable via GRADING_DIAGNOSTICS=1 or { scratchDiagnostics: true } on pipeline/analyze.
 */

const SCRATCH_CAP_SOURCE = /scratch/i;

/**
 * @param {{ scratchDiagnostics?: boolean, diagnostics?: boolean }} [options]
 */
export function isScratchDiagnosticsEnabled(options = {}) {
  if (options.scratchDiagnostics === true || options.diagnostics === true) {
    return true;
  }
  const env = process.env.GRADING_DIAGNOSTICS;
  return env === "1" || env === "true";
}

/**
 * @param {Record<string, unknown>} rawVision
 */
export function createScratchDiagnosticTrace(rawVision) {
  const defects = /** @type {Array<{ tag: string }>} */ (rawVision.defects || []);
  return {
    generatedAt: new Date().toISOString(),
    visionRaw: JSON.parse(JSON.stringify(rawVision)),
    visionDefectTags: defects.map((defect) => defect.tag),
    visionPrimaryLimiterTag: rawVision.primaryLimiterTag ?? null,
    visionPrimaryLimiterLabel: rawVision.primaryLimiterLabel ?? null,
    surfaceNoteBeforeReconciliation: rawVision.categoryNotes?.surface ?? null,
    surfaceNoteAfterReconciliation: null,
    stages: [],
    visionReconciliationAudit: [],
    capAuditScratch: [],
    finalDefectTags: [],
    finalPrimaryLimiterTag: null,
    finalPrimaryLimiterLabel: null,
    finalPsaGrade: null,
    finalInternalGrade: null,
    finalSurfaceScore: null,
    summary: null,
  };
}

/**
 * @param {ReturnType<typeof createScratchDiagnosticTrace>} trace
 * @param {string} stage
 * @param {{
 *   defects?: Array<{ tag: string }>,
 *   categoryNotes?: Record<string, string>,
 *   raw?: Record<string, unknown>,
 *   finalLimiter?: { primaryLimiterTag?: string|null, primaryLimiterLabel?: string|null },
 *   categoryScores?: { surface?: number },
 *   visionReconciliationAudit?: Array<Record<string, unknown>>,
 * }} snapshot
 */
export function recordScratchStage(trace, stage, snapshot = {}) {
  if (!trace) {
    return;
  }
  const defects = snapshot.defects || [];
  const categoryNotes = snapshot.categoryNotes || snapshot.raw?.categoryNotes || {};
  trace.stages.push({
    stage,
    surfaceNote: categoryNotes.surface ?? null,
    defectTags: defects.map((defect) => defect.tag),
    hasSurfaceScratchLight: defects.some((defect) => defect.tag === "surface_scratch_light"),
    primaryLimiterTag:
      snapshot.finalLimiter?.primaryLimiterTag ??
      snapshot.raw?.primaryLimiterTag ??
      null,
    primaryLimiterLabel:
      snapshot.finalLimiter?.primaryLimiterLabel ??
      snapshot.raw?.primaryLimiterLabel ??
      null,
    surfaceScore: snapshot.categoryScores?.surface ?? null,
    reconcileAuditAdded: snapshot.visionReconciliationAudit?.length
      ? snapshot.visionReconciliationAudit.slice(-3)
      : undefined,
  });
}

/**
 * @param {Array<{ source?: string, cap?: number, value?: number }>} capAudit
 */
export function extractScratchCapAudit(capAudit) {
  return (capAudit || []).filter((entry) => SCRATCH_CAP_SOURCE.test(String(entry.source || "")));
}

/**
 * @param {ReturnType<typeof createScratchDiagnosticTrace>} trace
 */
function buildScratchSummary(trace) {
  const visionHadScratch = trace.visionDefectTags.includes("surface_scratch_light");
  const visionLimiterScratch =
    trace.visionPrimaryLimiterTag === "surface_scratch_light" ||
    SCRATCH_CAP_SOURCE.test(String(trace.visionPrimaryLimiterLabel || ""));

  const finalHasScratch = trace.finalDefectTags.includes("surface_scratch_light");
  const finalLimiterScratch = trace.finalPrimaryLimiterTag === "surface_scratch_light";

  let firstScratchStage = null;
  let lastScratchStage = null;
  for (const stage of trace.stages) {
    if (stage.hasSurfaceScratchLight) {
      if (!firstScratchStage) {
        firstScratchStage = stage.stage;
      }
      lastScratchStage = stage.stage;
    }
  }

  let origin = "none";
  if (visionHadScratch || visionLimiterScratch) {
    origin = finalHasScratch || finalLimiterScratch
      ? "vision_retained_to_final"
      : "vision_stripped_by_reconciliation";
  } else if (finalHasScratch || finalLimiterScratch) {
    origin = firstScratchStage
      ? `downstream_introduced_at_${firstScratchStage}`
      : "downstream_introduced_unknown_stage";
  }

  const capScratchEntries = trace.capAuditScratch.length;
  let capDriver = null;
  if (capScratchEntries > 0) {
    capDriver = trace.capAuditScratch.map((entry) => entry.source).join(", ");
  }

  return {
    origin,
    visionHadSurfaceScratchLight: visionHadScratch,
    visionPrimaryLimiterWasScratch: visionLimiterScratch,
    finalHasSurfaceScratchLight: finalHasScratch,
    finalPrimaryLimiterIsScratch: finalLimiterScratch,
    firstStageWithSurfaceScratchLight: firstScratchStage,
    lastStageWithSurfaceScratchLight: lastScratchStage,
    capAuditScratchSources: capDriver,
    hypothesis:
      origin === "vision_retained_to_final"
        ? "Vision model returned scratch tag/limiter and reconciliation did not remove it."
        : origin.startsWith("vision_stripped")
          ? "Vision returned scratch but reconciliation removed it before grade."
          : origin.startsWith("downstream_introduced")
            ? "Scratch tag was synthesized after vision (ensurePrimaryLimiter, infer, or cap path)."
            : finalLimiterScratch && !finalHasScratch
              ? "Limiter references scratch without defect tag — check primaryLimiter synthesis."
              : "No surface_scratch_light detected in trace.",
  };
}

/**
 * @param {ReturnType<typeof createScratchDiagnosticTrace>} trace
 * @param {import("./types.js").VisionAnalysis} analysis
 * @param {import("./types.js").GradeResult} [gradeResult]
 */
export function finalizeScratchDiagnosticTrace(trace, analysis, gradeResult) {
  if (!trace) {
    return null;
  }

  trace.surfaceNoteAfterReconciliation = analysis.categoryNotes?.surface ?? null;
  trace.finalDefectTags = (analysis.defects || []).map((defect) => defect.tag);
  trace.finalPrimaryLimiterTag = analysis.primaryLimiterTag ?? null;
  trace.finalPrimaryLimiterLabel = analysis.primaryLimiterLabel ?? null;
  trace.visionReconciliationAudit = analysis.visionReconciliationAudit || [];

  if (gradeResult) {
    trace.capAuditScratch = extractScratchCapAudit(gradeResult.capAudit);
    trace.finalPsaGrade = gradeResult.psaGrade;
    trace.finalInternalGrade = gradeResult.internalGrade;
    trace.finalSurfaceScore = gradeResult.categoryScores?.surface ?? null;
  }

  trace.summary = buildScratchSummary(trace);
  return trace;
}

/**
 * @param {ReturnType<typeof createScratchDiagnosticTrace>} trace
 */
export function logScratchDiagnostics(trace) {
  if (!trace) {
    return;
  }
  console.log("[scratch-diagnostics]", JSON.stringify(trace, null, 2));
}
