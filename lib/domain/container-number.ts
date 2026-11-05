/**
 * ISO 6346 shipping-container identifiers, e.g. "CSQU 305438 3".
 *
 *   CSQ   owner code (3 letters)
 *   U     equipment category: U (freight container), J (detachable equipment), Z (trailer/chassis)
 *   305438 serial number (6 digits)
 *   3     check digit
 *
 * The same rule is enforced again in Postgres (Sprint 1 migration) so the
 * database never stores an invalid number, whatever the client sends.
 */

const FORMAT = /^[A-Z]{3}[UJZ]\d{6}\d$/;

/** Letter values skip multiples of 11 (11, 22, 33). */
const LETTER_VALUES: Record<string, number> = (() => {
  const values: Record<string, number> = {};
  let v = 10;
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++;
    values[letter] = v++;
  }
  return values;
})();

/** Uppercases and removes spaces, dashes and dots ("csqu-305438.3" → "CSQU3054383"). */
export function normalizeContainerNumber(input: string): string {
  return input.toUpperCase().replace(/[\s\-.]/g, "");
}

/** Computes the check digit for the first 10 characters (owner code + category + serial). */
export function computeCheckDigit(first10: string): number {
  if (!/^[A-Z]{4}\d{6}$/.test(first10)) {
    throw new Error("Expected 4 letters followed by 6 digits");
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i];
    const value = i < 4 ? LETTER_VALUES[ch] : Number(ch);
    sum += value * 2 ** i;
  }
  return (sum % 11) % 10;
}

export type ContainerNumberResult =
  | { valid: true; value: string }
  | { valid: false; value: string; reason: "format" | "check_digit" };

/** Validates a container number and returns its normalized form. */
export function validateContainerNumber(input: string): ContainerNumberResult {
  const value = normalizeContainerNumber(input);
  if (!FORMAT.test(value)) return { valid: false, value, reason: "format" };
  const expected = computeCheckDigit(value.slice(0, 10));
  if (expected !== Number(value[10])) {
    return { valid: false, value, reason: "check_digit" };
  }
  return { valid: true, value };
}

export function isValidContainerNumber(input: string): boolean {
  return validateContainerNumber(input).valid;
}
