import path from "node:path";
import type { NextConfig } from "next";

/*
 * Security headers for every response. Pages get their full Content-Security-Policy, with a
 * per-request nonce, from proxy.ts (lib/security/csp.ts); this CSP covers what the proxy skips
 * (static files, job endpoints) and is compatible with the page policy.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // no GPS in Phase 1; camera is kept for driver photo evidence
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      { source: "/offline.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  // Off since Sprint 5: a nonce CSP needs every page rendered per request; prebuilt shells
  // (Cache Components / partial prerendering) cannot carry the nonce. Measured cost: ~8 ms first byte.
  cacheComponents: false,
  turbopack: {
    // Pin the project root: there's an unrelated package-lock.json in the home folder.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
