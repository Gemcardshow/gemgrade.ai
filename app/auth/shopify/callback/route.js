import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  consumeShopifyHandoffToken,
  establishGemGradeSession,
  findOrCreateGemGradeUser,
  finalizeShopifyHandoffUser,
  sanitizeHandoffNextPath,
  ShopifyHandoffError,
} from "../../../../lib/shopifyHandoffAuth.js";
import { getSupabaseAnonKey, getSupabaseUrl } from "../../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../../lib/supabase/server.js";

/**
 * @param {string} origin
 * @param {string} [errorCode]
 */
function loginErrorRedirect(origin, errorCode = "shopify_handoff_error") {
  return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
}

/** @param {import("next/server").NextRequest} request */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token");

  /**
   * @param {Record<string, unknown>} fields
   */
  function logCallback(fields) {
    console.info(
      JSON.stringify({
        event: "shopify_handoff_callback",
        ts: new Date().toISOString(),
        ...fields,
      }),
    );
  }

  logCallback({
    step: "received",
    token_present: Boolean(token),
    token_length: token ? token.length : 0,
  });

  if (!token) {
    logCallback({
      step: "missing_token",
      handoff_session: "failed",
      final_redirect: "login_error",
      reason: "missing_token",
    });
    return loginErrorRedirect(origin);
  }

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const serviceSupabase = getServiceRoleClient();

  if (!url || !anonKey || !serviceSupabase) {
    logCallback({
      step: "missing_supabase_config",
      handoff_session: "failed",
      final_redirect: "login_error",
      reason: "missing_supabase_config",
      has_supabase_url: Boolean(url),
      has_anon_key: Boolean(anonKey),
      has_service_role: Boolean(serviceSupabase),
    });
    return loginErrorRedirect(origin);
  }

  try {
    logCallback({ step: "consume_handoff_token_start" });
    const claims = await consumeShopifyHandoffToken(serviceSupabase, token);
    const nextPath = sanitizeHandoffNextPath(claims.next);
    logCallback({
      step: "consume_handoff_token_ok",
      next_path: nextPath,
      customer_email_present: Boolean(claims.email),
    });

    const response = NextResponse.redirect(`${origin}${nextPath}`);
    const cookieStore = cookies();
    /** @type {string[]} */
    const cookiesSet = [];

    const sessionSupabase = createServerClient(url, anonKey, {
      cookieOptions: {
        secure: true,
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Request-scope cookie store may be read-only in some contexts.
            }
            response.cookies.set(name, value, options);
            cookiesSet.push(name);
          });
        },
      },
    });

    logCallback({ step: "find_or_create_user_start" });
    const account = await findOrCreateGemGradeUser(serviceSupabase, claims.email);
    logCallback({
      step: "find_or_create_user_ok",
      user_created: account.created,
      customer_email_present: Boolean(account.email),
    });

    logCallback({ step: "establish_session_start" });
    const user = await establishGemGradeSession(
      serviceSupabase,
      sessionSupabase,
      account.email,
    );
    logCallback({
      step: "establish_session_ok",
      user_id_present: Boolean(user?.id),
      cookies_set_count: cookiesSet.length,
      cookie_names: cookiesSet.map((name) => name.slice(0, 24)),
    });

    try {
      logCallback({ step: "finalize_user_start" });
      await finalizeShopifyHandoffUser(serviceSupabase, {
        id: user.id,
        email: user.email ?? account.email,
        created_at: user.created_at,
      });
      logCallback({ step: "finalize_user_ok" });
    } catch (fulfillError) {
      console.error(
        "shopify handoff credit fulfillment failed:",
        fulfillError,
      );
      logCallback({
        step: "finalize_user_failed",
        reason: "credit_fulfillment_failed",
      });
    }

    logCallback({
      step: "redirecting",
      handoff_session: "ok",
      user_created: account.created,
      customer_email_present: Boolean(account.email),
      final_redirect: nextPath,
      cookies_set_count: cookiesSet.length,
    });

    return response;
  } catch (error) {
    const code =
      error instanceof ShopifyHandoffError ? error.code : "shopify_handoff_error";
    logCallback({
      step: "failed",
      handoff_session: "failed",
      final_redirect: "login_error",
      reason: code,
    });
    console.error("shopify handoff callback failed:", code, error);
    return loginErrorRedirect(origin, "shopify_handoff_error");
  }
}
