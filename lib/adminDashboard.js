import { isMissingColumnInsertError } from "./scanHistory.js";

const RECENT_SCANS_LIMIT = 20;
const TOP_USERS_LIMIT = 5;
const TOP_USERS_LOOKBACK_DAYS = 7;

/**
 * @param {Date} [now]
 * @returns {string}
 */
export function startOfUtcDayIso(now = new Date()) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString();
}

/**
 * @param {number} hours
 * @param {Date} [now]
 * @returns {string}
 */
export function hoursAgoIso(hours, now = new Date()) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/**
 * @param {number} days
 * @param {Date} [now]
 * @returns {string}
 */
export function daysAgoIso(days, now = new Date()) {
  return hoursAgoIso(days * 24, now);
}

/**
 * @param {unknown} creditsUsed
 * @param {unknown} mode
 * @returns {"scout"|"pro"|"unknown"}
 */
export function inferScanMode(creditsUsed, mode) {
  if (mode === "scout" || mode === "pro") {
    return mode;
  }

  if (creditsUsed === 1) {
    return "scout";
  }

  if (creditsUsed === 2) {
    return "pro";
  }

  return "unknown";
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapRecentScanRow(row) {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    email: row.email ? String(row.email) : null,
    userId: row.user_id ? String(row.user_id) : null,
    grade: typeof row.grade === "number" ? row.grade : Number(row.grade),
    era: row.era ? String(row.era) : null,
    mode: inferScanMode(row.credits_used, row.mode),
    creditsUsed:
      typeof row.credits_used === "number" ? row.credits_used : null,
    verdictPreview: row.verdict ? String(row.verdict).slice(0, 120) : null,
  };
}

/**
 * @param {Array<{ userId?: string | null, email?: string | null }>} scans
 * @param {number} [limit]
 */
export function aggregateTopActiveUsers(scans, limit = TOP_USERS_LIMIT) {
  /** @type {Map<string, { userId: string | null, email: string | null, scanCount: number }>} */
  const counts = new Map();

  for (const scan of scans) {
    const key = scan.userId || scan.email || "unknown";
    const existing = counts.get(key) ?? {
      userId: scan.userId ?? null,
      email: scan.email ?? null,
      scanCount: 0,
    };

    existing.scanCount += 1;
    counts.set(key, existing);
  }

  return [...counts.values()]
    .sort((left, right) => right.scanCount - left.scanCount)
    .slice(0, limit);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} table
 * @param {(query: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>} [applyFilters]
 */
async function countRows(supabase, table, applyFilters) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });

  if (applyFilters) {
    query = applyFilters(query);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} hours
 * @param {Date} [now]
 */
export async function countRecentSignIns(supabase, hours, now = new Date()) {
  const cutoffMs = now.getTime() - hours * 60 * 60 * 1000;
  let page = 1;
  let total = 0;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw new Error(error.message);
    }

    for (const user of data.users) {
      if (!user.last_sign_in_at) {
        continue;
      }

      if (new Date(user.last_sign_in_at).getTime() >= cutoffMs) {
        total += 1;
      }
    }

    if (data.users.length < 1000) {
      break;
    }

    page += 1;
  }

  return total;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function countScanModesFromLedger(supabase) {
  const [scoutCount, proCount] = await Promise.all([
    countRows(supabase, "credit_transactions", (query) =>
      query.eq("type", "scan_scout"),
    ),
    countRows(supabase, "credit_transactions", (query) =>
      query.eq("type", "scan_pro"),
    ),
  ]);

  return { scoutScans: scoutCount, proScans: proCount };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
async function sumCreditsConsumed(supabase) {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("amount, type")
    .in("type", ["scan_scout", "scan_pro"]);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce((total, row) => {
    const amount = Number(row.amount);

    if (!Number.isFinite(amount)) {
      return total;
    }

    return total + Math.abs(amount);
  }, 0);
}

const SCAN_COLUMNS_FULL =
  "id, created_at, email, user_id, grade, era, credits_used, verdict";
const SCAN_COLUMNS_ACTIVITY =
  "id, created_at, email, user_id, grade, credits_used";
const SCAN_COLUMNS_LEGACY = "id, created_at, email, grade, verdict";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} columns
 * @param {(query: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>} buildQuery
 */
async function queryScansWithFallback(supabase, preferredColumns, buildQuery) {
  let lastError = null;

  for (const columns of [preferredColumns, SCAN_COLUMNS_LEGACY]) {
    let query = supabase.from("scans").select(columns);
    query = buildQuery(query);
    const { data, error } = await query;

    if (!error) {
      return data ?? [];
    }

    lastError = error;

    if (!isMissingColumnInsertError(error)) {
      throw new Error(error.message);
    }
  }

  throw new Error(lastError?.message || "Failed to query scans");
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} [limit]
 */
async function fetchRecentScans(supabase, limit = RECENT_SCANS_LIMIT) {
  const data = await queryScansWithFallback(
    supabase,
    SCAN_COLUMNS_FULL,
    (query) => query.order("created_at", { ascending: false }).limit(limit),
  );

  return data.map(mapRecentScanRow);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} sinceIso
 */
async function fetchScansSince(supabase, sinceIso) {
  const data = await queryScansWithFallback(
    supabase,
    SCAN_COLUMNS_ACTIVITY,
    (query) =>
      query.gte("created_at", sinceIso).order("created_at", { ascending: false }),
  );

  return data.map(mapRecentScanRow);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Date} [now]
 */
export async function fetchAdminDashboardStats(supabase, now = new Date()) {
  const todayStart = startOfUtcDayIso(now);
  const sevenDaysAgo = daysAgoIso(TOP_USERS_LOOKBACK_DAYS, now);

  const [
    totalUsers,
    signedInLast24Hours,
    signedInLast7Days,
    totalScans,
    scansToday,
    modeCounts,
    creditsConsumed,
    recentScans,
    scansLast7Days,
  ] = await Promise.all([
    countRows(supabase, "profiles"),
    countRecentSignIns(supabase, 24, now),
    countRecentSignIns(supabase, 24 * 7, now),
    countRows(supabase, "scans"),
    countRows(supabase, "scans", (query) =>
      query.gte("created_at", todayStart),
    ),
    countScanModesFromLedger(supabase),
    sumCreditsConsumed(supabase),
    fetchRecentScans(supabase),
    fetchScansSince(supabase, sevenDaysAgo),
  ]);

  return {
    generatedAt: now.toISOString(),
    users: {
      total: totalUsers,
      signedInLast24Hours,
      signedInLast7Days,
    },
    scans: {
      total: totalScans,
      today: scansToday,
      scout: modeCounts.scoutScans,
      pro: modeCounts.proScans,
    },
    creditsConsumed,
    topActiveUsers: aggregateTopActiveUsers(scansLast7Days),
    recentScans,
  };
}

/**
 * @param {"scout"|"pro"|"unknown"} mode
 * @returns {string}
 */
export function formatDashboardModeLabel(mode) {
  if (mode === "scout") {
    return "Scout";
  }

  if (mode === "pro") {
    return "Pro";
  }

  return "Unknown";
}
