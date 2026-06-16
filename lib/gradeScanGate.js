import {
  deductScanCredits,
  getScanCreditCost,
  getUserCreditBalance,
  InsufficientCreditsError,
  normalizeScanMode,
} from "./credits.js";

/**
 * Run a grade scan behind credit pre-check and post-success deduction.
 * Credits are not deducted if grading or scan persistence fails.
 *
 * @param {{
 *   userId: string,
 *   mode?: string,
 *   supabase: import("@supabase/supabase-js").SupabaseClient,
 *   runGrade: () => Promise<Record<string, unknown>>,
 *   saveScanRecord: (grade: Record<string, unknown>) => Promise<string | null>,
 * }} params
 */
export async function executeCreditGatedScan({
  userId,
  mode,
  supabase,
  runGrade,
  saveScanRecord,
}) {
  const normalizedMode = normalizeScanMode(mode);
  const cost = getScanCreditCost(normalizedMode);
  const balance = await getUserCreditBalance(supabase, userId);

  if (balance < cost) {
    throw new InsufficientCreditsError(cost, balance, normalizedMode);
  }

  const grade = await runGrade();
  const scanId = await saveScanRecord(grade);
  const deduction = await deductScanCredits(
    supabase,
    userId,
    normalizedMode,
    scanId,
  );

  return {
    grade,
    deduction,
    mode: normalizedMode,
  };
}

export { InsufficientCreditsError } from "./credits.js";
