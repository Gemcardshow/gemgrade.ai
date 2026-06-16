import test from "node:test";
import assert from "node:assert/strict";
import {
  getCreditsUsed,
  getScoutBuySignal,
  getScoutConfidence,
  getScoutPsaEstimate,
} from "./scoutPresentation.js";

const baseGrade = {
  psaGrade: 8,
  likelyRange: "PSA 7–9",
  scanQuality: { confidence: "high" },
  primaryLimiter: { tag: "corner_wear_light", label: "Light corner wear" },
};

test("getScoutPsaEstimate formats PSA grade and range", () => {
  assert.equal(getScoutPsaEstimate(baseGrade), "PSA 8 (PSA 7–9)");
});

test("getScoutConfidence reads scan quality confidence", () => {
  assert.equal(getScoutConfidence(baseGrade), "high");
  assert.equal(getScoutConfidence({}), "Unknown");
});

test("getScoutBuySignal returns Buy for PSA 8", () => {
  const signal = getScoutBuySignal(baseGrade);
  assert.equal(signal.label, "Buy");
  assert.equal(signal.tone, "positive");
});

test("getScoutBuySignal returns Strong Buy for gem candidates", () => {
  const signal = getScoutBuySignal({
    psaGrade: 10,
    scanQuality: { confidence: "high" },
    primaryLimiter: { tag: "none_visible", label: "None visible" },
  });
  assert.equal(signal.label, "Strong Buy");
});

test("getScoutBuySignal returns Pass for low grades", () => {
  const signal = getScoutBuySignal({
    psaGrade: 3,
    primaryLimiter: { tag: "moderate_crease", label: "Moderate crease" },
  });
  assert.equal(signal.label, "Pass");
  assert.equal(signal.tone, "negative");
});

test("getCreditsUsed prefers API credits payload", () => {
  assert.equal(getCreditsUsed({ credits: { deducted: 1 } }, "pro"), 1);
  assert.equal(getCreditsUsed(null, "scout"), 1);
  assert.equal(getCreditsUsed(null, "pro"), 2);
});
