import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withContext, withSystem } from "@platform/db";
import { categories, importBatchRows, priceLists, supplierProducts } from "@platform/db/schema";
import { createCanonical, listDuplicateCandidates, resolveDuplicate } from "../src/catalog";
import { processProductImport, startProductImport } from "../src/imports";
import { updateOrganization } from "../src/organizations";
import { createProduct, getPublicProduct, reserveStock, resolvePrices, setProductPrices, setPublished, setStock, settleReservation, upsertPriceList, availableQty } from "../src/supplier-products";
import { decideSupplier, getMyProfile, reviewDocument, startReview, submitForVerification, updateMyProfile, uploadSupplierDocument, upsertWarehouse } from "../src/suppliers";
import { createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");

async function cat(slug: string) {
  const [c] = await withSystem((tx) => tx.select().from(categories).where(eq(categories.slug, slug)).limit(1));
  return c!;
}

async function adminCtx() {
  const admin = await createUser({ platformAdmin: true, twoFactor: true });
  return ctxFor(admin.id);
}

/** Create a supplier and drive it to approved through the real lifecycle. */
export async function approvedSupplier() {
  const s = await setupOrg("supplier");
  const pipes = await cat("pipes");
  await updateOrganization(s.ctx, { crNumber: "1010123456", vatNumber: "300000000000003", city: "Riyadh" });
  await updateMyProfile(s.ctx, { descriptionAr: "مورد مواد سباكة", coverageRegions: ["RD"], categoryIds: [pipes.id], deliversNationwide: true });
  const cr = await uploadSupplierDocument(s.ctx, { kind: "commercial_registration", documentNumber: "1010123456" }, { buffer: PDF, fileName: "cr.pdf" });
  const vat = await uploadSupplierDocument(s.ctx, { kind: "vat_certificate" }, { buffer: PDF, fileName: "vat.pdf" });
  await submitForVerification(s.ctx);
  const admin = await adminCtx();
  await startReview(admin, s.org.id);
  await reviewDocument(admin, cr.id, { status: "verified" });
  await reviewDocument(admin, vat.id, { status: "verified" });
  await decideSupplier(admin, s.org.id, { decision: "approved" });
  return { ...s, ctx: await ctxFor(s.user.id, s.org.id), admin };
}

describe("supplier verification lifecycle", () => {
  it("rejects submission with an incomplete profile and lists missing items", async () => {
    const s = await setupOrg("supplier");
    await expect(submitForVerification(s.ctx)).rejects.toMatchObject({ code: "VALIDATION", details: { missing: expect.arrayContaining(["crNumber", "document:commercial_registration", "categories"]) } });
  });

  it("approval requires verified mandatory documents; full flow reaches approved", async () => {
    const s = await setupOrg("supplier");
    const pipes = await cat("pipes");
    await updateOrganization(s.ctx, { crNumber: "1010123457", vatNumber: "300000000000003", city: "Jeddah" });
    await updateMyProfile(s.ctx, { descriptionEn: "Pipes supplier", categoryIds: [pipes.id] });
    const cr = await uploadSupplierDocument(s.ctx, { kind: "commercial_registration" }, { buffer: PDF, fileName: "cr.pdf" });
    await uploadSupplierDocument(s.ctx, { kind: "vat_certificate" }, { buffer: PDF, fileName: "vat.pdf" });
    await submitForVerification(s.ctx);
    const admin = await adminCtx();
    await startReview(admin, s.org.id);
    await reviewDocument(admin, cr.id, { status: "verified" });
    await expect(decideSupplier(admin, s.org.id, { decision: "approved" })).rejects.toMatchObject({ messageKey: "documents_not_verified" });
    await expect(decideSupplier(admin, s.org.id, { decision: "rejected" })).rejects.toMatchObject({ messageKey: "reason_required" });
    const prof = await getMyProfile(s.ctx);
    expect(prof.profile.status).toBe("under_review");
    expect(prof.history.map((h) => h.toStatus)).toEqual(["under_review", "pending_verification"]);
  });

  it("a supplier cannot approve itself or verify its own documents (DB triggers)", async () => {
    const s = await setupOrg("supplier");
    await getMyProfile(s.ctx);
    const g = { userId: s.user.id, orgId: s.org.id };
    await expect(rawAsApp(g, "update supplier_profiles set status = 'approved' where org_id = $1", [s.org.id])).rejects.toThrow(/platform/);
    const doc = await uploadSupplierDocument(s.ctx, { kind: "commercial_registration" }, { buffer: PDF, fileName: "cr.pdf" });
    await expect(rawAsApp(g, "update supplier_documents set status = 'verified' where id = $1", [doc.id])).rejects.toThrow(/platform-only/);
  });

  it("non-admins cannot review suppliers", async () => {
    const s = await setupOrg("supplier");
    const b = await setupOrg("buyer");
    await expect(startReview(b.ctx, s.org.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supplier documents and warehouses are invisible to other orgs (RLS)", async () => {
    const s = await setupOrg("supplier");
    const doc = await uploadSupplierDocument(s.ctx, { kind: "commercial_registration" }, { buffer: PDF, fileName: "cr.pdf" });
    await upsertWarehouse(s.ctx, null, { name: "WH", city: "riyadh" });
    const other = await setupOrg("supplier");
    const buyer = await setupOrg("buyer");
    for (const o of [other, buyer]) {
      const g = { userId: o.user.id, orgId: o.org.id };
      expect(await rawAsApp(g, "select id from supplier_documents where id = $1", [doc.id])).toHaveLength(0);
      expect(await rawAsApp(g, "select id from files where id = $1", [doc.fileId])).toHaveLength(0);
      expect(await rawAsApp(g, "select id from warehouses where org_id = $1", [s.org.id])).toHaveLength(0);
    }
  });
});

describe("supplier products, pricing and inventory", () => {
  it("validates attributes, enforces SKU uniqueness, and gates publishing", async () => {
    const s = await setupOrg("supplier");
    const pipes = await cat("pipes");
    const base = { sku: "PVC-110", categoryId: pipes.id, nameAr: "ماسورة يو بي في سي 110 مم", nameEn: "uPVC pipe 110mm", saleUnit: "m", attributes: { material: "upvc", diameter_mm: "110" }, status: "active" as const };
    await expect(createProduct(s.ctx, { ...base, attributes: { voltage: 220 } })).rejects.toMatchObject({ code: "VALIDATION" });
    const p = await createProduct(s.ctx, base);
    expect(p.attributes).toEqual({ material: "upvc", diameter_mm: 110 });
    await expect(createProduct(s.ctx, base)).rejects.toMatchObject({ messageKey: "sku_exists" });
    await expect(setPublished(s.ctx, p.id, true)).rejects.toMatchObject({ messageKey: "supplier_not_approved" });
    // unapproved supplier's active products are not public
    expect(await getPublicProduct(p.id)).toBeNull();
  });

  it("approved supplier publishes after setting a retail price; buyer-specific prices stay private", async () => {
    const s = await approvedSupplier();
    const pipes = await cat("pipes");
    const p = await createProduct(s.ctx, { sku: "PPR-25", categoryId: pipes.id, nameAr: "ماسورة بي بي آر 25", nameEn: "PPR pipe 25mm", saleUnit: "m", attributes: { material: "ppr", diameter_mm: 25 }, status: "active" });
    await expect(setPublished(s.ctx, p.id, true)).rejects.toMatchObject({ messageKey: "retail_price_required" });
    const retail = await upsertPriceList(s.ctx, null, { name: "Retail", kind: "retail" });
    await setProductPrices(s.ctx, { priceListId: retail.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "12.5" }, { minQty: "100", unitPrice: "11" }] });
    await setPublished(s.ctx, p.id, true);
    expect(await getPublicProduct(p.id)).not.toBeNull();

    const buyerA = await setupOrg("buyer");
    const buyerB = await setupOrg("buyer");
    const special = await upsertPriceList(s.ctx, null, { name: "Special A", kind: "org_specific", buyerOrgId: buyerA.org.id });
    await setProductPrices(s.ctx, { priceListId: special.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "9.75" }] });
    const ent = await upsertPriceList(s.ctx, null, { name: "Enterprise", kind: "enterprise" });
    await setProductPrices(s.ctx, { priceListId: ent.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: "11.5" }] });

    const priceFor = (c: { userId: string | null; orgId: string | null; mode: "user" | "public" }, buyer: Parameters<typeof resolvePrices>[2]) => withContext(c, (tx) => resolvePrices(tx, [p.id], buyer, { [p.id]: "10" }));
    const a = (await priceFor({ userId: buyerA.user.id, orgId: buyerA.org.id, mode: "user" }, { orgId: buyerA.org.id, orgType: "buyer" })).get(p.id)!;
    expect(a.kind).toBe("org_specific");
    expect(a.unitPrice.toFixed(2)).toBe("9.75");
    const b = (await priceFor({ userId: buyerB.user.id, orgId: buyerB.org.id, mode: "user" }, { orgId: buyerB.org.id, orgType: "buyer" })).get(p.id)!;
    expect(b.kind).toBe("enterprise");
    const anon = (await priceFor({ userId: null, orgId: null, mode: "public" }, { orgId: null })).get(p.id)!;
    expect(anon.kind).toBe("retail");
    // even if buyer B claims to be buyer A, RLS hides A's list
    const forged = (await priceFor({ userId: buyerB.user.id, orgId: buyerB.org.id, mode: "user" }, { orgId: buyerA.org.id, orgType: "buyer" })).get(p.id)!;
    expect(forged.kind).toBe("enterprise");
    expect(await rawAsApp({ userId: buyerB.user.id, orgId: buyerB.org.id }, "select id from price_lists where id = $1", [special.id])).toHaveLength(0);
    expect(await rawAsApp({ mode: "public" }, "select id from price_lists where id = $1", [ent.id])).toHaveLength(0);
  });

  it("reserves, releases and fulfils stock without going negative", async () => {
    const s = await approvedSupplier();
    const pipes = await cat("pipes");
    const p = await createProduct(s.ctx, { sku: "GI-50", categoryId: pipes.id, nameAr: "ماسورة مجلفن 50", nameEn: "GI pipe 50mm", saleUnit: "pc", attributes: { material: "gi", diameter_mm: 50 }, status: "active" });
    const w1 = await upsertWarehouse(s.ctx, null, { name: "Riyadh WH", city: "riyadh" });
    const w2 = await upsertWarehouse(s.ctx, null, { name: "Jeddah WH", city: "jeddah" });
    await setStock(s.ctx, { warehouseId: w1.id, supplierProductId: p.id, onHand: "6" });
    await setStock(s.ctx, { warehouseId: w2.id, supplierProductId: p.id, onHand: "4" });
    await withSystem(async (tx) => {
      expect((await availableQty(tx, p.id)).toFixed(0)).toBe("10");
      expect(await reserveStock(tx, p.id, "11", "order:x")).toBe(false);
      expect(await reserveStock(tx, p.id, "8", "order:a")).toBe(true);
      expect((await availableQty(tx, p.id)).toFixed(0)).toBe("2");
      await settleReservation(tx, p.id, "order:a", "release");
      await settleReservation(tx, p.id, "order:a", "release"); // idempotent
      expect((await availableQty(tx, p.id)).toFixed(0)).toBe("10");
      expect(await reserveStock(tx, p.id, "3", "order:b")).toBe(true);
      await settleReservation(tx, p.id, "order:b", "fulfil");
      expect((await availableQty(tx, p.id)).toFixed(0)).toBe("7");
    });
    await expect(setStock(s.ctx, { warehouseId: w1.id, supplierProductId: p.id, onHand: "-1" })).rejects.toThrow();
  });

  it("bulk import applies valid rows and reports errors per row", async () => {
    const s = await approvedSupplier();
    await upsertWarehouse(s.ctx, null, { name: "Main", city: "riyadh" });
    const csv = [
      "sku,name_ar,name_en,category,unit,brand,price,stock,status,attr:diameter_mm,attr:material",
      "IMP-1,ماسورة 110,Pipe 110,pipes,م.ط,Acme,25.50,100,active,110,upvc",
      "IMP-2,محبس,Valve,valves,عدد,Acme,abc,5,active,,",
      "IMP-3,ماسورة,Pipe,unknown-cat,m,,10,,,,",
      "IMP-1,ماسورة 110 محدثة,Pipe 110 v2,pipes,m,Acme,24,,active,110,upvc",
    ].join("\n");
    const batch = await startProductImport(s.ctx, { buffer: Buffer.from(csv, "utf8"), fileName: "products.csv" });
    const res = await processProductImport(batch.id, s.user.id, s.org.id);
    expect(res).toEqual({ ok: 2, errors: 2 });
    const rows = await withSystem((tx) => tx.select().from(importBatchRows).where(eq(importBatchRows.batchId, batch.id)));
    expect(rows.find((r) => r.rowNumber === 3)!.errors).toContain("invalid_price");
    expect(rows.find((r) => r.rowNumber === 4)!.errors).toContain("unknown_category");
    expect(rows.find((r) => r.rowNumber === 5)!.status).toBe("updated");
    const [prod] = await withContext({ userId: s.user.id, orgId: s.org.id, mode: "user" }, (tx) => tx.select().from(supplierProducts).where(eq(supplierProducts.sku, "IMP-1")));
    expect(prod!.nameEn).toBe("Pipe 110 v2");
    // retail list auto-created
    const lists = await withContext({ userId: s.user.id, orgId: s.org.id, mode: "user" }, (tx) => tx.select().from(priceLists).where(eq(priceLists.orgId, s.org.id)));
    expect(lists.some((l) => l.kind === "retail")).toBe(true);
  });
});

describe("canonical catalog data quality", () => {
  it("flags likely duplicates for review but never merges automatically; conflicting critical attributes are not flagged", async () => {
    const admin = await adminCtx();
    const pipes = await cat("pipes");
    const suffix = Date.now().toString(36);
    const a = await createCanonical(admin, { categoryId: pipes.id, nameAr: `ماسورة يو بي في سي 110 مم ${suffix}`, nameEn: `uPVC drainage pipe 110 mm ${suffix}`, baseUnit: "m", attributes: { material: "upvc", diameter_mm: 110 } });
    const b = await createCanonical(admin, { categoryId: pipes.id, nameAr: `ماسورة يو بي في سي 110مم ${suffix}`, nameEn: `uPVC drainage pipe 110mm ${suffix}`, baseUnit: "m", attributes: { material: "upvc", diameter_mm: 110 } });
    expect(b.duplicatesFlagged).toBeGreaterThan(0);
    const c = await createCanonical(admin, { categoryId: pipes.id, nameAr: `ماسورة يو بي في سي 160 مم ${suffix}`, nameEn: `uPVC drainage pipe 160 mm ${suffix}`, baseUnit: "m", attributes: { material: "upvc", diameter_mm: 160 } });
    const cands = await listDuplicateCandidates(admin);
    const pair = cands.find((x) => [x.aId, x.bId].includes(a.product.id) && [x.aId, x.bId].includes(b.product.id))!;
    expect(pair).toBeDefined();
    expect(cands.some((x) => [x.aId, x.bId].includes(c.product.id))).toBe(false);
    // both still active until an admin decides
    expect(pair.a!.status).toBe("active");
    expect(pair.b!.status).toBe("active");
    await resolveDuplicate(admin, pair.id, { action: "merge", keepId: a.product.id });
    const after = await listDuplicateCandidates(admin);
    expect(after.some((x) => x.id === pair.id)).toBe(false);
  });
});
