import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting AS THE SIGNED-IN USER (their JWT), so Row Level Security applies.
 *
 * Create a new client per request; never share one across requests.
 * Reads cookies(): with Cache Components, callers must render inside <Suspense>
 * and must never use this inside 'use cache' / 'use cache: remote'.
 */
export async function createClient() {
  // Request-time only: the Supabase client reads the clock (session expiry),
  // which Next.js must never evaluate during prerendering.
  await connection();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: proxy.ts refreshes the session cookie on each request.
          }
        },
      },
    },
  );
}
