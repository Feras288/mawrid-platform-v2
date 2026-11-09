// Per-query timing for store search (dev only).
import { existsSync } from "node:fs";
import { join } from "node:path";

const envFile = join(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { closeDb } = await import("@platform/db");
const { publicCtx } = await import("@platform/modules/context");
const { searchProducts } = await import("@platform/modules/store");
const pub = publicCtx("ar");
const qs: Record<string, Parameters<typeof searchProducts>[1]> = {
  text: { q: "perf pipe 150" },
  textPage3: { q: "upvc", page: 3 },
  catPrice: { categorySlug: "pipes", sort: "price_asc" },
  catBrand: { categorySlug: "pipes", brand: "Beta" },
  newest: { sort: "newest" },
};
for (const [k, q] of Object.entries(qs)) {
  await searchProducts(pub, q);
  const t: number[] = [];
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    await searchProducts(pub, q);
    t.push(performance.now() - s);
  }
  console.log(k.padEnd(12), t.map((x) => x.toFixed(0)).join(" "));
}
await closeDb();
