import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "./supabase/env.js";

/**
 * Supabase client for Pages API routes (cookie session).
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {import("@supabase/supabase-js").SupabaseClient | null}
 */
export function createPagesApiClient(req, res) {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    return null;
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? "");
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.appendHeader(
            "Set-Cookie",
            serializeCookieHeader(name, value, options),
          );
        });
      },
    },
  });
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {Promise<import("@supabase/supabase-js").User | null>}
 */
export async function getSessionUser(req, res) {
  const supabase = createPagesApiClient(req, res);
  if (!supabase) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return user;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();

    if (token) {
      const {
        data: { user: bearerUser },
      } = await supabase.auth.getUser(token);

      if (bearerUser) {
        return bearerUser;
      }
    }
  }

  return null;
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {Promise<import("@supabase/supabase-js").User | null>}
 */
export async function requireAuth(req, res) {
  const user = await getSessionUser(req, res);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  return user;
}
