import { requireAuth } from "../../../../lib/auth.js";
import {
  fetchUserScanFrontImage,
} from "../../../../lib/scanHistory.js";
import { hasSupabasePublicConfig } from "../../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

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

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const payload = await fetchUserScanFrontImage(
      supabase,
      { userId: user.id, email: user.email },
      scanId,
    );

    if (!payload) {
      return res.status(404).json({ error: "Front image not found." });
    }

    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(payload.body);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch scan image";
    return res.status(500).json({ error: message });
  }
}
