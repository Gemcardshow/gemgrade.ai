import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { gradeCard } from "./grading/index.js";
import { isScratchDiagnosticsEnabled } from "./grading/scratch-diagnostics.js";

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let supabaseClient = null;

function getSupabaseKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

/** @returns {"SUPABASE_SERVICE_ROLE_KEY"|"SUPABASE_ANON_KEY"|null} */
export function getSupabaseKeySource() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return "SUPABASE_SERVICE_ROLE_KEY";
  }
  if (process.env.SUPABASE_ANON_KEY?.trim()) {
    return "SUPABASE_ANON_KEY";
  }
  return null;
}

function summarizeInsertPayload(record) {
  return {
    email: record.email ?? null,
    grade: record.grade,
    verdictLength: record.verdict?.length ?? 0,
    frontImageBytes: record.front_image?.length ?? 0,
    backImageBytes: record.back_image?.length ?? 0,
  };
}

function logSupabaseInsertFailure(insertError, record) {
  console.error("Supabase grade insert failed:", {
    table: "scans",
    operation: "insert",
    keySource: getSupabaseKeySource(),
    supabase: {
      message: insertError.message,
      code: insertError.code,
      details: insertError.details ?? null,
      hint: insertError.hint ?? null,
    },
    payloadSummary: summarizeInsertPayload(record),
  });
}

/**
 * Required runtime env for /api/grade (read per request — never at module load).
 * @returns {string[]}
 */
export function getMissingRequiredEnvVars() {
  const missing = [];

  if (!process.env.OPENAI_API_KEY?.trim()) {
    missing.push("OPENAI_API_KEY");
  }
  if (!process.env.SUPABASE_URL?.trim()) {
    missing.push("SUPABASE_URL");
  }
  if (!getSupabaseKey()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");
  }

  return missing;
}

/**
 * Lazy Supabase client — only created when URL + key are present.
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function getSupabaseClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = getSupabaseKey();

  if (!url || !key) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(url, key);
  }

  return supabaseClient;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const missing = getMissingRequiredEnvVars();
  if (missing.length) {
    return res.status(503).json({
      error: `Missing required environment variables: ${missing.join(", ")}`,
      missing,
    });
  }

  const { hasSupabasePublicConfig } = await import("./supabase/env.js");
  if (!hasSupabasePublicConfig()) {
    return res.status(503).json({ error: "Supabase auth is not configured" });
  }

  const { requireAuth } = await import("./auth.js");
  const { getServiceRoleClient } = await import("./supabase/server.js");
  const { executeCreditGatedScan, InsufficientCreditsError } = await import(
    "./gradeScanGate.js"
  );

  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }

  const creditsSupabase = getServiceRoleClient();
  if (!creditsSupabase) {
    return res.status(503).json({
      error: "Supabase service role is not configured",
    });
  }

  try {
    const { frontImage, backImage, email, era, diagnostics, mode } = req.body;
    const { resolveScanImagesForGrade } = await import("./scanInputAdapter.js");
    const resolved = resolveScanImagesForGrade({
      mode,
      frontImage,
      backImage: backImage ?? null,
    });

    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }

    const gradeFrontImage = resolved.frontImage;
    const gradeBackImage = resolved.backImage;
    const scoutFrontOnlyApproximation = resolved.scoutFrontOnlyApproximation;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const scratchDiagnostics = isScratchDiagnosticsEnabled({
      diagnostics,
      scratchDiagnostics: diagnostics,
    });

    const scanSupabase = getSupabaseClient();
    const scanEmail = user.email || email || null;

    const { grade, deduction, mode: scanMode } = await executeCreditGatedScan({
      userId: user.id,
      mode: resolved.mode,
      supabase: creditsSupabase,
      runGrade: () =>
        gradeCard(client, {
          frontImage: gradeFrontImage,
          backImage: gradeBackImage,
          eraRequest: era || "auto",
          scratchDiagnostics,
          diagnostics: scratchDiagnostics,
        }),
      saveScanRecord: async (gradeResult) => {
        if (!scanSupabase) {
          return null;
        }

        const insertRecord = {
          email: scanEmail,
          grade: gradeResult.psaGrade,
          verdict: gradeResult.verdict,
          front_image: gradeFrontImage,
          back_image: gradeBackImage,
        };

        const { data: scanRow, error: insertError } = await scanSupabase
          .from("scans")
          .insert([insertRecord])
          .select("id")
          .single();

        if (insertError) {
          logSupabaseInsertFailure(insertError, insertRecord);
          throw new Error(
            "Grade computed but failed to save record. Please try again.",
          );
        }

        return scanRow?.id ? String(scanRow.id) : null;
      },
    });

    return res.status(200).json({
      ...grade,
      ...(scoutFrontOnlyApproximation
        ? {
            scout: {
              frontOnlyApproximation: true,
              note: "Scout v1 approximation: front image duplicated as back for grading adapter.",
            },
          }
        : {}),
      credits: {
        balance: deduction.balance,
        deducted: deduction.creditsDeducted,
        mode: scanMode,
        transactionId: deduction.transactionId,
      },
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return res.status(error.statusCode).json(error.toJSON());
    }

    console.error(error);

    return res.status(500).json({
      error: error.message || "Error grading card",
    });
  }
}
