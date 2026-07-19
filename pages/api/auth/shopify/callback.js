import { exchangeAndStoreShopifyAdminToken } from "../../../../lib/shopifyHandoffAuth.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

/**
 * Shopify OAuth redirect URI for Dev Dashboard app install / offline token grant.
 * Redirect URL: https://app.gemcardshow.com/api/auth/shopify/callback
 *
 * Customer session handoff continues to use App Router /auth/shopify/callback?token=...
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://app.gemcardshow.com";

  const query = req.query || {};
  const error = typeof query.error === "string" ? query.error : "";
  const code = typeof query.code === "string" ? query.code : "";
  const shop = typeof query.shop === "string" ? query.shop : "";

  if (error) {
    return res.redirect(
      302,
      `${origin}/login?error=shopify_handoff_error`,
    );
  }

  if (!code || !shop) {
    return res.status(400).json({
      error: "Missing OAuth code or shop",
      hint: "Open the Shopify authorize URL once as the store owner to store an offline Admin API token.",
      authorizeUrl:
        "https://hidden-gem-sportcards.myshopify.com/admin/oauth/authorize?client_id=5d873659d0a23f0e2d0b9931e2ae744e&scope=read_customers%2Cwrite_app_proxy&redirect_uri=https%3A%2F%2Fapp.gemcardshow.com%2Fapi%2Fauth%2Fshopify%2Fcallback",
    });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(500).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const stored = await exchangeAndStoreShopifyAdminToken({
      code,
      shopDomain: shop,
      supabase,
    });

    return res.status(200).json({
      ok: true,
      shop,
      scope: stored.scope || null,
      message:
        "Offline Shopify Admin API token stored. Shopify → GemGrade handoff can now look up customer emails.",
    });
  } catch (err) {
    console.error("shopify_oauth_token_exchange_failed", err);
    return res.status(500).json({
      error: "Failed to exchange Shopify OAuth code",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
