/**
 * Performance measurements against the brief's targets (dev/test only — refuses other environments).
 * Generates volume data flagged as test data, then measures:
 *  1. Store search / listing (service p95 and HTTP p95 when PERF_BASE_URL is set) on ≥100k supplier products
 *  2. BOQ pipeline (extract + normalize + match, no AI) on a 2,000-line XLSX
 *  3. Quotation comparison matrix 500 lines × 8 suppliers
 *  4. Bilingual PO PDF generation for 200 lines (headless Chromium)
 * Usage: pnpm exec tsx scripts/perf/run.ts   (PERF_PRODUCTS=100000 PERF_BASE_URL=http://127.0.0.1:3198)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const envFile = join(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!["development", "test"].includes(process.env.APP_ENV ?? "development")) {
  console.error("perf script refuses to run outside development/test");
  process.exit(1);
}

const { sql, eq } = await import("drizzle-orm");
const { uuidv7, randomToken } = await import("@platform/core");
const { closeDb, withSystem } = await import("@platform/db");
const schema = await import("@platform/db/schema");
const { resolveContext, publicCtx } = await import("@platform/modules/context");
const { createOrganization } = await import("@platform/modules/organizations");
const { searchProducts } = await import("@platform/modules/store");
const { buildXlsx } = await import("@platform/modules/spreadsheet");
const { uploadBoq, processBoq } = await import("@platform/modules/boq");
const { comparison } = await import("@platform/modules/quotations");
const { generatePoDocuments } = await import("@platform/modules/purchase-orders");
const { ensureBucket } = await import("@platform/integrations/storage");

const N = Number(process.env.PERF_PRODUCTS ?? 100_000);
const BASE = process.env.PERF_BASE_URL;
const results: { name: string; target: string; value: string; pass: boolean; note?: string }[] = [];
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const time = async <T>(fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  return { ms: performance.now() - t, r };
};

await ensureBucket().catch(() => undefined);

// ---------------------------------------------------------------- fixtures: one test user, buyer org, 8 approved suppliers
const userId = uuidv7();
await withSystem((tx) => tx.insert(schema.authUsers).values({ id: userId, email: `perf-${randomToken(6)}@perf.test`, name: "Perf user", emailVerified: true }));
const base = await resolveContext({ userId });
const buyer = await createOrganization(base, { type: "buyer", nameAr: "مشتري الأداء", nameEn: `Perf Buyer ${randomToken(4)}` }, { isTestData: true });
const buyerCtx = await resolveContext({ userId, orgId: buyer.id });
const suppliers: string[] = [];
for (let i = 0; i < 8; i++) {
  const s = await createOrganization(base, { type: "supplier", nameAr: `مورد أداء ${i}`, nameEn: `Perf Supplier ${i} ${randomToken(3)}` }, { isTestData: true });
  await withSystem((tx) => tx.update(schema.supplierProfiles).set({ status: "approved" }).where(eq(schema.supplierProfiles.orgId, s.id)));
  suppliers.push(s.id);
}
const [cat] = await withSystem((tx) => tx.select().from(schema.categories).where(eq(schema.categories.slug, "pipes")).limit(1));

// ---------------------------------------------------------------- 1. store search on N products
const existing = await withSystem((tx) => tx.execute(sql`select count(*)::int as n from supplier_products`));
const have = (existing.rows[0] as { n: number }).n;
const toCreate = Math.max(0, N - have);
console.log(`products present: ${have}; generating ${toCreate}`);
if (toCreate > 0) {
  const t0 = performance.now();
  await withSystem(async (tx) => {
    const lists: string[] = [];
    for (const s of suppliers) {
      const [l] = await tx.insert(schema.priceLists).values({ orgId: s, name: "Retail", kind: "retail" }).returning();
      lists.push(l!.id);
    }
    const per = Math.ceil(toCreate / suppliers.length);
    for (const [i, s] of suppliers.entries()) {
      await tx.execute(sql`
        insert into supplier_products (id, org_id, sku, category_id, name_ar, name_en, sale_unit, attributes, status, is_published, normalized_name, brand_name)
        select app_uuidv7(), ${s}, 'PERF-' || ${i} || '-' || g, ${cat!.id},
               'ماسورة اختبار ' || g || ' مم', 'Perf pipe ' || g || ' mm ' || (array['upvc','ppr','hdpe','steel'])[1 + g % 4],
               'm', jsonb_build_object('diameter_mm', 20 + (g % 300)), 'active', true,
               'perf pipe ' || g || ' mm ' || (array['upvc','ppr','hdpe','steel'])[1 + g % 4], (array['Alpha','Beta','Gamma','Delta'])[1 + g % 4]
        from generate_series(1, ${per}) g`);
      await tx.execute(sql`
        insert into price_list_items (id, price_list_id, supplier_product_id, min_qty, unit_price)
        select app_uuidv7(), ${lists[i]!}, p.id, 1, 5 + (random() * 200)::numeric(12,2) from supplier_products p where p.org_id = ${s}`);
    }
  });
  await withSystem((tx) => tx.execute(sql`analyze supplier_products; analyze price_list_items;`));
  console.log(`generated in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
const pub = publicCtx("ar");
const queries = [{ q: "perf pipe 150" }, { categorySlug: "pipes", sort: "price_asc" as const }, { q: "upvc", page: 3 }, { categorySlug: "pipes", brand: "Beta", inStock: false }, { sort: "newest" as const }];
await searchProducts(pub, queries[0]!); // warm-up
const svc: number[] = [];
for (let i = 0; i < 30; i++) svc.push((await time(() => searchProducts(pub, queries[i % queries.length]!))).ms);
const svcP95 = pct(svc, 95);
results.push({ name: `Store search service p95 (${N.toLocaleString()} products)`, target: "< 400 ms", value: `${svcP95.toFixed(0)} ms (p50 ${pct(svc, 50).toFixed(0)} ms)`, pass: svcP95 < 400 });
if (BASE) {
  const paths = ["/ar/products?q=perf%20pipe%20150", "/ar/products?category=pipes&sort=price_asc", "/en/products?q=upvc&page=3", "/ar/products"];
  await fetch(`${BASE}${paths[0]}`);
  const http: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t = performance.now();
    const r = await fetch(`${BASE}${paths[i % paths.length]}`);
    await r.text();
    http.push(performance.now() - t);
  }
  const p95 = pct(http, 95);
  results.push({ name: "Store listing page HTTP p95 (production build, SSR)", target: "< 400 ms", value: `${p95.toFixed(0)} ms (p50 ${pct(http, 50).toFixed(0)} ms)`, pass: p95 < 400 });
}

// ---------------------------------------------------------------- 2. BOQ 2,000 lines (rule engine, no AI)
const units = ["m", "pc", "m2", "set"];
const kinds = [
  (i: number) => `توريد وتركيب ماسورة يو بي في سي قطر ${50 + (i % 200)} مم ضغط PN10`,
  (i: number) => `Supply & install copper cable 4x${[6, 10, 16, 25, 35][i % 5]}mm² XLPE`,
  (i: number) => `كوع بي بي آر ${20 + (i % 60)} مم 90 درجة`,
  (i: number) => `MCB 1P ${[10, 16, 20, 32][i % 4]}A 6kA`,
];
const rows = [["البند", "الوصف", "الوحدة", "الكمية"], ...Array.from({ length: 2000 }, (_, i) => [String(i + 1), kinds[i % 4]!(i), units[i % 4]!, String(10 + (i % 90))])];
const xlsx = await buildXlsx([{ name: "BOQ", rows }]);
const doc = await uploadBoq(buyerCtx, { title: "Perf BOQ 2000" }, { buffer: Buffer.from(xlsx), fileName: "perf-boq.xlsx" });
const boq = await time(() => processBoq(doc.id));
const [boqRow] = await withSystem((tx) => tx.select({ status: schema.boqDocuments.status }).from(schema.boqDocuments).where(eq(schema.boqDocuments.id, doc.id)));
const lines = await withSystem((tx) => tx.execute(sql`select count(*)::int as n from boq_items where document_id = ${doc.id}`));
results.push({ name: "BOQ 2,000 lines: extract + normalize + match (no AI)", target: "< 60 s", value: `${(boq.ms / 1000).toFixed(1)} s · ${(lines.rows[0] as { n: number }).n} lines · status ${boqRow?.status}`, pass: boq.ms < 60_000 });

// ---------------------------------------------------------------- 3. comparison 500 × 8
const rfqId = uuidv7();
await withSystem(async (tx) => {
  await tx.insert(schema.rfqs).values({ id: rfqId, orgId: buyer.id, code: `RFQ-PERF-${randomToken(4)}`, title: "Perf comparison", status: "under_evaluation" });
  await tx.execute(sql`insert into rfq_items (id, rfq_id, org_id, line_no, description, quantity, unit, category_id)
    select app_uuidv7(), ${rfqId}, ${buyer.id}, g, 'Perf line ' || g, 10 + g % 50, 'm', ${cat!.id} from generate_series(1, 500) g`);
  for (const [i, s] of suppliers.entries()) {
    const qid = uuidv7();
    await tx.insert(schema.quotations).values({ id: qid, rfqId, buyerOrgId: buyer.id, supplierOrgId: s, version: 1, status: "submitted", isCurrent: true, validUntil: new Date(Date.now() + 30 * 86_400_000), submittedAt: new Date(), subtotal: "0", vatTotal: "0", total: "0", coveredLines: 500 } as never);
    await tx.execute(sql`insert into quotation_items (id, quotation_id, rfq_item_id, buyer_org_id, supplier_org_id, offered, quantity, unit_price, discount_pct, vat_rate, line_net, line_vat, line_total)
      select app_uuidv7(), ${qid}, ri.id, ${buyer.id}, ${s}, true, ri.quantity, (5 + ${i} + random() * 50)::numeric(12,2), 0, 0.15, 0, 0, 0 from rfq_items ri where ri.rfq_id = ${rfqId}`);
  }
});
await comparison(buyerCtx, rfqId);
const cmp: number[] = [];
for (let i = 0; i < 5; i++) cmp.push((await time(() => comparison(buyerCtx, rfqId))).ms);
results.push({ name: "Comparison matrix 500 lines × 8 suppliers (data)", target: "< 2 s", value: `${pct(cmp, 95).toFixed(0)} ms (max of 5)`, pass: pct(cmp, 95) < 2000, note: "service time; UI paginates/virtualizes render" });

// ---------------------------------------------------------------- 4. PO PDF 200 lines (Arabic + English)
const poId = uuidv7();
await withSystem(async (tx) => {
  await tx.insert(schema.purchaseOrders).values({ id: poId, orgId: buyer.id, supplierOrgId: suppliers[0]!, code: `PO-PERF-${randomToken(4)}`, verificationCode: randomToken(16), approvalStatus: "approved", issuedAt: new Date(), subtotal: "0", vatTotal: "0", total: "0" } as never);
  await tx.execute(sql`insert into po_items (id, po_id, org_id, supplier_org_id, line_no, description, quantity, unit, unit_price, vat_rate, line_net, line_vat, line_total)
    select app_uuidv7(), ${poId}, ${buyer.id}, ${suppliers[0]!}, g, 'ماسورة يو بي في سي قطر ' || (50 + g) || ' مم — uPVC pipe ' || (50 + g) || ' mm', 10, 'm', 25.5, 0.15, 255, 38.25, 293.25 from generate_series(1, 200) g`);
});
try {
  const pdf = await time(() => generatePoDocuments(poId));
  results.push({ name: "PO PDF 200 lines (Arabic + English, Chromium)", target: "< 10 s", value: `${(pdf.ms / 1000).toFixed(1)} s for both languages`, pass: pdf.ms < 10_000 });
} catch (e) {
  results.push({ name: "PO PDF 200 lines (Arabic + English, Chromium)", target: "< 10 s", value: `error: ${(e as Error).message.slice(0, 120)}`, pass: false });
}

console.log("\n| Measurement | Target | Result | Pass |\n|---|---|---|---|");
for (const r of results) console.log(`| ${r.name} | ${r.target} | ${r.value}${r.note ? ` (${r.note})` : ""} | ${r.pass ? "✅" : "❌"} |`);
await closeDb();
process.exit(0);
