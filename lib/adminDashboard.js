const RECENT_SCANS_LIMIT = 20;
const TOP_USERS_LIMIT = 5;
const TOP_USERS_LOOKBACK_DAYS = 7;
const SCAN_COUNT_PAGE_SIZE = 1000;

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
    throw new Error(error.message || `Failed to count ${table}`);
  }

  return count ?? 0;
}

/**
 * Count scans without select('*') — production PostgREST treats bare `mode`
 * as the MODE() aggregate when expanding columns.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {(query: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>} [applyFilters]
 */
export async function countScans(supabase, applyFilters) {
  let query = supabase
    .from("scans")
    .select("id", { count: "exact", head: true });

  if (applyFilters) {
    query = applyFilters(query);
  }

  const { count, error } = await query;

  if (!error && typeof count === "number") {
    return count;
  }

  if (error) {
    console.warn("admin dashboard scan head count failed, falling back to pagination:", error.message);
  }

  return countScansByPagination(supabase, applyFilters);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {(query: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>} [applyFilters]
 */
async function countScansByPagination(supabase, applyFilters) {
  let total = 0;
  let offset = 0;

  while (true) {
    let query = supabase
      .from("scans")
      .select("id")
      .order("id", { ascending: true })
      .range(offset, offset + SCAN_COUNT_PAGE_SIZE - 1);

    if (applyFilters) {
      query = applyFilters(query);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message || "Failed to count scans");
    }

    const batch = data ?? [];
    total += batch.length;

    if (batch.length < SCAN_COUNT_PAGE_SIZE) {
      return total;
    }

    offset += SCAN_COUNT_PAGE_SIZE;
  }
}

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

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {(query: import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>) => import("@supabase/supabase-js").PostgrestFilterBuilder<any, any, any, any, any>} buildQuery
 */
async function queryScansWithFallback(supabase, buildQuery) {
  let query = supabase.from("scans").select("*");
  query = buildQuery(query);
  const { data, error } = await query;

  if (error) {
    throw new Error(error.message || "Failed to query scans");
  }

  return data ?? [];
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {number} [limit]
 */
async function fetchRecentScans(supabase, limit = RECENT_SCANS_LIMIT) {
  const data = await queryScansWithFallback(supabase, (query) =>
    query.order("created_at", { ascending: false }).limit(limit),
  );

  return data.map(mapRecentScanRow);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} sinceIso
 */
async function fetchScansSince(supabase, sinceIso) {
  const data = await queryScansWithFallback(supabase, (query) =>
    query.gte("created_at", sinceIso).order("created_at", { ascending: false }),
  );

  return data.map(mapRecentScanRow);
}

/**
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {T} fallback
 * @template T
 */
async function safeMetric(label, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(`admin dashboard metric failed (${label}): ${message}`);
    return fallback;
  }
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
    safeMetric("totalUsers", () => countRows(supabase, "profiles"), 0),
    safeMetric("signedInLast24Hours", () => countRecentSignIns(supabase, 24, now), 0),
    safeMetric("signedInLast7Days", () => countRecentSignIns(supabase, 24 * 7, now), 0),
    safeMetric("totalScans", () => countScans(supabase), 0),
    safeMetric(
      "scansToday",
      () => countScans(supabase, (query) => query.gte("created_at", todayStart)),
      0,
    ),
    safeMetric(
      "modeCounts",
      () => countScanModesFromLedger(supabase),
      { scoutScans: 0, proScans: 0 },
    ),
    safeMetric("creditsConsumed", () => sumCreditsConsumed(supabase), 0),
    safeMetric("recentScans", () => fetchRecentScans(supabase), []),
    safeMetric("scansLast7Days", () => fetchScansSince(supabase, sevenDaysAgo), []),
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
