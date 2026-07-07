import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ensureCreditProfile,
  grantSignupBonusIfEligible,
} from "../../../lib/credits.js";
import { fulfillPendingGrantsForEmail } from "../../../lib/shopifyCredits.js";
import { getSupabaseAnonKey, getSupabaseUrl } from "../../../lib/supabase/env.js";
import { getServiceRoleClient } from "../../../lib/supabase/server.js";

/** @param {import("next/server").NextRequest} request */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextPath = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  const response = NextResponse.redirect(`${origin}${nextPath}`);
  const cookieStore = cookies();
  const supabase = createServerClient(url, key, {
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
        });
      },
    },
  });

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
  }

  const serviceSupabase = getServiceRoleClient();
  const user = sessionData.user;

  if (serviceSupabase && user) {
    try {
      await ensureCreditProfile(serviceSupabase, user.id, user.email ?? "");
      await grantSignupBonusIfEligible(
        serviceSupabase,
        user.id,
        user.created_at,
      );
      await fulfillPendingGrantsForEmail(
        serviceSupabase,
        user.id,
        user.email ?? "",
      );
    } catch (fulfillError) {
      console.error("auth callback pending grant fulfillment failed:", fulfillError);
    }
  }

  return response;
}
