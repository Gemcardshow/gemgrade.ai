import { detectEraFromImages } from "./analyze.js";

const VINTAGE_YEAR_CUTOFF = 1990;

export function normalizeEraRequest(era) {
  if (era === "vintage" || era === "modern" || era === "auto") {
    return era;
  }
  return "auto";
}

export function eraFromYear(year) {
  if (typeof year !== "number" || Number.isNaN(year)) return null;
  return year < VINTAGE_YEAR_CUTOFF ? "vintage" : "modern";
}

/**
 * @param {import("openai").default} client
 * @param {{ frontImage: string, backImage: string, eraRequest?: import("./types.js").EraRequest }} params
 */
export async function resolveEra(client, { frontImage, backImage, eraRequest = "auto" }) {
  const normalizedRequest = normalizeEraRequest(eraRequest);

  if (normalizedRequest === "vintage") {
    return {
      era: "vintage",
      eraSource: "override",
      estimatedYear: null,
      confidence: "high",
      signals: ["Request override: vintage"],
    };
  }

  if (normalizedRequest === "modern") {
    return {
      era: "modern",
      eraSource: "override",
      estimatedYear: null,
      confidence: "high",
      signals: ["Request override: modern"],
    };
  }

  const detection = await detectEraFromImages(client, { frontImage, backImage });
  const inferredEra = eraFromYear(detection.estimatedYear);

  if (inferredEra && detection.confidence !== "low") {
    return {
      era: inferredEra,
      eraSource: "auto",
      estimatedYear: detection.estimatedYear,
      confidence: detection.confidence,
      signals: detection.signals || [],
    };
  }

  if (inferredEra && detection.confidence === "low") {
    return {
      era: "vintage",
      eraSource: "fallback",
      estimatedYear: detection.estimatedYear,
      confidence: "low",
      signals: [
        ...(detection.signals || []),
        "Low-confidence era detection defaulted to vintage path",
      ],
    };
  }

  return {
    era: "vintage",
    eraSource: "fallback",
    estimatedYear: detection.estimatedYear ?? null,
    confidence: detection.confidence || "low",
    signals: [
      ...(detection.signals || []),
      "Unable to determine year; defaulted to vintage path",
    ],
  };
}

export { VINTAGE_YEAR_CUTOFF };
