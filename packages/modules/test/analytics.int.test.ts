import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken, uuidv7 } from "@platform/core";
import { withSystem } from "@platform/db";
import { canonicalProducts, notifications, organizations, priceIndexSnapshots, priceObservations } from "@platform/db/schema";
import { TestPaymentProvider } from "@platform/integrations/payments";
import { platformKpis, supplierKpis } from "../src/analytics";
import { addToCart, checkout } from "../src/commerce";
import { collectObservations, computeSnapshots, createAlert, evaluateAlerts, getIndexSeries, indexHealth, searchIndex } from "../src/price-index";
import { adminCtx, approvedSupplier, categoryBySlug, rawAsApp, setupOrg } from "./helpers";
import { customer, intentOf, product, webhook, zone } from "./store-helpers";

async function canonical(name: string) {
  const pipes = await categoryBySlug("pipes");
  const [c] = await withSystem((tx) =>
    tx.insert(canonicalProducts).values({ categoryId: pipes.id, nameAr: `منتج ${name}`, nameEn: `Index ${name}`, baseUnit: "m", normalizedName: `index ${name.toLowerCase()}`, status: "active" } as never).returning(),
  );
  return { canonical: c!, categoryId: pipes.id };
}

type ObsIn = { kind: string; price: string; supplier: string; buyer?: string | null; test?: boolean; daysAgo?: number };
async function observe(canonicalId: string, categoryId: string, list: ObsIn[]) {
  await withSystem((tx) =>
    tx.insert(priceObservations).values(
      list.map((o) => ({
        kind: o.kind,
        sourceType: "test",
        sourceId: uuidv7(),
        observedAt: new Date(Date.now() - (o.daysAgo ?? 1) * 86_400_000),
        canonicalProductId: canonicalId,
        categoryId,
        supplierOrgId: o.supplier,
        buyerOrgId: o.buyer ?? null,
        baseUnit: "m",
        quantityBase: "10",
        unitPriceBase: o.price,
        isTestData: o.test ?? false,
      })),
    ),
  );
}

const ids = (n: number) => Array.from({ length: n }, () => uuidv7());

describe("price index: normalization, outliers, privacy thresholds, alerts", () => {
  it("publishes only k-anonymous aggregates, excludes test data and outliers, and never exposes raw prices", async () => {
    const { canonical: c, categoryId } = await canonical(randomToken(5));
    const [s1, s2, s3, s4] = ids(4);
    const [b1, b2] = ids(2);
    await observe(c.id, categoryId, [
      // catalog: 6 observations from 4 suppliers, one extreme outlier → published
      { kind: "catalog_retail", price: "10.00", supplier: s1! },
      { kind: "catalog_retail", price: "11.00", supplier: s2! },
      { kind: "catalog_retail", price: "12.00", supplier: s3! },
      { kind: "catalog_retail", price: "10.50", supplier: s4! },
      { kind: "catalog_retail", price: "11.50", supplier: s1! },
      { kind: "catalog_retail", price: "95.00", supplier: s2! },
      // test data never counts
      { kind: "catalog_retail", price: "1.00", supplier: s3!, test: true },
      // outside the 90-day window
      { kind: "catalog_retail", price: "500.00", supplier: s4!, daysAgo: 200 },
      // POs: 6 observations but only 2 buyer orgs → suppressed (buyer side must be ≥ 3 too)
      ...[s1, s2, s3, s1, s2, s3].map((s, i) => ({ kind: "po", price: String(20 + i), supplier: s!, buyer: i % 2 ? b1! : b2! })),
      // quotes: one supplier dominates (5 of 7) → suppressed
      ...[s1, s1, s1, s1, s1, s2, s3].map((s, i) => ({ kind: "rfq_quote", price: String(30 + i), supplier: s!, buyer: [b1, b2, ids(1)[0]][i % 3]! })),
    ]);
    await computeSnapshots();
    const snaps = await withSystem((tx) => tx.select().from(priceIndexSnapshots).where(eq(priceIndexSnapshots.subjectId, c.id)));
    const cat = snaps.find((s) => s.kind === "catalog_retail")!;
    expect(cat.published).toBe(true);
    expect(cat.n).toBe(5);
    expect(cat.outliersExcluded).toBe(1);
    expect(Number(cat.median)).toBeCloseTo(11, 6);
    expect(cat.orgCount).toBe(4);
    const po = snaps.find((s) => s.kind === "po")!;
    expect(po.published).toBe(false);
    expect(po.suppressedReason).toBe("min_organizations");
    expect(po.median).toBeNull();
    const q = snaps.find((s) => s.kind === "rfq_quote")!;
    expect(q.published).toBe(false);
    expect(q.suppressedReason).toBe("dominance");
    // outlier flag recorded on the raw observation
    const flagged = await withSystem((tx) => tx.select().from(priceObservations).where(sql`${priceObservations.canonicalProductId} = ${c.id} and ${priceObservations.isOutlier}`));
    expect(flagged.map((f) => f.unitPriceBase)).toEqual(["95.000000"]);

    // buyers with price_index.view see published aggregates only
    const buyer = await setupOrg("buyer");
    const found = await searchIndex(buyer.ctx, { q: c.nameEn.toLowerCase() });
    expect(found.items.map((i) => i.s.kind)).toEqual(["catalog_retail"]);
    const series = await getIndexSeries(buyer.ctx, "canonical", c.id);
    expect(series.series.every((s) => s.published)).toBe(true);
    // suppliers (no permission) are refused; raw observations are not readable by any user role
    const sup = await approvedSupplier();
    await expect(searchIndex(sup.ctx, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await rawAsApp({ userId: buyer.user.id, orgId: buyer.org.id }, "select count(*)::int as n from price_observations", [])).toEqual([{ n: 0 }]);
    const visible = await rawAsApp<{ kind: string }>({ userId: buyer.user.id, orgId: buyer.org.id }, "select kind from price_index_snapshots where subject_id = $1", [c.id]);
    expect(visible.map((v) => v.kind).sort()).toEqual(["catalog_retail"]);
    expect((await rawAsApp({ userId: null, orgId: null, mode: "public" }, "select count(*)::int as n from price_index_snapshots", []))[0]!.n).toBe(0);

    // admin health view reports suppression reasons without prices
    const health = await indexHealth(await adminCtx());
    expect(health.rows.find((r) => r.kind === "po")!.reasons.min_organizations).toBeGreaterThanOrEqual(1);

    // alerts: baseline at current median; a +20% move triggers one notification
    const alert = await createAlert(buyer.ctx, { subjectType: "canonical", subjectId: c.id, kind: "catalog_retail", thresholdPct: 10, direction: "up" });
    expect(Number(alert.lastValue)).toBeCloseTo(11, 6);
    await withSystem((tx) => tx.update(priceObservations).set({ unitPriceBase: sql`${priceObservations.unitPriceBase} * 1.2` }).where(sql`${priceObservations.canonicalProductId} = ${c.id} and ${priceObservations.kind} = 'catalog_retail'`));
    await computeSnapshots();
    expect(await evaluateAlerts()).toBeGreaterThanOrEqual(1);
    const notes = await withSystem((tx) => tx.select().from(notifications).where(sql`${notifications.userId} = ${buyer.user.id} and ${notifications.kind} = 'price.alert'`));
    expect(notes).toHaveLength(1);
  });

  it("captures observations from real store sales and catalog prices (idempotent, base-unit normalized)", async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `PI-${randomToken(4)}`, retail: "40.00", enterprise: "35.00", stock: "20" });
    await zone(sup, "0.00");
    const c = await customer();
    await addToCart(c.ctx, p.id, "3");
    const r = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
    const i = await intentOf(r.orderId);
    TestPaymentProvider.settle(i.providerRef!, "succeeded", 13800);
    await webhook(i.providerRef!);
    const first = await collectObservations();
    expect(first.store_sale).toBeGreaterThanOrEqual(1);
    expect(first.catalog_retail).toBeGreaterThanOrEqual(1);
    const again = await collectObservations();
    expect(again.store_sale).toBe(0);
    expect(again.catalog_retail).toBe(0);
    const [obs] = await withSystem((tx) => tx.select().from(priceObservations).where(sql`${priceObservations.kind} = 'store_sale' and ${priceObservations.supplierOrgId} = ${sup.org.id}`));
    expect(obs!.baseUnit).toBe("pc");
    expect(obs!.unitPriceBase).toBe("40.000000");
    expect(obs!.quantityBase).toBe("3.0000");
  });
});

describe("analytics KPIs", () => {
  it("supplier KPIs come from its own records; platform KPIs exclude test organizations", async () => {
    const admin = await adminCtx();
    const before = await platformKpis(admin);
    const real = await approvedSupplier();
    const demo = await approvedSupplier();
    // test helpers flag every org as test data; mark one as a real organization for this check
    await withSystem((tx) => tx.update(organizations).set({ isTestData: false }).where(eq(organizations.id, real.org.id)));
    await withSystem((tx) => tx.update(organizations).set({ isTestData: true }).where(eq(organizations.id, demo.org.id)));
    for (const [s, price] of [
      [real, "100.00"],
      [demo, "999.00"],
    ] as const) {
      const p = await product(s, { sku: `K-${randomToken(4)}`, retail: price, stock: "5" });
      await zone(s, "0.00");
      const c = await customer();
      await addToCart(c.ctx, p.id, "1");
      const r = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [s.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
      const i = await intentOf(r.orderId);
      TestPaymentProvider.settle(i.providerRef!, "succeeded", Math.round(Number(price) * 115));
      await webhook(i.providerRef!);
    }
    const after = await platformKpis(admin);
    // only the real supplier's 115.00 (100 + VAT) is counted
    expect(Number(after.storeGmv) - Number(before.storeGmv)).toBeCloseTo(115, 2);
    expect(after.storeOrders - before.storeOrders).toBe(1);
    expect(after.testOrgsExcluded).toBeGreaterThan(before.testOrgsExcluded);
    const sk = await supplierKpis(real.ctx);
    expect(sk.storeOrders).toBe(1);
    expect(sk.storeSales).toBe("115.00");
    expect(sk.salesByMonth.at(-1)!.value).toBe("115.00");
    await expect(platformKpis(real.ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
