import { analyzeCard } from "./analyze.js";
import { computeGrade } from "./engine.js";
import { resolveEra } from "./era.js";
import { formatGradeResponse } from "./response.js";

/**
 * @param {import("openai").default} client
 * @param {{
 *   frontImage: string,
 *   backImage: string,
 *   mode?: import("./types.js").GradingMode,
 *   eraRequest?: import("./types.js").EraRequest,
 * }} params
 */
export async function gradeCard(client, params) {
  const mode = params.mode === "pro" ? "pro" : "free";
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
    estimatedYear: eraResult.estimatedYear ?? analysis.cardMeta?.estimatedYear ?? null,
    mode,
  });
}

export { analyzeCard } from "./analyze.js";
export { computeGrade } from "./engine.js";
export { resolveEra } from "./era.js";
export { formatGradeResponse } from "./response.js";
export { DEFECT_REGISTRY, DEFECT_TAGS } from "./defects.js";
