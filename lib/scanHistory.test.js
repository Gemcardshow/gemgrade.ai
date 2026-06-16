import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResultSnapshot,
  buildScanInsertRecord,
  formatScanDate,
  formatScanModeLabel,
  isMissingColumnInsertError,
  mapScanDetail,
  mapScanListItem,
  toLegacyScanInsertRecord,
} from "./scanHistory.js";

const GRADE_RESULT = {
  psaGrade: 8,
  internalGrade: 7.5,
  era: "vintage",
  eraSource: "auto",
  likelyRange: "PSA 7–8",
  verdict: "Strong vintage candidate.",
  categoryScores: { corners: 8, edges: 7, surface: 8, centering: 7 },
  primaryLimiter: { tag: "edge_wear", label: "Edge wear" },
  scanQuality: { confidence: "high", level: "good", ceilingApplied: 9 },
};

test("buildScanInsertRecord includes history metadata", () => {
  const record = buildScanInsertRecord({
    userId: "user-1",
    email: "test@example.com",
    mode: "scout",
    creditsUsed: 1,
    gradeResult: GRADE_RESULT,
    frontImage: "front-data",
    backImage: "back-data",
  });

  assert.equal(record.user_id, "user-1");
  assert.equal(record.mode, "scout");
  assert.equal(record.credits_used, 1);
  assert.equal(record.grade, 8);
  assert.equal(record.era, "vintage");
  assert.equal(record.confidence, "high");
  assert.equal(record.result_snapshot.psaGrade, 8);
});

test("toLegacyScanInsertRecord keeps legacy insert shape", () => {
  const legacy = toLegacyScanInsertRecord({
    email: "test@example.com",
    grade: 8,
    verdict: "Test",
    front_image: "front",
    back_image: "back",
    user_id: "user-1",
    mode: "pro",
  });

  assert.deepEqual(legacy, {
    email: "test@example.com",
    grade: 8,
    verdict: "Test",
    front_image: "front",
    back_image: "back",
  });
});

test("isMissingColumnInsertError detects schema mismatch", () => {
  assert.equal(
    isMissingColumnInsertError({ code: "42703", message: "column user_id does not exist" }),
    true,
  );
  assert.equal(
    isMissingColumnInsertError({ code: "23505", message: "duplicate key" }),
    false,
  );
});

test("mapScanListItem and mapScanDetail shape API payloads", () => {
  const row = {
    id: "scan-1",
    created_at: "2026-06-10T12:00:00.000Z",
    mode: "pro",
    grade: 9,
    confidence: "medium",
    credits_used: 2,
    era: "modern",
    verdict: "Clean modern card with minor centering variance.",
    result_snapshot: buildResultSnapshot(GRADE_RESULT),
  };

  const listItem = mapScanListItem(row);
  assert.equal(listItem.mode, "pro");
  assert.equal(listItem.creditsUsed, 2);
  assert.match(listItem.verdictPreview, /Clean modern/);

  const detail = mapScanDetail(row);
  assert.equal(detail.result.psaGrade, 8);
  assert.equal(detail.result.credits.deducted, 2);
});

test("format helpers render mode and date labels", () => {
  assert.equal(formatScanModeLabel("scout"), "Scout");
  assert.equal(formatScanModeLabel("pro"), "Pro");
  assert.match(formatScanDate("2026-06-10T12:00:00.000Z"), /2026/);
});
