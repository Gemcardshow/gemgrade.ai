import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResultSnapshot,
  buildScanInsertRecord,
  buildScanInsertAttempts,
  fetchUserScanById,
  fetchUserScanHistory,
  formatHistoryListConfidence,
  formatHistoryListCredits,
  formatHistoryListEra,
  formatScanDate,
  formatScanModeLabel,
  inferHistoryScanMode,
  insertScanRecord,
  isMissingColumnInsertError,
  mapScanDetail,
  mapScanListItem,
  normalizeHistoryGradeResult,
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

test("mapScanListItem reads metadata from result_snapshot when columns are missing", () => {
  const listItem = mapScanListItem({
    id: "legacy-1",
    created_at: "2026-06-10T12:00:00.000Z",
    grade: 8,
    verdict: "Legacy row",
    result_snapshot: {
      ...buildResultSnapshot(GRADE_RESULT),
      scout: { frontOnlyApproximation: true },
    },
  });

  assert.equal(listItem.mode, "scout");
  assert.equal(listItem.confidence, "high");
  assert.equal(listItem.creditsUsed, 1);
  assert.equal(listItem.era, "vintage");
});

test("mapScanListItem leaves credits null for unknown legacy rows", () => {
  const listItem = mapScanListItem({
    id: "legacy-2",
    created_at: "2026-06-10T12:00:00.000Z",
    grade: 7,
    verdict: "Minimal legacy row",
    result_snapshot: {},
  });

  assert.equal(listItem.mode, "pro");
  assert.equal(listItem.creditsUsed, null);
  assert.equal(formatHistoryListCredits(listItem), "—");
});

test("normalizeHistoryGradeResult provides safe defaults for sparse snapshots", () => {
  const safeGrade = normalizeHistoryGradeResult({
    mode: "pro",
    grade: 7,
    creditsUsed: null,
    confidence: null,
    era: null,
    verdict: "Saved verdict",
    result: {},
  });

  assert.equal(safeGrade.psaGrade, 7);
  assert.deepEqual(safeGrade.categoryScores, {});
  assert.equal(safeGrade.primaryLimiter.label, "Not available");
  assert.equal(safeGrade.scanQuality.level, "unknown");
  assert.deepEqual(safeGrade.capAudit, []);
  assert.equal(safeGrade.verdict, "Saved verdict");
});

test("formatHistoryListConfidence and era use enriched values", () => {
  const scan = {
    mode: "scout",
    confidence: "medium",
    creditsUsed: 1,
    era: "modern",
  };

  assert.equal(formatHistoryListConfidence(scan), "medium");
  assert.equal(formatHistoryListEra(scan), "modern");
});

test("inferHistoryScanMode detects scout from snapshot metadata", () => {
  assert.equal(
    inferHistoryScanMode(
      { credits_used: null },
      { scout: { frontOnlyApproximation: true } },
    ),
    "scout",
  );
});

test("format helpers render mode and date labels", () => {
  assert.equal(formatScanModeLabel("scout"), "Scout");
  assert.equal(formatScanModeLabel("pro"), "Pro");
  assert.match(formatScanDate("2026-06-10T12:00:00.000Z"), /2026/);
});

function createHistoryQueryMock(rows, options = {}) {
  const calls = {
    select: null,
    userId: null,
    email: null,
    limit: null,
    scanId: null,
    queryCount: 0,
  };
  const failUserIdColumn =
    options.failUserIdColumn === true
      ? { code: "42703", message: "column scans.user_id does not exist" }
      : null;

  const chain = {
    select(columns) {
      calls.select = columns;
      return chain;
    },
    eq(column, value) {
      if (column === "user_id") calls.userId = value;
      if (column === "email") calls.email = value;
      if (column === "id") calls.scanId = value;
      return chain;
    },
    order(_column, _options) {
      return chain;
    },
    limit(value) {
      calls.limit = value;
      calls.queryCount += 1;
      if (failUserIdColumn && calls.queryCount === 1) {
        return Promise.resolve({ data: null, error: failUserIdColumn });
      }
      return Promise.resolve({ data: rows, error: null });
    },
    maybeSingle() {
      calls.queryCount += 1;
      if (failUserIdColumn && calls.queryCount === 1) {
        return Promise.resolve({ data: null, error: failUserIdColumn });
      }
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
  };

  return {
    calls,
    supabase: {
      from(table) {
        assert.equal(table, "scans");
        return chain;
      },
    },
  };
}

test("fetchUserScanHistory uses select * and filters by user_id", async () => {
  const row = {
    id: "scan-1",
    created_at: "2026-06-10T12:00:00.000Z",
    mode: "scout",
    grade: 8,
    confidence: "high",
    credits_used: 1,
    era: "vintage",
    verdict: "Test verdict",
  };
  const { supabase, calls } = createHistoryQueryMock([row]);

  const scans = await fetchUserScanHistory(
    supabase,
    { userId: "user-1", email: "test@example.com" },
    { limit: 10 },
  );

  assert.equal(calls.select, "*");
  assert.equal(calls.userId, "user-1");
  assert.equal(calls.limit, 10);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].mode, "scout");
});

test("fetchUserScanHistory falls back to email when user_id column is missing", async () => {
  const row = {
    id: "scan-legacy",
    created_at: "2026-06-10T12:00:00.000Z",
    grade: 8,
    verdict: "Legacy scan",
  };
  const { supabase, calls } = createHistoryQueryMock([row], {
    failUserIdColumn: true,
  });

  const scans = await fetchUserScanHistory(
    supabase,
    { userId: "user-1", email: "test@example.com" },
    { limit: 5 },
  );

  assert.equal(calls.queryCount, 2);
  assert.equal(calls.email, "test@example.com");
  assert.equal(scans.length, 1);
});

test("fetchUserScanById uses select * and filters by user_id", async () => {
  const row = {
    id: "scan-2",
    created_at: "2026-06-10T13:00:00.000Z",
    mode: "pro",
    grade: 7,
    confidence: "high",
    credits_used: 2,
    era: "vintage",
    verdict: "Pro verdict",
    result_snapshot: buildResultSnapshot(GRADE_RESULT),
  };
  const { supabase, calls } = createHistoryQueryMock([row]);

  const scan = await fetchUserScanById(
    supabase,
    { userId: "user-1", email: "test@example.com" },
    "scan-2",
  );

  assert.equal(calls.select, "*");
  assert.equal(scan?.mode, "pro");
  assert.equal(scan?.creditsUsed, 2);
});

test("insertScanRecord retries without user_id before legacy fallback", async () => {
  let attempt = 0;
  const supabase = {
    from() {
      return {
        insert(payload) {
          attempt += 1;
          return {
            select() {
              return {
                async single() {
                  if (attempt === 1) {
                    return {
                      data: null,
                      error: {
                        code: "42703",
                        message: "column scans.user_id does not exist",
                      },
                    };
                  }

                  assert.equal(payload[0].mode, "scout");
                  assert.equal(payload[0].user_id, undefined);
                  return { data: { id: "scan-partial" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  const record = buildScanInsertRecord({
    userId: "user-1",
    email: "test@example.com",
    mode: "scout",
    creditsUsed: 1,
    gradeResult: GRADE_RESULT,
    frontImage: "front",
    backImage: "back",
  });

  const result = await insertScanRecord(supabase, record);

  assert.equal(attempt, 2);
  assert.equal(result.id, "scan-partial");
});

test("buildScanInsertAttempts includes metadata-only payload", () => {
  const record = buildScanInsertRecord({
    userId: "user-1",
    email: "test@example.com",
    mode: "scout",
    creditsUsed: 1,
    gradeResult: GRADE_RESULT,
    frontImage: "front",
    backImage: "back",
  });

  const attempts = buildScanInsertAttempts(record);

  assert.ok(attempts.length >= 2);
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.mode === "scout" &&
        attempt.credits_used === 1 &&
        attempt.result_snapshot,
    ),
  );
  assert.ok(attempts.some((attempt) => !("user_id" in attempt)));
});

test("buildResultSnapshot marks scout mode in snapshot", () => {
  const snapshot = buildResultSnapshot(GRADE_RESULT, { mode: "scout" });
  assert.equal(snapshot.scout?.historyMode, "scout");
});
