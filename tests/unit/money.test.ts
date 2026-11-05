import { describe, expect, it } from "vitest";
import {
  add,
  balanceDue,
  compare,
  CurrencyMismatchError,
  formatMoney,
  money,
  subtract,
  sum,
} from "@/lib/domain/money";

describe("money", () => {
  it("normalizes to two decimals", () => {
    expect(money("12", "USD").amount).toBe("12.00");
    expect(money("12.5", "USD").amount).toBe("12.50");
  });

  it("avoids floating-point errors", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in plain JS
    expect(add(money("0.10", "USD"), money("0.20", "USD")).amount).toBe("0.30");
  });

  it.each(["1,000", "12.345", "abc", "", "1e5", " "])("rejects invalid amount %j", (a) => {
    expect(() => money(a, "USD")).toThrow();
  });

  it("rejects amounts beyond numeric(14,2)", () => {
    expect(() => money("1000000000000.00", "USD")).toThrow(/too large/);
    expect(money("999999999999.99", "USD").amount).toBe("999999999999.99");
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money("1", "USD"), money("1", "RWF"))).toThrow(CurrencyMismatchError);
    expect(() => compare(money("1", "USD"), money("1", "KES"))).toThrow(CurrencyMismatchError);
  });

  it("sums and subtracts", () => {
    const total = sum([money("100.10", "TZS"), money("200.20", "TZS")], "TZS");
    expect(total.amount).toBe("300.30");
    expect(subtract(total, money("0.30", "TZS")).amount).toBe("300.00");
    expect(sum([], "KES").amount).toBe("0.00");
  });

  it("computes balance due from partial payments (AC-11)", () => {
    const total = money("1500.00", "USD");
    const balance = balanceDue(total, [money("500.00", "USD"), money("250.50", "USD")]);
    expect(balance.amount).toBe("749.50");
    expect(balanceDue(total, [money("1500.00", "USD")]).amount).toBe("0.00");
  });

  it("refuses an overpaid (negative) balance", () => {
    expect(() => balanceDue(money("100.00", "USD"), [money("100.01", "USD")])).toThrow(
      /credit or refund/,
    );
  });

  it("formats with the currency code (non-breaking space keeps code and amount together)", () => {
    expect(formatMoney(money("1250.5", "USD"))).toBe("USD\u00a01,250.50");
    expect(formatMoney(money("150000", "RWF"))).toBe("RWF\u00a0150,000");
  });
});
