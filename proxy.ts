import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { areaOf, canUseArea, homePathFor, isAppRole } from "@/lib/auth/roles";
import { buildCsp, createNonce } from "@/lib/security/csp";

/**
 * Runs before every page request (see `config.matcher`).
 *
 * 1. Refreshes the Supabase session cookie when the access token is near expiry.
 * 2. Sets the Content-Security-Policy with a fresh nonce (lib/security/csp.ts). Next.js reads it
 *    from the forwarded request header and adds the nonce to its own scripts.
 * 3. Routes coarsely by role. Signed-out users are sent to /login, clients
 *    away from /admin and staff away from /portal.
 *
 * Routing only. It is NOT the security boundary: every page re-checks the
 * user through the DAL (lib/dal/session.ts) and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV === "development" });
  /** Continue to the page with the CSP (and any refreshed cookies) on the forwarded request. */
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = forward();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // no-store headers: a response that sets auth cookies must never be
          // cached and served to another user
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getClaims() verifies the JWT (signature + expiry) and refreshes it if needed.
  // Do not put other code between createServerClient and this call.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = claims?.app_metadata?.role;

  const { pathname, search } = request.nextUrl;
  const area = areaOf(pathname);

  /** Redirect while keeping any refreshed session cookies. */
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  };

  if (area) {
    if (!claims) {
      return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
    }
    if (!isAppRole(role)) {
      return redirectTo("/login?error=no_access");
    }
    if (!canUseArea(role, area)) {
      return redirectTo(homePathFor(role));
    }
    // Signed-in pages are personal: never cache them in shared caches
    response.headers.set("Cache-Control", "private, no-store");
  }

  // Already signed in: skip the sign-in page
  if (pathname === "/login" && claims && isAppRole(role)) {
    return redirectTo(homePathFor(role));
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static files, images, the service worker/manifest,
    // public icons and background-job/webhook endpoints (they use their own auth)
    "/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.webmanifest|icons/|api/jobs/|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
