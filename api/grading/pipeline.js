import { analyzeCard } from "./analyze.js";
import { computeGrade } from "./engine.js";
import { resolveEra } from "./era.js";
import { formatGradeResponse } from "./response.js";

/**
 * Single grading pipeline for all users. Monetization (scan limits, credits)
 * is enforced outside this module — not via alternate prompts or caps.
 *
 * @param {import("openai").default} client
 * @param {{
 *   frontImage: string,
 *   backImage: string,
 *   eraRequest?: import("./types.js").EraRequest,
 * }} params
 * @returns {Promise<import("./types.js").GradeResponse>}
 */
export async function runGradingPipeline(client, params) {
  const eraResult = await resolveEra(client, {
    frontImage: params.frontImage,
    backImage: params.backImage,
    eraRequest: params.eraRequest || "auto",
  });

  const analysis = await analyzeCard(client, {
    frontImage: params.frontImage,
    backImage: params.backImage,
    era: eraResult.era,
  });

  const gradeResult = computeGrade(analysis, eraResult.era);

  return formatGradeResponse({
    gradeResult,
    analysis,
    eraSource: eraResult.eraSource,
    estimatedYear:
      eraResult.estimatedYear ?? analysis.cardMeta?.estimatedYear ?? null,
  });
}
