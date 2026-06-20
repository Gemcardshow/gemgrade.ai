import { requireAdmin } from "../../../../lib/adminAuth.js";
import {
  AdminCreditValidationError,
  adjustUserCredits,
} from "../../../../lib/adminCredits.js";
import { hasSupabasePublicConfig } from "../../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
    const { email, user_id, amount, mode, reason, allowNegative } =
      req.body ?? {};

    const result = await adjustUserCredits(supabase, {
      adminEmail: admin.email ?? "",
      email,
      user_id,
      amount,
      mode,
      reason,
      allowNegative: allowNegative === true,
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AdminCreditValidationError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    const message =
      error instanceof Error ? error.message : "Failed to adjust credits";
    return res.status(500).json({ error: message });
  }
}
