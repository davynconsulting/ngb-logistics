/**
 * Content Security Policy for pages (Sprint 5). A fresh nonce per request: Next.js reads it from the
 * request's Content-Security-Policy header and puts it on its own scripts, so only scripts we serve
 * run. 'strict-dynamic' lets those scripts load the app's chunks; nothing else may run, inline or not.
 *
 * - connect-src: the app itself and Supabase (the upload form sends files straight to Storage).
 * - style-src 'unsafe-inline': UI libraries (theme switcher, toasts) inject <style> elements from
 *   JavaScript without a nonce (found by tests/e2e/csp.spec.ts in a real browser). Styles cannot
 *   run code, and CSS cannot leak data out: images, fonts and connections are limited to the app
 *   and Supabase. No nonce here on purpose: browsers ignore 'unsafe-inline' when a nonce is listed.
 * - No 'unsafe-eval' in production. Development needs it (React error overlays).
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function buildCsp(nonce: string, opts: { supabaseUrl: string; dev?: boolean }): string {
  const supabase = new URL(opts.supabaseUrl).origin;
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", supabase],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(opts.dev ? [] : [["upgrade-insecure-requests"] as [string]]),
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}
