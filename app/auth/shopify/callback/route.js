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

  if (!token) {
    return loginErrorRedirect(origin);
  }

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const serviceSupabase = getServiceRoleClient();

  if (!url || !anonKey || !serviceSupabase) {
    return loginErrorRedirect(origin);
  }

  try {
    const claims = await consumeShopifyHandoffToken(serviceSupabase, token);
    const nextPath = sanitizeHandoffNextPath(claims.next);
    const response = NextResponse.redirect(`${origin}${nextPath}`);
    const cookieStore = cookies();

    const sessionSupabase = createServerClient(url, anonKey, {
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

    const account = await findOrCreateGemGradeUser(serviceSupabase, claims.email);

    const user = await establishGemGradeSession(
      serviceSupabase,
      sessionSupabase,
      account.email,
    );

    try {
      await finalizeShopifyHandoffUser(serviceSupabase, {
        id: user.id,
        email: user.email ?? account.email,
        created_at: user.created_at,
      });
    } catch (fulfillError) {
      console.error(
        "shopify handoff credit fulfillment failed:",
        fulfillError,
      );
    }

    return response;
  } catch (error) {
    const code =
      error instanceof ShopifyHandoffError ? error.code : "shopify_handoff_error";
    console.error("shopify handoff callback failed:", code, error);
    return loginErrorRedirect(origin, "shopify_handoff_error");
  }
}
