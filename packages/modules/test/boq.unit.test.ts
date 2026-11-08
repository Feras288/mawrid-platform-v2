import { describe, expect, it } from "vitest";
import { parseLocaleNumber } from "@platform/core/text";
import { classifyCategory, detectMapping, extractAttributes, inferMapping, itemsToLines, linesToGrid, parseRows, type TextItem } from "../src/boq";
import { decide, scoreCandidate } from "../src/matching";
import { resolveUnitCode } from "../src/reference";
import { UNITS } from "../src/reference/data";
import { GOLDEN_LINES, goldenRows } from "./fixtures/boq-golden";

const unitRows = UNITS.map((u) => ({ code: u.code, aliases: u.aliases }));

describe("BOQ extraction — golden set", () => {
  for (const lang of ["ar", "en"] as const) {
    it(`detects header and extracts all lines (${lang} headers)`, () => {
      const rows = goldenRows(lang);
      const m = detectMapping(rows)!;
      expect(m).toMatchObject({ headerRow: 2, itemCode: 0, description: 1, unit: 2, quantity: 3 });
      const lines = parseRows(rows, m, { sheet: "BOQ" });
      // recall/precision: every golden line extracted, nothing else (sections & totals skipped)
      expect(lines.length).toBe(GOLDEN_LINES.length);
      const recall = GOLDEN_LINES.filter((g) => lines.some((l) => l.itemCode === g.code && l.description === g.description)).length / GOLDEN_LINES.length;
      expect(recall).toBe(1);
      for (const l of lines) {
        const g = GOLDEN_LINES.find((x) => x.code === l.itemCode)!;
        expect(l.quantity).toBe(parseLocaleNumber(g.quantity));
        expect(resolveUnitCode(l.unitRaw, unitRows)).toBe(g.unitCode);
        expect(l.section).toBe(g.section);
        expect(l.source).toMatchObject({ sheet: "BOQ" });
      }
    });
  }

  it("infers columns when no header row exists", () => {
    const rows = goldenRows("en").slice(3).filter((r) => r[2]);
    const aliases = new Set(UNITS.flatMap((u) => [u.code, ...u.aliases.map((a) => a.toLowerCase())]));
    const m = inferMapping(rows, aliases)!;
    expect(m.description).toBe(1);
    expect(m.quantity).toBe(3);
    expect(m.unit).toBe(2);
  });

  it("joins wrapped descriptions and flags missing quantities instead of guessing", () => {
    const rows = [
      ["No", "Description", "Unit", "Qty"],
      ["1", "Supply and install uPVC pipe 110mm", "m", "50"],
      ["", "including all fittings, supports, testing and commissioning as per specs", "", ""],
      ["2", "Lump sum item for testing", "LS", ""],
    ];
    const lines = parseRows(rows, detectMapping(rows)!);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.description).toContain("including all fittings");
    expect(lines[1]!.quantity).toBeNull();
    expect(lines[1]!.issues).toContain("quantity_missing");
  });

  it("extracts engineering attributes for the golden lines", () => {
    let hits = 0;
    let total = 0;
    for (const g of GOLDEN_LINES) {
      const a = extractAttributes(g.description);
      for (const [k, v] of Object.entries(g.expect.attrs)) {
        total++;
        if (a[k] === v) hits++;
        else console.warn(`attr miss ${g.code} ${k}: expected ${v} got ${a[k]}`);
      }
    }
    expect(hits / total).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies categories for the golden lines", () => {
    const correct = GOLDEN_LINES.filter((g) => classifyCategory(g.description, g.section)?.slug === g.expect.category).length;
    expect(correct / GOLDEN_LINES.length).toBeGreaterThanOrEqual(0.9);
  });

  it("never invents values that are not in the text", () => {
    expect(extractAttributes("Supply and install pipe for drainage")).toEqual({});
    expect(extractAttributes("cable for lighting circuits")).not.toHaveProperty("cross_section_mm2");
  });
});

describe("PDF text reconstruction", () => {
  it("rebuilds columns from positioned text items anchored on the header line", () => {
    const items: TextItem[] = [];
    const put = (str: string, x: number, y: number) => items.push({ str, x, y, width: str.length * 5, page: 1 });
    put("Item", 40, 700);
    put("Description", 100, 700);
    put("Unit", 400, 700);
    put("Qty", 460, 700);
    put("1", 40, 680);
    put("uPVC pipe 110mm PN10", 100, 680);
    put("m", 402, 680);
    put("120", 462, 680);
    put("2", 40, 660);
    put("Copper cable 4x16mm2", 100, 660);
    put("m", 402, 660);
    put("300", 462, 660);
    const { rows } = linesToGrid(itemsToLines(items));
    const lines = parseRows(rows, detectMapping(rows)!);
    expect(lines.map((l) => [l.description, l.quantity, l.unitRaw])).toEqual([
      ["uPVC pipe 110mm PN10", "120", "m"],
      ["Copper cable 4x16mm2", "300", "m"],
    ]);
  });
});

describe("matching rules", () => {
  const critical = new Set(["material", "diameter_mm", "pressure_class"]);
  const dims = new Map([
    ["m", "length"],
    ["pc", "count"],
  ]);
  const cand = (id: string, attrs: Record<string, string | number>, baseUnit = "m", sim = 0.8) => ({ id, normalizedName: "upvc pipe 110 mm", attributes: attrs, baseUnit, categoryId: "c1", sim });
  const item = { text: "uPVC pipe 110mm", attributes: { material: "upvc", diameter_mm: 110 }, unit: "m", categoryId: "c1" };

  it("rejects candidates with a conflicting critical attribute even if names are similar", () => {
    const s = scoreCandidate(item, cand("a", { material: "upvc", diameter_mm: 160 }), critical, dims);
    expect(s.rejected).toBe(true);
  });
  it("rejects unit dimension conflicts", () => {
    expect(scoreCandidate(item, cand("a", { material: "upvc", diameter_mm: 110 }, "pc"), critical, dims).rejected).toBe(true);
  });
  it("caps confidence when the BOQ line lacks a critical attribute the product defines", () => {
    const s = scoreCandidate(item, cand("a", { material: "upvc", diameter_mm: 110, pressure_class: "PN10" }), critical, dims);
    expect(s.rejected).toBe(false);
    expect(s.score).toBeLessThanOrEqual(0.7);
    expect(decide([s]).status).toBe("needs_review");
  });
  it("auto-suggests only a clear, complete, high-scoring match", () => {
    const good = scoreCandidate(item, cand("a", { material: "upvc", diameter_mm: 110 }, "m", 0.95), critical, dims);
    expect(decide([good]).status).toBe("auto_suggested");
    const twin = { ...good, id: "b", score: good.score - 0.01 };
    expect(decide([good, twin]).status).toBe("needs_review");
    expect(decide([]).status).toBe("no_match");
  });
});
