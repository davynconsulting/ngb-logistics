import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session and returns to /login. Used by the DAL when a signed-in
 * account is deactivated or has no access (Server Components cannot clear
 * cookies themselves). Normal sign-out uses the signOut Server Action.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const reason = request.nextUrl.searchParams.get("reason") === "no_access" ? "?error=no_access" : "";
  const response = NextResponse.redirect(new URL(`/login${reason}`, request.nextUrl.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
