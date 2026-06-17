import { NextResponse } from "next/server";
import { updateSession } from "./lib/supabase/middleware.js";

export async function middleware(request) {
  try {
    return await updateSession(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Middleware invocation failed:", message);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
