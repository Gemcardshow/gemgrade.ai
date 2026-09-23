import { requireAuth } from "../../../../lib/auth.js";
import {
  appleIapErrorResponse,
  verifyAndGrantApplePurchase,
} from "../../../../lib/appleIapVerify.js";
import { hasSupabasePublicConfig } from "../../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!hasSupabasePublicConfig()) {
    return res.status(503).json({
      status: "apple_config",
      error: "Supabase auth is not configured",
      finishTransaction: false,
      creditsGranted: 0,
    });
  }

  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return res.status(503).json({
      status: "apple_config",
      error: "Supabase service role is not configured",
      finishTransaction: false,
      creditsGranted: 0,
    });
  }

  try {
    const outcome = await verifyAndGrantApplePurchase({
      supabase,
      userId: user.id,
      signedTransaction: req.body?.signedTransaction,
    });
    return res.status(outcome.httpStatus).json(outcome.body);
  } catch (error) {
    const outcome = appleIapErrorResponse(error);
    return res.status(outcome.httpStatus).json(outcome.body);
  }
}
