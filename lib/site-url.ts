/*
 * The address used in links we send (password reset, invitations).
 *
 * Deployed sites must never build these from the request's Host header: anyone
 * can send a request with Host: evil.example. Order:
 *   1. SITE_URL (set per environment on Vercel, e.g. https://ngb-logistics-staging.vercel.app)
 *   2. Vercel's own production address (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel)
 *   3. local development / `next start` only: the request's host
 * Supabase additionally refuses redirect targets missing from the project's
 * allow-list (Auth → URL configuration), so a wrong value fails closed.
 */
type Env = Record<string, string | undefined>;

export function resolveSiteOrigin(env: Env, host: string | null, proto: string | null): string {
  if (env.SITE_URL) {
    const u = new URL(env.SITE_URL);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") {
      throw new Error("SITE_URL must be an https address");
    }
    return u.origin;
  }
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL) throw new Error("Set SITE_URL for this Vercel environment");
  const h = host ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
  if (!local) throw new Error("Set SITE_URL: links are only built from the request host on localhost");
  return `${proto === "https" ? "https" : "http"}://${h}`;
}
