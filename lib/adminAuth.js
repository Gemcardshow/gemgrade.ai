import { requireAuth } from "./auth.js";

/**
 * @returns {string[]}
 */
export function parseAdminEmails() {
  const raw = process.env.ADMIN_EMAILS?.trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {{ email?: string | null } | null | undefined} user
 * @returns {boolean}
 */
export function isAdminUser(user) {
  const email = user?.email?.trim().toLowerCase();

  if (!email) {
    return false;
  }

  return parseAdminEmails().includes(email);
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @returns {Promise<import("@supabase/supabase-js").User | null>}
 */
export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);

  if (!user) {
    return null;
  }

  if (!isAdminUser(user)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return user;
}
