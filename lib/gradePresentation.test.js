import test from "node:test";
import assert from "node:assert/strict";
import {
  formatGemGradeHeader,
  formatLikelyRangeDisplay,
  formatScoutGradeEstimate,
  formatVerdictDisplay,
  parseLikelyRangeBounds,
  GEMGRADE_DISCLAIMER,
} from "./gradePresentation.js";

test("formatGemGradeHeader uses GemGrade branding", () => {
  assert.equal(formatGemGradeHeader(9), "GemGrade 9");
  assert.equal(formatGemGradeHeader(null), "GemGrade —");
});

test("parseLikelyRangeBounds reads PSA range strings", () => {
  assert.deepEqual(parseLikelyRangeBounds("PSA 8–9"), { low: "8", high: "9" });
  assert.deepEqual(parseLikelyRangeBounds("PSA 8"), { low: "8", high: "8" });
});

test("formatLikelyRangeDisplay uses confidence range labels", () => {
  assert.equal(
    formatLikelyRangeDisplay("PSA 7-8"),
    "Confidence range: 7–8",
  );
  assert.equal(
    formatLikelyRangeDisplay("PSA 7–9"),
    "Confidence range: 7–9",
  );
});

test("formatLikelyRangeDisplay handles single PSA values", () => {
  assert.equal(formatLikelyRangeDisplay("PSA 8"), "Confidence range: around 8");
});

test("formatScoutGradeEstimate combines GemGrade header and confidence range", () => {
  assert.equal(
    formatScoutGradeEstimate({ psaGrade: 8, likelyRange: "PSA 7–9" }),
    "GemGrade 8 (Confidence range: 7–9)",
  );
});

test("formatVerdictDisplay removes duplicate headline grades and reframes range", () => {
  const verdict = `## Overall Grade: 9 / 10
Internal Grade: 9.2

### Category Scores
- Corners: 9

### Likely Grade Range
PSA 8–9

## Professional Verdict
Projected PSA 9 based on visible condition. The primary limiter is centering.

### Likely Grade Range
PSA 7–8`;

  const display = formatVerdictDisplay(verdict, { headlineGrade: 9 });

  assert.match(display, /Supports the GemGrade 9 estimate shown above/);
  assert.doesNotMatch(display, /Overall Grade: 9 \/ 10/);
  assert.match(
    display,
    /Visible condition suggests the grade could fall between 8 and 9/,
  );
  assert.match(display, /This card aligns with a GemGrade 9 read/);
  assert.match(display, /## Condition Notes/);
  assert.doesNotMatch(display, /Projected PSA/);
});

test("GEMGRADE_DISCLAIMER is present", () => {
  assert.match(
    GEMGRADE_DISCLAIMER,
    /independent AI pre-grade estimation platform/i,
  );
});
