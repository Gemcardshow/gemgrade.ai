import { normalizeScanMode } from "./scanCredits.js";

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
export function mapScanListItem(row) {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    mode: normalizeScanMode(row.mode),
    grade: typeof row.grade === "number" ? row.grade : Number(row.grade),
    confidence: row.confidence ? String(row.confidence) : null,
    creditsUsed:
      typeof row.credits_used === "number" ? row.credits_used : null,
    era: row.era ? String(row.era) : null,
    verdictPreview: row.verdict ? String(row.verdict).slice(0, 160) : null,
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function mapScanDetail(row) {
  const listItem = mapScanListItem(row);
  const snapshot =
    row.result_snapshot && typeof row.result_snapshot === "object"
      ? row.result_snapshot
      : {};

  return {
    ...listItem,
    verdict: row.verdict ? String(row.verdict) : null,
    result: {
      ...snapshot,
      psaGrade:
        typeof snapshot.psaGrade === "number"
          ? snapshot.psaGrade
          : listItem.grade,
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
