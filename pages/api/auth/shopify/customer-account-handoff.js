import {
  createShopifyHandoffToken,
  fetchShopifyCustomerEmail,
  registerShopifyHandoffNonce,
  sanitizeHandoffNextPath,
  ShopifyHandoffError,
} from "../../../../lib/shopifyHandoffAuth.js";
import {
  extractBearerToken,
  peekShopifySessionTokenClaims,
  verifyShopifyCustomerAccountSessionToken,
} from "../../../../lib/shopifyCustomerAccountSession.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
};

/**
 * @param {Record<string, unknown>} fields
 */
function logHandoff(fields) {
  console.info(
    JSON.stringify({
      event: "shopify_customer_account_handoff",
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

/**
 * @param {import("http").ServerResponse} res
 * @param {number} status
 * @param {Record<string, unknown>} body
 */
function json(res, status, body) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
  return res.end(JSON.stringify(body));
}

/**
 * @param {import("http").ServerResponse} res
 * @param {string} location
 */
function redirect(res, location) {
  res.writeHead(302, {
    ...CORS_HEADERS,
    Location: location,
  });
  return res.end();
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {{ sessionToken: string, nextPath: string, transport: string }}
 */
function readSessionTokenInput(req) {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://app.gemcardshow.com";
  const url = new URL(req.url || "/", origin);
  const body =
    typeof req.body === "object" && req.body !== null ? req.body : {};
  const bearer = extractBearerToken(req.headers.authorization);
  const queryToken = String(url.searchParams.get("token") || "").trim();
  const bodyToken = String(body.sessionToken || body.token || "").trim();

  let transport = "none";
  let sessionToken = "";
  if (bearer) {
    sessionToken = bearer;
    transport = "authorization_bearer";
  } else if (queryToken) {
    sessionToken = queryToken;
    transport = "query_token";
  } else if (bodyToken) {
    sessionToken = bodyToken;
    transport = "body_token";
  }

  const nextRaw =
    body.next ?? url.searchParams.get("next") ?? "/";
  return {
    sessionToken,
    nextPath: sanitizeHandoffNextPath(nextRaw),
    transport,
  };
}

/**
 * Customer Account UI extension → GemGrade SSO handoff.
 *
 * Preferred for Dev Dashboard apps (no Partner "API access" menu):
 * GET ?token=<sessionToken>&next=/  → 302 to /auth/shopify/callback
 *
 * Optional: POST with Authorization: Bearer <sessionToken> → JSON { redirectUrl }
 * (requires Shopify network_access approval to call from the extension worker).
 */
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return json(res, 405, { error: "Method not allowed" });
  }

  // Always finish on GemGrade's real site URL — never the SSO bounce host.
  const gemgradeOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://app.gemcardshow.com";
  const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const loginFallback = `${gemgradeOrigin}/login?error=shopify_handoff_error`;
  const wantsRedirect = req.method === "GET";

  try {
    logHandoff({
      step: "received",
      method: req.method,
      request_host: requestHost.slice(0, 80),
      gemgrade_origin: gemgradeOrigin,
    });

    const { sessionToken, nextPath, transport } = readSessionTokenInput(req);

    logHandoff({
      step: "token_input",
      method: req.method,
      transport,
      token_present: Boolean(sessionToken),
      token_length: sessionToken.length,
      token_segments: sessionToken ? sessionToken.split(".").length : 0,
      next_path: nextPath,
    });

    if (!sessionToken) {
      logHandoff({
        step: "missing_session_token",
        method: req.method,
        transport,
        signature_valid: false,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        reason: "missing_session_token",
        final_redirect: wantsRedirect ? "login" : "json_401",
      });
      if (wantsRedirect) {
        return redirect(res, `${gemgradeOrigin}/login?error=shopify_handoff_error`);
      }
      return json(res, 401, { error: "missing_session_token" });
    }

    const peeked = peekShopifySessionTokenClaims(sessionToken);
    logHandoff({
      step: "jwt_peek",
      method: req.method,
      transport,
      request_host: requestHost.slice(0, 80),
      server_time: Math.floor(Date.now() / 1000),
      ...peeked,
    });

    let verified;
    try {
      verified = verifyShopifyCustomerAccountSessionToken(sessionToken);
      logHandoff({
        step: "jwt_verified",
        method: req.method,
        transport,
        signature_valid: true,
        shop: verified.shopDomain,
        logged_in_customer_id_present: true,
        logged_in_customer_id_length: verified.customerId.length,
      });
    } catch (error) {
      const code =
        error instanceof ShopifyHandoffError
          ? error.code
          : "invalid_session_token";
      logHandoff({
        step: "jwt_invalid",
        method: req.method,
        transport,
        signature_valid: code === "invalid_signature" ? false : "not_checked_or_valid",
        customer_lookup: "skipped",
        handoff_session: "skipped",
        reason: code,
        verification_failure_category: code,
        verify_message:
          error instanceof Error ? error.message.slice(0, 120) : "unknown",
        ...peeked,
        final_redirect: wantsRedirect ? "login_error" : "json_401",
      });
      if (wantsRedirect) {
        return redirect(res, loginFallback);
      }
      return json(res, 401, { error: code });
    }

    const serviceSupabase = getServiceRoleClient();
    if (!serviceSupabase) {
      logHandoff({
        step: "missing_service_role",
        method: req.method,
        transport,
        shop: verified.shopDomain,
        logged_in_customer_id_present: true,
        logged_in_customer_id_length: verified.customerId.length,
        signature_valid: true,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        reason: "missing_service_role",
        final_redirect: wantsRedirect ? "login_error" : "json_500",
      });
      if (wantsRedirect) {
        return redirect(res, loginFallback);
      }
      return json(res, 500, { error: "server_misconfigured" });
    }

    logHandoff({
      step: "customer_lookup_start",
      method: req.method,
      transport,
      shop: verified.shopDomain,
      logged_in_customer_id_length: verified.customerId.length,
    });

    const customer = await fetchShopifyCustomerEmail(verified.customerId, {
      shopDomain: verified.shopDomain,
      supabase: serviceSupabase,
    });

    logHandoff({
      step: "customer_lookup_ok",
      method: req.method,
      transport,
      shop: verified.shopDomain,
      customer_lookup: "ok",
      customer_email_present: Boolean(customer.email),
    });

    const { token, claims } = createShopifyHandoffToken({
      shopifyCustomerId: customer.id,
      email: customer.email,
      nextPath,
    });
    await registerShopifyHandoffNonce(serviceSupabase, claims);

    const redirectUrl = `${gemgradeOrigin}/auth/shopify/callback?token=${encodeURIComponent(token)}`;

    logHandoff({
      step: "handoff_token_minted",
      method: req.method,
      transport,
      shop: verified.shopDomain,
      logged_in_customer_id_present: true,
      logged_in_customer_id_length: verified.customerId.length,
      signature_valid: true,
      customer_lookup: "ok",
      customer_email_present: Boolean(customer.email),
      handoff_session: "token_minted",
      handoff_jti_prefix: String(claims.jti).slice(0, 8),
      final_redirect: "auth_shopify_callback",
      next_path: nextPath,
      callback_host: "app.gemcardshow.com",
      callback_path: "/auth/shopify/callback",
      request_host: requestHost.slice(0, 80),
    });

    if (wantsRedirect) {
      logHandoff({
        step: "redirecting",
        method: req.method,
        location_host: "app.gemcardshow.com",
        location_path: "/auth/shopify/callback",
      });
      return redirect(res, redirectUrl);
    }
    return json(res, 200, { ok: true, redirectUrl });
  } catch (error) {
    const code =
      error instanceof ShopifyHandoffError ? error.code : "shopify_handoff_error";
    logHandoff({
      step: "failed",
      method: req.method,
      signature_valid: "unknown",
      customer_lookup: "failed",
      handoff_session: "failed",
      reason: code,
      final_redirect: wantsRedirect ? "login_error" : "json_500",
    });
    console.error("shopify_customer_account_handoff_failed", code, error);
    if (wantsRedirect) {
      return redirect(res, loginFallback);
    }
    return json(res, 500, { error: code });
  }
}
