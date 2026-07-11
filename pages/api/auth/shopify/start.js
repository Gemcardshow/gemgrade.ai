import {
  createShopifyHandoffToken,
  fetchShopifyCustomerEmail,
  getShopifyApiSecret,
  registerShopifyHandoffNonce,
  sanitizeHandoffNextPath,
  ShopifyHandoffError,
  verifyShopifyAppProxySignature,
} from "../../../../lib/shopifyHandoffAuth.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

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
 * Shopify App Proxy entrypoint.
 * Configure proxy to: https://app.gemcardshow.com/api/auth/shopify/start
 *
 * Theme link (logged-in): /apps/gemgrade/handoff?next=/
 * Theme link (guest): https://app.gemcardshow.com/login
 */
export default async function handler(req, res) {
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

    if (!apiSecret) {
      console.error("shopify_handoff missing SHOPIFY_API_SECRET");
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    if (!verifyShopifyAppProxySignature(query, apiSecret)) {
      console.error("shopify_handoff invalid app proxy signature");
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    const customerId = String(query.get("logged_in_customer_id") || "").trim();
    if (!customerId) {
      return redirect(res, loginFallback);
    }

    const customer = await fetchShopifyCustomerEmail(customerId);
    const nextPath = sanitizeHandoffNextPath(query.get("next"));
    const { token, claims } = createShopifyHandoffToken({
      shopifyCustomerId: customer.id,
      email: customer.email,
      nextPath,
    });

    const serviceSupabase = getServiceRoleClient();
    if (!serviceSupabase) {
      console.error("shopify_handoff missing service role client");
      return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
    }

    await registerShopifyHandoffNonce(serviceSupabase, claims);

    return redirect(
      res,
      `${origin}/auth/shopify/callback?token=${encodeURIComponent(token)}`,
    );
  } catch (error) {
    const code =
      error instanceof ShopifyHandoffError ? error.code : "shopify_handoff_error";
    console.error("shopify_handoff start failed:", code, error);
    return redirect(res, `${loginFallback}?error=shopify_handoff_error`);
  }
}
