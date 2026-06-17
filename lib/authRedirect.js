/**
 * Auth redirect helpers for magic-link and OAuth callbacks.
 * Prefer NEXT_PUBLIC_SITE_URL in production builds; fall back to browser origin locally.
 */

/**
 * @param {string} [fallbackOrigin]
 * @returns {string}
 */
export function getPublicSiteUrl(fallbackOrigin = "") {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "";
  const fromOrigin = fallbackOrigin.trim().replace(/\/$/, "");
  return fromEnv || fromOrigin;
}

/**
 * @param {string} [fallbackOrigin]
 * @returns {string}
 */
export function getAuthCallbackUrl(fallbackOrigin = "") {
  const siteUrl = getPublicSiteUrl(fallbackOrigin);
  if (!siteUrl) {
    return "";
  }

  return `${siteUrl}/auth/callback`;
}
