import { createBrowserClient } from "@supabase/ssr";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  hasUsableSupabasePublicConfig,
} from "./env.js";

/**
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function createSupabaseBrowserClient() {
  if (!hasUsableSupabasePublicConfig()) {
    return null;
  }

  try {
    return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to create Supabase browser client:", message);
    return null;
  }
}
