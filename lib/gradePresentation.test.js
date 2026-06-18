import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGemGradeHeader,
  formatLikelyRangeDisplay,
  formatScoutGradeEstimate,
  GEMGRADE_DISCLAIMER,
} from "./gradePresentation.js";

test("formatGemGradeHeader uses GemGrade branding", () => {
  assert.equal(formatGemGradeHeader(9), "GemGrade 9");
  assert.equal(formatGemGradeHeader(null), "GemGrade —");
});

test("formatLikelyRangeDisplay renames PSA ranges", () => {
  assert.equal(
    formatLikelyRangeDisplay("PSA 7-8"),
    "Estimated Grade Range: 7-8",
  );
  assert.equal(
    formatLikelyRangeDisplay("PSA 7–9"),
    "Estimated Grade Range: 7-9",
  );
});

test("formatLikelyRangeDisplay renames single PSA values", () => {
  assert.equal(formatLikelyRangeDisplay("PSA 8"), "Estimated Grade: 8");
});

test("formatScoutGradeEstimate combines GemGrade header and range label", () => {
  assert.equal(
    formatScoutGradeEstimate({ psaGrade: 8, likelyRange: "PSA 7–9" }),
    "GemGrade 8 (Estimated Grade Range: 7-9)",
  );
});

test("GEMGRADE_DISCLAIMER is present", () => {
  assert.match(GEMGRADE_DISCLAIMER, /not affiliated with or endorsed by PSA/i);
});
