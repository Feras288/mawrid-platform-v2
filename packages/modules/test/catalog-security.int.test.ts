import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { priceLists, supplierProducts } from "@platform/db/schema";
import { setOrgStatus } from "../src/admin";
import { addToCart } from "../src/commerce";
import { addRfqItem, createRfq, deliverRecipient, getRfq, sendRfq, setRecipients, submitRfq } from "../src/rfq";
import { listApprovedSuppliers } from "../src/suppliers";
import { rfqRecipients } from "@platform/db/schema";
import { publicCtx } from "../src/context";
import { getStoreProduct, searchProducts } from "../src/store";
import { setProductPrices, setPublished, upsertPriceList } from "../src/supplier-products";
import { adminCtx, approvedSupplier, rawAsApp, setupOrg } from "./helpers";
import { customer, product } from "./store-helpers";

/**
 * Security of the storefront search path (store_catalog view + store_price): it must expose exactly what the
 * public RLS rules expose — published, active, priced products of approved, non-suspended suppliers — and
 * never non-retail (enterprise / contract / regional) prices or writable access.
 */
const pub = () => publicCtx("ar");
const viewIds = async (orgId: string) =>
  (await rawAsApp<{ id: string }>({ userId: null, orgId: null, mode: "public" }, "select id from store_catalog where org_id = $1", [orgId])).map((r) => r.id);

describe("store catalog view & search security", () => {
  it("hides unpublished, inactive and unpriced products", async () => {
    const sup = await approvedSupplier();
    const visible = await product(sup, { sku: `V-${randomToken(4)}`, retail: "10.00", stock: "5" });
    const unpublished = await product(sup, { sku: `U-${randomToken(4)}`, retail: "10.00", stock: "5" });
    await setPublished(sup.ctx, unpublished.id, false);
    const inactive = await product(sup, { sku: `I-${randomToken(4)}`, retail: "10.00", stock: "5" });
    await withSystem((tx) => tx.update(supplierProducts).set({ status: "inactive" }).where(eq(supplierProducts.id, inactive.id)));
    expect((await viewIds(sup.org.id)).sort()).toEqual([visible.id]);
    for (const p of [unpublished, inactive]) {
      expect((await searchProducts(pub(), { q: p.sku })).total).toBe(0);
      expect(await getStoreProduct(pub(), p.id)).toBeNull();
    }
  });

  it("never exposes enterprise, contract or regional prices through store_price", async () => {
    const sup = await approvedSupplier();
    const buyer = await setupOrg("buyer");
    const p = await product(sup, { sku: `P-${randomToken(4)}`, retail: "100.00", enterprise: "70.00", stock: "5" });
    const contract = await upsertPriceList(sup.ctx, null, { name: "Contract", kind: "org_specific", buyerOrgId: buyer.org.id });
    await setProductPrices(sup.ctx, { priceListId: contract.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "40.00" }] });
    const regional = await upsertPriceList(sup.ctx, null, { name: "Riyadh", kind: "regional", cities: ["riyadh"] });
    await setProductPrices(sup.ctx, { priceListId: regional.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "30.00" }] });
    const [row] = await rawAsApp<{ store_price: string }>({ userId: null, orgId: null, mode: "public" }, "select store_price from store_catalog where id = $1", [p.id]);
    expect(row!.store_price).toBe("100.0000");
    // a product priced only on non-retail lists is not in the public catalog at all
    const hidden = await product(sup, { sku: `H-${randomToken(4)}`, retail: "1.00", stock: "5" });
    const retailListId = (await withSystem((tx) => tx.select({ id: priceLists.id }).from(priceLists).where(sql`${priceLists.orgId} = ${sup.org.id} and ${priceLists.kind} = 'retail'`)))[0]!.id;
    await withSystem((tx) => tx.execute(sql`delete from price_list_items where supplier_product_id = ${hidden.id} and price_list_id = ${retailListId}`));
    await setProductPrices(sup.ctx, { priceListId: contract.id, supplierProductId: hidden.id, tiers: [{ minQty: "1", unitPrice: "5.00" }] });
    expect(await viewIds(sup.org.id)).not.toContain(hidden.id);
    // deactivating the retail list removes its prices from the catalog (trigger refresh)
    await withSystem((tx) => tx.update(priceLists).set({ isActive: false }).where(eq(priceLists.id, retailListId)));
    expect(await viewIds(sup.org.id)).toEqual([]);
  });

  it("removes every product of a suspended supplier profile or a suspended organization", async () => {
    const admin = await adminCtx();
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `S-${randomToken(4)}`, retail: "10.00", stock: "5" });
    expect(await viewIds(sup.org.id)).toEqual([p.id]);
    // organization suspended by a platform admin (profile stays "approved")
    await setOrgStatus(admin, sup.org.id, "suspended", "compliance hold");
    expect(await viewIds(sup.org.id)).toEqual([]);
    expect((await searchProducts(pub(), { q: p.sku })).total).toBe(0);
    expect(await getStoreProduct(pub(), p.id)).toBeNull();
    const c = await customer();
    await expect(addToCart(c.ctx, p.id, "1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // and RLS agrees with the view
    expect(await rawAsApp({ userId: c.user.id, orgId: null }, "select id from supplier_products where id = $1", [p.id])).toHaveLength(0);
    await setOrgStatus(admin, sup.org.id, "active", "resolved");
    expect(await viewIds(sup.org.id)).toEqual([p.id]);
  });

  it("is read-only for the application role and exposes no private columns", async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `R-${randomToken(4)}`, retail: "10.00", stock: "5" });
    for (const stmt of [
      ["update store_catalog set store_price = 0 where id = $1", [p.id]],
      ["delete from store_catalog where id = $1", [p.id]],
    ] as const) {
      await expect(rawAsApp({ userId: null, orgId: null, mode: "public" }, stmt[0], [...stmt[1]])).rejects.toThrow(/permission denied/);
    }
    const cols = await rawAsApp<{ column_name: string }>({ userId: null, orgId: null, mode: "public" }, "select column_name from information_schema.columns where table_name = 'store_catalog' order by column_name", []);
    expect(cols.map((c) => c.column_name)).toEqual(["brand_name", "category_id", "created_at", "id", "name_ar", "name_en", "normalized_name", "org_id", "sku", "store_price"]);
    // store_price is maintained only by owner-privileged triggers: the application role cannot write it on another org's product
    const other = await approvedSupplier();
    await rawAsApp({ userId: other.user.id, orgId: other.org.id }, "update supplier_products set store_price = 0.01 where id = $1", [p.id]);
    const [after] = await withSystem((tx) => tx.select({ v: supplierProducts.storePrice }).from(supplierProducts).where(eq(supplierProducts.id, p.id)));
    expect(after!.v).toBe("10.0000");
  });

  it("suspended supplier organizations cannot be invited to RFQs and receive nothing if suspended after invitation", async () => {
    const admin = await adminCtx();
    const buyer = await setupOrg("buyer");
    const a = await approvedSupplier();
    const b = await approvedSupplier();
    const rfq = await createRfq(buyer.ctx, { title: "Eligibility check", closesAt: new Date(Date.now() + 5 * 86_400_000) });
    await addRfqItem(buyer.ctx, rfq.id, { description: "uPVC pipe 110mm", quantity: "10", unit: "m" });
    await setOrgStatus(admin, b.org.id, "suspended", "compliance hold");
    expect((await listApprovedSuppliers()).map((x) => x.orgId)).not.toContain(b.org.id);
    await expect(setRecipients(buyer.ctx, rfq.id, [a.org.id, b.org.id])).rejects.toMatchObject({ messageKey: "supplier_not_eligible" });
    await setOrgStatus(admin, b.org.id, "active", "resolved");
    await setRecipients(buyer.ctx, rfq.id, [a.org.id, b.org.id]);
    await submitRfq(buyer.ctx, rfq.id);
    // b is suspended between invitation and delivery
    await setOrgStatus(admin, b.org.id, "suspended", "compliance hold");
    await sendRfq(buyer.ctx, rfq.id, randomToken(12));
    const rows = await withSystem((tx) => tx.select().from(rfqRecipients).where(eq(rfqRecipients.rfqId, rfq.id)));
    for (const r of rows) await deliverRecipient(r.id);
    const after = (await getRfq(buyer.ctx, rfq.id)).recipients;
    expect(after.find((r) => r.rc.supplierOrgId === b.org.id)!.rc).toMatchObject({ status: "failed", lastError: "supplier_not_eligible" });
    expect(after.find((r) => r.rc.supplierOrgId === a.org.id)!.rc.status).toBe("sent");
    expect(await rawAsApp({ userId: b.user.id, orgId: b.org.id }, "select id from rfqs where id = $1", [rfq.id])).toHaveLength(0);
  });
});
