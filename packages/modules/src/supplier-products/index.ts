import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, D, dec, invalidState, notFound, unit, validation, type Dec } from "@platform/core";
import { normalizeText } from "@platform/core/text";
import { likeEscape, pageParams, withContext, withPublic, type Tx } from "@platform/db";
import {
  canonicalProducts,
  categories,
  inventoryLevels,
  inventoryMovements,
  priceListItems,
  priceLists,
  supplierProducts,
  supplierProfiles,
  units,
  warehouses,
} from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { attributesForCategory, ensureBrand, normalizeAttributes } from "../catalog";
import { dbCtx, type Ctx } from "../context";

// ------------------------------------------------------------------------------------------ products

const decimalStr = (max = 1e9) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) <= max, "Invalid number");

export const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, "SKU may contain letters, digits and . _ - /"),
  categoryId: z.string().uuid(),
  canonicalProductId: z.string().uuid().optional().nullable(),
  nameAr: z.string().trim().min(2).max(300),
  nameEn: z.string().trim().min(2).max(300),
  descriptionAr: z.string().trim().max(5000).optional().nullable(),
  descriptionEn: z.string().trim().max(5000).optional().nullable(),
  brandName: z.string().trim().max(80).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  countryOfOrigin: z.string().trim().max(60).optional().nullable(),
  certifications: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  saleUnit: z.string().trim().min(1).max(10),
  packSize: decimalStr().default("1"),
  moq: decimalStr().default("1"),
  orderIncrement: decimalStr().default("1"),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  vatRate: z
    .string()
    .regex(/^0(\.\d{1,4})?$/)
    .default("0.15"),
  status: z.enum(["draft", "active", "inactive"]).default("draft"),
});
export type ProductInput = z.input<typeof productSchema>;

async function validateProduct(tx: Tx, d: z.output<typeof productSchema>) {
  const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, d.categoryId)).limit(1);
  if (!cat) throw validation("Unknown category", { field: "categoryId" });
  const [u] = await tx.select({ code: units.code }).from(units).where(eq(units.code, d.saleUnit)).limit(1);
  if (!u) throw validation("Unknown unit", { field: "saleUnit" });
  if (d.canonicalProductId) {
    const [cp] = await tx.select({ id: canonicalProducts.id }).from(canonicalProducts).where(eq(canonicalProducts.id, d.canonicalProductId)).limit(1);
    if (!cp) throw validation("Unknown canonical product", { field: "canonicalProductId" });
  }
  for (const k of ["packSize", "moq", "orderIncrement"] as const) if (dec(d[k]).lte(0)) throw validation(`${k} must be > 0`, { field: k });
  const defs = await attributesForCategory(d.categoryId);
  return normalizeAttributes(d.attributes, defs);
}

export async function createProduct(ctx: Ctx, input: ProductInput, tx0?: Tx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.manage", { write: true });
  const d = productSchema.parse(input);
  const run = async (tx: Tx) => {
    const attributes = await validateProduct(tx, d);
    const [dup] = await tx.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.orgId, ctx.orgId!), eq(supplierProducts.sku, d.sku))).limit(1);
    if (dup) throw new AppError("CONFLICT", "SKU already exists", { key: "sku_exists", details: { sku: d.sku } });
    const brandId = d.brandName ? await ensureBrand(tx, d.brandName) : null;
    const [row] = await tx
      .insert(supplierProducts)
      .values({
        ...d,
        attributes,
        brandId,
        orgId: ctx.orgId!,
        normalizedName: normalizeText(`${d.nameEn} ${d.nameAr} ${d.brandName ?? ""} ${d.model ?? ""}`),
        matchStatus: d.canonicalProductId ? "confirmed" : "unmatched",
        matchSource: d.canonicalProductId ? "manual" : null,
      })
      .returning();
    await audit(ctx, { action: "product.created", entityType: "supplier_product", entityId: row!.id, data: { sku: d.sku } }, tx);
    return row!;
  };
  return tx0 ? run(tx0) : withContext(dbCtx(ctx), run);
}

export async function updateProduct(ctx: Ctx, id: string, input: ProductInput, tx0?: Tx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.manage", { write: true });
  const d = productSchema.parse(input);
  const run = async (tx: Tx) => {
    const [before] = await tx.select().from(supplierProducts).where(and(eq(supplierProducts.id, id), eq(supplierProducts.orgId, ctx.orgId!))).limit(1);
    if (!before) throw notFound("Product");
    const attributes = await validateProduct(tx, d);
    if (d.sku !== before.sku) {
      const [dup] = await tx.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.orgId, ctx.orgId!), eq(supplierProducts.sku, d.sku))).limit(1);
      if (dup) throw new AppError("CONFLICT", "SKU already exists", { key: "sku_exists" });
    }
    const brandId = d.brandName ? await ensureBrand(tx, d.brandName) : null;
    const canonicalChanged = (d.canonicalProductId ?? null) !== before.canonicalProductId;
    const [row] = await tx
      .update(supplierProducts)
      .set({
        ...d,
        attributes,
        brandId,
        normalizedName: normalizeText(`${d.nameEn} ${d.nameAr} ${d.brandName ?? ""} ${d.model ?? ""}`),
        ...(canonicalChanged ? { matchStatus: d.canonicalProductId ? "confirmed" : "unmatched", matchSource: d.canonicalProductId ? "manual" : null } : {}),
        isPublished: d.status === "active" ? before.isPublished : false,
      })
      .where(eq(supplierProducts.id, id))
      .returning();
    await audit(ctx, { action: "product.updated", entityType: "supplier_product", entityId: id, data: { sku: d.sku } }, tx);
    return row!;
  };
  return tx0 ? run(tx0) : withContext(dbCtx(ctx), run);
}

/** Publishing to the store requires an approved supplier, an active product and a retail price. */
export async function setPublished(ctx: Ctx, id: string, published: boolean) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [p] = await tx.select().from(supplierProducts).where(and(eq(supplierProducts.id, id), eq(supplierProducts.orgId, ctx.orgId))).limit(1);
    if (!p) throw notFound("Product");
    if (published) {
      const [sp] = await tx.select({ status: supplierProfiles.status, acceptsStoreOrders: supplierProfiles.acceptsStoreOrders }).from(supplierProfiles).where(eq(supplierProfiles.orgId, ctx.orgId)).limit(1);
      if (sp?.status !== "approved") throw new AppError("INVALID_STATE", "Supplier must be approved to publish products", { key: "supplier_not_approved" });
      if (!sp.acceptsStoreOrders) throw new AppError("INVALID_STATE", "Store orders are disabled in your profile", { key: "store_orders_disabled" });
      if (p.status !== "active") throw new AppError("INVALID_STATE", "Only active products can be published", { key: "product_not_active" });
      const [price] = await tx
        .select({ id: priceListItems.id })
        .from(priceListItems)
        .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
        .where(and(eq(priceListItems.supplierProductId, id), eq(priceLists.kind, "retail"), eq(priceLists.isActive, true)))
        .limit(1);
      if (!price) throw new AppError("INVALID_STATE", "A retail price is required before publishing", { key: "retail_price_required" });
    }
    await tx.update(supplierProducts).set({ isPublished: published }).where(eq(supplierProducts.id, id));
    await audit(ctx, { action: published ? "product.published" : "product.unpublished", entityType: "supplier_product", entityId: id }, tx);
  });
}

export async function getMyProduct(ctx: Ctx, id: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [p] = await tx.select().from(supplierProducts).where(and(eq(supplierProducts.id, id), eq(supplierProducts.orgId, ctx.orgId))).limit(1);
    if (!p) throw notFound("Product");
    const prices = await tx
      .select({ item: priceListItems, list: priceLists })
      .from(priceListItems)
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(eq(priceListItems.supplierProductId, id))
      .orderBy(asc(priceLists.kind), asc(priceListItems.minQty));
    const stock = await tx
      .select({ warehouseId: inventoryLevels.warehouseId, onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved, warehouse: warehouses.name })
      .from(inventoryLevels)
      .innerJoin(warehouses, eq(warehouses.id, inventoryLevels.warehouseId))
      .where(eq(inventoryLevels.supplierProductId, id));
    return { product: p, prices, stock };
  });
}

export async function listMyProducts(ctx: Ctx, opts: { q?: string; status?: string; categoryId?: string; page?: number; pageSize?: number } = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, opts.pageSize ?? 25);
  return withContext(dbCtx(ctx), async (tx) => {
    const q = opts.q ? normalizeText(opts.q) : null;
    const where = and(
      eq(supplierProducts.orgId, ctx.orgId),
      opts.status ? eq(supplierProducts.status, opts.status) : undefined,
      opts.categoryId ? eq(supplierProducts.categoryId, opts.categoryId) : undefined,
      q ? or(sql`${supplierProducts.normalizedName} like ${"%" + likeEscape(q) + "%"}`, sql`lower(${supplierProducts.sku}) like ${"%" + likeEscape(q.toLowerCase()) + "%"}`) : undefined,
    );
    const items = await tx
      .select({
        id: supplierProducts.id,
        sku: supplierProducts.sku,
        nameAr: supplierProducts.nameAr,
        nameEn: supplierProducts.nameEn,
        status: supplierProducts.status,
        isPublished: supplierProducts.isPublished,
        saleUnit: supplierProducts.saleUnit,
        matchStatus: supplierProducts.matchStatus,
        brandName: supplierProducts.brandName,
        updatedAt: supplierProducts.updatedAt,
        available: sql<string>`product_available_qty(${supplierProducts.id})`,
      })
      .from(supplierProducts)
      .where(where)
      .orderBy(desc(supplierProducts.updatedAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(supplierProducts).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

// ------------------------------------------------------------------------------------------ price lists

export const priceListSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    kind: z.enum(["retail", "enterprise", "org_specific", "regional"]),
    buyerOrgId: z.string().uuid().optional().nullable(),
    regions: z.array(z.string().max(4)).max(20).default([]),
    cities: z.array(z.string().max(40)).max(100).default([]),
    pricesIncludeVat: z.boolean().default(false),
    validFrom: z.coerce.date().optional().nullable(),
    validTo: z.coerce.date().optional().nullable(),
    isActive: z.boolean().default(true),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine((d) => (d.kind === "org_specific") === Boolean(d.buyerOrgId), { message: "Org-specific lists need a buyer organization", path: ["buyerOrgId"] })
  .refine((d) => d.kind !== "regional" || d.regions.length + d.cities.length > 0, { message: "Regional lists need regions or cities", path: ["regions"] })
  .refine((d) => !d.validFrom || !d.validTo || d.validTo > d.validFrom, { message: "End must be after start", path: ["validTo"] });

export async function listPriceLists(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.view");
  return withContext(dbCtx(ctx), (tx) => tx.select().from(priceLists).where(eq(priceLists.orgId, ctx.orgId)).orderBy(asc(priceLists.kind), asc(priceLists.name)));
}

export async function upsertPriceList(ctx: Ctx, id: string | null, input: z.input<typeof priceListSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "pricing.manage", { write: true });
  const d = priceListSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const values = { ...d, buyerOrgId: d.kind === "org_specific" ? d.buyerOrgId! : null, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null };
    let row;
    if (id) {
      [row] = await tx.update(priceLists).set(values).where(and(eq(priceLists.id, id), eq(priceLists.orgId, ctx.orgId))).returning();
      if (!row) throw notFound("Price list");
    } else {
      [row] = await tx.insert(priceLists).values({ ...values, orgId: ctx.orgId }).returning();
    }
    await audit(ctx, { action: id ? "pricing.list_updated" : "pricing.list_created", entityType: "price_list", entityId: row!.id, data: { kind: d.kind } }, tx);
    return row!;
  });
}

/** The supplier's default retail list (created on demand). */
export async function ensureRetailList(tx: Tx, orgId: string): Promise<string> {
  const [existing] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.orgId, orgId), eq(priceLists.kind, "retail"))).orderBy(asc(priceLists.createdAt)).limit(1);
  if (existing) return existing.id;
  const [row] = await tx.insert(priceLists).values({ orgId, name: "Retail", kind: "retail" }).returning({ id: priceLists.id });
  return row!.id;
}

export const priceItemSchema = z.object({
  priceListId: z.string().uuid(),
  supplierProductId: z.string().uuid(),
  tiers: z
    .array(z.object({ minQty: decimalStr(), unitPrice: decimalStr(1e8), discountPct: z.coerce.number().min(0).max(99.99).default(0) }))
    .min(1)
    .max(20),
});

/** Replace the tiers of one product in one price list. Tiers must have distinct minQty. */
export async function setProductPrices(ctx: Ctx, input: z.input<typeof priceItemSchema>, tx0?: Tx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "pricing.manage", { write: true });
  const d = priceItemSchema.parse(input);
  const mins = d.tiers.map((t) => dec(t.minQty).toFixed(4));
  if (new Set(mins).size !== mins.length) throw validation("Duplicate quantity tiers");
  const run = async (tx: Tx) => {
    const [pl] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, d.priceListId), eq(priceLists.orgId, ctx.orgId!))).limit(1);
    if (!pl) throw notFound("Price list");
    const [p] = await tx.select({ id: supplierProducts.id, moq: supplierProducts.moq }).from(supplierProducts).where(and(eq(supplierProducts.id, d.supplierProductId), eq(supplierProducts.orgId, ctx.orgId!))).limit(1);
    if (!p) throw notFound("Product");
    await tx.delete(priceListItems).where(and(eq(priceListItems.priceListId, d.priceListId), eq(priceListItems.supplierProductId, d.supplierProductId)));
    await tx.insert(priceListItems).values(
      d.tiers.map((t) => ({ priceListId: d.priceListId, supplierProductId: d.supplierProductId, minQty: unit(t.minQty).toFixed(4), unitPrice: unit(t.unitPrice).toFixed(4), discountPct: dec(t.discountPct).toFixed(2) })),
    );
    await audit(ctx, { action: "pricing.prices_set", entityType: "supplier_product", entityId: d.supplierProductId, data: { priceListId: d.priceListId, tiers: d.tiers } }, tx);
  };
  return tx0 ? run(tx0) : withContext(dbCtx(ctx), run);
}

// ------------------------------------------------------------------------------------------ price resolution

export interface Buyer {
  orgId?: string | null;
  orgType?: "buyer" | "supplier" | "platform" | null;
  city?: string | null;
  region?: string | null;
}

export interface ResolvedPrice {
  priceListId: string;
  kind: "retail" | "enterprise" | "org_specific" | "regional";
  unitPrice: Dec; // effective, ex-VAT, after tier discount
  listUnitPrice: Dec;
  discountPct: Dec;
  minQty: Dec;
  pricesIncludeVat: boolean;
  vatRate: Dec;
}

const SPECIFICITY: Record<ResolvedPrice["kind"], number> = { org_specific: 4, regional: 3, enterprise: 2, retail: 1 };

type Candidate = {
  list: Pick<typeof priceLists.$inferSelect, "id" | "kind" | "buyerOrgId" | "regions" | "cities" | "pricesIncludeVat" | "validFrom" | "validTo" | "isActive" | "priority">;
  item: Pick<typeof priceListItems.$inferSelect, "minQty" | "unitPrice" | "discountPct">;
};

/**
 * Pure price selection. Eligible lists: retail always; enterprise for buyer orgs; org_specific for the
 * matching buyer org; regional when city/region matches. The most specific eligible list wins (ties by
 * priority, then lowest price). Within a list the highest tier with minQty ≤ qty applies.
 */
export function selectPrice(cands: Candidate[], buyer: Buyer, qty: string, vatRate: string, at = new Date()): ResolvedPrice | null {
  const q = dec(qty);
  const eligible = cands.filter(({ list }) => {
    if (!list.isActive) return false;
    if (list.validFrom && list.validFrom > at) return false;
    if (list.validTo && list.validTo <= at) return false;
    if (list.kind === "retail") return true;
    if (list.kind === "enterprise") return buyer.orgType === "buyer";
    if (list.kind === "org_specific") return Boolean(buyer.orgId && list.buyerOrgId === buyer.orgId);
    if (list.kind === "regional") return Boolean((buyer.city && list.cities.includes(buyer.city)) || (buyer.region && list.regions.includes(buyer.region)));
    return false;
  });
  const perList = new Map<string, Candidate>();
  for (const c of eligible) {
    if (dec(c.item.minQty).gt(q)) continue;
    const cur = perList.get(c.list.id);
    if (!cur || dec(c.item.minQty).gt(dec(cur.item.minQty))) perList.set(c.list.id, c);
  }
  const effective = (c: Candidate) => {
    let p = dec(c.item.unitPrice).times(new D(1).minus(dec(c.item.discountPct).div(100)));
    if (c.list.pricesIncludeVat) p = p.div(dec(vatRate).plus(1));
    return unit(p);
  };
  const ranked = [...perList.values()].sort(
    (a, b) => SPECIFICITY[b.list.kind as ResolvedPrice["kind"]] - SPECIFICITY[a.list.kind as ResolvedPrice["kind"]] || b.list.priority - a.list.priority || effective(a).cmp(effective(b)),
  );
  const best = ranked[0];
  if (!best) return null;
  return {
    priceListId: best.list.id,
    kind: best.list.kind as ResolvedPrice["kind"],
    unitPrice: effective(best),
    listUnitPrice: dec(best.item.unitPrice),
    discountPct: dec(best.item.discountPct),
    minQty: dec(best.item.minQty),
    pricesIncludeVat: best.list.pricesIncludeVat,
    vatRate: dec(vatRate),
  };
}

/** Load candidates visible to the buyer (RLS-enforced) and select the applicable price for each product. */
export async function resolvePrices(tx: Tx, productIds: string[], buyer: Buyer, qtyByProduct: Record<string, string> = {}) {
  if (!productIds.length) return new Map<string, ResolvedPrice | null>();
  const rows = await tx
    .select({ productId: priceListItems.supplierProductId, list: priceLists, item: priceListItems, vatRate: supplierProducts.vatRate })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
    .innerJoin(supplierProducts, eq(supplierProducts.id, priceListItems.supplierProductId))
    .where(inArray(priceListItems.supplierProductId, productIds));
  const out = new Map<string, ResolvedPrice | null>();
  for (const id of productIds) {
    const mine = rows.filter((r) => r.productId === id);
    out.set(id, selectPrice(mine.map((r) => ({ list: r.list, item: r.item })), buyer, qtyByProduct[id] ?? "1", mine[0]?.vatRate ?? "0.15"));
  }
  return out;
}

/** Validate an order quantity against MOQ and order increment. */
export function checkOrderQuantity(p: { moq: string; orderIncrement: string }, qty: string): string | null {
  const q = dec(qty);
  if (q.lte(0)) return "quantity_positive";
  if (q.lt(dec(p.moq))) return "below_moq";
  const steps = q.minus(dec(p.moq)).div(dec(p.orderIncrement));
  if (!steps.isInteger()) return "invalid_increment";
  return null;
}

// ------------------------------------------------------------------------------------------ inventory

export const stockSchema = z.object({
  warehouseId: z.string().uuid(),
  supplierProductId: z.string().uuid(),
  onHand: decimalStr(),
  reason: z.string().trim().max(200).optional(),
});

/** Set absolute on-hand stock (cannot go below reserved). Movement recorded. */
export async function setStock(ctx: Ctx, input: z.input<typeof stockSchema>, tx0?: Tx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "inventory.manage", { write: true });
  const d = stockSchema.parse(input);
  const run = async (tx: Tx) => {
    const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, d.warehouseId), eq(warehouses.orgId, ctx.orgId!))).limit(1);
    if (!w) throw notFound("Warehouse");
    const [p] = await tx.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.id, d.supplierProductId), eq(supplierProducts.orgId, ctx.orgId!))).limit(1);
    if (!p) throw notFound("Product");
    const [cur] = await tx
      .select()
      .from(inventoryLevels)
      .where(and(eq(inventoryLevels.warehouseId, d.warehouseId), eq(inventoryLevels.supplierProductId, d.supplierProductId)))
      .limit(1)
      .for("update");
    const newQty = unit(d.onHand);
    if (cur && newQty.lt(dec(cur.reserved))) throw invalidState("Stock cannot be below reserved quantity", { reserved: cur.reserved });
    await tx
      .insert(inventoryLevels)
      .values({ warehouseId: d.warehouseId, supplierProductId: d.supplierProductId, orgId: ctx.orgId!, onHand: newQty.toFixed(4) })
      .onConflictDoUpdate({ target: [inventoryLevels.warehouseId, inventoryLevels.supplierProductId], set: { onHand: newQty.toFixed(4), updatedAt: new Date() } });
    await tx.insert(inventoryMovements).values({
      orgId: ctx.orgId!,
      warehouseId: d.warehouseId,
      supplierProductId: d.supplierProductId,
      kind: "adjust",
      quantity: newQty.minus(dec(cur?.onHand ?? 0)).toFixed(4),
      reference: d.reason ?? null,
      actorUserId: ctx.userId,
    });
  };
  return tx0 ? run(tx0) : withContext(dbCtx(ctx), run);
}

/**
 * Reserve stock for an order line across the supplier's warehouses (system operation used by
 * checkout). Returns false when insufficient — caller decides (backorder not allowed in store).
 */
export async function reserveStock(tx: Tx, productId: string, qty: string, reference: string): Promise<boolean> {
  let need = dec(qty);
  const rows = await tx
    .select()
    .from(inventoryLevels)
    .innerJoin(warehouses, and(eq(warehouses.id, inventoryLevels.warehouseId), eq(warehouses.isActive, true)))
    .where(eq(inventoryLevels.supplierProductId, productId))
    .orderBy(desc(sql`${inventoryLevels.onHand} - ${inventoryLevels.reserved}`))
    .for("update", { of: inventoryLevels });
  const available = rows.reduce((a, r) => a.plus(dec(r.inventory_levels.onHand).minus(dec(r.inventory_levels.reserved))), dec(0));
  if (available.lt(need)) return false;
  for (const r of rows) {
    if (need.lte(0)) break;
    const free = dec(r.inventory_levels.onHand).minus(dec(r.inventory_levels.reserved));
    const take = D.min(free, need);
    if (take.lte(0)) continue;
    await tx
      .update(inventoryLevels)
      .set({ reserved: dec(r.inventory_levels.reserved).plus(take).toFixed(4) })
      .where(and(eq(inventoryLevels.warehouseId, r.inventory_levels.warehouseId), eq(inventoryLevels.supplierProductId, productId)));
    await tx.insert(inventoryMovements).values({ orgId: r.inventory_levels.orgId, warehouseId: r.inventory_levels.warehouseId, supplierProductId: productId, kind: "reserve", quantity: take.toFixed(4), reference });
    need = need.minus(take);
  }
  return true;
}

/** Release (cancel) or consume (fulfil) a reservation recorded under `reference`. */
export async function settleReservation(tx: Tx, productId: string, reference: string, mode: "release" | "fulfil"): Promise<void> {
  const moves = await tx
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.supplierProductId, productId), eq(inventoryMovements.reference, reference), eq(inventoryMovements.kind, "reserve")));
  const done = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.supplierProductId, productId), eq(inventoryMovements.reference, reference), inArray(inventoryMovements.kind, ["release", "fulfil"])));
  if ((done[0]?.n ?? 0) > 0) return; // idempotent
  for (const m of moves) {
    const q = dec(m.quantity);
    const [lvl] = await tx.select().from(inventoryLevels).where(and(eq(inventoryLevels.warehouseId, m.warehouseId), eq(inventoryLevels.supplierProductId, productId))).limit(1).for("update");
    if (!lvl) continue;
    const reserved = D.max(dec(lvl.reserved).minus(q), 0);
    const onHand = mode === "fulfil" ? D.max(dec(lvl.onHand).minus(q), reserved) : dec(lvl.onHand);
    await tx.update(inventoryLevels).set({ reserved: reserved.toFixed(4), onHand: onHand.toFixed(4) }).where(and(eq(inventoryLevels.warehouseId, m.warehouseId), eq(inventoryLevels.supplierProductId, productId)));
    await tx.insert(inventoryMovements).values({ orgId: m.orgId, warehouseId: m.warehouseId, supplierProductId: productId, kind: mode, quantity: q.toFixed(4), reference });
  }
}

export async function availableQty(tx: Tx, productId: string): Promise<Dec> {
  const r = await tx.execute(sql`select product_available_qty(${productId}::uuid) as q`);
  return dec((r.rows[0] as { q: string } | undefined)?.q ?? "0");
}

// ------------------------------------------------------------------------------------------ public reads

/** Public product view (store / RFQ): RLS exposes only active products of approved suppliers. */
export async function getPublicProduct(id: string) {
  const [p] = await withPublic((tx) => tx.select().from(supplierProducts).where(eq(supplierProducts.id, id)).limit(1));
  return p ?? null;
}

