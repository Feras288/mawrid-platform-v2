import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { inventoryLevels, invoices, ledgerEntries, orders, paymentIntents, paymentWebhookEvents } from "@platform/db/schema";
import { TestPaymentProvider } from "@platform/integrations/payments";
import { decodeTlv } from "@platform/integrations/zatca";
import {
  addToCart,
  advanceGroup,
  cancelByCustomer,
  cancelBySupplier,
  checkout,
  decideReturn,
  getCart,
  getMyOrder,
  getSupplierOrder,
  listSupplierOrders,
  requestReturn,
  saveAddress,
  saveShippingZone,
  toggleWishlist,
  listWishlist,
  updateCartItem,
} from "../src/commerce";
import { setFlag } from "../src/config";
import { applyProviderStatus, expireUnpaidOrders, ledgerSummary, processWebhook, providerFor, retryPayment, supplierBalance, syncOrderPayment } from "../src/payments";
import { getStoreProduct, searchProducts } from "../src/store";
import { createProduct, setProductPrices, setPublished, setStock, upsertPriceList } from "../src/supplier-products";
import { upsertWarehouse } from "../src/suppliers";
import { publicCtx } from "../src/context";
import { adminCtx, approvedSupplier, categoryBySlug, createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";

type Sup = Awaited<ReturnType<typeof approvedSupplier>>;

async function product(s: Sup, opts: { sku: string; retail: string; enterprise?: string; stock: string; moq?: string; increment?: string }) {
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

async function zone(s: Sup, fee: string, freeOver: string | null = null) {
  await saveShippingZone(s.ctx, null, { name: "KSA", nationwide: true, rates: [{ method: "standard", fee, freeOver, etaMinDays: 1, etaMaxDays: 4 }] });
}

async function customer() {
  const u = await createUser();
  const ctx = await ctxFor(u.id, null);
  const addr = await saveAddress(ctx, null, { recipientName: "عميل الاختبار", phone: "+966500000000", line1: "شارع الملك فهد", city: "riyadh", isDefault: true });
  return { user: u, ctx, addr };
}

async function webhook(ref: string, eventId = `evt_${randomToken(8)}`) {
  const p = (await providerFor("test")) as TestPaymentProvider;
  const body = JSON.stringify({ id: eventId, type: "payment.updated", ref });
  return processWebhook("test", body, new Headers({ "x-test-signature": p.sign(body) }));
}

async function intentOf(orderId: string) {
  const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, orderId)).orderBy(sql`created_at desc`).limit(1));
  return i!;
}

async function onHand(productId: string) {
  const [r] = await withSystem((tx) => tx.select({ onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved }).from(inventoryLevels).where(eq(inventoryLevels.supplierProductId, productId)));
  return r!;
}

describe("store: catalog, cart, checkout, payments, fulfilment, returns", () => {
  it("runs a multi-vendor purchase end-to-end with separated charges, ledger, invoices and isolation", async () => {
    const supA = await approvedSupplier();
    const supB = await approvedSupplier();
    const pa = await product(supA, { sku: `A-${randomToken(4)}`, retail: "100.00", enterprise: "90.00", stock: "50", moq: "2", increment: "2" });
    const pb = await product(supB, { sku: `B-${randomToken(4)}`, retail: "40.00", stock: "10" });
    await zone(supA, "25.00");
    await zone(supB, "15.00", "100.00");

    // public search sees both; product page resolves retail for anonymous
    const found = await searchProducts(publicCtx("ar"), { q: "Product", pageSize: 100 });
    expect(found.items.map((i) => i.id)).toEqual(expect.arrayContaining([pa.id, pb.id]));
    const c = await customer();
    const page = await getStoreProduct(c.ctx, pa.id);
    expect(page!.card.price!.kind).toBe("retail");
    expect(page!.card.price!.unitPrice.toFixed(2)).toBe("100.00");

    // buyer orgs get enterprise prices
    const buyer = await setupOrg("buyer");
    const bp = await getStoreProduct(buyer.ctx, pa.id);
    expect(bp!.card.price!.kind).toBe("enterprise");

    // wishlist
    expect(await toggleWishlist(c.ctx, pa.id)).toBe(true);
    expect((await listWishlist(c.ctx)).map((w) => w.p.id)).toEqual([pa.id]);

    // quantity rules and stock
    await expect(addToCart(c.ctx, pa.id, "1")).rejects.toMatchObject({ messageKey: "below_moq" });
    await expect(addToCart(c.ctx, pa.id, "3")).rejects.toMatchObject({ messageKey: "invalid_increment" });
    await expect(addToCart(c.ctx, pb.id, "11")).rejects.toMatchObject({ messageKey: "insufficient_stock" });
    await addToCart(c.ctx, pa.id, "4");
    await addToCart(c.ctx, pb.id, "3");
    const cart = await getCart(c.ctx, { city: "riyadh" });
    expect(cart.groups).toHaveLength(2);
    const gA = cart.groups.find((g) => g.supplierOrgId === supA.org.id)!;
    const gB = cart.groups.find((g) => g.supplierOrgId === supB.org.id)!;
    expect(gA.goodsNet).toBe("400.00");
    expect(gA.goodsVat).toBe("60.00");
    expect(gA.shippingOptions[0]!.fee).toBe("25.00");
    expect(gB.goodsNet).toBe("120.00");
    expect(gB.shippingOptions[0]!.free).toBe(true); // free over 100

    // a supplier cannot buy as its own org
    await expect(addToCart(supA.ctx, pb.id, "1")).rejects.toMatchObject({ messageKey: "store_wrong_context" });

    // idempotent checkout
    const key = `chk-${randomToken(12)}`;
    const input = { addressId: c.addr.id, shipping: { [supA.org.id]: "standard", [supB.org.id]: "standard" } as Record<string, "standard">, paymentMethod: "card" as const, acceptTerms: true as const };
    const r1 = await checkout(c.ctx, input, key, "ar");
    const r2 = await checkout(c.ctx, input, key, "ar");
    expect(r2.orderId).toBe(r1.orderId);
    expect(r1.redirectUrl).toContain(`/checkout/pay/`);
    const [o] = await withSystem((tx) => tx.select().from(orders).where(eq(orders.id, r1.orderId)));
    // A: 400 + 60 VAT + 25 + 3.75 = 488.75 ; B: 120 + 18 = 138.00 (free shipping)
    expect(o!.total).toBe("626.75");
    expect(o!.status).toBe("pending_payment");
    expect((await onHand(pa.id)).reserved).toBe("4.0000");
    // cart was converted; a new cart starts empty
    expect((await getCart(c.ctx)).groups).toHaveLength(0);

    // suppliers cannot see unpaid groups
    expect((await listSupplierOrders(supA.ctx)).items.find((g) => g.orderId === o!.id)).toBeUndefined();

    // invalid signature is rejected and recorded
    const bad = await processWebhook("test", JSON.stringify({ id: "evt_bad", type: "x", ref: "nope" }), new Headers({ "x-test-signature": "forged" }));
    expect(bad.status).toBe(401);

    // amount mismatch never marks the order paid
    const intent = await intentOf(o!.id);
    TestPaymentProvider.settle(intent.providerRef!, "succeeded", 100);
    expect((await webhook(intent.providerRef!)).result).toBe("amount_mismatch");
    expect((await withSystem((tx) => tx.select().from(orders).where(eq(orders.id, o!.id))))[0]!.paymentStatus).not.toBe("paid");

    // retry → provider confirms the right amount → webhook (re-fetched) marks it paid; duplicates are ignored
    await retryPayment(c.ctx, o!.id);
    const intent2 = await intentOf(o!.id);
    TestPaymentProvider.settle(intent2.providerRef!, "succeeded", 62675);
    const evId = `evt_${randomToken(8)}`;
    expect((await webhook(intent2.providerRef!, evId)).result).toBe("succeeded");
    expect((await webhook(intent2.providerRef!, evId)).result).toBe("duplicate");
    expect(await syncOrderPayment(c.ctx, o!.id)).toBe("succeeded");
    const order = await getMyOrder(c.ctx, o!.id);
    expect(order.order.paymentStatus).toBe("paid");
    expect(order.order.status).toBe("placed");
    expect(order.groups.every((g) => g.status === "confirmed")).toBe(true);

    // ledger: one journal per group, balanced; supplier balances equal group totals (commission off)
    const ledger = await withSystem((tx) => tx.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, o!.id)));
    const dr = ledger.reduce((a, l) => a + Number(l.debit), 0);
    const cr = ledger.reduce((a, l) => a + Number(l.credit), 0);
    expect(dr.toFixed(2)).toBe(cr.toFixed(2));
    expect((await supplierBalance(supA.ctx)).payable).toBe("488.75");
    expect((await supplierBalance(supA.ctx)).payoutsEnabled).toBe(false);
    const sum = await ledgerSummary(await adminCtx());
    expect(sum.balanced).toBe(true);

    // one tax invoice per supplier group with a decodable ZATCA QR
    const invs = await withSystem((tx) => tx.select().from(invoices).where(eq(invoices.orderId, o!.id)));
    expect(invs).toHaveLength(2);
    const invA = invs.find((i) => i.supplierOrgId === supA.org.id)!;
    expect(invA.kind).toBe("simplified");
    const tlv = decodeTlv(invA.qrTlv);
    expect(tlv[2]).toBe("300000000000003");
    expect(tlv[4]).toBe("488.75");
    expect(tlv[5]).toBe("63.75");

    // isolation: supplier B sees only its group; no commission rows visible to the customer
    const bGroups = (await listSupplierOrders(supB.ctx)).items.filter((g) => g.orderId === o!.id);
    expect(bGroups).toHaveLength(1);
    const groupA = order.groups.find((g) => g.supplierOrgId === supA.org.id)!;
    await expect(getSupplierOrder(supB.ctx, groupA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rawB = await rawAsApp({ userId: supB.user.id, orgId: supB.org.id }, "select count(*)::int as n from order_lines where group_id = $1", [groupA.id]);
    expect(rawB[0]!.n).toBe(0);
    const rawOrderB = await rawAsApp({ userId: supB.user.id, orgId: supB.org.id }, "select count(*)::int as n from orders where id = $1", [o!.id]);
    expect(rawOrderB[0]!.n).toBe(0);
    const custCharges = await rawAsApp({ userId: c.user.id, orgId: null }, "select kind from order_charges where order_id = $1", [o!.id]);
    expect(custCharges.map((r) => r.kind)).not.toContain("supplier_payable");
    const other = await customer();
    await expect(getMyOrder(other.ctx, o!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ledgerRaw = await rawAsApp({ userId: supA.user.id, orgId: supA.org.id }, "select count(*)::int as n from ledger_entries", []);
    expect(ledgerRaw[0]!.n).toBe(0);
    await rawAsApp({ userId: c.user.id, orgId: null }, "update orders set total = 1 where id = $1", [o!.id]); // RLS: 0 rows updated
    expect((await withSystem((tx) => tx.select().from(orders).where(eq(orders.id, o!.id))))[0]!.total).toBe("626.75");

    // customer cancels supplier B's group before preparation → full refund, stock released
    const groupB = order.groups.find((g) => g.supplierOrgId === supB.org.id)!;
    const reservedBefore = (await onHand(pb.id)).reserved;
    expect(reservedBefore).toBe("3.0000");
    await cancelByCustomer(c.ctx, o!.id, groupB.id, "changed my mind");
    expect((await onHand(pb.id)).reserved).toBe("0.0000");
    const afterCancel = await getMyOrder(c.ctx, o!.id);
    expect(afterCancel.order.refundedTotal).toBe("138.00");
    expect(afterCancel.order.paymentStatus).toBe("partially_refunded");
    expect((await supplierBalance(supB.ctx)).payable).toBe("0.00");

    // supplier A fulfils: prepare → ship (stock consumed) → deliver
    await advanceGroup(supA.ctx, groupA.id, "prepare");
    await expect(advanceGroup(supA.ctx, groupA.id, "deliver")).rejects.toMatchObject({ messageKey: "invalid_transition" });
    await advanceGroup(supA.ctx, groupA.id, "ship", { carrier: "SMSA", trackingNumber: "TRK123" });
    expect(await onHand(pa.id)).toEqual({ onHand: "46.0000", reserved: "0.0000" });
    await expect(cancelBySupplier(supA.ctx, groupA.id, "too late")).rejects.toMatchObject({ messageKey: "group_not_cancellable" });
    await advanceGroup(supA.ctx, groupA.id, "deliver");
    expect((await getMyOrder(c.ctx, o!.id)).order.status).toBe("in_progress");

    // return 2 of 4 → supplier approves → receives → partial refund + credit note
    const line = (await getMyOrder(c.ctx, o!.id)).groups.find((g) => g.id === groupA.id)!.lines[0]!;
    const ret = await requestReturn(c.ctx, groupA.id, { reason: "damaged in transit", lines: [{ orderLineId: line.id, quantity: "2" }] });
    expect(ret.amount).toBe("230.00");
    await expect(requestReturn(c.ctx, groupA.id, { reason: "again please", lines: [{ orderLineId: line.id, quantity: "1" }] })).rejects.toMatchObject({ messageKey: "return_open" });
    await expect(decideReturn(supB.ctx, ret.id, "approve")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await decideReturn(supA.ctx, ret.id, "approve");
    await decideReturn(supA.ctx, ret.id, "receive");
    const final = await getMyOrder(c.ctx, o!.id);
    expect(final.returns[0]!.status).toBe("refunded");
    expect(final.order.refundedTotal).toBe("368.00");
    expect(final.invoices.filter((i) => i.kind === "credit_note")).toHaveLength(2);
    expect((await supplierBalance(supA.ctx)).payable).toBe("258.75");
    const all = await withSystem((tx) => tx.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, o!.id)));
    expect(all.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0).toFixed(2)).toBe("0.00");
  });

  it("failed payments keep data intact; unpaid orders expire and release stock; late payments are refunded", async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `X-${randomToken(4)}`, retail: "10.00", stock: "5" });
    await zone(sup, "0.00");
    const c = await customer();
    await addToCart(c.ctx, p.id, "5");
    const r = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
    const i = await intentOf(r.orderId);
    TestPaymentProvider.settle(i.providerRef!, "failed");
    expect((await webhook(i.providerRef!)).result).toBe("failed");
    const o1 = await getMyOrder(c.ctx, r.orderId);
    expect(o1.order.status).toBe("payment_failed");
    expect(o1.canPay).toBe(true);
    expect((await onHand(p.id)).reserved).toBe("5.0000");
    // another customer cannot buy reserved stock
    const c2 = await customer();
    await expect(addToCart(c2.ctx, p.id, "1")).rejects.toMatchObject({ messageKey: "insufficient_stock" });

    // expire
    await withSystem((tx) => tx.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, r.orderId)));
    expect(await expireUnpaidOrders()).toBeGreaterThanOrEqual(1);
    expect((await onHand(p.id)).reserved).toBe("0.0000");
    const o2 = await getMyOrder(c.ctx, r.orderId);
    expect(o2.order.status).toBe("expired");
    expect(o2.groups[0]!.status).toBe("cancelled");

    // a payment that arrives after expiry is captured and refunded automatically
    const i2 = await intentOf(r.orderId);
    await withSystem((tx) => tx.update(paymentIntents).set({ status: "pending" }).where(eq(paymentIntents.id, i2.id)));
    TestPaymentProvider.settle(i2.providerRef!, "succeeded", 5750); // 5 × 10.00 + 15% VAT
    const res = await applyProviderStatus(i2.id, await (await providerFor("test")).fetchPayment(i2.providerRef!), "test");
    expect(res).toBe("refund_late_payment");
    const o3 = await getMyOrder(c.ctx, r.orderId);
    expect(o3.order.paymentStatus).toBe("refunded");
    expect(o3.refunds[0]!.reason).toBe("late_payment");
  });

  it("checkout rejects stale carts and missing shipping; respects the checkout flag", async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `S-${randomToken(4)}`, retail: "20.00", stock: "3" });
    const c = await customer();
    await addToCart(c.ctx, p.id, "2");
    // no shipping zone for this supplier and no platform default → no option
    await expect(checkout(c.ctx, { addressId: c.addr.id, shipping: {}, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`)).rejects.toMatchObject({ messageKey: "shipping_required" });
    await zone(sup, "5.00");
    // stock drops below the cart quantity → cart_invalid with details
    await setStock(sup.ctx, { warehouseId: (await withSystem((tx) => tx.execute(sql`select id from warehouses where org_id = ${sup.org.id} limit 1`))).rows[0]!.id as string, supplierProductId: p.id, onHand: "1" });
    await expect(checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`)).rejects.toMatchObject({ messageKey: "cart_invalid" });
    const cart = await getCart(c.ctx, { city: "riyadh" });
    expect(cart.groups[0]!.lines[0]!.issues).toContain("insufficient_stock");
    await updateCartItem(c.ctx, cart.groups[0]!.lines[0]!.itemId, "1");
    // checkout disabled by flag
    const admin = await adminCtx();
    await setFlag(admin, "store.checkout", false);
    try {
      await expect(checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`)).rejects.toMatchObject({ messageKey: "payment_not_configured" });
    } finally {
      await setFlag(admin, "store.checkout", true);
    }
    const ok = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
    expect(ok.orderId).toBeTruthy();
    // webhook events table is not readable by users
    const rows = await rawAsApp({ userId: c.user.id, orgId: null }, "select count(*)::int as n from payment_webhook_events", []);
    expect(rows[0]!.n).toBe(0);
    expect((await withSystem((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(paymentWebhookEvents)))[0]!.n).toBeGreaterThan(0);
  });
});
