import { createSupabaseBrowserClient } from "./supabase/browser.js";

/**
 * Same-origin fetch that forwards Supabase session cookies and Bearer token.
 * Pages API routes accept either cookie sessions or Authorization headers.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function fetchAuthed(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const supabase = createSupabaseBrowserClient();

  if (supabase) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
    }
  }

  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });
}
