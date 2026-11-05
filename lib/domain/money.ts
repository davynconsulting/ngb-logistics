import Decimal from "decimal.js";

/**
 * Decimal-safe money helpers (FRS §9 rules 2, 3 and 5).
 *
 * - Amounts travel as strings ("1250.50"), matching Postgres numeric(14,2).
 *   Never use JavaScript floating-point numbers for money.
 * - Every amount carries its currency; combining different currencies throws.
 * - The database remains the source of truth for balances. These helpers are
 *   for validation, display and UI previews.
 */

export const CURRENCIES = ["USD", "TZS", "KES", "RWF"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Money = Readonly<{ amount: string; currency: Currency }>;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Largest absolute value numeric(14,2) can store. */
const MAX_ABS = new D("999999999999.99");
const AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} and ${b} amounts`);
    this.name = "CurrencyMismatchError";
  }
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Creates a Money value. Accepts a decimal string with at most 2 decimal
 * places (no thousands separators). Throws on anything else, including
 * numbers, so floats can't sneak in.
 */
export function money(amount: string, currency: Currency): Money {
  const trimmed = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new Error(`Invalid amount "${amount}": use digits with up to 2 decimals`);
  }
  if (!isCurrency(currency)) throw new Error(`Unsupported currency "${currency}"`);
  const d = new D(trimmed);
  if (d.abs().gt(MAX_ABS)) throw new Error("Amount is too large");
  return Object.freeze({ amount: d.toFixed(2), currency });
}

function sameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(new D(a.amount).plus(b.amount).toFixed(2), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(new D(a.amount).minus(b.amount).toFixed(2), a.currency);
}

/** Sums amounts that must all share `currency`; an empty list sums to zero. */
export function sum(items: readonly Money[], currency: Currency): Money {
  return items.reduce((acc, m) => add(acc, m), money("0", currency));
}

/** -1, 0 or 1. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return new D(a.amount).comparedTo(b.amount) as -1 | 0 | 1;
}

export function isZero(m: Money) {
  return new D(m.amount).isZero();
}

export function isNegative(m: Money) {
  return new D(m.amount).isNegative() && !new D(m.amount).isZero();
}

/**
 * Remaining balance = invoice total − verified payments (FRS §9.5).
 * Throws instead of returning a negative balance: overpayments must go
 * through an explicit credit/refund workflow.
 */
export function balanceDue(total: Money, verifiedPayments: readonly Money[]): Money {
  const balance = subtract(total, sum(verifiedPayments, total.currency));
  if (isNegative(balance)) {
    throw new Error("Payments exceed invoice total; record a credit or refund instead");
  }
  return balance;
}

/**
 * Formats for display, e.g. "USD 1,250.50" or "RWF 150,000".
 * Passes the string (not a float) to Intl so no precision is lost.
 */
export function formatMoney(m: Money, locale = "en"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
    currencyDisplay: "code",
  }).format(m.amount as `${number}`);
}
