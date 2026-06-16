import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "./env.js";

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let serviceRoleClient = null;

/**
 * Service-role client for server-side writes (credits, admin).
 * Bypasses RLS — use only in trusted API routes.
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function getServiceRoleClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceRoleKey();

  if (!url || !key) {
    return null;
  }

  if (!serviceRoleClient) {
    serviceRoleClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return serviceRoleClient;
}

/**
 * Cookie-backed Supabase client for App Router server components / route handlers.
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Read-only in Server Components; middleware refreshes sessions.
        }
      },
    },
  });
}
