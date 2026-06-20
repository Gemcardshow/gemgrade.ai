import { requireAuth } from "../../../lib/auth.js";
import { fetchUserScanHistory } from "../../../lib/scanHistory.js";
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

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const scans = await fetchUserScanHistory(supabase, {
      userId: user.id,
      email: user.email,
    });
    return res.status(200).json({ scans });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch scan history";
    return res.status(500).json({ error: message });
  }
}
