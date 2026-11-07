import { describe, expect, it } from "vitest";
import { canSeeOpsReports, formatHours, parsePeriod, percent } from "@/lib/domain/reports";

describe("reports helpers", () => {
  it("accepts only the offered periods, defaulting to 90 days", () => {
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("365")).toBe(365);
    expect(parsePeriod("7")).toBe(90);
    expect(parsePeriod(undefined)).toBe(90);
    expect(parsePeriod(["30", "90"])).toBe(90);
  });
  it("formats hours, adding days from 48 h", () => {
    expect(formatHours(50)).toBe("50 h (2.1 d)");
    expect(formatHours("12.25")).toBe("12.3 h");
    expect(formatHours(0)).toBe("0 h");
    expect(formatHours(null)).toBe("—");
    expect(formatHours("abc")).toBe("—");
  });
  it("percent never divides by zero", () => {
    expect(percent(1, 3)).toBe("33%");
    expect(percent(0, 0)).toBe("—");
  });
  it("operational reports are for admin and operations managers only", () => {
    expect(canSeeOpsReports("admin")).toBe(true);
    expect(canSeeOpsReports("ops_manager")).toBe(true);
    expect(canSeeOpsReports("finance")).toBe(false);
    expect(canSeeOpsReports("client")).toBe(false);
  });
});
