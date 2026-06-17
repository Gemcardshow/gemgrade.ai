/** Shared Supabase env accessors (server, client, middleware). */

const SUPABASE_HOST_SUFFIX = ".supabase.co";

/** Documentation placeholders that must not ship to production. */
const SUPABASE_URL_PLACEHOLDERS = [
  "your-project",
  "real-project-ref",
  "<",
  ">",
];

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isValidSupabaseProjectUrl(url) {
  if (!url) {
    return false;
  }

  if (SUPABASE_URL_PLACEHOLDERS.some((marker) => url.includes(marker))) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const projectRef = parsed.hostname.slice(
      0,
      parsed.hostname.length - SUPABASE_HOST_SUFFIX.length,
    );

    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(SUPABASE_HOST_SUFFIX) &&
      projectRef.length > 0 &&
      /^[a-z0-9-]+$/i.test(projectRef)
    );
  } catch {
    return false;
  }
}

/**
 * Accept legacy anon JWT keys and Supabase publishable keys.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isValidSupabaseAnonKey(key) {
  if (typeof key !== "string" || key.length < 20) {
    return false;
  }

  if (key.startsWith("eyJ")) {
    return true;
  }

  if (key.startsWith("sb_publishable_")) {
    return true;
  }

  return false;
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
