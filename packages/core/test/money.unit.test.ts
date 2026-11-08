import { describe, expect, it } from "vitest";
import { allocate, dec, documentTotals, lineTotals, money, toDb } from "../src/money";

describe("money", () => {
  it("avoids floating point errors", () => {
    expect(dec("0.1").plus("0.2").toString()).toBe("0.3");
    expect(toDb(dec("1.005"))).toBe("1.01"); // half-up
    expect(toDb(dec("2.675"))).toBe("2.68");
  });

  it("computes line totals with VAT rounded per line", () => {
    const l = lineTotals({ unitPrice: "10.333", quantity: "3", vatRate: "0.15" });
    expect(l.gross.toFixed(2)).toBe("31.00");
    expect(l.vat.toFixed(2)).toBe("4.65");
    expect(l.total.toFixed(2)).toBe("35.65");
  });

  it("applies discounts before VAT and rejects excessive discount", () => {
    const l = lineTotals({ unitPrice: "100", quantity: "2", discount: "20", vatRate: "0.15" });
    expect(l.net.toFixed(2)).toBe("180.00");
    expect(l.vat.toFixed(2)).toBe("27.00");
    expect(() => lineTotals({ unitPrice: "1", quantity: "1", discount: "2" })).toThrow();
  });

  it("handles VAT-inclusive prices", () => {
    const l = lineTotals({ unitPrice: "115", quantity: "1", vatRate: "0.15", pricesIncludeVat: true });
    expect(l.net.toFixed(2)).toBe("100.00");
    expect(l.vat.toFixed(2)).toBe("15.00");
  });

  it("rejects negative quantities and prices", () => {
    expect(() => lineTotals({ unitPrice: "-1", quantity: "1" })).toThrow();
    expect(() => lineTotals({ unitPrice: "1", quantity: "-1" })).toThrow();
  });

  it("document totals include shipping VAT", () => {
    const lines = [lineTotals({ unitPrice: "50", quantity: "2", vatRate: "0.15" }), lineTotals({ unitPrice: "19.99", quantity: "1", vatRate: "0.15" })];
    const t = documentTotals(lines, { shipping: "25", vatRate: "0.15" });
    expect(t.net.toFixed(2)).toBe("119.99");
    expect(t.vat.toFixed(2)).toBe((15 + 3 + 3.75).toFixed(2));
    expect(t.total.toFixed(2)).toBe(money(dec("119.99").plus("21.75").plus("25")).toFixed(2));
  });

  it("allocates exactly without losing cents", () => {
    const parts = allocate("100.00", [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(parts.reduce((a, b) => a.plus(b), dec(0)).toFixed(2)).toBe("100.00");
    expect(allocate("10", [0, 0]).map((p) => p.toFixed(2))).toEqual(["10.00", "0.00"]);
  });
});
