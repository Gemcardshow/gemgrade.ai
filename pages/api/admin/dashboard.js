import { requireAdmin } from "../../../lib/adminAuth.js";
import { fetchAdminDashboardStats } from "../../../lib/adminDashboard.js";
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

  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const stats = await fetchAdminDashboardStats(supabase);
    return res.status(200).json(stats);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load admin dashboard";
    return res.status(500).json({ error: message });
  }
}
