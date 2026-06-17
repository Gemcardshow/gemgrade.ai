import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  hasUsableSupabasePublicConfig,
} from "./env.js";

/**
 * @param {import("next/server").NextRequest} request
 * @returns {import("next/server").NextResponse}
 */
function passthroughResponse(request) {
  return NextResponse.next({ request });
}

/**
 * Supabase session refresh for Edge middleware (currently unused — see root middleware.js).
 * Kept for re-enable after launch; auth uses client + /auth/callback + Pages API routes.
 *
 * @param {import("next/server").NextRequest} request
 */
export async function updateSession(request) {
  let supabaseResponse = passthroughResponse(request);

  if (!hasUsableSupabasePublicConfig()) {
    return supabaseResponse;
  }

  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });
          } catch {
            // Request cookies are read-only in some Edge runtimes.
          }

          supabaseResponse = passthroughResponse(request);

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    const { error } = await supabase.auth.getUser();
    if (error) {
      console.warn("Supabase middleware session refresh:", error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Supabase middleware session refresh failed:", message);
    return passthroughResponse(request);
  }

  return supabaseResponse;
}
