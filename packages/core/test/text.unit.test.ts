import { describe, expect, it } from "vitest";
import { normalizeText, parseLocaleNumber, similarity, toAsciiDigits, tokenJaccard, tokens } from "../src/text";

describe("text normalization", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toAsciiDigits("١٢٣٫٥")).toBe("123.5");
    expect(toAsciiDigits("۴۵")).toBe("45");
  });
  it("normalizes Arabic letter variants and diacritics", () => {
    expect(normalizeText("أنابيبُ إسمنتيّة")).toBe(normalizeText("انابيب اسمنتيه"));
    expect(normalizeText("مكيّف")).toBe("مكيف");
  });
  it("parses localized numbers", () => {
    expect(parseLocaleNumber("1,234.50")).toBe("1234.50");
    expect(parseLocaleNumber("١٬٢٣٤٫٥")).toBe("1234.5");
    expect(parseLocaleNumber("12,5")).toBe("12.5");
    expect(parseLocaleNumber("1.234,5")).toBe("1234.5");
    expect(parseLocaleNumber("abc")).toBeNull();
    expect(parseLocaleNumber(42)).toBe("42");
    expect(parseLocaleNumber("1,234,567")).toBe("1234567");
  });
  it("similarity helpers", () => {
    expect(similarity("pipe", "pipe")).toBe(1);
    expect(similarity("pvc pipe", "ppr pipe")).toBeGreaterThan(0.5);
    expect(tokenJaccard(tokens("uPVC pipe 110mm"), tokens("pipe upvc 110mm"))).toBe(1);
  });
});
