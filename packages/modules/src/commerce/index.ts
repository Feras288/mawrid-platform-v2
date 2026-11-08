import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, dec, invalidState, lineTotals, money, notFound, toDb, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { pageParams, withContext, withSystem, type Tx } from "@platform/db";
import {
  addresses,
  authUsers,
  cartItems,
  carts,
  cities,
  invoices,
  orderCharges,
  orderEvents,
  orderGroups,
  orderLines,
  orders,
  organizations,
  paymentIntents,
  refunds,
  returnRequests,
  shippingRates,
  shippingZones,
  supplierProducts,
  wishlistItems,
} from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, requireOrg, requireUser } from "../authz";
import { getSetting, isEnabled } from "../config";
import { dbCtx, type Ctx } from "../context";
import { POLICY_VERSIONS, recordConsent } from "../identity";
import { idempotent } from "../idempotency";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { availableMethods, refundPayment, startPayment } from "../payments";
import { buyerOf } from "../store";
import { availableQty, checkOrderQuantity, reserveStock, resolvePrices, settleReservation } from "../supplier-products";

/**
 * Store commerce: addresses, wishlist, multi-vendor cart with revalidation, shipping quotes, idempotent
 * checkout (one order, one group per supplier, typed charges, stock reservations), customer and
 * supplier order handling, cancellations and returns. Payment state lives in the payments module.
 */

const SYS = { userId: null, orgId: null, mode: "system" } as const;
const blank = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const qtyStr = z.preprocess((v) => (blank(v) === undefined ? undefined : parseLocaleNumber(v)), z.string().regex(/^\d+(\.\d{1,4})?$/));

/** Who is buying: a buyer org (needs store.purchase) or the user personally. Suppliers cannot buy as their org. */
function customerScope(ctx: Ctx): { userId: string; orgId: string | null } {
  requireUser(ctx);
  if (ctx.orgId && ctx.orgType === "buyer") {
    authorize(ctx, "store.purchase", { write: true });
    return { userId: ctx.userId!, orgId: ctx.orgId };
  }
  if (ctx.orgId && ctx.orgType !== "buyer") throw new AppError("FORBIDDEN", "Switch to personal shopping or a buyer organization to purchase", { key: "store_wrong_context" });
  return { userId: ctx.userId!, orgId: null };
}

async function storeOpen() {
  if (!(await isEnabled("store.enabled"))) throw invalidState("Store is disabled", { key: "store_disabled" });
}

// ------------------------------------------------------------------------------------------ addresses

export const addressSchema = z.object({
  label: z.preprocess(blank, z.string().trim().max(60).optional().nullable()),
  recipientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/),
  line1: z.string().trim().min(3).max(200),
  line2: z.preprocess(blank, z.string().trim().max(200).optional().nullable()),
  district: z.preprocess(blank, z.string().trim().max(100).optional().nullable()),
  city: z.string().trim().min(2).max(60),
  postalCode: z.preprocess(blank, z.string().trim().regex(/^\d{5}$/).optional().nullable()),
  nationalAddressCode: z.preprocess(blank, z.string().trim().regex(/^[A-Za-z]{4}\d{4}$/).optional().nullable()),
  isDefault: z.boolean().optional(),
});

const ownerCols = (s: { userId: string; orgId: string | null }) => (s.orgId ? { userId: null, orgId: s.orgId } : { userId: s.userId, orgId: null });
const ownerWhere = (s: { userId: string; orgId: string | null }) => (s.orgId ? eq(addresses.orgId, s.orgId) : and(eq(addresses.userId, s.userId), isNull(addresses.orgId)));

export async function listAddresses(ctx: Ctx) {
  const s = customerScope(ctx);
  return withContext(dbCtx(ctx), (tx) => tx.select().from(addresses).where(ownerWhere(s)).orderBy(desc(addresses.isDefault), desc(addresses.createdAt)));
}

export async function saveAddress(ctx: Ctx, id: string | null, input: z.input<typeof addressSchema>) {
  const s = customerScope(ctx);
  const d = addressSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const [c] = await tx.select({ code: cities.code, region: cities.regionCode }).from(cities).where(eq(cities.code, d.city)).limit(1);
    if (!c) throw validation("Unknown city", { key: "unknown_city", fields: { city: "invalid" } });
    if (d.isDefault) await tx.update(addresses).set({ isDefault: false }).where(ownerWhere(s));
    const values = { ...d, region: c.region, isDefault: d.isDefault ?? false };
    if (id) {
      const [row] = await tx.update(addresses).set(values).where(and(eq(addresses.id, id), ownerWhere(s))).returning();
      if (!row) throw notFound("Address");
      return row;
    }
    const existing = await tx.select({ id: addresses.id }).from(addresses).where(ownerWhere(s)).limit(1);
    const [row] = await tx.insert(addresses).values({ ...values, ...ownerCols(s), isDefault: values.isDefault || existing.length === 0 }).returning();
    return row!;
  });
}

export async function deleteAddress(ctx: Ctx, id: string) {
  const s = customerScope(ctx);
  await withContext(dbCtx(ctx), async (tx) => {
    const r = await tx.delete(addresses).where(and(eq(addresses.id, id), ownerWhere(s))).returning({ id: addresses.id });
    if (!r.length) throw notFound("Address");
  });
}

// ------------------------------------------------------------------------------------------ wishlist

export async function toggleWishlist(ctx: Ctx, productId: string): Promise<boolean> {
  requireUser(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const del = await tx.delete(wishlistItems).where(and(eq(wishlistItems.userId, ctx.userId!), eq(wishlistItems.supplierProductId, productId))).returning();
    if (del.length) return false;
    const [p] = await tx.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.id, productId), eq(supplierProducts.isPublished, true))).limit(1);
    if (!p) throw notFound("Product");
    await tx.insert(wishlistItems).values({ userId: ctx.userId!, supplierProductId: productId }).onConflictDoNothing();
    return true;
  });
}

export async function listWishlist(ctx: Ctx) {
  requireUser(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const rows = await tx
      .select({ p: supplierProducts, at: wishlistItems.createdAt, supAr: organizations.nameAr, supEn: organizations.nameEn })
      .from(wishlistItems)
      .innerJoin(supplierProducts, eq(supplierProducts.id, wishlistItems.supplierProductId))
      .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
      .where(eq(wishlistItems.userId, ctx.userId!))
      .orderBy(desc(wishlistItems.createdAt));
    const prices = await resolvePrices(tx, rows.map((r) => r.p.id), buyerOf(ctx));
    return rows.map((r) => ({ ...r, available: r.p.isPublished && r.p.status === "active", price: prices.get(r.p.id) ?? null }));
  });
}

export async function wishlistIds(ctx: Ctx): Promise<Set<string>> {
  if (!ctx.userId) return new Set();
  const rows = await withContext(dbCtx(ctx), (tx) => tx.select({ id: wishlistItems.supplierProductId }).from(wishlistItems).where(eq(wishlistItems.userId, ctx.userId!)));
  return new Set(rows.map((r) => r.id));
}

// ------------------------------------------------------------------------------------------ cart

async function activeCart(tx: Tx, s: { userId: string; orgId: string | null }, create: boolean): Promise<typeof carts.$inferSelect | null> {
  const [c] = await tx
    .select()
    .from(carts)
    .where(and(eq(carts.userId, s.userId), s.orgId ? eq(carts.orgId, s.orgId) : isNull(carts.orgId), eq(carts.status, "active")))
    .limit(1);
  if (c || !create) return c ?? null;
  const [n] = await tx.insert(carts).values({ userId: s.userId, orgId: s.orgId }).onConflictDoNothing().returning();
  if (n) return n;
  return activeCart(tx, s, false);
}

export async function addToCart(ctx: Ctx, productId: string, quantity: string) {
  await storeOpen();
  const s = customerScope(ctx);
  const q = qtyStr.parse(quantity);
  return withContext(dbCtx(ctx), async (tx) => {
    const [p] = await tx.select().from(supplierProducts).where(and(eq(supplierProducts.id, productId), eq(supplierProducts.isPublished, true), eq(supplierProducts.status, "active"))).limit(1);
    if (!p) throw notFound("Product");
    const cart = (await activeCart(tx, s, true))!;
    const [existing] = await tx.select().from(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.supplierProductId, p.id))).limit(1);
    const newQty = existing ? dec(existing.quantity).plus(dec(q)) : dec(q);
    const issue = checkOrderQuantity(p, newQty.toFixed(4));
    if (issue) throw validation("Invalid quantity", { key: issue, details: { moq: p.moq, increment: p.orderIncrement } });
    const price = (await resolvePrices(tx, [p.id], buyerOf(ctx), { [p.id]: newQty.toFixed(4) })).get(p.id);
    if (!price) throw invalidState("Product has no price for you", { key: "no_price" });
    if ((await availableQty(tx, p.id)).lt(newQty)) throw invalidState("Insufficient stock", { key: "insufficient_stock" });
    if (existing) await tx.update(cartItems).set({ quantity: newQty.toFixed(4), seenUnitPrice: price.unitPrice.toFixed(4) }).where(eq(cartItems.id, existing.id));
    else await tx.insert(cartItems).values({ cartId: cart.id, userId: s.userId, supplierProductId: p.id, supplierOrgId: p.orgId, quantity: newQty.toFixed(4), seenUnitPrice: price.unitPrice.toFixed(4) });
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return { quantity: newQty.toFixed(4) };
  });
}

export async function updateCartItem(ctx: Ctx, itemId: string, quantity: string) {
  const s = customerScope(ctx);
  const q = qtyStr.parse(quantity);
  return withContext(dbCtx(ctx), async (tx) => {
    const [it] = await tx.select({ it: cartItems, p: supplierProducts }).from(cartItems).innerJoin(supplierProducts, eq(supplierProducts.id, cartItems.supplierProductId)).where(and(eq(cartItems.id, itemId), eq(cartItems.userId, s.userId))).limit(1);
    if (!it) throw notFound("Cart item");
    if (dec(q).isZero()) {
      await tx.delete(cartItems).where(eq(cartItems.id, itemId));
      return;
    }
    const issue = checkOrderQuantity(it.p, q);
    if (issue) throw validation("Invalid quantity", { key: issue, details: { moq: it.p.moq, increment: it.p.orderIncrement } });
    await tx.update(cartItems).set({ quantity: dec(q).toFixed(4) }).where(eq(cartItems.id, itemId));
  });
}

export async function removeCartItem(ctx: Ctx, itemId: string) {
  const s = customerScope(ctx);
  await withContext(dbCtx(ctx), (tx) => tx.delete(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.userId, s.userId))));
}

export async function cartCount(ctx: Ctx): Promise<number> {
  if (!ctx.userId || (ctx.orgId && ctx.orgType !== "buyer")) return 0;
  const s = { userId: ctx.userId, orgId: ctx.orgId ?? null };
  return withContext(dbCtx(ctx), async (tx) => {
    const c = await activeCart(tx, s, false);
    if (!c) return 0;
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.cartId, c.id));
    return r?.n ?? 0;
  });
}

// ------------------------------------------------------------------------------------------ shipping

export interface ShippingOption {
  rateId: string;
  method: "standard" | "express" | "pickup";
  fee: string;
  vatRate: string;
  etaMinDays: number;
  etaMaxDays: number;
  free: boolean;
}

/** Options for one supplier group: the supplier's zones first; platform defaults when it has none. */
export async function shippingOptions(tx: Tx, supplierOrgId: string, city: string, region: string | null, goodsNet: string): Promise<ShippingOption[]> {
  const load = async (sup: string | null) =>
    tx
      .select({ z: shippingZones, r: shippingRates })
      .from(shippingRates)
      .innerJoin(shippingZones, eq(shippingZones.id, shippingRates.zoneId))
      .where(and(sup ? eq(shippingZones.supplierOrgId, sup) : isNull(shippingZones.supplierOrgId), eq(shippingZones.isActive, true), eq(shippingRates.isActive, true)));
  let rows = await load(supplierOrgId);
  const hasOwn = rows.length > 0;
  if (!hasOwn) rows = await load(null);
  const matching = rows.filter(({ z }) => z.nationwide || z.cities.includes(city) || (region && z.regions.includes(region)));
  // most specific zone wins per method: city > region > nationwide
  const spec = (z: typeof shippingZones.$inferSelect) => (z.cities.includes(city) ? 3 : region && z.regions.includes(region) ? 2 : 1);
  const best = new Map<string, (typeof matching)[number]>();
  for (const m of matching) {
    const cur = best.get(m.r.method);
    if (!cur || spec(m.z) > spec(cur.z)) best.set(m.r.method, m);
  }
  return [...best.values()]
    .map(({ r }) => {
      const free = r.freeOver !== null && dec(goodsNet).gte(dec(r.freeOver));
      return { rateId: r.id, method: r.method as ShippingOption["method"], fee: free ? "0.00" : r.fee, vatRate: r.vatRate, etaMinDays: r.etaMinDays, etaMaxDays: r.etaMaxDays, free };
    })
    .sort((a, b) => Number(a.fee) - Number(b.fee));
}

export const zoneSchema = z.object({
  name: z.string().trim().min(2).max(80),
  nationwide: z.boolean().default(false),
  cities: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  rates: z
    .array(
      z.object({
        method: z.enum(["standard", "express", "pickup"]),
        fee: z.preprocess((v) => parseLocaleNumber(v), z.string().regex(/^\d+(\.\d{1,2})?$/)),
        freeOver: z.preprocess((v) => (blank(v) === undefined ? null : parseLocaleNumber(v)), z.string().regex(/^\d+(\.\d{1,2})?$/).nullable()),
        etaMinDays: z.coerce.number().int().min(0).max(60),
        etaMaxDays: z.coerce.number().int().min(0).max(90),
      }),
    )
    .min(1),
});

/** Supplier manages its delivery zones and rates (zones of other suppliers are untouchable by RLS). */
export async function saveShippingZone(ctx: Ctx, id: string | null, input: z.input<typeof zoneSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.fulfil", { write: true });
  const d = zoneSchema.parse(input);
  if (!d.nationwide && !d.cities.length && !d.regions.length) throw validation("Choose cities, regions or nationwide", { key: "zone_empty" });
  for (const r of d.rates) if (r.etaMaxDays < r.etaMinDays) throw validation("Invalid delivery time", { key: "eta_invalid" });
  return withContext(dbCtx(ctx), async (tx) => {
    let zoneId = id;
    if (id) {
      const [z] = await tx.update(shippingZones).set({ name: d.name, nationwide: d.nationwide, cities: d.cities, regions: d.regions, isActive: d.isActive }).where(and(eq(shippingZones.id, id), eq(shippingZones.supplierOrgId, ctx.orgId))).returning();
      if (!z) throw notFound("Zone");
      await tx.delete(shippingRates).where(eq(shippingRates.zoneId, id));
    } else {
      const [z] = await tx.insert(shippingZones).values({ supplierOrgId: ctx.orgId, name: d.name, nationwide: d.nationwide, cities: d.cities, regions: d.regions, isActive: d.isActive }).returning();
      zoneId = z!.id;
    }
    await tx.insert(shippingRates).values(d.rates.map((r) => ({ zoneId: zoneId!, supplierOrgId: ctx.orgId, method: r.method, fee: r.fee, freeOver: r.freeOver, etaMinDays: r.etaMinDays, etaMaxDays: r.etaMaxDays })));
    await audit(ctx, { action: "shipping.zone_saved", entityType: "shipping_zone", entityId: zoneId!, data: { name: d.name, rates: d.rates.length } }, tx);
    return { id: zoneId! };
  });
}

export async function listMyShippingZones(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  return withContext(dbCtx(ctx), async (tx) => {
    const zones = await tx.select().from(shippingZones).where(eq(shippingZones.supplierOrgId, ctx.orgId)).orderBy(asc(shippingZones.name));
    const rates = zones.length ? await tx.select().from(shippingRates).where(inArray(shippingRates.zoneId, zones.map((z) => z.id))) : [];
    return zones.map((z) => ({ ...z, rates: rates.filter((r) => r.zoneId === z.id) }));
  });
}

export async function deleteShippingZone(ctx: Ctx, id: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.fulfil", { write: true });
  await withContext(dbCtx(ctx), async (tx) => {
    const r = await tx.delete(shippingZones).where(and(eq(shippingZones.id, id), eq(shippingZones.supplierOrgId, ctx.orgId))).returning();
    if (!r.length) throw notFound("Zone");
  });
}

// ------------------------------------------------------------------------------------------ cart view (revalidated)

export type LineIssue = "unavailable" | "no_price" | "insufficient_stock" | "below_moq" | "invalid_increment" | "quantity_positive";

export interface CartLine {
  itemId: string;
  productId: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  unit: string;
  quantity: string;
  moq: string;
  orderIncrement: string;
  unitPrice: string | null;
  seenUnitPrice: string | null;
  priceChanged: boolean;
  priceListId: string | null;
  priceKind: string | null;
  vatRate: string;
  net: string;
  vat: string;
  total: string;
  available: string;
  issues: LineIssue[];
}

export interface CartGroup {
  supplierOrgId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  lines: CartLine[];
  goodsNet: string;
  goodsVat: string;
  shippingOptions: ShippingOption[];
}

/** Rebuild the cart with current prices, stock and quantity rules; nothing is trusted from the client. */
export async function buildCart(tx: Tx, ctx: Ctx, s: { userId: string; orgId: string | null }, city?: string | null) {
  const cart = await activeCart(tx, s, false);
  if (!cart) return { cartId: null as string | null, groups: [] as CartGroup[], region: null as string | null };
  const rows = await tx
    .select({ it: cartItems, p: supplierProducts, supAr: organizations.nameAr, supEn: organizations.nameEn })
    .from(cartItems)
    .innerJoin(supplierProducts, eq(supplierProducts.id, cartItems.supplierProductId))
    .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.createdAt));
  // products that disappeared from the viewer's RLS scope (supplier suspended / deactivated)
  const visible = new Set(rows.map((r) => r.it.id));
  const allItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, cart.id));
  const region = city ? ((await tx.select({ r: cities.regionCode }).from(cities).where(eq(cities.code, city)).limit(1))[0]?.r ?? null) : null;
  const prices = await resolvePrices(tx, rows.map((r) => r.p.id), { ...buyerOf(ctx), city: city ?? null, region }, Object.fromEntries(rows.map((r) => [r.p.id, r.it.quantity])));
  const groups = new Map<string, CartGroup>();
  for (const { it, p, supAr, supEn } of rows) {
    const issues: LineIssue[] = [];
    if (!p.isPublished || p.status !== "active") issues.push("unavailable");
    const q = checkOrderQuantity(p, it.quantity);
    if (q) issues.push(q as LineIssue);
    const price = prices.get(p.id) ?? null;
    if (!price) issues.push("no_price");
    const avail = await availableQty(tx, p.id);
    if (avail.lt(dec(it.quantity))) issues.push("insufficient_stock");
    const t = price ? lineTotals({ quantity: it.quantity, unitPrice: price.unitPrice, vatRate: p.vatRate }) : null;
    const line: CartLine = {
      itemId: it.id,
      productId: p.id,
      sku: p.sku,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      unit: p.saleUnit,
      quantity: it.quantity,
      moq: p.moq,
      orderIncrement: p.orderIncrement,
      unitPrice: price ? price.unitPrice.toFixed(4) : null,
      seenUnitPrice: it.seenUnitPrice,
      priceChanged: Boolean(price && it.seenUnitPrice && !price.unitPrice.eq(dec(it.seenUnitPrice))),
      priceListId: price?.priceListId ?? null,
      priceKind: price?.kind ?? null,
      vatRate: p.vatRate,
      net: t ? toDb(t.net) : "0.00",
      vat: t ? toDb(t.vat) : "0.00",
      total: t ? toDb(t.total) : "0.00",
      available: avail.toFixed(4),
      issues,
    };
    const g = groups.get(p.orgId) ?? { supplierOrgId: p.orgId, supplierNameAr: supAr, supplierNameEn: supEn, lines: [], goodsNet: "0.00", goodsVat: "0.00", shippingOptions: [] };
    g.lines.push(line);
    groups.set(p.orgId, g);
  }
  for (const g of groups.values()) {
    g.goodsNet = toDb(g.lines.reduce((a, l) => a.plus(dec(l.net)), dec(0)));
    g.goodsVat = toDb(g.lines.reduce((a, l) => a.plus(dec(l.vat)), dec(0)));
    g.shippingOptions = city ? await shippingOptions(tx, g.supplierOrgId, city, region, g.goodsNet) : [];
  }
  const hidden = allItems.filter((i) => !visible.has(i.id)).length;
  return { cartId: cart.id, groups: [...groups.values()], region, hiddenItems: hidden };
}

export async function getCart(ctx: Ctx, opts: { city?: string | null } = {}) {
  const s = customerScope(ctx);
  return withContext(dbCtx(ctx), (tx) => buildCart(tx, ctx, s, opts.city));
}

// ------------------------------------------------------------------------------------------ checkout

export const checkoutSchema = z.object({
  addressId: z.string().uuid(),
  shipping: z.record(z.string().uuid(), z.enum(["standard", "express", "pickup"])),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  acceptTerms: z.literal(true),
  buyerVatNumber: z.preprocess(blank, z.string().regex(/^3\d{13}3$/).optional().nullable()),
});

const CARD_TTL_MIN = 30;
const BANK_TTL_HOURS = 72;

async function commissionRate(): Promise<string> {
  if (!(await isEnabled("commission.enabled"))) return "0";
  const s = await getSetting<{ ratePct?: number | string }>("commission");
  const r = dec(s.value?.ratePct ?? 0);
  return r.gte(0) && r.lt(100) ? r.toString() : "0";
}

/**
 * Place an order from the cart. Idempotent per (user, key). All lines are revalidated; any issue aborts
 * with the details so the customer can fix the cart. Stock is reserved in the same transaction.
 * Payment starts after commit (provider calls never run inside a DB transaction).
 */
export async function checkout(ctx: Ctx, input: z.input<typeof checkoutSchema>, idempotencyKey: string, locale: "ar" | "en" = "ar") {
  await storeOpen();
  const s = customerScope(ctx);
  const d = checkoutSchema.parse(input);
  const methods = await availableMethods();
  if ((d.paymentMethod === "card" && !methods.card) || (d.paymentMethod === "bank_transfer" && !methods.bankTransfer)) throw new AppError("INTEGRATION_UNAVAILABLE", "Payment method unavailable", { key: "payment_not_configured" });
  const rate = await commissionRate();
  const placed = await withContext(dbCtx(ctx), (tx) =>
    idempotent(`checkout:${s.userId}`, idempotencyKey, { ...d, orgId: s.orgId }, async () => {
      const [addr] = await tx.select().from(addresses).where(and(eq(addresses.id, d.addressId), ownerWhere(s))).limit(1);
      if (!addr) throw notFound("Address");
      const cart = await buildCart(tx, ctx, s, addr.city);
      if (!cart.cartId || !cart.groups.length) throw invalidState("Cart is empty", { key: "cart_empty" });
      const problems = cart.groups.flatMap((g) => g.lines.filter((l) => l.issues.length).map((l) => ({ sku: l.sku, issues: l.issues })));
      if (problems.length || (cart as { hiddenItems?: number }).hiddenItems) throw invalidState("Cart needs attention", { key: "cart_invalid", details: { problems } });
      const [user] = await tx.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, s.userId)).limit(1);
      let buyerName = user?.name ?? null;
      let buyerVat = d.buyerVatNumber ?? null;
      if (s.orgId) {
        const [org] = await tx.select({ nameAr: organizations.nameAr, vat: organizations.vatNumber }).from(organizations).where(eq(organizations.id, s.orgId)).limit(1);
        buyerName = org?.nameAr ?? buyerName;
        buyerVat = buyerVat ?? org?.vat ?? null;
      }
      // compute groups
      const plan = cart.groups.map((g) => {
        const method = d.shipping[g.supplierOrgId];
        const opt = g.shippingOptions.find((o) => o.method === method);
        if (!opt) throw invalidState("Choose a delivery option for every supplier", { key: "shipping_required", details: { supplierOrgId: g.supplierOrgId } });
        const shippingNet = money(opt.fee);
        const shippingVat = money(shippingNet.times(dec(opt.vatRate)));
        const total = dec(g.goodsNet).plus(dec(g.goodsVat)).plus(shippingNet).plus(shippingVat);
        const commissionNet = money(dec(g.goodsNet).times(dec(rate)).div(100));
        const commissionVat = money(commissionNet.times("0.15"));
        return { g, opt, shippingNet, shippingVat, total: money(total), commissionNet, commissionVat, payable: money(total).minus(commissionNet).minus(commissionVat) };
      });
      const goodsNet = plan.reduce((a, p) => a.plus(dec(p.g.goodsNet)), dec(0));
      const shippingNet = plan.reduce((a, p) => a.plus(p.shippingNet), dec(0));
      const vat = plan.reduce((a, p) => a.plus(dec(p.g.goodsVat)).plus(p.shippingVat), dec(0));
      const total = plan.reduce((a, p) => a.plus(p.total), dec(0));
      const address = { recipientName: addr.recipientName, phone: addr.phone, line1: addr.line1, line2: addr.line2, district: addr.district, city: addr.city, region: addr.region, postalCode: addr.postalCode, nationalAddressCode: addr.nationalAddressCode };
      return withContext(SYS, async (sx) => {
        const seq = await sx.execute(sql`select nextval('store_order_seq') as n`);
        const n = Number((seq.rows[0] as { n: string }).n);
        const code = `ORD-${new Date().getUTCFullYear()}-${String(n).padStart(6, "0")}`;
        const expiresAt = new Date(Date.now() + (d.paymentMethod === "card" ? CARD_TTL_MIN * 60_000 : BANK_TTL_HOURS * 3_600_000));
        const [o] = await sx
          .insert(orders)
          .values({ code, userId: s.userId, orgId: s.orgId, paymentMethod: d.paymentMethod, goodsNet: toDb(goodsNet), shippingNet: toDb(shippingNet), vatTotal: toDb(vat), total: toDb(total), shippingAddress: address, buyerName, buyerVatNumber: buyerVat, idempotencyKey, termsVersion: POLICY_VERSIONS.terms, expiresAt })
          .returning();
        for (const [idx, p] of plan.entries()) {
          const [g] = await sx
            .insert(orderGroups)
            .values({
              orderId: o!.id,
              code: `${code}-${idx + 1}`,
              userId: s.userId,
              orgId: s.orgId,
              supplierOrgId: p.g.supplierOrgId,
              shippingMethod: p.opt.method,
              shippingNet: toDb(p.shippingNet),
              shippingVat: toDb(p.shippingVat),
              goodsNet: p.g.goodsNet,
              goodsVat: p.g.goodsVat,
              total: toDb(p.total),
              commissionNet: toDb(p.commissionNet),
              commissionVat: toDb(p.commissionVat),
              supplierPayable: toDb(p.payable),
              deliveryAddress: { ...address, buyerName },
              etaMinDays: p.opt.etaMinDays,
              etaMaxDays: p.opt.etaMaxDays,
            })
            .returning();
          await sx.insert(orderLines).values(
            p.g.lines.map((l) => ({ orderId: o!.id, groupId: g!.id, userId: s.userId, orgId: s.orgId, supplierOrgId: p.g.supplierOrgId, supplierProductId: l.productId, sku: l.sku, nameAr: l.nameAr, nameEn: l.nameEn, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice!, priceListId: l.priceListId, priceKind: l.priceKind, vatRate: l.vatRate, lineNet: l.net, lineVat: l.vat, lineTotal: l.total })),
          );
          const base = { orderId: o!.id, groupId: g!.id, userId: s.userId, orgId: s.orgId, supplierOrgId: p.g.supplierOrgId };
          await sx.insert(orderCharges).values(
            (
              [
                ["goods", p.g.goodsNet],
                ["goods_vat", p.g.goodsVat],
                ["shipping", toDb(p.shippingNet)],
                ["shipping_vat", toDb(p.shippingVat)],
                ["commission", toDb(p.commissionNet)],
                ["commission_vat", toDb(p.commissionVat)],
                ["supplier_payable", toDb(p.payable)],
              ] as const
            ).map(([kind, amount]) => ({ ...base, kind, amount })),
          );
          for (const l of p.g.lines) {
            const ok = await reserveStock(sx, l.productId, l.quantity, `order:${o!.id}`);
            if (!ok) throw invalidState("Insufficient stock", { key: "insufficient_stock", details: { sku: l.sku } });
          }
        }
        await sx.insert(orderEvents).values({ orderId: o!.id, userId: s.userId, orgId: s.orgId, kind: "created", actorUserId: s.userId, data: { paymentMethod: d.paymentMethod } });
        await sx.update(carts).set({ status: "converted" }).where(eq(carts.id, cart.cartId!));
        await emit({ topic: "store.order_created", aggregateType: "order", aggregateId: o!.id, orgId: s.orgId, payload: { orderId: o!.id }, dedupeKey: `order-created:${o!.id}` }, sx);
        await audit(ctx, { action: "order.created", entityType: "order", entityId: o!.id, orgId: s.orgId, data: { code, total: toDb(total), groups: plan.length } }, sx);
        return { orderId: o!.id, code };
      });
    }),
  );
  await recordConsent(s.userId, "terms", true, POLICY_VERSIONS.terms).catch(() => undefined);
  try {
    const pay = await startPayment(placed.orderId, locale);
    return { ...placed, redirectUrl: pay.redirectUrl, instructions: pay.instructions, paymentError: null as string | null };
  } catch (e) {
    // the order exists and stays payable until it expires; the customer can retry from the order page
    return { ...placed, redirectUrl: null, instructions: null, paymentError: e instanceof AppError ? e.messageKey : "payment_provider" };
  }
}

// ------------------------------------------------------------------------------------------ customer orders

export async function listMyOrders(ctx: Ctx, opts: { page?: number } = {}) {
  const s = customerScope(ctx);
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = s.orgId ? eq(orders.orgId, s.orgId) : and(eq(orders.userId, s.userId), isNull(orders.orgId));
    const items = await tx
      .select({ o: orders, groups: sql<number>`(select count(*)::int from order_groups g where g.order_id = ${orders.id})` })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getMyOrder(ctx: Ctx, orderId: string) {
  const s = customerScope(ctx);
  if (s.orgId) authorize(ctx, "store.orders.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o) throw notFound("Order");
    const groups = await tx
      .select({ g: orderGroups, supAr: organizations.nameAr, supEn: organizations.nameEn })
      .from(orderGroups)
      .innerJoin(organizations, eq(organizations.id, orderGroups.supplierOrgId))
      .where(eq(orderGroups.orderId, o.id))
      .orderBy(asc(orderGroups.code));
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id));
    const events = await tx.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(desc(orderEvents.createdAt));
    const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, o.id)).orderBy(desc(paymentIntents.createdAt)).limit(1);
    const invs = await tx.select().from(invoices).where(eq(invoices.orderId, o.id)).orderBy(asc(invoices.issuedAt));
    const rets = await tx.select().from(returnRequests).where(eq(returnRequests.orderId, o.id)).orderBy(desc(returnRequests.createdAt));
    const refs = await tx.select().from(refunds).where(eq(refunds.orderId, o.id)).orderBy(desc(refunds.createdAt));
    const window = await returnWindowDays();
    return {
      order: o,
      groups: groups.map(({ g, supAr, supEn }) => ({
        ...g,
        supplierNameAr: supAr,
        supplierNameEn: supEn,
        lines: lines.filter((l) => l.groupId === g.id),
        canCancel: o.paymentStatus === "paid" && g.status === "confirmed",
        canReturn: g.status === "delivered" && Boolean(g.deliveredAt && g.deliveredAt.getTime() + window * 86_400_000 > Date.now()) && !rets.some((r) => r.groupId === g.id && ["requested", "approved"].includes(r.status)),
      })),
      events,
      intent: intent ? { id: intent.id, status: intent.status, provider: intent.provider, redirectUrl: intent.redirectUrl, instructions: intent.instructions, failureReason: intent.failureReason } : null,
      invoices: invs,
      returns: rets,
      refunds: refs,
      canPay: ["pending_payment", "payment_failed"].includes(o.status) && o.paymentStatus !== "paid" && Boolean(o.expiresAt && o.expiresAt.getTime() > Date.now()),
    };
  });
}

async function returnWindowDays(): Promise<number> {
  const s = await getSetting<{ returnWindowDays?: number }>("store.policies");
  const n = Number(s.value?.returnWindowDays ?? 7);
  return Number.isFinite(n) && n >= 0 && n <= 90 ? n : 7;
}

function deriveOrderStatus(groups: { status: string }[], current: string): string {
  if (!groups.length) return current;
  if (groups.every((g) => g.status === "cancelled")) return "cancelled";
  if (groups.every((g) => g.status === "completed" || g.status === "cancelled")) return "completed";
  if (groups.some((g) => ["preparing", "shipped", "delivered", "completed"].includes(g.status))) return "in_progress";
  return current === "pending_payment" || current === "payment_failed" ? current : "placed";
}

async function refreshOrderStatus(tx: Tx, orderId: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o) return;
  const gs = await tx.select({ status: orderGroups.status }).from(orderGroups).where(eq(orderGroups.orderId, orderId));
  const next = deriveOrderStatus(gs, o.status);
  if (next !== o.status) await tx.update(orders).set({ status: next, ...(next === "cancelled" ? { cancelledAt: new Date() } : {}) }).where(eq(orders.id, orderId));
}

async function releaseGroupStock(tx: Tx, g: typeof orderGroups.$inferSelect) {
  const lines = await tx.select({ productId: orderLines.supplierProductId }).from(orderLines).where(eq(orderLines.groupId, g.id));
  for (const l of lines) await settleReservation(tx, l.productId, `order:${g.orderId}`, "release");
}

/** Customer cancels an unpaid order, or a paid supplier group that has not started preparation (refund). */
export async function cancelByCustomer(ctx: Ctx, orderId: string, groupId: string | null, reason: string) {
  const s = customerScope(ctx);
  const why = z.string().trim().min(3).max(500).parse(reason);
  let refund: { groupId: string; amount: string } | null = null;
  await withContext(dbCtx(ctx), async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!o || (s.orgId ? o.orgId !== s.orgId : o.userId !== s.userId)) throw notFound("Order");
    await withContext(SYS, async (sx) => {
      if (o.paymentStatus !== "paid") {
        if (!["pending_payment", "payment_failed"].includes(o.status)) throw invalidState("Order cannot be cancelled", { key: "order_not_cancellable" });
        await sx.update(orders).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: why }).where(eq(orders.id, o.id));
        const gs = await sx.update(orderGroups).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "customer", cancelReason: why }).where(eq(orderGroups.orderId, o.id)).returning();
        for (const g of gs) await releaseGroupStock(sx, g);
        await sx.update(paymentIntents).set({ status: "cancelled" }).where(and(eq(paymentIntents.orderId, o.id), inArray(paymentIntents.status, ["created", "pending"])));
        await sx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "cancelled", actorUserId: ctx.userId, data: { reason: why } });
        return;
      }
      if (!groupId) throw validation("Choose the supplier shipment to cancel", { key: "group_required" });
      const [g] = await sx.select().from(orderGroups).where(and(eq(orderGroups.id, groupId), eq(orderGroups.orderId, o.id))).limit(1).for("update");
      if (!g) throw notFound("Order group");
      if (g.status !== "confirmed") throw invalidState("This shipment can no longer be cancelled", { key: "group_not_cancellable" });
      await sx.update(orderGroups).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "customer", cancelReason: why }).where(eq(orderGroups.id, g.id));
      await releaseGroupStock(sx, g);
      await sx.insert(orderEvents).values({ orderId: o.id, groupId: g.id, userId: o.userId, orgId: o.orgId, supplierOrgId: g.supplierOrgId, kind: "cancelled", actorUserId: ctx.userId, data: { reason: why, by: "customer" } });
      await refreshOrderStatus(sx, o.id);
      refund = { groupId: g.id, amount: toDb(dec(g.total).minus(dec(g.refundedTotal))) };
    });
  });
  if (refund) {
    const r = refund as { groupId: string; amount: string };
    if (dec(r.amount).gt(0)) await refundPayment({ orderId, groupId: r.groupId, amount: r.amount, reason: "cancellation", idempotencyKey: `cancel:${r.groupId}`, actorUserId: ctx.userId });
  }
}

// ------------------------------------------------------------------------------------------ supplier side

export async function listSupplierOrders(ctx: Ctx, opts: { status?: string; page?: number } = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(eq(orderGroups.supplierOrgId, ctx.orgId), ne(orderGroups.status, "awaiting_payment"), opts.status ? eq(orderGroups.status, opts.status) : undefined);
    const items = await tx.select().from(orderGroups).where(where).orderBy(desc(orderGroups.createdAt)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(orderGroups).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getSupplierOrder(ctx: Ctx, groupId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [g] = await tx.select().from(orderGroups).where(and(eq(orderGroups.id, groupId), eq(orderGroups.supplierOrgId, ctx.orgId))).limit(1);
    if (!g || g.status === "awaiting_payment") throw notFound("Order");
    const lines = await tx.select().from(orderLines).where(eq(orderLines.groupId, g.id));
    const charges = await tx.select().from(orderCharges).where(eq(orderCharges.groupId, g.id));
    const events = await tx.select().from(orderEvents).where(eq(orderEvents.groupId, g.id)).orderBy(desc(orderEvents.createdAt));
    const rets = await tx.select().from(returnRequests).where(eq(returnRequests.groupId, g.id)).orderBy(desc(returnRequests.createdAt));
    const invs = await tx.select().from(invoices).where(eq(invoices.groupId, g.id));
    return { group: g, lines, charges, events, returns: rets, invoices: invs };
  });
}

const groupFlow: Record<string, string[]> = { confirmed: ["preparing", "cancelled"], preparing: ["shipped", "cancelled"], shipped: ["delivered"], delivered: ["completed"] };

export const shipSchema = z.object({ carrier: z.string().trim().min(2).max(80), trackingNumber: z.preprocess(blank, z.string().trim().max(80).optional().nullable()) });

/** Supplier advances its group: prepare → ship (consumes reservation) → deliver. */
export async function advanceGroup(ctx: Ctx, groupId: string, action: "prepare" | "ship" | "deliver", extra: Partial<z.input<typeof shipSchema>> = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.fulfil", { write: true });
  const to = action === "prepare" ? "preparing" : action === "ship" ? "shipped" : "delivered";
  const ship = action === "ship" ? shipSchema.parse(extra) : null;
  await withContext(dbCtx(ctx), async (tx) => {
    const [g0] = await tx.select().from(orderGroups).where(and(eq(orderGroups.id, groupId), eq(orderGroups.supplierOrgId, ctx.orgId))).limit(1);
    if (!g0 || g0.status === "awaiting_payment") throw notFound("Order");
    await withContext(SYS, async (sx) => {
      const [g] = await sx.select().from(orderGroups).where(eq(orderGroups.id, groupId)).limit(1).for("update");
      if (!g || !(groupFlow[g.status] ?? []).includes(to)) throw invalidState(`Cannot move from ${g?.status} to ${to}`, { key: "invalid_transition" });
      const now = new Date();
      await sx
        .update(orderGroups)
        .set({ status: to, ...(to === "shipped" ? { shippedAt: now, carrier: ship!.carrier, trackingNumber: ship!.trackingNumber ?? null } : {}), ...(to === "delivered" ? { deliveredAt: now } : {}) })
        .where(eq(orderGroups.id, g.id));
      if (to === "shipped") {
        const lines = await sx.select({ productId: orderLines.supplierProductId }).from(orderLines).where(eq(orderLines.groupId, g.id));
        for (const l of lines) await settleReservation(sx, l.productId, `order:${g.orderId}`, "fulfil");
      }
      await sx.insert(orderEvents).values({ orderId: g.orderId, groupId: g.id, userId: g.userId, orgId: g.orgId, supplierOrgId: g.supplierOrgId, kind: to, actorUserId: ctx.userId, data: ship ? { carrier: ship.carrier, trackingNumber: ship.trackingNumber ?? null } : {} });
      await refreshOrderStatus(sx, g.orderId);
      const [o] = await sx.select({ code: orders.code }).from(orders).where(eq(orders.id, g.orderId)).limit(1);
      const [sup] = await sx.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, g.supplierOrgId)).limit(1);
      await notifyUsers({ userIds: [g.userId], kind: "order.status_changed", params: { orderNumber: o?.code ?? g.code, supplierName: sup?.nameAr ?? "", status: to }, link: `/account/orders/${g.orderId}`, dedupeKey: `group:${g.id}:${to}`, email: true }, sx);
      await audit(ctx, { action: `order_group.${to}`, entityType: "order_group", entityId: g.id, data: ship ?? {} }, sx);
    });
  });
}

/** Supplier cancels before shipping (e.g. stock discrepancy) — the customer is refunded in full. */
export async function cancelBySupplier(ctx: Ctx, groupId: string, reason: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.fulfil", { write: true });
  const why = z.string().trim().min(3).max(500).parse(reason);
  let refund: { orderId: string; amount: string } | null = null;
  await withContext(dbCtx(ctx), async (tx) => {
    const [g0] = await tx.select().from(orderGroups).where(and(eq(orderGroups.id, groupId), eq(orderGroups.supplierOrgId, ctx.orgId))).limit(1);
    if (!g0 || g0.status === "awaiting_payment") throw notFound("Order");
    await withContext(SYS, async (sx) => {
      const [g] = await sx.select().from(orderGroups).where(eq(orderGroups.id, groupId)).limit(1).for("update");
      if (!g || !["confirmed", "preparing"].includes(g.status)) throw invalidState("Cannot cancel after shipping", { key: "group_not_cancellable" });
      await sx.update(orderGroups).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "supplier", cancelReason: why }).where(eq(orderGroups.id, g.id));
      await releaseGroupStock(sx, g);
      await sx.insert(orderEvents).values({ orderId: g.orderId, groupId: g.id, userId: g.userId, orgId: g.orgId, supplierOrgId: g.supplierOrgId, kind: "cancelled", actorUserId: ctx.userId, data: { reason: why, by: "supplier" } });
      await refreshOrderStatus(sx, g.orderId);
      await audit(ctx, { action: "order_group.cancelled", entityType: "order_group", entityId: g.id, data: { reason: why } }, sx);
      refund = { orderId: g.orderId, amount: toDb(dec(g.total).minus(dec(g.refundedTotal))) };
    });
  });
  if (refund) {
    const r = refund as { orderId: string; amount: string };
    if (dec(r.amount).gt(0)) await refundPayment({ orderId: r.orderId, groupId, amount: r.amount, reason: "cancellation", idempotencyKey: `cancel:${groupId}`, actorUserId: ctx.userId });
  }
}

// ------------------------------------------------------------------------------------------ returns

export const returnSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
  lines: z.array(z.object({ orderLineId: z.string().uuid(), quantity: qtyStr })).min(1),
});

export async function requestReturn(ctx: Ctx, groupId: string, input: z.input<typeof returnSchema>) {
  const s = customerScope(ctx);
  const d = returnSchema.parse(input);
  const window = await returnWindowDays();
  return withContext(dbCtx(ctx), async (tx) => {
    const [g] = await tx.select().from(orderGroups).where(eq(orderGroups.id, groupId)).limit(1);
    if (!g || (s.orgId ? g.orgId !== s.orgId : g.userId !== s.userId)) throw notFound("Order");
    if (g.status !== "delivered" || !g.deliveredAt || g.deliveredAt.getTime() + window * 86_400_000 < Date.now()) throw invalidState("Return window closed", { key: "return_window_closed" });
    const lines = await tx.select().from(orderLines).where(eq(orderLines.groupId, g.id));
    let amount = dec(0);
    const clean: { orderLineId: string; quantity: string }[] = [];
    for (const r of d.lines) {
      if (dec(r.quantity).isZero()) continue;
      const l = lines.find((x) => x.id === r.orderLineId);
      if (!l) throw notFound("Order line");
      if (dec(r.quantity).gt(dec(l.quantity).minus(dec(l.returnedQty)))) throw validation("Return quantity exceeds what was delivered", { key: "return_qty_exceeds" });
      amount = amount.plus(money(dec(l.lineTotal).times(dec(r.quantity)).div(dec(l.quantity))));
      clean.push({ orderLineId: l.id, quantity: dec(r.quantity).toFixed(4) });
    }
    if (!clean.length) throw validation("Choose at least one item", { key: "return_empty" });
    return withContext(SYS, async (sx) => {
      const [open] = await sx.select({ id: returnRequests.id }).from(returnRequests).where(and(eq(returnRequests.groupId, g.id), inArray(returnRequests.status, ["requested", "approved"]))).limit(1);
      if (open) throw invalidState("A return is already open for this shipment", { key: "return_open" });
      const n = ((await sx.execute(sql`select count(*)::int as n from return_requests where group_id = ${g.id}`)).rows[0] as { n: number } | undefined)?.n ?? 0;
      const [r] = await sx
        .insert(returnRequests)
        .values({ code: `${g.code}-R${n + 1}`, orderId: g.orderId, groupId: g.id, userId: g.userId, orgId: g.orgId, supplierOrgId: g.supplierOrgId, reason: d.reason, lines: clean, amount: toDb(amount) })
        .returning();
      await sx.insert(orderEvents).values({ orderId: g.orderId, groupId: g.id, userId: g.userId, orgId: g.orgId, supplierOrgId: g.supplierOrgId, kind: "return_requested", actorUserId: ctx.userId, data: { returnId: r!.id, amount: r!.amount } });
      return r!;
    });
  });
}

/** Supplier decision on a return; refund happens when the goods are received back. */
export async function decideReturn(ctx: Ctx, returnId: string, decision: "approve" | "reject" | "receive", note?: string | null) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.fulfil", { write: true });
  let refundFor: typeof returnRequests.$inferSelect | null = null;
  await withContext(dbCtx(ctx), async (tx) => {
    const [r0] = await tx.select().from(returnRequests).where(and(eq(returnRequests.id, returnId), eq(returnRequests.supplierOrgId, ctx.orgId))).limit(1);
    if (!r0) throw notFound("Return");
    await withContext(SYS, async (sx) => {
      const [r] = await sx.select().from(returnRequests).where(eq(returnRequests.id, returnId)).limit(1).for("update");
      const next = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "received";
      const allowed = decision === "receive" ? r!.status === "approved" : r!.status === "requested";
      if (!allowed) throw invalidState("Invalid return transition", { key: "invalid_transition" });
      if (decision === "reject" && (!note || note.trim().length < 3)) throw validation("A reason is required", { key: "note_required" });
      await sx.update(returnRequests).set({ status: next, decisionNote: note?.trim() || r!.decisionNote }).where(eq(returnRequests.id, r!.id));
      if (decision === "receive") {
        for (const l of r!.lines) await sx.update(orderLines).set({ returnedQty: sql`${orderLines.returnedQty} + ${l.quantity}::numeric` }).where(eq(orderLines.id, l.orderLineId));
        refundFor = r!;
      }
      await sx.insert(orderEvents).values({ orderId: r!.orderId, groupId: r!.groupId, userId: r!.userId, orgId: r!.orgId, supplierOrgId: r!.supplierOrgId, kind: `return_${next}`, actorUserId: ctx.userId, data: { returnId: r!.id, note: note ?? null } });
      const [o] = await sx.select({ code: orders.code }).from(orders).where(eq(orders.id, r!.orderId)).limit(1);
      await notifyUsers({ userIds: [r!.userId], kind: "return.status_changed", params: { orderNumber: o?.code ?? "", status: next }, link: `/account/orders/${r!.orderId}`, dedupeKey: `return:${r!.id}:${next}`, email: true }, sx);
      await audit(ctx, { action: `return.${next}`, entityType: "return_request", entityId: r!.id, data: { note: note ?? null } }, sx);
    });
  });
  if (refundFor) {
    const r = refundFor as typeof returnRequests.$inferSelect;
    const res = await refundPayment({ orderId: r.orderId, groupId: r.groupId, amount: r.amount, reason: "return", idempotencyKey: `return:${r.id}`, actorUserId: ctx.userId });
    await withSystem((tx) => tx.update(returnRequests).set({ refundId: res.refundId, status: res.status === "succeeded" ? "refunded" : "received" }).where(eq(returnRequests.id, r.id)));
  }
}

export async function listSupplierReturns(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.view");
  return withContext(dbCtx(ctx), (tx) => tx.select().from(returnRequests).where(eq(returnRequests.supplierOrgId, ctx.orgId)).orderBy(desc(returnRequests.createdAt)).limit(200));
}

/** Job: delivered groups past the return window with no open return become completed. */
export async function completeDeliveredGroups(): Promise<number> {
  const window = await returnWindowDays();
  const cutoff = new Date(Date.now() - window * 86_400_000);
  const due = await withSystem((tx) =>
    tx
      .select({ id: orderGroups.id, orderId: orderGroups.orderId })
      .from(orderGroups)
      .where(and(eq(orderGroups.status, "delivered"), lt(orderGroups.deliveredAt, cutoff), sql`not exists (select 1 from return_requests r where r.group_id = ${orderGroups.id} and r.status in ('requested','approved'))`))
      .limit(500),
  );
  for (const g of due) {
    await withSystem(async (tx) => {
      await tx.update(orderGroups).set({ status: "completed", completedAt: new Date() }).where(and(eq(orderGroups.id, g.id), eq(orderGroups.status, "delivered")));
      await refreshOrderStatus(tx, g.orderId);
    });
  }
  return due.length;
}

export { deriveOrderStatus };
