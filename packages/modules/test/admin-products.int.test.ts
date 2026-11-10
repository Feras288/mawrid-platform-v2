import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { auditLogs, supplierProducts } from "@platform/db/schema";
import {
  adminCreateProduct,
  adminGetProduct,
  adminListProducts,
  adminListSuppliersForProducts,
  adminSetPublished,
  adminUpdateProduct,
  getMyProduct,
  listMyProducts,
  setProductPrices,
  upsertPriceList,
  type ProductInput,
} from "../src/supplier-products";
import { adminCtx, approvedSupplier, categoryBySlug, createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";

async function input(over: Partial<ProductInput> = {}): Promise<ProductInput> {
  const pipes = await categoryBySlug("pipes");
  return { sku: `ADM-${randomToken(5)}`, categoryId: pipes.id, nameAr: "أنبوب اختبار", nameEn: "Test pipe", saleUnit: "pc", attributes: { material: "upvc", diameter_mm: 110 }, status: "active", ...over };
}

const auditsFor = (entityId: string) => withSystem((tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)));

describe("admin: supplier products on behalf of suppliers", () => {
  it("only platform admins with admin.catalog can use it", async () => {
    const sup = await approvedSupplier();
    const buyer = await setupOrg("buyer");
    const plainUser = await ctxFor((await createUser()).id);
    for (const ctx of [sup.ctx, buyer.ctx, plainUser]) {
      await expect(adminListProducts(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(adminCreateProduct(ctx, sup.org.id, await input(), "on request")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("creates a product for a supplier: owned by the supplier, audited against the supplier with the admin as actor", async () => {
    const sup = await approvedSupplier();
    const admin = await adminCtx();
    await expect(adminCreateProduct(admin, sup.org.id, await input(), "  ")).rejects.toMatchObject({ messageKey: "reason_required" });
    const p = await adminCreateProduct(admin, sup.org.id, await input(), "supplier asked by phone");
    expect(p.orgId).toBe(sup.org.id);

    // the supplier sees and owns it like any of its products
    expect((await listMyProducts(sup.ctx)).items.map((i) => i.id)).toContain(p.id);
    expect((await getMyProduct(sup.ctx, p.id)).product.sku).toBe(p.sku);

    const [a] = await auditsFor(p.id);
    expect(a).toMatchObject({ action: "product.created", orgId: sup.org.id, actorUserId: admin.userId, actorType: "admin" });
    expect(a!.data).toMatchObject({ onBehalfOf: sup.org.id, reason: "supplier asked by phone" });
    // …and the supplier can read that audit entry under RLS
    const seen = await rawAsApp({ userId: sup.user.id, orgId: sup.org.id }, "select action from audit_logs where entity_id = $1", [p.id]);
    expect(seen.map((r) => r.action)).toEqual(["product.created"]);
  });

  it("keeps the supplier's SKU uniqueness and refuses non-supplier organizations", async () => {
    const sup = await approvedSupplier();
    const admin = await adminCtx();
    const first = await adminCreateProduct(admin, sup.org.id, await input(), "bulk onboarding");
    await expect(adminCreateProduct(admin, sup.org.id, await input({ sku: first.sku }), "bulk onboarding")).rejects.toMatchObject({ messageKey: "sku_exists" });
    // the same SKU is fine for another supplier
    const other = await approvedSupplier();
    expect((await adminCreateProduct(admin, other.org.id, await input({ sku: first.sku }), "bulk onboarding")).orgId).toBe(other.org.id);
    const buyer = await setupOrg("buyer");
    await expect(adminCreateProduct(admin, buyer.org.id, await input(), "wrong org")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adminCreateProduct(admin, sup.org.id, await input({ categoryId: "00000000-0000-4000-8000-000000000000" }), "bad category")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("edits a supplier product with the same rules, records changed fields and the reason", async () => {
    const sup = await approvedSupplier();
    const admin = await adminCtx();
    const p = await adminCreateProduct(admin, sup.org.id, await input(), "onboarding");
    const base = await input({ sku: p.sku });
    await expect(adminUpdateProduct(admin, p.id, { ...base, nameEn: "Renamed pipe" }, "")).rejects.toMatchObject({ messageKey: "reason_required" });
    const u = await adminUpdateProduct(admin, p.id, { ...base, nameEn: "Renamed pipe", moq: "5" }, "fix typo reported by supplier");
    expect(u).toMatchObject({ nameEn: "Renamed pipe", moq: "5.0000", orgId: sup.org.id });
    const upd = (await auditsFor(p.id)).find((a) => a.action === "product.updated")!;
    expect(upd).toMatchObject({ orgId: sup.org.id, actorUserId: admin.userId });
    expect(upd.data).toMatchObject({ reason: "fix typo reported by supplier" });
    expect((upd.data as { fields: string[] }).fields.sort()).toEqual(["moq", "nameEn"]); // only what really changed
    await expect(adminUpdateProduct(admin, "00000000-0000-4000-8000-000000000000", base, "x".repeat(5))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("publishing follows the store rules (approved supplier, active product, retail price)", async () => {
    const admin = await adminCtx();
    const pending = await setupOrg("supplier"); // not approved
    const unapproved = await adminCreateProduct(admin, pending.org.id, await input(), "draft for review");
    await expect(adminSetPublished(admin, unapproved.id, true, "go live")).rejects.toMatchObject({ messageKey: "supplier_not_approved" });

    const sup = await approvedSupplier();
    const p = await adminCreateProduct(admin, sup.org.id, await input(), "onboarding");
    await expect(adminSetPublished(admin, p.id, true, "go live")).rejects.toMatchObject({ messageKey: "retail_price_required" });
    const list = await upsertPriceList(sup.ctx, null, { name: "Retail", kind: "retail" });
    await setProductPrices(sup.ctx, { priceListId: list.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "12.50" }] });
    await expect(adminSetPublished(admin, p.id, true, "")).rejects.toMatchObject({ messageKey: "reason_required" });
    await adminSetPublished(admin, p.id, true, "go live");
    expect((await adminGetProduct(admin, p.id)).product.isPublished).toBe(true);
    await adminSetPublished(admin, p.id, false, "price dispute");
    const [row] = await withSystem((tx) => tx.select().from(supplierProducts).where(eq(supplierProducts.id, p.id)));
    expect(row!.isPublished).toBe(false);
    const actions = (await auditsFor(p.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["product.published", "product.unpublished"]));
    // a draft cannot be published
    const draft = await adminCreateProduct(admin, sup.org.id, await input({ status: "draft" }), "draft");
    await expect(adminSetPublished(admin, draft.id, true, "go live")).rejects.toMatchObject({ messageKey: "product_not_active" });
  });

  it("lists products across suppliers with filters, and shows detail with prices and stock", async () => {
    const admin = await adminCtx();
    const a = await approvedSupplier();
    const b = await approvedSupplier();
    const tag = randomToken(6).toLowerCase();
    const pa = await adminCreateProduct(admin, a.org.id, await input({ sku: `LST-${tag}-A`, status: "active" }), "seed");
    const pb = await adminCreateProduct(admin, b.org.id, await input({ sku: `LST-${tag}-B`, status: "draft" }), "seed");

    const both = await adminListProducts(admin, { q: `lst-${tag}` });
    expect(both.items.map((i) => i.id).sort()).toEqual([pa.id, pb.id].sort());
    expect(both.items.find((i) => i.id === pb.id)).toMatchObject({ supplierOrgId: b.org.id, supplierEn: expect.any(String) });
    expect((await adminListProducts(admin, { q: `lst-${tag}`, supplierOrgId: a.org.id })).items.map((i) => i.id)).toEqual([pa.id]);
    expect((await adminListProducts(admin, { q: `lst-${tag}`, status: "draft" })).items.map((i) => i.id)).toEqual([pb.id]);
    expect((await adminListProducts(admin, { q: `lst-${tag}`, published: "yes" })).items).toHaveLength(0);

    const detail = await adminGetProduct(admin, pa.id);
    expect(detail.supplier).toMatchObject({ id: a.org.id, profileStatus: "approved" });
    expect(detail.prices).toEqual([]);
    expect(detail.stock).toEqual([]);
    const suppliers = await adminListSuppliersForProducts(admin);
    expect(suppliers.map((s) => s.id)).toEqual(expect.arrayContaining([a.org.id, b.org.id]));
    expect(suppliers.every((s) => s.id)).toBe(true);
  });

  it("does not leak: a supplier still cannot read another supplier's product directly", async () => {
    const admin = await adminCtx();
    const a = await approvedSupplier();
    const b = await approvedSupplier();
    const p = await adminCreateProduct(admin, a.org.id, await input(), "seed");
    await expect(getMyProduct(b.ctx, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rows = await withSystem((tx) => tx.select().from(supplierProducts).where(and(eq(supplierProducts.id, p.id), eq(supplierProducts.orgId, b.org.id))));
    expect(rows).toHaveLength(0);
  });
});
