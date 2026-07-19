import crypto from "node:crypto";
import { normalizeShopifyEmail } from "./shopifyCredits.js";

export const SHOPIFY_HANDOFF_MAX_TTL_SECONDS = 5 * 60;
export const SHOPIFY_HANDOFF_TOKEN_VERSION = 1;

/**
 * @returns {string}
 */
export function getShopifyHandoffSecret() {
  return (
    process.env.SHOPIFY_HANDOFF_SECRET?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim() ||
    ""
  );
}

/**
 * @returns {string}
 */
export function getShopifyApiSecret() {
  return process.env.SHOPIFY_API_SECRET?.trim() || "";
}

/**
 * @returns {string}
 */
export function getShopifyShopDomain() {
  return (
    process.env.SHOPIFY_SHOP_DOMAIN?.trim() ||
    process.env.SHOPIFY_SHOP?.trim() ||
    ""
  );
}

/**
 * @returns {string}
 */
export function getShopifyApiKey() {
  return (
    process.env.SHOPIFY_API_KEY?.trim() ||
    process.env.SHOPIFY_CLIENT_ID?.trim() ||
    ""
  );
}

/**
 * Optional static Admin token override. Prefer client-credentials refresh.
 * @returns {string}
 */
export function getShopifyAdminAccessToken() {
  return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim() || "";
}

/** @type {{ token: string, expiresAtMs: number } | null} */
let cachedAdminAccessToken = null;

/**
 * Clear cached client-credentials Admin token (tests / forced refresh).
 */
export function clearShopifyAdminAccessTokenCache() {
  cachedAdminAccessToken = null;
}

/**
 * Obtain a Shopify Admin API access token.
 * Order: static env override → in-memory client_credentials cache →
 * client_credentials grant → stored offline token (authorization code).
 *
 * @param {{
 *   shopDomain?: string,
 *   fetchImpl?: typeof fetch,
 *   forceRefresh?: boolean,
 *   supabase?: import("@supabase/supabase-js").SupabaseClient | null,
 * }} [options]
 * @returns {Promise<string>}
 */
export async function resolveShopifyAdminAccessToken(options = {}) {
  const staticToken = getShopifyAdminAccessToken();
  if (staticToken) {
    return staticToken;
  }

  const now = Date.now();
  if (
    !options.forceRefresh &&
    cachedAdminAccessToken?.token &&
    cachedAdminAccessToken.expiresAtMs > now + 60_000
  ) {
    return cachedAdminAccessToken.token;
  }

  const shopDomain = (options.shopDomain ?? getShopifyShopDomain())
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const clientId = getShopifyApiKey();
  const clientSecret = getShopifyApiSecret();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!shopDomain) {
    throw new ShopifyHandoffError(
      "missing_admin_config",
      "Shopify Admin API is not configured (SHOPIFY_SHOP_DOMAIN required)",
    );
  }

  if (clientId && clientSecret) {
    try {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await fetchImpl(
        `https://${shopDomain}/admin/oauth/access_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
        },
      );

      if (response.ok) {
        const payload = await response.json();
        const token = String(payload?.access_token ?? "").trim();
        const expiresIn = Number(payload?.expires_in);
        if (token) {
          const ttlSeconds =
            Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86_399;
          cachedAdminAccessToken = {
            token,
            expiresAtMs: now + ttlSeconds * 1000,
          };
          return token;
        }
      }
    } catch {
      // Fall through to stored offline token.
    }
  }

  const stored = await loadStoredShopifyAdminAccessToken(shopDomain, options.supabase);
  if (stored) {
    cachedAdminAccessToken = {
      token: stored,
      // Offline tokens do not expire until uninstall; refresh cache daily.
      expiresAtMs: now + 86_400_000,
    };
    return stored;
  }

  throw new ShopifyHandoffError(
    "missing_admin_config",
    "Shopify Admin API token unavailable. Complete one OAuth authorize visit so GemGrade can store an offline token, or set SHOPIFY_ADMIN_ACCESS_TOKEN.",
  );
}

/**
 * @param {string} shopDomain
 * @param {import("@supabase/supabase-js").SupabaseClient | null | undefined} supabase
 * @returns {Promise<string>}
 */
async function loadStoredShopifyAdminAccessToken(shopDomain, supabase) {
  if (!supabase) {
    return "";
  }

  const { data, error } = await supabase
    .from("shopify_admin_tokens")
    .select("access_token")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (error || !data?.access_token) {
    return "";
  }

  return String(data.access_token).trim();
}

/**
 * Exchange an authorization code for an offline Admin API token and persist it.
 *
 * @param {{
 *   code: string,
 *   shopDomain: string,
 *   supabase: import("@supabase/supabase-js").SupabaseClient,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<{ accessToken: string, scope: string }>}
 */
export async function exchangeAndStoreShopifyAdminToken(options) {
  const shopDomain = String(options.shopDomain ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const code = String(options.code ?? "").trim();
  const clientId = getShopifyApiKey();
  const clientSecret = getShopifyApiSecret();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!shopDomain || !code || !clientId || !clientSecret) {
    throw new ShopifyHandoffError(
      "missing_admin_config",
      "Cannot exchange Shopify OAuth code without shop, code, SHOPIFY_API_KEY, and SHOPIFY_API_SECRET",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
  });

  const response = await fetchImpl(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    },
  );

  if (!response.ok) {
    throw new ShopifyHandoffError(
      "admin_token_failed",
      `Shopify OAuth token exchange failed (${response.status})`,
    );
  }

  const payload = await response.json();
  const accessToken = String(payload?.access_token ?? "").trim();
  const scope = String(payload?.scope ?? "").trim();
  if (!accessToken) {
    throw new ShopifyHandoffError(
      "admin_token_failed",
      "Shopify OAuth token response was missing access_token",
    );
  }

  const { error } = await options.supabase.from("shopify_admin_tokens").upsert(
    {
      shop_domain: shopDomain,
      access_token: accessToken,
      scope: scope || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_domain" },
  );

  if (error) {
    throw new Error(error.message);
  }

  clearShopifyAdminAccessTokenCache();
  cachedAdminAccessToken = {
    token: accessToken,
    expiresAtMs: Date.now() + 86_400_000,
  };

  return { accessToken, scope };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value), "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {string} value
 * @returns {Buffer}
 */
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(`${padded}${"=".repeat(padLength)}`, "base64");
}

/**
 * @param {string} payloadPart
 * @param {string} secret
 * @returns {string}
 */
function signPayload(payloadPart, secret) {
  return base64UrlEncode(
    crypto.createHmac("sha256", secret).update(payloadPart).digest(),
  );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualString(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify Shopify App Proxy query signature.
 * @see https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
 *
 * @param {URLSearchParams | Record<string, string | string[] | undefined>} query
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyShopifyAppProxySignature(query, secret) {
  if (!secret) {
    return false;
  }

  const params =
    query instanceof URLSearchParams
      ? Object.fromEntries(query.entries())
      : { ...query };

  const signature = String(params.signature ?? "");
  if (!signature) {
    return false;
  }

  /** @type {string[]} */
  const messageParts = [];
  for (const key of Object.keys(params).sort()) {
    if (key === "signature") {
      continue;
    }
    const value = params[key];
    const normalized = Array.isArray(value) ? value.join(",") : String(value ?? "");
    messageParts.push(`${key}=${normalized}`);
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(messageParts.join(""))
    .digest("hex");

  return timingSafeEqualString(digest, signature);
}

/**
 * @typedef {Object} ShopifyHandoffClaims
 * @property {number} v
 * @property {string} jti
 * @property {string} cid
 * @property {string} email
 * @property {number} iat
 * @property {number} exp
 * @property {string} [next]
 */

export class ShopifyHandoffError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ShopifyHandoffError";
    this.code = code;
  }
}

/**
 * @param {{
 *   shopifyCustomerId: string,
 *   email: string,
 *   nextPath?: string,
 *   ttlSeconds?: number,
 *   nowSeconds?: number,
 *   secret?: string,
 * }} input
 * @returns {{ token: string, claims: ShopifyHandoffClaims }}
 */
export function createShopifyHandoffToken(input) {
  const secret = input.secret ?? getShopifyHandoffSecret();
  if (!secret) {
    throw new ShopifyHandoffError(
      "missing_secret",
      "Shopify handoff secret is not configured",
    );
  }

  const email = normalizeShopifyEmail(input.email);
  const shopifyCustomerId = String(input.shopifyCustomerId ?? "").trim();

  if (!shopifyCustomerId) {
    throw new ShopifyHandoffError(
      "missing_customer_id",
      "Shopify customer id is required",
    );
  }

  if (!email || !email.includes("@")) {
    throw new ShopifyHandoffError(
      "missing_email",
      "Verified customer email is required",
    );
  }

  const ttlSeconds = Math.min(
    Math.max(1, Number(input.ttlSeconds) || SHOPIFY_HANDOFF_MAX_TTL_SECONDS),
    SHOPIFY_HANDOFF_MAX_TTL_SECONDS,
  );
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const nextPath =
    typeof input.nextPath === "string" && input.nextPath.startsWith("/")
      ? input.nextPath
      : "/";

  /** @type {ShopifyHandoffClaims} */
  const claims = {
    v: SHOPIFY_HANDOFF_TOKEN_VERSION,
    jti: crypto.randomUUID(),
    cid: shopifyCustomerId,
    email,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    next: nextPath,
  };

  const payloadPart = base64UrlEncode(JSON.stringify(claims));
  const signaturePart = signPayload(payloadPart, secret);
  return {
    token: `${payloadPart}.${signaturePart}`,
    claims,
  };
}

/**
 * Cryptographically verify a handoff token (does not enforce single-use).
 *
 * @param {string} token
 * @param {{ secret?: string, nowSeconds?: number }} [options]
 * @returns {ShopifyHandoffClaims}
 */
export function verifyShopifyHandoffToken(token, options = {}) {
  const secret = options.secret ?? getShopifyHandoffSecret();
  if (!secret) {
    throw new ShopifyHandoffError(
      "missing_secret",
      "Shopify handoff secret is not configured",
    );
  }

  if (typeof token !== "string" || !token.includes(".")) {
    throw new ShopifyHandoffError("invalid_token", "Handoff token is malformed");
  }

  const [payloadPart, signaturePart, ...rest] = token.split(".");
  if (!payloadPart || !signaturePart || rest.length > 0) {
    throw new ShopifyHandoffError("invalid_token", "Handoff token is malformed");
  }

  const expected = signPayload(payloadPart, secret);
  if (!timingSafeEqualString(expected, signaturePart)) {
    throw new ShopifyHandoffError("altered_token", "Handoff token signature is invalid");
  }

  let claims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  } catch {
    throw new ShopifyHandoffError("invalid_token", "Handoff token payload is invalid");
  }

  if (
    !claims ||
    typeof claims !== "object" ||
    claims.v !== SHOPIFY_HANDOFF_TOKEN_VERSION ||
    typeof claims.jti !== "string" ||
    !claims.jti ||
    typeof claims.cid !== "string" ||
    !claims.cid ||
    typeof claims.email !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number"
  ) {
    throw new ShopifyHandoffError(
      "invalid_token",
      "Handoff token is missing required fields",
    );
  }

  const email = normalizeShopifyEmail(claims.email);
  if (!email || !email.includes("@")) {
    throw new ShopifyHandoffError("missing_email", "Handoff token email is missing");
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.exp < nowSeconds) {
    throw new ShopifyHandoffError("expired_token", "Handoff token has expired");
  }

  if (claims.exp - claims.iat > SHOPIFY_HANDOFF_MAX_TTL_SECONDS) {
    throw new ShopifyHandoffError("invalid_token", "Handoff token TTL exceeds maximum");
  }

  return {
    v: claims.v,
    jti: claims.jti,
    cid: String(claims.cid),
    email,
    iat: claims.iat,
    exp: claims.exp,
    next:
      typeof claims.next === "string" && claims.next.startsWith("/")
        ? claims.next
        : "/",
  };
}

/**
 * Persist nonce so the token can be consumed exactly once.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {ShopifyHandoffClaims} claims
 * @returns {Promise<void>}
 */
export async function registerShopifyHandoffNonce(supabase, claims) {
  const { error } = await supabase.from("shopify_auth_handoff_nonces").insert({
    jti: claims.jti,
    shopify_customer_id: claims.cid,
    email: claims.email,
    expires_at: new Date(claims.exp * 1000).toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Verify signature/expiry and consume the nonce (single-use).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} token
 * @param {{ secret?: string, nowSeconds?: number }} [options]
 * @returns {Promise<ShopifyHandoffClaims>}
 */
export async function consumeShopifyHandoffToken(supabase, token, options = {}) {
  const claims = verifyShopifyHandoffToken(token, options);
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowSeconds * 1000).toISOString();

  const { data: row, error: readError } = await supabase
    .from("shopify_auth_handoff_nonces")
    .select("jti, consumed_at, expires_at, email, shopify_customer_id")
    .eq("jti", claims.jti)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message);
  }

  if (!row) {
    throw new ShopifyHandoffError("invalid_token", "Handoff token was not issued");
  }

  if (row.consumed_at) {
    throw new ShopifyHandoffError("replayed_token", "Handoff token was already used");
  }

  if (new Date(row.expires_at).getTime() <= nowSeconds * 1000) {
    throw new ShopifyHandoffError("expired_token", "Handoff token has expired");
  }

  const { data: updated, error: updateError } = await supabase
    .from("shopify_auth_handoff_nonces")
    .update({ consumed_at: nowIso })
    .eq("jti", claims.jti)
    .is("consumed_at", null)
    .select("jti")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (!updated) {
    throw new ShopifyHandoffError("replayed_token", "Handoff token was already used");
  }

  return claims;
}

/**
 * @param {string} shopifyCustomerId
 * @param {{
 *   shopDomain?: string,
 *   accessToken?: string,
 *   fetchImpl?: typeof fetch,
 *   supabase?: import("@supabase/supabase-js").SupabaseClient | null,
 * }} [options]
 * @returns {Promise<{ id: string, email: string }>}
 */
export async function fetchShopifyCustomerEmail(shopifyCustomerId, options = {}) {
  const customerId = String(shopifyCustomerId ?? "").trim();
  if (!customerId) {
    throw new ShopifyHandoffError("missing_customer_id", "Shopify customer id is required");
  }

  const shopDomain = (options.shopDomain ?? getShopifyShopDomain())
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken =
    options.accessToken ??
    (await resolveShopifyAdminAccessToken({
      shopDomain,
      fetchImpl,
      supabase: options.supabase,
    }));

  if (!shopDomain || !accessToken) {
    throw new ShopifyHandoffError(
      "missing_admin_config",
      "Shopify Admin API is not configured",
    );
  }

  const response = await fetchImpl(
    `https://${shopDomain}/admin/api/2024-10/customers/${encodeURIComponent(customerId)}.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new ShopifyHandoffError(
      "customer_lookup_failed",
      `Unable to load Shopify customer (${response.status})`,
    );
  }

  const payload = await response.json();
  const email = normalizeShopifyEmail(payload?.customer?.email);
  const id = String(payload?.customer?.id ?? customerId);

  if (!email) {
    throw new ShopifyHandoffError(
      "missing_email",
      "Shopify customer is missing a verified email",
    );
  }

  return { id, email };
}

/**
 * Find an existing auth user by email, or create a confirmed user.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 * @returns {Promise<{ userId: string, email: string, created: boolean }>}
 */
export async function findOrCreateGemGradeUser(supabase, email) {
  const normalizedEmail = normalizeShopifyEmail(email);
  if (!normalizedEmail) {
    throw new ShopifyHandoffError("missing_email", "Customer email is required");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (profile?.id) {
    return {
      userId: String(profile.id),
      email: normalizeShopifyEmail(profile.email) || normalizedEmail,
      created: false,
    };
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    user_metadata: {
      source: "shopify_handoff",
    },
  });

  if (createError) {
    const message = createError.message?.toLowerCase() ?? "";
    if (message.includes("already") || message.includes("registered")) {
      const { data: linkData, error: linkError } =
        await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: normalizedEmail,
        });

      if (linkError || !linkData?.user?.id) {
        throw new Error(linkError?.message || createError.message);
      }

      return {
        userId: String(linkData.user.id),
        email: normalizedEmail,
        created: false,
      };
    }

    throw new Error(createError.message);
  }

  if (!created?.user?.id) {
    throw new Error("Failed to create GemGrade user");
  }

  return {
    userId: String(created.user.id),
    email: normalizedEmail,
    created: true,
  };
}

/**
 * Establish a cookie session for an existing confirmed user.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} serviceSupabase
 * @param {import("@supabase/supabase-js").SupabaseClient} sessionSupabase
 * @param {string} email
 * @returns {Promise<import("@supabase/supabase-js").User>}
 */
export async function establishGemGradeSession(
  serviceSupabase,
  sessionSupabase,
  email,
) {
  const normalizedEmail = normalizeShopifyEmail(email);
  const { data: linkData, error: linkError } =
    await serviceSupabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
    });

  if (linkError) {
    throw new Error(linkError.message);
  }

  const hashedToken = linkData?.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error("Supabase did not return a session token hash");
  }

  const { data: sessionData, error: verifyError } =
    await sessionSupabase.auth.verifyOtp({
      token_hash: hashedToken,
      type: "email",
    });

  if (verifyError || !sessionData?.user) {
    throw new Error(verifyError?.message || "Unable to establish GemGrade session");
  }

  return sessionData.user;
}

/**
 * Complete post-verification handoff: profile, signup bonus, pending Shopify credits.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} serviceSupabase
 * @param {{ id: string, email?: string | null, created_at?: string }} user
 * @param {{
 *   ensureCreditProfile?: typeof import("./credits.js").ensureCreditProfile,
 *   grantSignupBonusIfEligible?: typeof import("./credits.js").grantSignupBonusIfEligible,
 *   fulfillPendingGrantsForEmail?: typeof import("./shopifyCredits.js").fulfillPendingGrantsForEmail,
 * }} [deps]
 */
export async function finalizeShopifyHandoffUser(serviceSupabase, user, deps = {}) {
  const ensureProfile =
    deps.ensureCreditProfile ??
    (await import("./credits.js")).ensureCreditProfile;
  const grantBonus =
    deps.grantSignupBonusIfEligible ??
    (await import("./credits.js")).grantSignupBonusIfEligible;
  const fulfillPending =
    deps.fulfillPendingGrantsForEmail ??
    (await import("./shopifyCredits.js")).fulfillPendingGrantsForEmail;

  const email = normalizeShopifyEmail(user.email ?? "");
  await ensureProfile(serviceSupabase, user.id, email);
  await grantBonus(serviceSupabase, user.id, user.created_at);
  return fulfillPending(serviceSupabase, user.id, email);
}

/**
 * @param {string | null | undefined} nextPath
 * @returns {string}
 */
export function sanitizeHandoffNextPath(nextPath) {
  if (typeof nextPath !== "string") {
    return "/";
  }

  const trimmed = nextPath.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return "/";
  }

  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith("//") || decoded.includes("\\")) return "/";
    const resolved = new URL(decoded, "https://gemgrade.internal");
    if (resolved.origin !== "https://gemgrade.internal") return "/";
  } catch {
    return "/";
  }

  return trimmed;
}
