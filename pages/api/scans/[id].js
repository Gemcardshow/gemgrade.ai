import { createPagesApiClient, requireAuth } from "../../../lib/auth.js";
import { fetchUserScanById } from "../../../lib/scanHistory.js";
import { hasSupabasePublicConfig } from "../../../lib/supabase/env.js";

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

  const scanId = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (!scanId) {
    return res.status(400).json({ error: "Scan id is required." });
  }

  const supabase = createPagesApiClient(req, res);
  if (!supabase) {
    return res.status(503).json({ error: "Supabase auth is not configured" });
  }

  try {
    const scan = await fetchUserScanById(supabase, user.id, scanId);

    if (!scan) {
      return res.status(404).json({ error: "Scan not found." });
    }

    return res.status(200).json({ scan });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch scan";
    return res.status(500).json({ error: message });
  }
}
