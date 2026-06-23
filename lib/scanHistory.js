import { getScanCreditCost, normalizeScanMode } from "./scanCredits.js";

// scans.mode conflicts with PostgREST MODE() aggregate — use * and map fields.
const HISTORY_LIST_COLUMNS = "*";

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMissingColumnInsertError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  return (
    code === "42703" ||
    code === "PGRST204" ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

/**
 * @param {Record<string, unknown>} record
 * @returns {Record<string, unknown>}
 */
export function toLegacyScanInsertRecord(record) {
  return {
    email: record.email ?? null,
    grade: record.grade,
    verdict: record.verdict,
    front_image: record.front_image,
    back_image: record.back_image,
  };
}

/**
 * @param {Record<string, unknown>} gradeResult
 * @returns {Record<string, unknown>}
 */
export function buildResultSnapshot(gradeResult) {
  return {
    psaGrade: gradeResult.psaGrade ?? null,
    internalGrade: gradeResult.internalGrade ?? null,
    era: gradeResult.era ?? null,
    eraSource: gradeResult.eraSource ?? null,
    estimatedYear: gradeResult.estimatedYear ?? null,
    likelyRange: gradeResult.likelyRange ?? null,
    categoryScores: gradeResult.categoryScores ?? null,
    primaryLimiter: gradeResult.primaryLimiter ?? null,
    bestAttribute: gradeResult.bestAttribute ?? null,
    eyeAppealSummary: gradeResult.eyeAppealSummary ?? null,
    defects: gradeResult.defects ?? [],
    categoryNotes: gradeResult.categoryNotes ?? {},
    scanQuality: gradeResult.scanQuality ?? null,
    capAudit: gradeResult.capAudit ?? [],
    verdict: gradeResult.verdict ?? null,
    cardMeta: gradeResult.cardMeta ?? null,
    scout: gradeResult.scout ?? null,
  };
}

/**
 * @param {{
 *   userId?: string | null,
 *   email?: string | null,
 *   mode?: string,
 *   creditsUsed?: number,
 *   gradeResult: Record<string, unknown>,
 *   frontImage: string,
 *   backImage: string,
 * }} params
 * @returns {Record<string, unknown>}
 */
export function buildScanInsertRecord({
  userId = null,
  email = null,
  mode,
  creditsUsed,
  gradeResult,
  frontImage,
  backImage,
}) {
  const normalizedMode = normalizeScanMode(mode);

  return {
    email: email ?? null,
    user_id: userId ?? null,
    grade: gradeResult.psaGrade,
    verdict: gradeResult.verdict,
    front_image: frontImage,
    back_image: backImage,
    mode: normalizedMode,
    credits_used: creditsUsed ?? null,
    era: gradeResult.era ?? null,
    confidence: gradeResult.scanQuality?.confidence ?? null,
    result_snapshot: buildResultSnapshot(gradeResult),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function readResultSnapshot(row) {
  return row.result_snapshot && typeof row.result_snapshot === "object"
    ? row.result_snapshot
    : {};
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readNumericField(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} snapshot
 * @returns {"scout"|"pro"}
 */
export function inferHistoryScanMode(row, snapshot = readResultSnapshot(row)) {
  if (row.mode === "scout" || row.mode === "pro") {
    return normalizeScanMode(row.mode);
  }

  if (snapshot.scout && typeof snapshot.scout === "object") {
    return "scout";
  }

  const creditsUsed = readNumericField(row.credits_used);
  if (creditsUsed === 1) {
    return "scout";
  }

  if (creditsUsed === 2) {
    return "pro";
  }

  return "pro";
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} snapshot
 * @param {"scout"|"pro"} mode
 * @returns {number | null}
 */
export function readHistoryCreditsUsed(row, snapshot, mode) {
  const fromRow = readNumericField(row.credits_used);
  if (fromRow !== null) {
    return fromRow;
  }

  const fromSnapshot = readNumericField(snapshot?.credits?.deducted);
  if (fromSnapshot !== null) {
    return fromSnapshot;
  }

  if (isHistoryModeExplicit(row, snapshot)) {
    return getScanCreditCost(mode);
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} [snapshot]
 * @returns {boolean}
 */
export function isHistoryModeExplicit(row, snapshot = readResultSnapshot(row)) {
  if (row.mode === "scout" || row.mode === "pro") {
    return true;
  }

  if (snapshot.scout && typeof snapshot.scout === "object") {
    return true;
  }

  const creditsUsed = readNumericField(row.credits_used);
  return creditsUsed === 1 || creditsUsed === 2;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} snapshot
 * @returns {string | null}
 */
export function readHistoryConfidence(row, snapshot) {
  if (typeof row.confidence === "string" && row.confidence.trim()) {
    return row.confidence.trim();
  }

  const fromSnapshot = snapshot.scanQuality?.confidence;
  if (typeof fromSnapshot === "string" && fromSnapshot.trim()) {
    return fromSnapshot.trim();
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} snapshot
 * @returns {string | null}
 */
export function readHistoryEra(row, snapshot) {
  if (typeof row.era === "string" && row.era.trim()) {
    return row.era.trim();
  }

  if (typeof snapshot.era === "string" && snapshot.era.trim()) {
    return snapshot.era.trim();
  }

  return null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} snapshot
 * @returns {number | null}
 */
function readHistoryGrade(row, snapshot) {
  const fromRow = readNumericField(row.grade);
  if (fromRow !== null) {
    return fromRow;
  }

  return readNumericField(snapshot.psaGrade);
}

/**
 * @param {{
 *   mode: "scout"|"pro",
 *   grade: number | null,
 *   confidence: string | null,
 *   creditsUsed: number | null,
 *   era: string | null,
 *   verdict?: string | null,
 *   result?: Record<string, unknown>,
 * }} detail
 * @returns {Record<string, unknown>}
 */
export function normalizeHistoryGradeResult(detail) {
  const result =
    detail.result && typeof detail.result === "object" ? detail.result : {};
  const mode = normalizeScanMode(detail.mode);
  const psaGrade =
    readNumericField(result.psaGrade) ?? readNumericField(detail.grade);
  const primaryLimiter =
    result.primaryLimiter && typeof result.primaryLimiter === "object"
      ? result.primaryLimiter
      : null;
  const scanQuality =
    result.scanQuality && typeof result.scanQuality === "object"
      ? result.scanQuality
      : null;

  return {
    ...result,
    psaGrade,
    internalGrade: readNumericField(result.internalGrade) ?? psaGrade,
    likelyRange:
      typeof result.likelyRange === "string" ? result.likelyRange : null,
    era: detail.era ?? (typeof result.era === "string" ? result.era : null),
    eraSource:
      typeof result.eraSource === "string" ? result.eraSource : "unknown",
    categoryScores:
      result.categoryScores && typeof result.categoryScores === "object"
        ? result.categoryScores
        : {},
    primaryLimiter: {
      tag:
        typeof primaryLimiter?.tag === "string"
          ? primaryLimiter.tag
          : "unknown",
      label:
        typeof primaryLimiter?.label === "string"
          ? primaryLimiter.label
          : "Not available",
    },
    scanQuality: {
      level: typeof scanQuality?.level === "string" ? scanQuality.level : "unknown",
      confidence:
        typeof scanQuality?.confidence === "string"
          ? scanQuality.confidence
          : detail.confidence ?? "unknown",
      ceilingApplied: readNumericField(scanQuality?.ceilingApplied),
    },
    categoryNotes:
      result.categoryNotes && typeof result.categoryNotes === "object"
        ? result.categoryNotes
        : {},
    capAudit: Array.isArray(result.capAudit) ? result.capAudit : [],
    defects: Array.isArray(result.defects) ? result.defects : [],
    verdict:
      typeof result.verdict === "string"
        ? result.verdict
        : detail.verdict ?? null,
    scout:
      result.scout && typeof result.scout === "object" ? result.scout : null,
    credits: {
      deducted: detail.creditsUsed ?? getScanCreditCost(mode),
      mode,
    },
  };
}

/**
 * @param {{
 *   mode: "scout"|"pro",
 *   confidence?: string | null,
 *   creditsUsed?: number | null,
 *   era?: string | null,
 * }} scan
 * @returns {string}
 */
export function formatHistoryListConfidence(scan) {
  const confidence =
    typeof scan.confidence === "string" ? scan.confidence.trim() : "";
  return confidence || "—";
}

/**
 * @param {{ creditsUsed?: number | null }} scan
 * @returns {string}
 */
export function formatHistoryListCredits(scan) {
  return typeof scan.creditsUsed === "number" ? String(scan.creditsUsed) : "—";
}

/**
 * @param {{ era?: string | null }} scan
 * @returns {string}
 */
export function formatHistoryListEra(scan) {
  return typeof scan.era === "string" && scan.era.trim() ? scan.era : "—";
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function mapScanListItem(row) {
  const snapshot = readResultSnapshot(row);
  const mode = inferHistoryScanMode(row, snapshot);
  const creditsUsed = readHistoryCreditsUsed(row, snapshot, mode);
  const grade = readHistoryGrade(row, snapshot);

  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    mode,
    grade: grade ?? null,
    confidence: readHistoryConfidence(row, snapshot),
    creditsUsed,
    era: readHistoryEra(row, snapshot),
    verdictPreview: row.verdict ? String(row.verdict).slice(0, 160) : null,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function mapScanDetail(row) {
  const listItem = mapScanListItem(row);
  const snapshot = readResultSnapshot(row);

  return {
    ...listItem,
    verdict: row.verdict ? String(row.verdict) : listItem.verdictPreview,
    result: {
      ...snapshot,
      psaGrade: readNumericField(snapshot.psaGrade) ?? listItem.grade,
      credits: {
        deducted: listItem.creditsUsed,
        mode: listItem.mode,
      },
    },
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} record
 * @returns {Promise<{ id: string | null, error: import("@supabase/supabase-js").PostgrestError | null }>}
 */
export async function insertScanRecord(supabase, record) {
  let { data, error } = await supabase
    .from("scans")
    .insert([record])
    .select("id")
    .single();

  if (error && isMissingColumnInsertError(error) && record.user_id != null) {
    const withoutUserId = { ...record };
    delete withoutUserId.user_id;

    ({ data, error } = await supabase
      .from("scans")
      .insert([withoutUserId])
      .select("id")
      .single());
  }

  if (error && isMissingColumnInsertError(error)) {
    ({ data, error } = await supabase
      .from("scans")
      .insert([toLegacyScanInsertRecord(record)])
      .select("id")
      .single());
  }

  return {
    id: data?.id ? String(data.id) : null,
    error,
  };
}

/**
 * @param {string | { userId?: string | null, email?: string | null }} userFilter
 * @returns {{ userId: string | null, email: string | null }}
 */
function normalizeUserFilter(userFilter) {
  if (typeof userFilter === "string") {
    return { userId: userFilter, email: null };
  }

  return {
    userId: userFilter.userId ?? null,
    email: userFilter.email ?? null,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ userId: string | null, email: string | null }} filter
 * @param {{ limit?: number, scanId?: string }} options
 */
async function queryUserScans(supabase, filter, options = {}) {
  const limit = options.limit ?? 50;
  const scanId = options.scanId ?? null;

  const runQuery = (ownerColumn, ownerValue) => {
    let query = supabase.from("scans").select(HISTORY_LIST_COLUMNS);

    if (scanId) {
      query = query.eq("id", scanId);
    }

    query = query.eq(ownerColumn, ownerValue);

    if (!scanId) {
      query = query.order("created_at", { ascending: false }).limit(limit);
      return query;
    }

    return query.maybeSingle();
  };

  if (filter.userId) {
    let result = await runQuery("user_id", filter.userId);

    if (
      result.error &&
      isMissingColumnInsertError(result.error) &&
      filter.email
    ) {
      result = await runQuery("email", filter.email);
    }

    return result;
  }

  if (filter.email) {
    return runQuery("email", filter.email);
  }

  return { data: scanId ? null : [], error: null };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | { userId?: string | null, email?: string | null }} userFilter
 * @param {{ limit?: number }} [options]
 */
export async function fetchUserScanHistory(supabase, userFilter, options = {}) {
  const filter = normalizeUserFilter(userFilter);
  const { data, error } = await queryUserScans(supabase, filter, options);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapScanListItem);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string | { userId?: string | null, email?: string | null }} userFilter
 * @param {string} scanId
 */
export async function fetchUserScanById(supabase, userFilter, scanId) {
  const filter = normalizeUserFilter(userFilter);
  const { data, error } = await queryUserScans(supabase, filter, { scanId });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapScanDetail(data);
}

/**
 * @param {unknown} mode
 * @returns {string}
 */
export function formatScanModeLabel(mode) {
  return normalizeScanMode(mode) === "scout" ? "Scout" : "Pro";
}

/**
 * @param {string | null | undefined} isoDate
 * @returns {string}
 */
export function formatScanDate(isoDate) {
  if (!isoDate) {
    return "Unknown date";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
