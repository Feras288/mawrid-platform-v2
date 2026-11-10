import { expect } from "vitest";
import { sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { TestPaymentProvider } from "@platform/integrations/payments";
import { addToCart, checkout, getMyOrder } from "../src/commerce";
import { approvedSupplier } from "./helpers";
import { customer, intentOf, product, webhook, zone } from "./store-helpers";

let shop: Promise<{ sup: Awaited<ReturnType<typeof approvedSupplier>>; productId: string }> | undefined;
/** One supplier and product for the whole file: approved suppliers are global state other suites rank against. */
const sharedShop = () =>
  (shop ??= (async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `H-${randomToken(4)}`, retail: "10.00", stock: "5000" });
    await zone(sup, "0.00");
    return { sup, productId: p.id };
  })());

export async function placeCardOrder() {
  const { sup, productId } = await sharedShop();
  const c = await customer();
  await addToCart(c.ctx, productId, "2");
  const r = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
  const intent = await intentOf(r.orderId);
  const order = await getMyOrder(c.ctx, r.orderId);
  return { sup, c, orderId: r.orderId, intent, groupId: order.groups[0]!.id };
}

export async function paidOrder() {
  const o = await placeCardOrder();
  TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
  expect((await webhook(o.intent.providerRef!)).result).toBe("succeeded");
  return o;
}

export const count = async (q: ReturnType<typeof sql>) => Number(((await withSystem((tx) => tx.execute(q))).rows[0] as { n: string }).n);
export const paidEvents = (orderId: string) => count(sql`select count(*) n from order_events where order_id = ${orderId} and kind = 'paid'`);
export const journals = (orderId: string) => count(sql`select count(distinct journal_id) n from ledger_entries where order_id = ${orderId}`);
export const creditNotes = (orderId: string) => count(sql`select count(*) n from invoices where order_id = ${orderId} and kind = 'credit_note'`);
