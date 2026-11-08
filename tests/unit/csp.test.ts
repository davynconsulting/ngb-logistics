import { describe, expect, it } from "vitest";
import { buildCsp, createNonce } from "@/lib/security/csp";

const SUPA = "https://abcdefgh.supabase.co";
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.split(" ")[0] === name);

describe("content security policy", () => {
  it("nonces are random, 128-bit, base64", () => {
    const a = createNonce(), b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
  it("production: scripts only with the nonce, no inline, no eval", () => {
    const csp = buildCsp("N0nce", { supabaseUrl: SUPA });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-N0nce' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
    // inline styles allowed (libraries inject <style>); no nonce, or browsers would ignore 'unsafe-inline'
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(csp, "img-src")).toBe("img-src 'self' blob: data:");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("locks down framing, plugins, base and form targets", () => {
    const csp = buildCsp("x", { supabaseUrl: SUPA });
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"])
      expect(csp).toContain(d);
  });
  it("connects only to itself and the Supabase origin (no path, no wildcard)", () => {
    expect(directive(buildCsp("x", { supabaseUrl: SUPA + "/rest/v1/" }), "connect-src")).toBe(`connect-src 'self' ${SUPA}`);
  });
  it("development adds eval for the dev overlay only", () => {
    const csp = buildCsp("x", { supabaseUrl: SUPA, dev: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
