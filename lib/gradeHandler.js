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
    table: "grades",
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
  const missing = getMissingRequiredEnvVars();
  if (missing.length) {
    return res.status(503).json({
      error: `Missing required environment variables: ${missing.join(", ")}`,
      missing,
    });
  }

  try {
    const { frontImage, backImage, email, era, diagnostics } = req.body;

    if (!frontImage || !backImage) {
      return res.status(400).json({ error: "Missing card images" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const scratchDiagnostics = isScratchDiagnosticsEnabled({
      diagnostics,
      scratchDiagnostics: diagnostics,
    });

    const grade = await gradeCard(client, {
      frontImage,
      backImage,
      eraRequest: era || "auto",
      scratchDiagnostics,
      diagnostics: scratchDiagnostics,
    });

    const supabase = getSupabaseClient();
    if (supabase) {
      const insertRecord = {
        email: email || null,
        grade: grade.psaGrade,
        verdict: grade.verdict,
        front_image: frontImage,
        back_image: backImage,
      };
      const { error: insertError } = await supabase
        .from("grades")
        .insert([insertRecord]);

      if (insertError) {
        logSupabaseInsertFailure(insertError, insertRecord);
        return res.status(500).json({
          error: "Grade computed but failed to save record. Please try again.",
        });
      }
    }

    return res.status(200).json(grade);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "Error grading card",
    });
  }
}
