import { describe, expect, it } from "vitest";
import { checkOrderQuantity, selectPrice } from "../src/supplier-products";
import { normalizeAttributes } from "../src/catalog";
import { resolveUnitCode } from "../src/reference";
import { UNITS } from "../src/reference/data";

const L = (id: string, kind: string, extra: Partial<{ buyerOrgId: string | null; regions: string[]; cities: string[]; pricesIncludeVat: boolean; validFrom: Date | null; validTo: Date | null; isActive: boolean; priority: number }> = {}) => ({
  id,
  kind,
  buyerOrgId: null,
  regions: [],
  cities: [],
  pricesIncludeVat: false,
  validFrom: null,
  validTo: null,
  isActive: true,
  priority: 0,
  ...extra,
});
const I = (minQty: string, unitPrice: string, discountPct = "0") => ({ minQty, unitPrice, discountPct });

describe("price selection", () => {
  const cands = [
    { list: L("retail", "retail"), item: I("1", "100") },
    { list: L("retail", "retail"), item: I("50", "90") },
    { list: L("ent", "enterprise"), item: I("1", "85") },
    { list: L("org", "org_specific", { buyerOrgId: "buyer-1" }), item: I("1", "80") },
    { list: L("reg", "regional", { cities: ["jeddah"] }), item: I("1", "95") },
  ];

  it("individuals get retail with quantity tiers", () => {
    expect(selectPrice(cands, {}, "10", "0.15")!.unitPrice.toFixed(2)).toBe("100.00");
    expect(selectPrice(cands, {}, "50", "0.15")!.unitPrice.toFixed(2)).toBe("90.00");
  });
  it("buyer orgs get enterprise; the matching buyer gets org-specific (most specific wins)", () => {
    expect(selectPrice(cands, { orgId: "buyer-2", orgType: "buyer" }, "1", "0.15")!.kind).toBe("enterprise");
    const r = selectPrice(cands, { orgId: "buyer-1", orgType: "buyer" }, "1", "0.15")!;
    expect(r.kind).toBe("org_specific");
    expect(r.unitPrice.toFixed(2)).toBe("80.00");
  });
  it("regional applies to matching city only", () => {
    expect(selectPrice(cands, { city: "jeddah" }, "1", "0.15")!.kind).toBe("regional");
    expect(selectPrice(cands, { city: "riyadh" }, "1", "0.15")!.kind).toBe("retail");
  });
  it("applies discounts and strips VAT from VAT-inclusive lists", () => {
    const r = selectPrice([{ list: L("x", "retail", { pricesIncludeVat: true }), item: I("1", "115", "10") }], {}, "1", "0.15")!;
    expect(r.unitPrice.toFixed(2)).toBe("90.00");
  });
  it("ignores expired, future and inactive lists", () => {
    const now = new Date("2026-06-01");
    const c = [
      { list: L("old", "retail", { validTo: new Date("2026-01-01") }), item: I("1", "10") },
      { list: L("future", "retail", { validFrom: new Date("2027-01-01") }), item: I("1", "11") },
      { list: L("off", "retail", { isActive: false }), item: I("1", "12") },
    ];
    expect(selectPrice(c, {}, "1", "0.15", now)).toBeNull();
  });
  it("returns null when qty is below every tier", () => {
    expect(selectPrice([{ list: L("r", "retail"), item: I("10", "5") }], {}, "5", "0.15")).toBeNull();
  });
});

describe("order quantity rules", () => {
  it("enforces MOQ and increments", () => {
    expect(checkOrderQuantity({ moq: "10", orderIncrement: "5" }, "10")).toBeNull();
    expect(checkOrderQuantity({ moq: "10", orderIncrement: "5" }, "20")).toBeNull();
    expect(checkOrderQuantity({ moq: "10", orderIncrement: "5" }, "12")).toBe("invalid_increment");
    expect(checkOrderQuantity({ moq: "10", orderIncrement: "5" }, "5")).toBe("below_moq");
    expect(checkOrderQuantity({ moq: "1", orderIncrement: "1" }, "0")).toBe("quantity_positive");
  });
});

describe("attribute normalization", () => {
  const defs = [
    { key: "diameter_mm", dataType: "number", options: [] },
    { key: "material", dataType: "enum", options: [{ value: "upvc" }, { value: "ppr" }], required: true },
  ];
  it("coerces numbers and validates enums", () => {
    expect(normalizeAttributes({ diameter_mm: "110", material: "UPVC" }, defs)).toEqual({ diameter_mm: 110, material: "upvc" });
    expect(() => normalizeAttributes({ material: "steel" }, defs)).toThrow();
    expect(() => normalizeAttributes({ unknown_key: "x" }, defs)).toThrow();
    expect(() => normalizeAttributes({ diameter_mm: "abc" }, defs)).toThrow();
  });
  it("enforces required attributes when asked", () => {
    expect(() => normalizeAttributes({ diameter_mm: 50 }, defs, { enforceRequired: true })).toThrow();
  });
});

describe("unit resolution", () => {
  const rows = UNITS.map((u) => ({ code: u.code, aliases: u.aliases }));
  it("maps Arabic and English aliases", () => {
    expect(resolveUnitCode("م.ط", rows)).toBe("m");
    expect(resolveUnitCode("L.M", rows)).toBe("m");
    expect(resolveUnitCode("عدد", rows)).toBe("pc");
    expect(resolveUnitCode("Nos", rows)).toBe("pc");
    expect(resolveUnitCode("م2", rows)).toBe("m2");
    expect(resolveUnitCode("sq.m", rows)).toBe("m2");
    expect(resolveUnitCode("طن", rows)).toBe("ton");
    expect(resolveUnitCode("xyz", rows)).toBeNull();
  });
});
