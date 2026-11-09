import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The working brand is temporary: it must live only in configuration (env defaults + one helper).
const ROOT = join(__dirname, "..", "..", "..");
const ALLOWED = new Set(["packages/core/src/brand.ts", "packages/core/src/env.ts"]);
const BRAND = /mawrid|مَوْرِد/i;
const SKIP = new Set(["node_modules", ".next", "dist", ".turbo", "test-results", "playwright-report"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|sql|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => f.slice(ROOT.length + 1).split(sep).join("/");

describe("brand decoupling", () => {
  it("no brand name in code, SQL, table names or API paths outside the brand helper", () => {
    const files = ["packages", "apps/web/src", "apps/worker/src", "scripts"].flatMap((d) => walk(join(ROOT, d)));
    const offenders = files
      .map(rel)
      .filter((r) => !ALLOWED.has(r) && !r.includes("/test/"))
      .filter((r) => BRAND.test(readFileSync(join(ROOT, r), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("package scope is neutral", () => {
    for (const p of ["packages/core", "packages/db", "packages/modules", "packages/integrations", "apps/web", "apps/worker"]) {
      const name = JSON.parse(readFileSync(join(ROOT, p, "package.json"), "utf8")).name as string;
      expect(name.startsWith("@platform/")).toBe(true);
    }
  });
});
