import crypto from "node:crypto";
import {
  ShopifyHandoffError,
  getShopifyApiKey,
  getShopifyApiSecret,
  getShopifyShopDomain,
} from "./shopifyHandoffAuth.js";

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
 * @param {string} value
 * @returns {string}
 */
function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeShopifyShopHost(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * Decode JWT payload claims without verifying signature (diagnostics only).
 * Never log the raw token.
 *
 * @param {string} token
 * @returns {{
 *   peek_ok: boolean,
 *   jwt_parts: number,
 *   alg?: string | null,
 *   has_sub?: boolean,
 *   sub_is_customer_gid?: boolean,
 *   aud_present?: boolean,
 *   aud_matches_api_key?: boolean | null,
 *   dest?: string | null,
 *   iss?: string | null,
 *   exp?: number | null,
 *   nbf?: number | null,
 *   jti_prefix?: string | null,
 * }}
 */
export function peekShopifySessionTokenClaims(token, options = {}) {
  const raw = String(token ?? "").trim();
  const parts = raw.split(".");
  if (!raw || parts.length !== 3) {
    return { peek_ok: false, jwt_parts: parts.filter(Boolean).length };
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
    const claims = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
    const apiKey = options.apiKey ?? getShopifyApiKey();
    const aud = String(claims.aud ?? "");
    return {
      peek_ok: true,
      jwt_parts: 3,
      alg: header?.alg ? String(header.alg).slice(0, 16) : null,
      has_sub: Boolean(claims.sub),
      sub_is_customer_gid: /^gid:\/\/shopify\/Customer\/\d+/i.test(
        String(claims.sub ?? ""),
      ),
      aud_present: Boolean(aud),
      aud_matches_api_key: apiKey ? aud === apiKey : null,
      dest: claims.dest ? String(claims.dest).slice(0, 80) : null,
      iss: claims.iss ? String(claims.iss).slice(0, 80) : null,
      exp: typeof claims.exp === "number" ? claims.exp : null,
      nbf: typeof claims.nbf === "number" ? claims.nbf : null,
    };
  } catch {
    return { peek_ok: false, jwt_parts: 3 };
  }
}

/**
 * Extract numeric customer id from `gid://shopify/Customer/123` or bare digits.
 * @param {unknown} sub
 * @returns {string}
 */
export function parseShopifyCustomerIdFromSub(sub) {
  const raw = String(sub ?? "").trim();
  if (!raw) {
    return "";
  }
  const gidMatch = raw.match(/gid:\/\/shopify\/Customer\/(\d+)/i);
  if (gidMatch?.[1]) {
    return gidMatch[1];
  }
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  return "";
}

/**
 * Verify a Customer Account UI session token (HS256 JWT).
 *
 * @param {string} token
 * @param {{
 *   apiKey?: string,
 *   apiSecret?: string,
 *   expectedShop?: string,
 *   nowSeconds?: number,
 * }} [options]
 * @returns {{
 *   claims: Record<string, unknown>,
 *   shopDomain: string,
 *   customerId: string,
 * }}
 */
export function verifyShopifyCustomerAccountSessionToken(token, options = {}) {
  const raw = String(token ?? "").trim();
  if (!raw) {
    throw new ShopifyHandoffError("missing_session_token", "Session token is required");
  }

  const apiSecret = options.apiSecret ?? getShopifyApiSecret();
  const apiKey = options.apiKey ?? getShopifyApiKey();
  if (!apiSecret || !apiKey) {
    throw new ShopifyHandoffError(
      "missing_admin_config",
      "SHOPIFY_API_KEY and SHOPIFY_API_SECRET are required to verify session tokens",
    );
  }

  const parts = raw.split(".");
  if (parts.length !== 3) {
    throw new ShopifyHandoffError("invalid_format", "Session token format is invalid");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString("utf8"));
    claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8"));
  } catch {
    throw new ShopifyHandoffError("invalid_payload", "Session token payload is invalid");
  }

  const alg = String(header?.alg ?? "");
  if (alg !== "HS256") {
    throw new ShopifyHandoffError("invalid_algorithm", "Unsupported session token algorithm");
  }

  const expectedSig = crypto
    .createHmac("sha256", apiSecret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const actualSig = base64UrlDecode(signaturePart);
  if (
    expectedSig.length !== actualSig.length ||
    !crypto.timingSafeEqual(expectedSig, actualSig)
  ) {
    throw new ShopifyHandoffError("invalid_signature", "Session token signature is invalid");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = Number(claims.exp);
  const nbf = Number(claims.nbf);
  if (!Number.isFinite(exp) || exp <= now) {
    throw new ShopifyHandoffError("expired_session_token", "Session token has expired");
  }
  if (Number.isFinite(nbf) && nbf > now + 5) {
    throw new ShopifyHandoffError("not_active", "Session token is not active yet");
  }

  const aud = String(claims.aud ?? "");
  if (aud !== apiKey) {
    throw new ShopifyHandoffError("wrong_audience", "Session token audience mismatch");
  }

  const destHost = normalizeShopifyShopHost(claims.dest);
  const expectedShop = normalizeShopifyShopHost(
    options.expectedShop ?? getShopifyShopDomain(),
  );

  if (!destHost) {
    throw new ShopifyHandoffError("missing_destination", "Session token missing dest claim");
  }

  if (expectedShop && destHost !== expectedShop) {
    throw new ShopifyHandoffError("wrong_destination", "Session token shop mismatch");
  }

  const rawIssuer = String(claims.iss ?? "").trim();
  if (rawIssuer) {
    let issuer;
    try {
      issuer = new URL(rawIssuer);
    } catch {
      throw new ShopifyHandoffError("wrong_issuer", "Session token issuer is invalid");
    }

    const allowedIssuerPaths = new Set([
      "",
      "/",
      "/admin",
      "/admin/",
      "/checkouts",
      "/checkouts/",
    ]);
    const issuerHost = issuer.hostname.toLowerCase();
    const issuerIsValid =
      issuer.protocol === "https:" &&
      !issuer.username &&
      !issuer.password &&
      !issuer.port &&
      !issuer.search &&
      !issuer.hash &&
      issuerHost === destHost &&
      allowedIssuerPaths.has(issuer.pathname);

    if (!issuerIsValid) {
      throw new ShopifyHandoffError("wrong_issuer", "Session token issuer mismatch");
    }
  }

  const customerId = parseShopifyCustomerIdFromSub(claims.sub);
  if (!customerId) {
    throw new ShopifyHandoffError(
      "missing_customer_id",
      "Session token is missing authenticated customer sub claim",
    );
  }

  return {
    claims,
    shopDomain: destHost,
    customerId,
  };
}

/**
 * @param {string} authorizationHeader
 * @returns {string}
 */
export function extractBearerToken(authorizationHeader) {
  const raw = String(authorizationHeader ?? "").trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

// Keep encode helper referenced for tests that may re-sign tokens.
export const __testOnly = { base64UrlEncode, base64UrlDecode };
