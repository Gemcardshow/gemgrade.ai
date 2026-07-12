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

  if (!code) {
    return res.status(400).json({
      error: "Missing OAuth code",
      hint: "This URL is the Shopify app install redirect. Customer login uses /apps/gemgrade/handoff.",
    });
  }

  // One-time install acknowledgement. Offline Admin tokens should be stored in
  // Vercel as SHOPIFY_ADMIN_ACCESS_TOKEN after exchanging this code offline.
  return res.status(200).json({
    ok: true,
    shop: shop || null,
    message:
      "Shopify OAuth code received. Exchange it for an offline Admin API token and set SHOPIFY_ADMIN_ACCESS_TOKEN in Vercel if not already configured.",
    codeReceived: true,
  });
}
