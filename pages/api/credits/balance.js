import { createPagesApiClient, requireAuth } from "../../../lib/auth.js";
import {
  ensureCreditProfile,
  getCreditBalanceSummary,
} from "../../../lib/credits.js";
import { fulfillPendingGrantsForEmail } from "../../../lib/shopifyCredits.js";
import { hasSupabasePublicConfig } from "../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../lib/supabase/server.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasSupabasePublicConfig()) {
    return res.status(503).json({ error: "Supabase auth is not configured" });
  }

  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const supabase = createPagesApiClient(req, res);
  if (!supabase) {
    return res.status(503).json({ error: "Supabase auth is not configured" });
  }

  try {
    const serviceSupabase = getServiceRoleClient();
    if (serviceSupabase) {
      try {
        await ensureCreditProfile(
          serviceSupabase,
          user.id,
          user.email ?? "",
        );
        await fulfillPendingGrantsForEmail(
          serviceSupabase,
          user.id,
          user.email ?? "",
        );
      } catch (profileEnsureError) {
        console.error("ensureCreditProfile failed:", profileEnsureError);
      }
    }

    const summary = await getCreditBalanceSummary(supabase, user.id);
    return res.status(200).json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch balance";
    console.error("GET /api/credits/balance failed:", message);
    return res.status(500).json({ error: message });
  }
}
