/**
 * Engineering hardening (P0 finance): reproduction + regression tests for
 *   AUD-001 failed webhook redelivery, AUD-004 duplicate captures, AUD-007 stuck refunds.
 * See docs/HARDENING_REPORT.md.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { paymentIntents, paymentWebhookEvents, refunds } from "@platform/db/schema";
import { TestPaymentProvider } from "@platform/integrations/payments";
import { addToCart, advanceGroup, cancelBySupplier, checkout, decideReturn, getMyOrder, requestReturn } from "../src/commerce";
import { ledgerSummary, processWebhook, providerFor, recoverPendingRefunds, refundPayment, retryPayment } from "../src/payments";
import { adminCtx, approvedSupplier } from "./helpers";
import { customer, intentOf, product, webhook, zone } from "./store-helpers";

afterEach(() => vi.restoreAllMocks());

let shop: Promise<{ sup: Awaited<ReturnType<typeof approvedSupplier>>; productId: string }> | undefined;
/** One supplier and product for the whole file: approved suppliers are global state other suites rank against. */
const sharedShop = () =>
  (shop ??= (async () => {
    const sup = await approvedSupplier();
    const p = await product(sup, { sku: `H-${randomToken(4)}`, retail: "10.00", stock: "5000" });
    await zone(sup, "0.00");
    return { sup, productId: p.id };
  })());

async function placeCardOrder() {
  const { sup, productId } = await sharedShop();
  const c = await customer();
  await addToCart(c.ctx, productId, "2");
  const r = await checkout(c.ctx, { addressId: c.addr.id, shipping: { [sup.org.id]: "standard" }, paymentMethod: "card", acceptTerms: true }, `k-${randomToken(10)}`);
  const intent = await intentOf(r.orderId);
  const order = await getMyOrder(c.ctx, r.orderId);
  return { sup, c, orderId: r.orderId, intent, groupId: order.groups[0]!.id };
}

async function paidOrder() {
  const o = await placeCardOrder();
  TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
  expect((await webhook(o.intent.providerRef!)).result).toBe("succeeded");
  return o;
}

const count = async (q: ReturnType<typeof sql>) => Number(((await withSystem((tx) => tx.execute(q))).rows[0] as { n: string }).n);
const paidEvents = (orderId: string) => count(sql`select count(*) n from order_events where order_id = ${orderId} and kind = 'paid'`);
const journals = (orderId: string) => count(sql`select count(distinct journal_id) n from ledger_entries where order_id = ${orderId}`);
const creditNotes = (orderId: string) => count(sql`select count(*) n from invoices where order_id = ${orderId} and kind = 'credit_note'`);

describe("AUD-001: a webhook whose processing failed must be re-processable on provider redelivery", () => {
  it("reprocesses the same event id after a transient failure (was: answered 'duplicate' forever)", async () => {
    const o = await placeCardOrder();
    TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
    const provider = await providerFor("test");
    vi.spyOn(provider, "fetchPayment").mockRejectedValueOnce(new Error("provider down"));
    const evt = `evt_${randomToken(8)}`;

    const first = await webhook(o.intent.providerRef!, evt);
    expect(first).toEqual({ status: 500, result: "failed" });
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).not.toBe("paid");

    const second = await webhook(o.intent.providerRef!, evt); // provider retries the SAME event
    expect(second).toEqual({ status: 200, result: "succeeded" });
    const order = await getMyOrder(o.c.ctx, o.orderId);
    expect(order.order.status).toBe("placed");
    expect(order.order.paymentStatus).toBe("paid");

    const [row] = await withSystem((tx) => tx.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, evt)));
    expect(row).toMatchObject({ status: "processed", error: null });
    expect(row!.attempts).toBe(2);

    // once processed, further redeliveries are plain duplicates
    expect((await webhook(o.intent.providerRef!, evt)).result).toBe("duplicate");
    expect(await paidEvents(o.orderId)).toBe(1);
  });

  it("handles concurrent deliveries of one event exactly once (one journal and invoice per group)", async () => {
    const o = await placeCardOrder();
    TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
    const evt = `evt_${randomToken(8)}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => webhook(o.intent.providerRef!, evt)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.result === "succeeded")).toHaveLength(1);
    expect(await paidEvents(o.orderId)).toBe(1);
    expect(await journals(o.orderId)).toBe(1);
    expect(await count(sql`select count(*) n from invoices where order_id = ${o.orderId}`)).toBe(1);
  });

  it("concurrent redeliveries of a FAILED event: a single worker wins the retry", async () => {
    const o = await placeCardOrder();
    TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
    const provider = await providerFor("test");
    vi.spyOn(provider, "fetchPayment").mockRejectedValueOnce(new Error("provider down"));
    const evt = `evt_${randomToken(8)}`;
    expect((await webhook(o.intent.providerRef!, evt)).status).toBe(500);
    const results = await Promise.all(Array.from({ length: 5 }, () => webhook(o.intent.providerRef!, evt)));
    expect(results.filter((r) => r.result === "succeeded")).toHaveLength(1);
    expect(results.filter((r) => r.result === "duplicate")).toHaveLength(4);
    expect(await paidEvents(o.orderId)).toBe(1);
    const [row] = await withSystem((tx) => tx.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.eventId, evt)));
    expect(row!.attempts).toBe(2);
  });

  it("recovers an event stranded in 'received' (worker crashed mid-processing) after its lease expires, not before", async () => {
    const o = await placeCardOrder();
    TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
    const evt = `evt_${randomToken(8)}`;
    await withSystem((tx) =>
      tx.insert(paymentWebhookEvents).values({ provider: "test", eventId: evt, eventType: "payment.updated", signatureValid: true, payload: {}, status: "received" }),
    );
    // fresh lease: another worker may still be processing
    expect((await webhook(o.intent.providerRef!, evt)).result).toBe("duplicate");
    await withSystem((tx) => tx.execute(sql`update payment_webhook_events set last_attempt_at = now() - interval '1 hour' where event_id = ${evt}`));
    expect((await webhook(o.intent.providerRef!, evt)).result).toBe("succeeded");
    expect(await paidEvents(o.orderId)).toBe(1);
  });

  it("does not reprocess events that were rejected for an invalid signature", async () => {
    const body = JSON.stringify({ id: "evt_bad", type: "payment.updated", ref: "x" });
    expect(await processWebhook("test", body, new Headers({ "x-test-signature": "nope" }))).toEqual({ status: 401, result: "invalid_signature" });
  });
});

describe("AUD-004: several successful captures for one order must be detected and the extras refunded", () => {
  async function orderWithTwoCaptures() {
    const o = await placeCardOrder();
    await retryPayment(o.c.ctx, o.orderId); // supersedes intent A locally; its hosted page may still be payable
    const [a, b] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, o.orderId)).orderBy(paymentIntents.createdAt));
    expect(a!.status).toBe("cancelled");
    expect(b!.status).toBe("pending");
    TestPaymentProvider.settle(a!.providerRef!, "succeeded");
    TestPaymentProvider.settle(b!.providerRef!, "succeeded");
    return { ...o, a: a!, b: b! };
  }

  it("books the first capture once and refunds the second in full without touching the ledger", async () => {
    const o = await orderWithTwoCaptures();
    expect((await webhook(o.a.providerRef!)).result).toBe("succeeded");
    expect((await webhook(o.b.providerRef!)).result).toBe("refund_duplicate_payment");

    const order = await getMyOrder(o.c.ctx, o.orderId);
    expect(order.order).toMatchObject({ status: "placed", paymentStatus: "paid", refundedTotal: "0.00" });
    expect(await paidEvents(o.orderId)).toBe(1);
    expect(await journals(o.orderId)).toBe(1);
    expect(await creditNotes(o.orderId)).toBe(0);
    expect((await ledgerSummary(await adminCtx())).balanced).toBe(true);

    const [a, b] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, o.orderId)).orderBy(paymentIntents.createdAt));
    expect(a).toMatchObject({ status: "succeeded", duplicateOf: null, refundedAmount: "0.00" });
    expect(b).toMatchObject({ status: "succeeded", duplicateOf: a!.id, refundedAmount: b!.amount });
    const rs = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)));
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ intentId: b!.id, reason: "duplicate_payment", status: "succeeded", amount: b!.amount });
    expect(await count(sql`select count(*) n from order_events where order_id = ${o.orderId} and kind = 'duplicate_payment'`)).toBe(1);
    expect(await count(sql`select count(*) n from audit_logs where entity_id = ${b!.id} and action = 'payment.duplicate_capture'`)).toBe(1);

    // redelivery / sync of the duplicate is a no-op
    expect((await webhook(o.b.providerRef!)).result).toBe("noop");
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)))).toHaveLength(1);
  });

  it("is order-independent and race-safe when both captures are reported concurrently", async () => {
    const o = await orderWithTwoCaptures();
    const res = await Promise.all([webhook(o.a.providerRef!), webhook(o.b.providerRef!)]);
    expect(res.map((r) => r.result).sort()).toEqual(["refund_duplicate_payment", "succeeded"]);
    expect(await paidEvents(o.orderId)).toBe(1);
    expect(await journals(o.orderId)).toBe(1);
    const succeededPrimary = await count(sql`select count(*) n from payment_intents where order_id = ${o.orderId} and status = 'succeeded' and duplicate_of is null`);
    expect(succeededPrimary).toBe(1);
  });

  it("a later business refund targets the primary capture, never the duplicate", async () => {
    const o = await orderWithTwoCaptures();
    await webhook(o.b.providerRef!); // B lands first and is the primary
    await webhook(o.a.providerRef!); // A is the duplicate
    await cancelBySupplier(o.sup.ctx, o.groupId, "out of stock");
    const [rf] = await withSystem((tx) => tx.select().from(refunds).where(sql`${refunds.orderId} = ${o.orderId} and ${refunds.reason} = 'cancellation'`));
    expect(rf).toMatchObject({ intentId: o.b.id, status: "succeeded" });
    const order = await getMyOrder(o.c.ctx, o.orderId);
    expect(order.order.paymentStatus).toBe("refunded");
    expect(await creditNotes(o.orderId)).toBe(1);
    expect((await ledgerSummary(await adminCtx())).balanced).toBe(true);
  });

  it("a superseded intent that expires or fails does not fail an order another intent can still pay", async () => {
    const o = await placeCardOrder();
    await retryPayment(o.c.ctx, o.orderId);
    const [a, b] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, o.orderId)).orderBy(paymentIntents.createdAt));
    TestPaymentProvider.settle(a!.providerRef!, "expired");
    expect((await webhook(a!.providerRef!)).result).toBe("expired");
    expect((await getMyOrder(o.c.ctx, o.orderId)).order).toMatchObject({ status: "pending_payment", paymentStatus: "pending" });
    TestPaymentProvider.settle(b!.providerRef!, "succeeded");
    expect((await webhook(b!.providerRef!)).result).toBe("succeeded");
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).toBe("paid");
  });

  it("the database refuses a second primary success for an order", async () => {
    const o = await orderWithTwoCaptures();
    await webhook(o.a.providerRef!);
    await expect(withSystem((tx) => tx.update(paymentIntents).set({ status: "succeeded" }).where(eq(paymentIntents.id, o.b.id)))).rejects.toThrow();
  });

  it("duplicate capture with a different amount is still treated as a mismatch, not as a payment", async () => {
    const o = await orderWithTwoCaptures();
    await webhook(o.a.providerRef!);
    TestPaymentProvider.settle(o.b.providerRef!, "succeeded", 100);
    expect((await webhook(o.b.providerRef!)).result).toBe("amount_mismatch");
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)))).toHaveLength(0);
  });
});

describe("AUD-007: a refund must not stay pending forever after a provider outage", () => {
  it("a connection failure leaves a retryable refund; the recovery job completes it exactly once", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValueOnce(new Error("ECONNRESET"));

    await cancelBySupplier(o.sup.ctx, o.groupId, "out of stock"); // the cancellation itself must not fail
    let [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)));
    expect(rf).toMatchObject({ status: "pending", providerRef: null });
    expect(rf!.attempts).toBe(1);
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).toBe("paid");

    // not due yet (a fresh attempt may still be in flight)
    expect(await recoverPendingRefunds()).toMatchObject({ completed: 0 });
    // due
    const r = await recoverPendingRefunds({ olderThanMs: 0 });
    expect(r.completed).toBe(1);
    [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)));
    expect(rf).toMatchObject({ status: "succeeded" });
    expect(rf!.providerRef).toBeTruthy();

    const order = await getMyOrder(o.c.ctx, o.orderId);
    expect(order.order).toMatchObject({ paymentStatus: "refunded", refundedTotal: o.intent.amount });
    expect(await creditNotes(o.orderId)).toBe(1);
    expect(await journals(o.orderId)).toBe(2); // payment + one reversal
    expect((await ledgerSummary(await adminCtx())).balanced).toBe(true);

    // running it again changes nothing
    expect(await recoverPendingRefunds({ olderThanMs: 0 })).toMatchObject({ completed: 0 });
    expect(await creditNotes(o.orderId)).toBe(1);
  });

  it("an explicit retry with the same idempotency key resumes a stranded refund instead of returning 'pending' forever", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValueOnce(new Error("socket hang up"));
    const input = { orderId: o.orderId, groupId: null, amount: "5.00", reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(6)}`, actorUserId: null };
    expect((await refundPayment(input)).status).toBe("pending");
    // too soon after the previous attempt → still pending, provider not hit twice
    expect((await refundPayment(input)).status).toBe("pending");
    await withSystem((tx) => tx.execute(sql`update refunds set last_attempt_at = now() - interval '1 hour' where idempotency_key = ${input.idempotencyKey}`));
    expect((await refundPayment(input)).status).toBe("succeeded");
    expect((await refundPayment(input)).status).toBe("succeeded");
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)))).toHaveLength(1);
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("5.00");
  });

  it("a return refund that completes later (recovery job) closes the return request", async () => {
    const o = await paidOrder();
    await advanceGroup(o.sup.ctx, o.groupId, "prepare");
    await advanceGroup(o.sup.ctx, o.groupId, "ship", { carrier: "SMSA", trackingNumber: "TRK1" });
    await advanceGroup(o.sup.ctx, o.groupId, "deliver");
    const line = (await getMyOrder(o.c.ctx, o.orderId)).groups[0]!.lines[0]!;
    const ret = await requestReturn(o.c.ctx, o.groupId, { reason: "damaged in transit", lines: [{ orderLineId: line.id, quantity: "1" }] });
    await decideReturn(o.sup.ctx, ret.id, "approve");
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValueOnce(new Error("ECONNRESET"));
    await decideReturn(o.sup.ctx, ret.id, "receive"); // must not fail because the provider is down
    expect((await getMyOrder(o.c.ctx, o.orderId)).returns[0]!.status).toBe("received");
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    const after = await getMyOrder(o.c.ctx, o.orderId);
    expect(after.returns[0]!.status).toBe("refunded");
    expect(after.returns[0]!.refundId).toBeTruthy();
    expect(after.order.paymentStatus).toBe("partially_refunded");
  });

  it("a lost provider response (refund executed, reply never arrived) is recovered without refunding twice", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    const real = provider.refund.bind(provider);
    vi.spyOn(provider, "refund").mockImplementationOnce(async (...a: Parameters<typeof real>) => {
      await real(...a);
      throw new Error("ETIMEDOUT");
    });
    const input = { orderId: o.orderId, groupId: null, amount: "7.50", reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(6)}`, actorUserId: null };
    expect((await refundPayment(input)).status).toBe("pending");
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(750); // the provider executed it once
    const [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)));
    expect(rf!.status).toBe("succeeded");
  });

  it("gives up after the attempt budget and hands the refund to finance (manual_required) instead of retrying forever", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValue(new Error("provider unreachable"));
    const input = { orderId: o.orderId, groupId: null, amount: "3.00", reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(6)}`, actorUserId: null };
    await refundPayment(input);
    for (let n = 0; n < 6; n++) await recoverPendingRefunds({ olderThanMs: 0, maxAttempts: 3 });
    const [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)));
    expect(rf).toMatchObject({ status: "manual_required", failureReason: "provider_unreachable" });
    expect(rf!.attempts).toBe(3);
    // the amount stays reserved so it cannot be refunded twice through another path
    await expect(refundPayment({ ...input, idempotencyKey: `adj:${randomToken(6)}`, amount: "9999.00" })).rejects.toMatchObject({ messageKey: "refund_exceeds" });
  });

  it("a definitive provider rejection is terminal: not retried, and its amount is released", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    const spy = vi.spyOn(provider, "refund").mockResolvedValueOnce({ status: "failed", providerRef: null, failureReason: "invalid_amount" });
    const input = { orderId: o.orderId, groupId: null, amount: "3.00", reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(6)}`, actorUserId: null };
    expect((await refundPayment(input)).status).toBe("failed");
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(0);
    expect((await refundPayment(input)).status).toBe("failed");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("concurrent refunds with one idempotency key create one refund (no unique-violation 500) and refund once", async () => {
    const o = await paidOrder();
    const input = { orderId: o.orderId, groupId: null, amount: "4.00", reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(6)}`, actorUserId: null };
    const res = await Promise.all(Array.from({ length: 5 }, () => refundPayment(input)));
    expect(new Set(res.map((r) => r.refundId)).size).toBe(1);
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)))).toHaveLength(1);
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(400);
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("4.00");
  });

  it("concurrent refunds cannot exceed the captured amount", async () => {
    const o = await paidOrder(); // 2 × 10.00 + 15% VAT = 23.00
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, n) => refundPayment({ orderId: o.orderId, groupId: null, amount: "10.00", reason: "adjustment", idempotencyKey: `adj:${n}:${randomToken(6)}`, actorUserId: null })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("20.00");
  });
});
