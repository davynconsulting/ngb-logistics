/**
 * Content Security Policy for pages (Sprint 5). A fresh nonce per request: Next.js reads it from the
 * request's Content-Security-Policy header and puts it on its own scripts, so only scripts we serve
 * run. 'strict-dynamic' lets those scripts load the app's chunks; nothing else may run, inline or not.
 *
 * - connect-src: the app itself and Supabase (the upload form sends files straight to Storage).
 * - style-src-attr 'unsafe-inline': server-rendered style="" attributes (UI components). Nonces
 *   cannot cover attributes; styles cannot run code.
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
    ["style-src", "'self'", ...(opts.dev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    ["style-src-attr", "'unsafe-inline'"],
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
