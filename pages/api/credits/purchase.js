import { requireAuth } from "../../../lib/auth.js";
import { executePlaceholderPurchase } from "../../../lib/credits.js";
import { hasSupabasePublicConfig } from "../../../lib/supabase/env.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasSupabasePublicConfig()) {
    return res.status(503).json({ error: "Supabase auth is not configured" });
  }

  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const outcome = await executePlaceholderPurchase(user.id, req.body?.pack);

  if (outcome.error) {
    return res.status(outcome.status).json({ error: outcome.error });
  }

  return res.status(200).json(outcome.data);
}
