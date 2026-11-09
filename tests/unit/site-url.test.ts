import { describe, expect, it } from "vitest";
import { resolveSiteOrigin } from "@/lib/site-url";

describe("resolveSiteOrigin (links in e-mails and invitations)", () => {
  it("uses SITE_URL and ignores the request host", () => {
    expect(resolveSiteOrigin({ SITE_URL: "https://ngb-logistics-staging.vercel.app/" }, "evil.example", "https")).toBe("https://ngb-logistics-staging.vercel.app");
  });
  it("refuses a plain-http SITE_URL except on localhost", () => {
    expect(() => resolveSiteOrigin({ SITE_URL: "http://ngb.example" }, null, null)).toThrow(/https/);
    expect(resolveSiteOrigin({ SITE_URL: "http://localhost:3000" }, null, null)).toBe("http://localhost:3000");
  });
  it("falls back to Vercel's production address", () => {
    expect(resolveSiteOrigin({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "ngb-logistics-staging.vercel.app" }, "evil.example", null))
      .toBe("https://ngb-logistics-staging.vercel.app");
  });
  it("on Vercel without an address it fails instead of trusting the host", () => {
    expect(() => resolveSiteOrigin({ VERCEL: "1" }, "evil.example", "https")).toThrow(/SITE_URL/);
  });
  it("uses the request host only on localhost", () => {
    expect(resolveSiteOrigin({}, "localhost:3123", null)).toBe("http://localhost:3123");
    expect(resolveSiteOrigin({}, "127.0.0.1:3000", null)).toBe("http://127.0.0.1:3000");
    expect(() => resolveSiteOrigin({}, "evil.example", "https")).toThrow(/SITE_URL/);
    expect(() => resolveSiteOrigin({}, "localhost.evil.example", null)).toThrow();
  });
});
