import { NextResponse } from "next/server";

/**
 * Launch hotfix: Supabase session refresh disabled in Edge middleware.
 * Auth continues via client Supabase, Pages API cookie clients, and /auth/callback.
 * Re-enable updateSession from lib/supabase/middleware.js once Edge runtime is stable.
 */
export async function middleware(request) {
  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
