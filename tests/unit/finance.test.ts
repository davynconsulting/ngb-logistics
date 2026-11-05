import { describe, expect, it } from "vitest";
import {
  canReadFinance, canVerifyPayments, canWriteFinance, filterStatuses, formatAmount, isOpenInvoice, isPositiveAmount,
  parseInvoiceFilter, previewLine, previewTotals,
} from "@/lib/domain/finance";
import {
  creditNoteSchema, invoiceDraftSchema, issueInvoiceSchema, recordPaymentSchema, reviewPaymentSchema,
} from "@/lib/validation/finance";

const line = (quantity: string, unit_price: string, tax_rate = "0") => ({ description: "x", quantity, unit_price, tax_rate });

describe("invoice preview mirrors the database (0021)", () => {
  it("the zero-rated + taxed example totals 2091.18", () => {
    expect(previewTotals([line("1", "1500.00"), line("2", "250.50", "18")])).toEqual({ subtotal: "2001.00", tax: "90.18", total: "2091.18" });
  });
  it("rounds per line, half away from zero", () => {
    expect(previewLine(line("0.333", "10.00", "18"))).toEqual({ amount: "3.33", tax: "0.60" });
    expect(previewLine(line("1", "0.05", "10"))).toEqual({ amount: "0.05", tax: "0.01" }); // 0.005 → 0.01
  });
  it("no floating-point drift", () => {
    expect(previewTotals([line("3", "0.10"), line("1", "0.20")])?.total).toBe("0.50");
  });
  it.each([
    [line("0", "10.00"), /Quantity/], [line("1.2345", "10.00"), /Quantity/], [line("1", "10.005"), /Price/],
    [line("1", "-5"), /Price/], [line("1", "10", "101"), /Tax/], [line("1", "1e3"), /Price/],
  ])("refuses bad input %#", (l, re) => {
    const p = previewLine(l);
    expect("error" in p && re.test(p.error)).toBe(true);
  });
  it("an invalid line means no total", () => expect(previewTotals([line("1", "10"), line("0", "1")])).toBeNull());
});

describe("display", () => {
  it("groups thousands without converting to a float", () => {
    expect(formatAmount("1234567.5", "RWF")).toBe("1,234,567.50 RWF");
    expect(formatAmount("999999999999.99", "TZS")).toBe("999,999,999,999.99 TZS");
    expect(formatAmount("0", "USD")).toBe("0.00 USD");
  });
  it("open invoices", () => {
    expect(isOpenInvoice("overdue")).toBe(true);
    expect(isOpenInvoice("paid")).toBe(false);
    expect(isOpenInvoice("draft")).toBe(false);
  });
});

describe("finance permissions (mirror 0021)", () => {
  it("only finance verifies; finance and admin write; ops managers read", () => {
    expect(canVerifyPayments("finance")).toBe(true);
    expect(canVerifyPayments("admin")).toBe(false);
    expect(canWriteFinance("admin")).toBe(true);
    expect(canWriteFinance("ops_manager")).toBe(false);
    expect(canReadFinance("ops_manager")).toBe(true);
    for (const r of ["client", "driver", "doc_officer", "clearing_agent", "transport_coord"] as const) expect(canReadFinance(r)).toBe(false);
  });
});

describe("invoice filters", () => {
  it("defaults to open and maps statuses", () => {
    expect(parseInvoiceFilter("nonsense")).toBe("open");
    expect(filterStatuses("open")).toEqual(["issued", "partially_paid", "overdue", "disputed"]);
    expect(filterStatuses("all")).toBeNull();
    expect(filterStatuses("void")).toEqual(["void"]);
  });
});

describe("finance form validation", () => {
  const ship = "6f1c8a52-4d7b-4f3a-9a0e-2b6c1d9e8f70";
  it("accepts a valid draft and keeps amounts as strings", () => {
    const r = invoiceDraftSchema.safeParse({ shipmentId: ship, currency: "USD",
      lines: [{ description: " Port handling ", quantity: "2", unit_price: "150.25", tax_rate: "" }] });
    expect(r.success).toBe(true);
    expect(r.data?.lines[0]).toEqual({ description: "Port handling", quantity: "2", unit_price: "150.25", tax_rate: "0" });
  });
  it("rejects bad lines, currencies and empty drafts", () => {
    const bad = (lines: unknown, currency = "USD") => invoiceDraftSchema.safeParse({ shipmentId: ship, currency, lines }).success;
    expect(bad([])).toBe(false);
    expect(bad([{ description: "x", quantity: "1", unit_price: "1.005", tax_rate: "0" }])).toBe(false);
    expect(bad([{ description: "x", quantity: "0", unit_price: "1", tax_rate: "0" }])).toBe(false);
    expect(bad([{ description: "x", quantity: "1", unit_price: "1", tax_rate: "101" }])).toBe(false);
    expect(bad([{ description: "", quantity: "1", unit_price: "1", tax_rate: "0" }])).toBe(false);
    expect(bad([{ description: "x", quantity: "1", unit_price: "1", tax_rate: "0" }], "EUR")).toBe(false);
  });
  it("amounts: positive, at most 2 decimals, no floats or separators", () => {
    expect(isPositiveAmount("0.01")).toBe(true);
    for (const v of ["0", "0.00", "-5", "1,000", "1e3", "1.234", ""]) expect(isPositiveAmount(v)).toBe(false);
  });
  it("payments need a reference unless cash", () => {
    const base = { amount: "100.00", paidAt: "2026-11-04T08:00:00.000Z" };
    expect(recordPaymentSchema.safeParse({ ...base, method: "bank_transfer" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, method: "bank_transfer", reference: "BK-77812" }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...base, method: "cash" }).success).toBe(true);
  });
  it("rejecting a payment needs a reason; verifying does not", () => {
    expect(reviewPaymentSchema.safeParse({ decision: "verified" }).success).toBe(true);
    expect(reviewPaymentSchema.safeParse({ decision: "rejected", reason: "" }).success).toBe(false);
    expect(reviewPaymentSchema.safeParse({ decision: "rejected", reason: "Not on statement" }).success).toBe(true);
    expect(reviewPaymentSchema.safeParse({ decision: "maybe" }).success).toBe(false);
  });
  it("credit notes need an amount and reason; due date not before issue", () => {
    expect(creditNoteSchema.safeParse({ amount: "50.00", reason: "ok" }).success).toBe(false);
    expect(creditNoteSchema.safeParse({ amount: "50.00", reason: "Storage waived" }).success).toBe(true);
    expect(issueInvoiceSchema.safeParse({ issueDate: "2026-11-05", dueDate: "2026-11-01" }).success).toBe(false);
    expect(issueInvoiceSchema.safeParse({ issueDate: "", dueDate: "" }).success).toBe(true);
  });
});

describe("client balance per currency", async () => {
  const { owedByCurrency } = await import("@/lib/domain/client-finance");
  it("sums open invoices per currency only, exactly, with overdue separately", () => {
    const r = owedByCurrency([
      { status: "issued", currency: "USD", balance_due: "0.10" },
      { status: "overdue", currency: "USD", balance_due: "0.20" },
      { status: "partially_paid", currency: "RWF", balance_due: "150000.00" },
      { status: "paid", currency: "USD", balance_due: "0.00" },
      { status: "void", currency: "KES", balance_due: "0.00" },
      { status: "disputed", currency: "RWF", balance_due: "50000.50" },
    ]);
    expect(r).toEqual([
      { currency: "RWF", owed: "200000.50", overdue: "0.00", count: 2 },
      { currency: "USD", owed: "0.30", overdue: "0.20", count: 2 }, // 0.1 + 0.2 without float error
    ]);
  });
});
