import { describe, expect, it } from "vitest";
import { ago, healthVerdict, type HealthInput } from "@/lib/domain/notifications";

const now = Date.parse("2026-11-09T12:00:00Z");
const base: HealthInput = {
  pending_count: 0, oldest_pending_at: null, last_sent_at: "2026-11-09T11:58:00Z",
  failed_24h: 0, sender_paused: false, sender_configured: true, stalled: false,
};

describe("ago", () => {
  it("words elapsed time", () => {
    expect(ago(null, now)).toBe("never");
    expect(ago("2026-11-09T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-11-09T11:15:00Z", now)).toBe("45 min ago");
    expect(ago("2026-11-09T02:00:00Z", now)).toBe("10 h ago");
    expect(ago("2026-11-05T12:00:00Z", now)).toBe("4 days ago");
  });
});

describe("healthVerdict", () => {
  it("normal", () => expect(healthVerdict(base, now)).toMatchObject({ level: "ok", title: "Sending normally" }));
  it("failures but sending", () => expect(healthVerdict({ ...base, failed_24h: 3 }, now)).toMatchObject({ level: "warning" }));
  it("stalled is an error and says milestones are safe", () => {
    const v = healthVerdict({ ...base, stalled: true, pending_count: 12, oldest_pending_at: "2026-11-09T11:30:00Z", last_sent_at: "2026-11-09T10:00:00Z" }, now);
    expect(v.level).toBe("error");
    expect(v.detail).toContain("12 messages waiting, oldest queued 30 min ago");
    expect(v.detail).toContain("2 h ago");
    expect(v.detail).toContain("Milestones");
  });
  it("paused wins over stalled (expected while paused)", () =>
    expect(healthVerdict({ ...base, stalled: true, sender_paused: true }, now)).toMatchObject({ level: "warning", title: "Sending is paused" }));
  it("not configured", () => expect(healthVerdict({ ...base, sender_configured: false, stalled: true }, now).title).toBe("The sender is not set up"));
  it("singular", () => expect(healthVerdict({ ...base, pending_count: 1 }, now).detail).toMatch(/^1 message waiting/));
});
