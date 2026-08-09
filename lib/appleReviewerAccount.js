/**
 * Server-only helpers to provision the Apple App Review demo account.
 * Credentials must come from environment variables — never hardcode them.
 */

import { adjustUserCredits } from "./adminCredits.js";
import { ensureCreditProfile } from "./credits.js";

export const APPLE_REVIEW_CREDIT_BALANCE = 100;
export const APPLE_REVIEW_CREDIT_REASON =
  "Apple App Review demo account grant";

/**
 * @typedef {Object} AppleReviewerCredentials
 * @property {string} email
 * @property {string} password
 */

/**
 * Read reviewer credentials from process env.
 * Never log the password.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {AppleReviewerCredentials}
 */
export function getAppleReviewerCredentialsFromEnv(env = process.env) {
  const email = env.APPLE_REVIEW_EMAIL?.trim().toLowerCase() || "";
  const password = env.APPLE_REVIEW_PASSWORD || "";

  if (!email) {
    throw new Error("APPLE_REVIEW_EMAIL is required");
  }

  if (!password || password.length < 8) {
    throw new Error(
      "APPLE_REVIEW_PASSWORD is required and must be at least 8 characters",
    );
  }

  return { email, password };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 * @returns {Promise<string | null>}
 */
async function findAuthUserIdByEmail(supabase, email) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (profile?.id) {
    return String(profile.id);
  }

  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

  if (linkError) {
    const message = linkError.message?.toLowerCase() ?? "";
    if (message.includes("not found") || message.includes("unable")) {
      return null;
    }
    throw new Error(linkError.message);
  }

  return linkData?.user?.id ? String(linkData.user.id) : null;
}

/**
 * Create or update the Apple reviewer auth user (confirmed email + password).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {AppleReviewerCredentials} credentials
 * @returns {Promise<{ userId: string, email: string, created: boolean }>}
 */
export async function upsertAppleReviewerAuthUser(supabase, credentials) {
  const { email, password } = credentials;

  const { data: created, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        source: "apple_app_review",
      },
    });

  if (!createError && created?.user?.id) {
    return {
      userId: String(created.user.id),
      email,
      created: true,
    };
  }

  const message = createError?.message?.toLowerCase() ?? "";
  const alreadyExists =
    message.includes("already") ||
    message.includes("registered") ||
    message.includes("exists");

  if (!alreadyExists) {
    throw new Error(createError?.message || "Failed to create Apple reviewer user");
  }

  const existingId = await findAuthUserIdByEmail(supabase, email);
  if (!existingId) {
    throw new Error(
      createError?.message || "Apple reviewer user exists but could not be resolved",
    );
  }

  const { data: updated, error: updateError } =
    await supabase.auth.admin.updateUserById(existingId, {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        source: "apple_app_review",
      },
    });

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    userId: String(updated.user?.id || existingId),
    email,
    created: false,
  };
}

/**
 * Ensure profile exists and set credit balance to the App Review grant amount.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ userId: string, email: string }} user
 * @param {number} [balance]
 * @returns {Promise<{ userId: string, email: string, balance: number }>}
 */
export async function grantAppleReviewerCredits(
  supabase,
  user,
  balance = APPLE_REVIEW_CREDIT_BALANCE,
) {
  await ensureCreditProfile(supabase, user.userId, user.email);

  const result = await adjustUserCredits(supabase, {
    adminEmail: "apple-review-provisioning@system",
    user_id: user.userId,
    amount: balance,
    mode: "set",
    reason: APPLE_REVIEW_CREDIT_REASON,
  });

  return {
    userId: result.userId,
    email: result.email,
    balance: result.balance,
  };
}

/**
 * Full provisioning: auth user + confirmed email + password + credits.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {AppleReviewerCredentials} [credentials]
 */
export async function provisionAppleReviewerAccount(supabase, credentials) {
  const resolved = credentials ?? getAppleReviewerCredentialsFromEnv();
  const user = await upsertAppleReviewerAuthUser(supabase, resolved);
  const credits = await grantAppleReviewerCredits(supabase, user);

  return {
    userId: user.userId,
    email: user.email,
    created: user.created,
    balance: credits.balance,
  };
}
