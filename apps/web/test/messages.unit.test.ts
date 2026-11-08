import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const load = (l: string) => JSON.parse(readFileSync(join(__dirname, "..", "src", "messages", `${l}.json`), "utf8")) as Record<string, unknown>;

function keys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}/${k}` : k));
}

describe("message catalogs", () => {
  const ar = keys(load("ar"));
  const en = keys(load("en"));
  it("Arabic and English have the same keys", () => {
    expect(ar.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !ar.includes(k))).toEqual([]);
  });
  it("no key contains a dot (next-intl nesting character)", () => {
    expect(ar.filter((k) => k.split("/").some((p) => p.includes(".")))).toEqual([]);
  });
  it("no empty translations", () => {
    const flat = (o: unknown): string[] => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(flat) : []);
    expect(flat(load("ar")).filter((s) => !s.trim())).toEqual([]);
    expect(flat(load("en")).filter((s) => !s.trim())).toEqual([]);
  });
});
