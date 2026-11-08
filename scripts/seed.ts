/**
 * Development / test seed. Refuses to run in staging or production.
 * Creates: reference data, system roles, a platform admin, a demo buyer org and an approved demo
 * supplier with products. All demo organizations are flagged is_test_data (excluded from analytics).
 * Credentials come from SEED_* env vars (see .env.example) — never use these in real environments.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const envFile = join(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const appEnv = process.env.APP_ENV ?? "development";
if (appEnv !== "development" && appEnv !== "test") {
  console.error(`Refusing to seed in APP_ENV=${appEnv}`);
  process.exit(1);
}

const { hashPassword } = await import("better-auth/crypto");
const { eq, isNull } = await import("drizzle-orm");
const { uuidv7 } = await import("@platform/core");
const { closeDb, withSystem } = await import("@platform/db");
const schema = await import("@platform/db/schema");
const { syncSystemRoles, createOrganization, updateOrganization } = await import("@platform/modules/organizations");
const { syncReferenceData } = await import("@platform/modules/reference");
const { resolveContext } = await import("@platform/modules/context");
const suppliers = await import("@platform/modules/suppliers");
const sp = await import("@platform/modules/supplier-products");

const PASSWORD = process.env.SEED_PASSWORD ?? "Seed-Passw0rd-2026!";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@platform.test";

async function ensureUser(email: string, name: string, opts: { admin?: boolean } = {}) {
  const [existing] = await withSystem((tx) => tx.select().from(schema.authUsers).where(eq(schema.authUsers.email, email)).limit(1));
  if (existing) return existing;
  const id = uuidv7();
  const hash = await hashPassword(PASSWORD);
  return withSystem(async (tx) => {
    const [u] = await tx.insert(schema.authUsers).values({ id, email, name, emailVerified: true, isPlatformAdmin: opts.admin ?? false }).returning();
    await tx.insert(schema.authAccounts).values({ accountId: id, providerId: "credential", userId: id, password: hash });
    return u!;
  });
}

const { getStorage } = await import("@platform/integrations/storage");
await getStorage().ensureBucket();
await syncSystemRoles();
await syncReferenceData();
const admin = await ensureUser(ADMIN_EMAIL, "Platform Admin", { admin: true });
console.log(`admin: ${admin.email}`);

const buyerUser = await ensureUser("buyer.owner@demo.test", "مالك المؤسسة التجريبية");
const supplierUser = await ensureUser("supplier.owner@demo.test", "مسؤول المورد التجريبي");

const existingOrgs = await withSystem((tx) => tx.select().from(schema.memberships).where(eq(schema.memberships.userId, buyerUser.id)));
if (!existingOrgs.length) {
  const base = await resolveContext({ userId: buyerUser.id });
  const org = await createOrganization(base, { type: "buyer", nameAr: "شركة البناء التجريبية", nameEn: "Demo Construction Co.", city: "riyadh", activityType: "contractor" }, { isTestData: true });
  console.log(`buyer org: ${org.id}`);
}

const supMembership = await withSystem((tx) => tx.select().from(schema.memberships).where(eq(schema.memberships.userId, supplierUser.id)));
if (!supMembership.length) {
  const base = await resolveContext({ userId: supplierUser.id });
  const org = await createOrganization(base, { type: "supplier", nameAr: "مؤسسة التوريد التجريبية", nameEn: "Demo Supply Est." }, { isTestData: true });
  const ctx = await resolveContext({ userId: supplierUser.id, orgId: org.id });
  await updateOrganization(ctx, { crNumber: "1010999999", vatNumber: "399999999900003", city: "riyadh" });
  const cats = await withSystem((tx) => tx.select().from(schema.categories));
  const bySlug = (s: string) => cats.find((c) => c.slug === s)!.id;
  await suppliers.updateMyProfile(ctx, { descriptionAr: "مورد تجريبي لمواد السباكة والكهرباء", descriptionEn: "Demo plumbing & electrical supplier", deliversNationwide: true, categoryIds: [bySlug("pipes"), bySlug("fittings"), bySlug("power-cables"), bySlug("circuit-breakers")] });
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");
  const cr = await suppliers.uploadSupplierDocument(ctx, { kind: "commercial_registration", documentNumber: "1010999999" }, { buffer: pdf, fileName: "cr.pdf" });
  const vat = await suppliers.uploadSupplierDocument(ctx, { kind: "vat_certificate" }, { buffer: pdf, fileName: "vat.pdf" });
  await suppliers.submitForVerification(ctx);
  const actx = await resolveContext({ userId: admin.id });
  const adminCtx = { ...actx, mfaEnabled: true };
  await suppliers.startReview(adminCtx, org.id);
  await suppliers.reviewDocument(adminCtx, cr.id, { status: "verified" });
  await suppliers.reviewDocument(adminCtx, vat.id, { status: "verified" });
  await suppliers.decideSupplier(adminCtx, org.id, { decision: "approved" });
  const sctx = await resolveContext({ userId: supplierUser.id, orgId: org.id });
  const wh = await suppliers.upsertWarehouse(sctx, null, { name: "Riyadh Main", city: "riyadh", region: "RD" });
  const retail = await sp.upsertPriceList(sctx, null, { name: "Retail", kind: "retail" });
  const ent = await sp.upsertPriceList(sctx, null, { name: "Enterprise", kind: "enterprise" });
  const items: [string, string, string, string, string, Record<string, unknown>, string, string][] = [
    ["UPVC-110", "pipes", "ماسورة يو بي في سي 110 مم (6 م)", "uPVC pipe 110mm (6 m)", "m", { material: "upvc", diameter_mm: 110 }, "24.50", "22.00"],
    ["UPVC-160", "pipes", "ماسورة يو بي في سي 160 مم (6 م)", "uPVC pipe 160mm (6 m)", "m", { material: "upvc", diameter_mm: 160 }, "48.00", "44.00"],
    ["PPR-25", "pipes", "ماسورة بي بي آر 25 مم PN20", "PPR pipe 25mm PN20", "m", { material: "ppr", diameter_mm: 25, pressure_class: "PN20" }, "6.75", "6.10"],
    ["ELB-110", "fittings", "كوع يو بي في سي 110 مم 90°", "uPVC elbow 110mm 90°", "pc", { material: "upvc", diameter_mm: 110, fitting_type: "elbow_90" }, "9.90", "8.80"],
    ["CBL-4X16", "power-cables", "كابل نحاس 4×16 مم² XLPE", "Copper cable 4x16mm² XLPE", "m", { cores: 4, cross_section_mm2: 16, conductor_material: "cu", insulation: "xlpe", voltage: 1000 }, "62.00", "57.50"],
    ["MCB-1P-20", "circuit-breakers", "قاطع MCB أحادي 20 أمبير", "MCB 1P 20A", "pc", { poles: 1, current_rating_a: 20, breaker_type: "mcb", breaking_capacity_ka: 6 }, "18.50", "16.90"],
  ];
  for (const [sku, cat, ar, en, unit, attributes, retailPrice, entPrice] of items) {
    const p = await sp.createProduct(sctx, { sku, categoryId: bySlug(cat), nameAr: ar, nameEn: en, saleUnit: unit, attributes, brandName: "DemoBrand", status: "active", leadTimeDays: 3 });
    await sp.setProductPrices(sctx, { priceListId: retail.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: retailPrice }] });
    await sp.setProductPrices(sctx, { priceListId: ent.id, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: entPrice }] });
    await sp.setStock(sctx, { warehouseId: wh.id, supplierProductId: p.id, onHand: "500" });
    await sp.setPublished(sctx, p.id, true);
  }
  console.log(`supplier org (approved, ${items.length} products): ${org.id}`);
}

// platform default delivery rates (used for suppliers without their own zones) — dev/test values
const defaultZones = await withSystem((tx) => tx.select().from(schema.shippingZones).where(isNull(schema.shippingZones.supplierOrgId)));
if (!defaultZones.length) {
  await withSystem(async (tx) => {
    const [z] = await tx.insert(schema.shippingZones).values({ supplierOrgId: null, name: "KSA default", nationwide: true }).returning();
    await tx.insert(schema.shippingRates).values([
      { zoneId: z!.id, supplierOrgId: null, method: "standard", fee: "25.00", freeOver: "500.00", etaMinDays: 2, etaMaxDays: 5 },
      { zoneId: z!.id, supplierOrgId: null, method: "express", fee: "60.00", freeOver: null, etaMinDays: 1, etaMaxDays: 2 },
    ]);
  });
  console.log("default shipping zone created");
}

await closeDb();
console.log("seed complete");
