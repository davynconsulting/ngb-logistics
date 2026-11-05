import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase Auth emails (password reset, invites).
 * Exchanges the one-time code/token for a session, then continues to `next`
 * (local paths only).
 */
const ALLOWED_NEXT = new Set(["/update-password", "/portal", "/admin"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "";
  const destination = ALLOWED_NEXT.has(next) ? next : "/login";

  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  const response = NextResponse.redirect(new URL(ok ? destination : "/login?error=link_invalid", origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
