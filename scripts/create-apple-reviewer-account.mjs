#!/usr/bin/env node
/**
 * Provision the Apple App Review demo account (server-side only).
 *
 * Required env (never commit these values):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   APPLE_REVIEW_EMAIL
 *   APPLE_REVIEW_PASSWORD
 *
 * Usage (local, with secrets in the shell env or a local .env that is gitignored):
 *   node --env-file=.env.local scripts/create-apple-reviewer-account.mjs
 *
 * Does not print the password.
 */
import { createClient } from "@supabase/supabase-js";
import { provisionAppleReviewerAccount } from "../lib/appleReviewerAccount.js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "../lib/supabase/env.js";

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const url = getSupabaseUrl();
const serviceRoleKey = getSupabaseServiceRoleKey();

if (!url || !serviceRoleKey) {
  fail(
    "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required",
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

try {
  const result = await provisionAppleReviewerAccount(supabase);
  console.log("Apple App Review account ready.");
  console.log(`email: ${result.email}`);
  console.log(`userId: ${result.userId}`);
  console.log(`created: ${result.created}`);
  console.log(`credit_balance: ${result.balance}`);
  console.log(
    "Provide the email and password to Apple in App Store Connect Review Information only — do not commit them.",
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
