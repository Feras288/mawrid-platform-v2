import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { inventoryLevels, paymentIntents } from "@platform/db/schema";
import { TestPaymentProvider } from "@platform/integrations/payments";
import { saveAddress, saveShippingZone } from "../src/commerce";
import { processWebhook, providerFor } from "../src/payments";
import { createProduct, setProductPrices, setPublished, setStock, upsertPriceList } from "../src/supplier-products";
import { upsertWarehouse } from "../src/suppliers";
import { approvedSupplier, categoryBySlug, createUser, ctxFor } from "./helpers";

export type Sup = Awaited<ReturnType<typeof approvedSupplier>>;

export async function product(s: Sup, opts: { sku: string; retail: string; enterprise?: string; stock: string; moq?: string; increment?: string }) {
  const pipes = await categoryBySlug("pipes");
  const lists = await withSystem((tx) => tx.execute(sql`select id, kind from price_lists where org_id = ${s.org.id}`));
  const byKind = new Map((lists.rows as { id: string; kind: string }[]).map((r) => [r.kind, r.id]));
  const retail = byKind.get("retail") ?? (await upsertPriceList(s.ctx, null, { name: "Retail", kind: "retail" })).id;
  const ent = byKind.get("enterprise") ?? (await upsertPriceList(s.ctx, null, { name: "Enterprise", kind: "enterprise" })).id;
  const whs = await withSystem((tx) => tx.execute(sql`select id from warehouses where org_id = ${s.org.id} limit 1`));
  const wh = (whs.rows[0] as { id: string } | undefined)?.id ?? (await upsertWarehouse(s.ctx, null, { name: "Main", city: "riyadh", region: "RD" })).id;
  const p = await createProduct(s.ctx, { sku: opts.sku, categoryId: pipes.id, nameAr: `منتج ${opts.sku}`, nameEn: `Product ${opts.sku}`, saleUnit: "pc", attributes: { material: "upvc", diameter_mm: 110 }, status: "active", moq: opts.moq ?? "1", orderIncrement: opts.increment ?? "1", brandName: "StoreBrand" });
  await setProductPrices(s.ctx, { priceListId: retail, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: opts.retail }] });
  if (opts.enterprise) await setProductPrices(s.ctx, { priceListId: ent, supplierProductId: p.id, tiers: [{ minQty: "1", unitPrice: opts.enterprise }] });
  await setStock(s.ctx, { warehouseId: wh, supplierProductId: p.id, onHand: opts.stock });
  await setPublished(s.ctx, p.id, true);
  return p;
}

export async function zone(s: Sup, fee: string, freeOver: string | null = null) {
  await saveShippingZone(s.ctx, null, { name: "KSA", nationwide: true, rates: [{ method: "standard", fee, freeOver, etaMinDays: 1, etaMaxDays: 4 }] });
}

export async function customer() {
  const u = await createUser();
  const ctx = await ctxFor(u.id, null);
  const addr = await saveAddress(ctx, null, { recipientName: "عميل الاختبار", phone: "+966500000000", line1: "شارع الملك فهد", city: "riyadh", isDefault: true });
  return { user: u, ctx, addr };
}

export async function webhook(ref: string, eventId = `evt_${randomToken(8)}`) {
  const p = (await providerFor("test")) as TestPaymentProvider;
  const body = JSON.stringify({ id: eventId, type: "payment.updated", ref });
  return processWebhook("test", body, new Headers({ "x-test-signature": p.sign(body) }));
}

export async function intentOf(orderId: string) {
  const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, orderId)).orderBy(sql`created_at desc`).limit(1));
  return i!;
}

export async function onHand(productId: string) {
  const [r] = await withSystem((tx) => tx.select({ onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved }).from(inventoryLevels).where(eq(inventoryLevels.supplierProductId, productId)));
  return r!;
}

