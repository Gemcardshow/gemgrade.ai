import { analyzeCard } from "./analyze.js";
import { computeGrade } from "./engine.js";
import { resolveEra } from "./era.js";
import { formatGradeResponse } from "./response.js";
import {
  finalizeScratchDiagnosticTrace,
  isScratchDiagnosticsEnabled,
  logScratchDiagnostics,
} from "./scratch-diagnostics.js";

/**
 * Single grading pipeline for all users. Monetization (scan limits, credits)
 * is enforced outside this module — not via alternate prompts or caps.
 *
 * @param {import("openai").default} client
 * @param {{
 *   frontImage: string,
 *   backImage: string,
 *   eraRequest?: import("./types.js").EraRequest,
 *   scratchDiagnostics?: boolean,
 *   diagnostics?: boolean,
 * }} params
 * @returns {Promise<import("./types.js").GradeResponse>}
 */
export async function runGradingPipeline(client, params) {
  const diagnosticsEnabled = isScratchDiagnosticsEnabled(params);

  const eraResult = await resolveEra(client, {
    frontImage: params.frontImage,
    backImage: params.backImage,
    eraRequest: params.eraRequest || "auto",
  });

  const analyzed = await analyzeCard(
    client,
    {
      frontImage: params.frontImage,
      backImage: params.backImage,
      era: eraResult.era,
    },
    { scratchDiagnostics: diagnosticsEnabled }
  );

  const analysis = analyzed.analysis ?? analyzed;
  const rawVision = analyzed.rawVision ?? null;
  const scratchDiagnostics = analyzed.scratchDiagnostics ?? null;

  const gradeResult = computeGrade(analysis, eraResult.era);

  if (scratchDiagnostics) {
    finalizeScratchDiagnosticTrace(scratchDiagnostics, analysis, gradeResult);
    logScratchDiagnostics(scratchDiagnostics);
  }

  const response = formatGradeResponse({
    gradeResult,
    analysis,
    eraSource: eraResult.eraSource,
    estimatedYear:
      eraResult.estimatedYear ?? analysis.cardMeta?.estimatedYear ?? null,
  });

  if (diagnosticsEnabled) {
    return {
      ...response,
      scratchDiagnostics,
      rawVision,
    };
  }

  return response;
}
