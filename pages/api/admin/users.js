import { requireAdmin } from "../../../lib/adminAuth.js";
import { searchUserByEmail } from "../../../lib/adminCredits.js";
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

  const email =
    typeof req.query.email === "string" ? req.query.email.trim() : "";

  if (!email) {
    return res.status(400).json({ error: "email query parameter is required" });
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const result = await searchUserByEmail(supabase, email);

    if (!result) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search users";
    return res.status(500).json({ error: message });
  }
}
