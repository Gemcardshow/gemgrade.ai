import {
  createShopifyHandoffToken,
  fetchShopifyCustomerEmail,
  getShopifyApiSecret,
  registerShopifyHandoffNonce,
  sanitizeHandoffNextPath,
  ShopifyHandoffError,
  verifyShopifyAppProxySignature,
} from "./shopifyHandoffAuth.js";
import { getServiceRoleClient } from "./supabase/server.js";

function getSiteOrigin(req) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const proto = String(req.headers["x-forwarded-proto"] || "https");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return host ? `${proto}://${host}` : "https://app.gemcardshow.com";
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  return res.end();
}

/**
 * Safe production diagnostics — never log secrets or full signatures.
 * @param {Record<string, unknown>} fields
 */
function logHandoff(fields) {
  console.info(
    JSON.stringify({
      event: "shopify_handoff_proxy",
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

/**
 * Shopify App Proxy entrypoint used by /api/auth/shopify/handoff
 * (and legacy /api/auth/shopify/start).
 *
 * Storefront guest/fallback link (unchanged): /apps/gghandoff/handoff?next=/
 * New Customer Accounts SSO uses Customer Account UI + session token instead
 * (POST /api/auth/shopify/customer-account-handoff) because logged_in_customer_id
 * is often empty under NCA.
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
export default async function shopifyHandoffStartHandler(req, res) {
  const origin = getSiteOrigin(req);
  const loginFallback = `${origin}/login`;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const url = new URL(req.url || "/", origin);
    const query = url.searchParams;
    const apiSecret = getShopifyApiSecret();
    const shop = String(query.get("shop") || "").trim();
    const customerId = String(query.get("logged_in_customer_id") || "").trim();
    const nextPath = sanitizeHandoffNextPath(query.get("next"));
    const hasSignature = Boolean(String(query.get("signature") || "").trim());

    if (!apiSecret) {
      logHandoff({
        shop,
        logged_in_customer_id_present: Boolean(customerId),
        logged_in_customer_id_length: customerId.length,
        signature_present: hasSignature,
        signature_valid: false,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        final_redirect: "login_error",
        reason: "missing_api_secret",
      });
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    const signatureValid = verifyShopifyAppProxySignature(query, apiSecret);
    if (!signatureValid) {
      logHandoff({
        shop,
        logged_in_customer_id_present: Boolean(customerId),
        logged_in_customer_id_length: customerId.length,
        signature_present: hasSignature,
        signature_valid: false,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        final_redirect: "login_error",
        reason: "invalid_signature",
      });
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    if (!customerId) {
      logHandoff({
        shop,
        logged_in_customer_id_present: false,
        logged_in_customer_id_length: 0,
        signature_present: hasSignature,
        signature_valid: true,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        final_redirect: "login",
        reason: "empty_logged_in_customer_id",
        note: "Common with Shopify New Customer Accounts — App Proxy often omits customer id even when logged in",
      });
      return redirect(res, loginFallback);
    }

    const serviceSupabase = getServiceRoleClient();
    if (!serviceSupabase) {
      logHandoff({
        shop,
        logged_in_customer_id_present: true,
        logged_in_customer_id_length: customerId.length,
        signature_present: hasSignature,
        signature_valid: true,
        customer_lookup: "skipped",
        handoff_session: "skipped",
        final_redirect: "login_error",
        reason: "missing_service_role",
      });
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    let customer;
    try {
      customer = await fetchShopifyCustomerEmail(customerId, {
        supabase: serviceSupabase,
      });
    } catch (lookupError) {
      const code =
        lookupError instanceof ShopifyHandoffError
          ? lookupError.code
          : "customer_lookup_failed";
      logHandoff({
        shop,
        logged_in_customer_id_present: true,
        logged_in_customer_id_length: customerId.length,
        signature_present: hasSignature,
        signature_valid: true,
        customer_lookup: "failed",
        customer_lookup_code: code,
        handoff_session: "skipped",
        final_redirect: "login_error",
        reason: code,
      });
      throw lookupError;
    }

    const { token, claims } = createShopifyHandoffToken({
      shopifyCustomerId: customer.id,
      email: customer.email,
      nextPath,
    });

    await registerShopifyHandoffNonce(serviceSupabase, claims);

    const finalRedirect = `${origin}/auth/shopify/callback?token=…`;
    logHandoff({
      shop,
      logged_in_customer_id_present: true,
      logged_in_customer_id_length: customerId.length,
      signature_present: hasSignature,
      signature_valid: true,
      customer_lookup: "ok",
      customer_email_present: Boolean(customer.email),
      handoff_session: "token_minted",
      final_redirect: "auth_shopify_callback",
      next_path: nextPath,
    });

    return redirect(
      res,
      `${origin}/auth/shopify/callback?token=${encodeURIComponent(token)}`,
    );
  } catch (error) {
    const code =
      error instanceof ShopifyHandoffError ? error.code : "shopify_handoff_error";
    logHandoff({
      signature_valid: "unknown",
      customer_lookup: "unknown",
      handoff_session: "failed",
      final_redirect: "login_error",
      reason: code,
    });
    console.error("shopify_handoff failed:", code, error);
    return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
  }
}
