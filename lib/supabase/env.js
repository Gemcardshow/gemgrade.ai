/** Shared Supabase env accessors (server, client, middleware). */

const SUPABASE_HOST_SUFFIX = ".supabase.co";

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isValidSupabaseProjectUrl(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(SUPABASE_HOST_SUFFIX) &&
      parsed.hostname.length > SUPABASE_HOST_SUFFIX.length
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isValidSupabaseAnonKey(key) {
  return typeof key === "string" && key.startsWith("eyJ") && key.length > 20;
}

export function getSupabaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    ""
  );
}

export function getSupabaseAnonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

export function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

export function hasSupabasePublicConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** True when URL/key look usable (guards middleware and client init). */
export function hasUsableSupabasePublicConfig() {
  return (
    isValidSupabaseProjectUrl(getSupabaseUrl()) &&
    isValidSupabaseAnonKey(getSupabaseAnonKey())
  );
}
