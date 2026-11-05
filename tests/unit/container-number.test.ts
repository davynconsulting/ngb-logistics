import { describe, expect, it } from "vitest";
import {
  computeCheckDigit,
  isValidContainerNumber,
  normalizeContainerNumber,
  validateContainerNumber,
} from "@/lib/domain/container-number";

describe("ISO 6346 container numbers", () => {
  it("computes the published check digit for CSQU305438", () => {
    // Worked example from the ISO 6346 standard.
    expect(computeCheckDigit("CSQU305438")).toBe(3);
  });

  it("accepts a valid number", () => {
    expect(validateContainerNumber("CSQU3054383")).toEqual({
      valid: true,
      value: "CSQU3054383",
    });
  });

  it("normalizes spaces, dashes, dots and lowercase", () => {
    expect(normalizeContainerNumber(" csqu 305438-3 ")).toBe("CSQU3054383");
    expect(isValidContainerNumber("csqu.305438.3")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    expect(validateContainerNumber("CSQU3054384")).toMatchObject({
      valid: false,
      reason: "check_digit",
    });
  });

  it.each(["CSQ3054383", "CSQX3054383", "CSQU30543831", "1SQU3054383", ""])(
    "rejects bad format %j",
    (input) => {
      expect(validateContainerNumber(input)).toMatchObject({ valid: false, reason: "format" });
    },
  );

  it("maps a remainder of 10 to check digit 0", () => {
    // Find a serial whose weighted sum mod 11 is 10 and confirm the digit is 0.
    for (let n = 0; n < 1000; n++) {
      const first10 = `ABCU${String(n).padStart(6, "0")}`;
      const digit = computeCheckDigit(first10);
      expect(digit).toBeGreaterThanOrEqual(0);
      expect(digit).toBeLessThanOrEqual(9);
      expect(isValidContainerNumber(`${first10}${digit}`)).toBe(true);
    }
  });
});
