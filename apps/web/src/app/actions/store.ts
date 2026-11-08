"use server";

import { z } from "zod";
import {
  addToCart,
  advanceGroup,
  cancelByCustomer,
  cancelBySupplier,
  checkout,
  decideReturn,
  deleteAddress,
  deleteShippingZone,
  removeCartItem,
  requestReturn,
  saveAddress,
  saveShippingZone,
  toggleWishlist,
  updateCartItem,
} from "@platform/modules/commerce";
import { applyProviderStatus, providerFor, retryPayment } from "@platform/modules/payments";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

const uuid = z.string().uuid();
const opt = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : String(v));
const bool = (v: unknown) => v === "1" || v === "on" || v === "true";
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);

// ------------------------------------------------------------------------------------- cart & wishlist

export async function addToCartAction(productId: string, quantity: string) {
  return run(async () => addToCart(await getCtx(), uuid.parse(productId), quantity));
}

export async function updateCartItemAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await updateCartItem(await getCtx(), uuid.parse(o.itemId), String(o.quantity ?? ""));
  });
}

export async function removeCartItemAction(itemId: string) {
  return run(async () => removeCartItem(await getCtx(), uuid.parse(itemId)));
}

export async function toggleWishlistAction(productId: string) {
  return run(async () => toggleWishlist(await getCtx(), uuid.parse(productId)));
}

// ------------------------------------------------------------------------------------- addresses

export async function saveAddressAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const r = await saveAddress(await getCtx(), opt(o.id) ? uuid.parse(o.id) : null, {
      label: opt(o.label),
      recipientName: String(o.recipientName ?? ""),
      phone: String(o.phone ?? ""),
      line1: String(o.line1 ?? ""),
      line2: opt(o.line2),
      district: opt(o.district),
      city: String(o.city ?? ""),
      postalCode: opt(o.postalCode),
      nationalAddressCode: opt(o.nationalAddressCode),
      isDefault: bool(o.isDefault),
    });
    return { id: r.id };
  });
}

export async function deleteAddressAction(id: string) {
  return run(async () => deleteAddress(await getCtx(), uuid.parse(id)));
}

// ------------------------------------------------------------------------------------- checkout & payment

export async function checkoutAction(fd: FormData) {
  return run(async () => {
    const ctx = await getCtx();
    const o = formToObject(fd);
    const suppliers = arr(o.supplierOrgId);
    const methods = arr(o.method);
    const shipping = Object.fromEntries(suppliers.map((s, i) => [s, methods[i] as "standard" | "express" | "pickup"]));
    const r = await checkout(
      ctx,
      { addressId: String(o.addressId ?? ""), shipping, paymentMethod: String(o.paymentMethod ?? "card") as "card" | "bank_transfer", acceptTerms: bool(o.acceptTerms) as true, buyerVatNumber: opt(o.buyerVatNumber) },
      z.string().min(8).max(200).parse(o.idempotencyKey),
      ctx.locale,
    );
    return { orderId: r.orderId, redirectUrl: r.redirectUrl, paymentError: r.paymentError };
  });
}

export async function retryPaymentAction(orderId: string) {
  return run(async () => {
    const ctx = await getCtx();
    const r = await retryPayment(ctx, uuid.parse(orderId), ctx.locale);
    return { redirectUrl: r.redirectUrl };
  });
}

/**
 * Test-provider simulator (dev/test only). Records the outcome at the "provider", then applies it via
 * the same authoritative path a webhook uses. The test provider refuses to exist in production.
 */
export async function simulateTestPaymentAction(intentId: string, outcome: "succeeded" | "failed") {
  return run(async () => {
    if (process.env.APP_ENV === "production") throw new Error("Not available");
    const ctx = await getCtx();
    if (!ctx.userId) throw new Error("Not signed in");
    const { TestPaymentProvider } = await import("@platform/integrations/payments");
    const { withSystem } = await import("@platform/db");
    const { paymentIntents } = await import("@platform/db/schema");
    const { eq } = await import("drizzle-orm");
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, uuid.parse(intentId))).limit(1));
    if (!i || i.userId !== ctx.userId || i.provider !== "test" || !i.providerRef) throw new Error("Unknown payment");
    const { toMinor } = await import("@platform/integrations/payments");
    TestPaymentProvider.settle(i.providerRef, outcome, toMinor(i.amount));
    const p = await providerFor("test");
    await applyProviderStatus(i.id, await p.fetchPayment(i.providerRef), "test_simulator");
    return { orderId: i.orderId };
  });
}

export async function cancelOrderAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await cancelByCustomer(await getCtx(), uuid.parse(o.orderId), opt(o.groupId) ? uuid.parse(o.groupId) : null, String(o.reason ?? ""));
  });
}

export async function requestReturnAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ids = arr(o.orderLineId);
    const qty = arr(o.quantity);
    await requestReturn(await getCtx(), uuid.parse(o.groupId), { reason: String(o.reason ?? ""), lines: ids.map((id, i) => ({ orderLineId: id, quantity: qty[i] || "0" })) });
  });
}

// ------------------------------------------------------------------------------------- supplier

export async function advanceGroupAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const action = z.enum(["prepare", "ship", "deliver"]).parse(o.action);
    await advanceGroup(await getCtx(), uuid.parse(o.groupId), action, { carrier: opt(o.carrier), trackingNumber: opt(o.trackingNumber) });
  });
}

export async function supplierCancelAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await cancelBySupplier(await getCtx(), uuid.parse(o.groupId), String(o.reason ?? ""));
  });
}

export async function decideReturnAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await decideReturn(await getCtx(), uuid.parse(o.returnId), z.enum(["approve", "reject", "receive"]).parse(o.decision), opt(o.note) ?? null);
  });
}

export async function saveZoneAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const methods = arr(o.method);
    const fees = arr(o.fee);
    const free = arr(o.freeOver);
    const mins = arr(o.etaMin);
    const maxs = arr(o.etaMax);
    return saveShippingZone(await getCtx(), opt(o.id) ? uuid.parse(o.id) : null, {
      name: String(o.name ?? ""),
      nationwide: bool(o.nationwide),
      cities: arr(o.cities),
      regions: arr(o.regions),
      isActive: o.isActive === undefined ? !opt(o.id) : bool(o.isActive),
      rates: methods
        .map((m, i) => ({ method: m as "standard", fee: fees[i] ?? "", freeOver: free[i] ?? "", etaMinDays: mins[i] ?? "1", etaMaxDays: maxs[i] ?? "5" }))
        .filter((r) => r.fee !== "") as never,
    });
  });
}

export async function deleteZoneAction(id: string) {
  return run(async () => deleteShippingZone(await getCtx(), uuid.parse(id)));
}
