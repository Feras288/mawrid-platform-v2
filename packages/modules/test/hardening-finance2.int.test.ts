/**
 * Engineering hardening, review round 2 (PR #1):
 *   R2-1 refunds the provider acknowledged as `pending` must be reconciled, never re-sent
 *   R2-2 OBS-1: a late payment that is refunded must leave supplier / platform books untouched
 *   R2-3 historical duplicate captures flagged by migration 0013 need a verified, audited, manual settlement path
 * See docs/HARDENING_REPORT.md.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { orders, paymentIntents, refunds } from "@platform/db/schema";
import { TestPaymentProvider, type PaymentProvider, type RefundResult } from "@platform/integrations/payments";
import { cancelBySupplier, getMyOrder } from "../src/commerce";
import { expireUnpaidOrders, ledgerSummary, listDuplicateCaptures, providerFor, recoverPendingRefunds, refundPayment, settleDuplicateCapture, supplierBalance } from "../src/payments";
import { count, creditNotes, paidOrder, placeCardOrder } from "./hardening-helpers";
import { adminCtx } from "./helpers";
import { webhook } from "./store-helpers";

const restores: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (restores.length) restores.pop()!();
});

type FetchRefundInput = { paymentId: string; providerRef: string | null; amountMinor: number; refundedBeforeMinor: number; idempotencyKey: string };
/** Install `fetchRefund` on the provider instance (works whether or not the adapter implements it). */
function stubFetchRefund(provider: PaymentProvider, impl: (i: FetchRefundInput) => Promise<RefundResult>) {
  const p = provider as unknown as { fetchRefund?: unknown };
  p.fetchRefund = vi.fn(impl);
  restores.push(() => {
    delete p.fetchRefund;
  });
  return p.fetchRefund as ReturnType<typeof vi.fn<(i: FetchRefundInput) => Promise<RefundResult>>>;
}

const refundRow = async (key: string) => (await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, key))))[0]!;
const adj = (orderId: string, amount = "5.00") => ({ orderId, groupId: null, amount, reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(8)}`, actorUserId: null });

/** Net (debit − credit) per ledger account for one order. */
async function net(orderId: string) {
  const rows = (await withSystem((tx) => tx.execute(sql`select account, (sum(debit) - sum(credit))::text as n from ledger_entries where order_id = ${orderId} group by account`))).rows as { account: string; n: string }[];
  return Object.fromEntries(["platform_clearing", "supplier_payable", "commission_revenue", "vat_payable"].map((a) => [a, rows.find((r) => r.account === a)?.n ?? "0.00"]));
}
async function platformTotals() {
  const s = await ledgerSummary(await adminCtx());
  return Object.fromEntries(s.accounts.map((a) => [a.account, `${a.debit}|${a.credit}`]));
}

describe("R2-1: a refund the provider accepted as pending is reconciled against the provider", () => {
  async function acceptedPending(o: Awaited<ReturnType<typeof paidOrder>>, amount = "5.00") {
    const provider = await providerFor("test");
    const ref = `rf_${randomToken(6)}`;
    const refundSpy = vi.spyOn(provider, "refund").mockResolvedValueOnce({ status: "pending", providerRef: ref });
    const input = adj(o.orderId, amount);
    expect((await refundPayment(input)).status).toBe("pending");
    const row = await refundRow(input.idempotencyKey);
    expect(row).toMatchObject({ status: "pending", providerRef: ref });
    return { provider, ref, input, row, refundSpy };
  }

  it("completes the refund once the provider confirms it — without sending it again", async () => {
    const o = await paidOrder();
    const { provider, ref, input, refundSpy } = await acceptedPending(o);
    const fetchRefund = stubFetchRefund(provider, async () => ({ status: "succeeded", providerRef: ref }));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(await refundRow(input.idempotencyKey)).toMatchObject({ status: "succeeded", providerRef: ref });
    expect(refundSpy).toHaveBeenCalledTimes(1); // never re-sent
    expect(fetchRefund).toHaveBeenCalledTimes(1);
    expect(fetchRefund.mock.calls[0]![0]).toMatchObject({ providerRef: ref, amountMinor: 500, refundedBeforeMinor: 0, idempotencyKey: input.idempotencyKey });
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("5.00");
    expect(await creditNotes(o.orderId)).toBe(1);
    // a second sweep changes nothing
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect(await creditNotes(o.orderId)).toBe(1);
    expect(fetchRefund).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the provider says pending, and does not poll again inside the lease", async () => {
    const o = await paidOrder();
    const { provider, input } = await acceptedPending(o);
    const fetchRefund = stubFetchRefund(provider, async () => ({ status: "pending", providerRef: null }));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(0);
    expect((await refundRow(input.idempotencyKey)).status).toBe("pending");
    await recoverPendingRefunds({ olderThanMs: 3_600_000 }); // last poll is inside this lease
    expect(fetchRefund).toHaveBeenCalledTimes(1);
  });

  it("marks the refund failed when the provider reports failure and releases the reserved amount", async () => {
    const o = await paidOrder();
    const { provider, input } = await acceptedPending(o, "23.00");
    stubFetchRefund(provider, async () => ({ status: "failed", providerRef: null, failureReason: "rejected_by_bank" }));
    await expect(refundPayment(adj(o.orderId, "1.00"))).rejects.toMatchObject({ messageKey: "refund_exceeds" }); // 23.00 still reserved
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect(await refundRow(input.idempotencyKey)).toMatchObject({ status: "failed", failureReason: "rejected_by_bank" });
    expect(await creditNotes(o.orderId)).toBe(0);
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).toBe("paid");
    expect((await refundPayment(adj(o.orderId, "1.00"))).status).toBe("succeeded"); // capacity is free again
  });

  it("survives provider lookup errors (stays pending, retried next sweep)", async () => {
    const o = await paidOrder();
    const { provider, ref, input } = await acceptedPending(o);
    const fetchRefund = stubFetchRefund(provider, async () => {
      throw new Error("ECONNRESET");
    });
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect((await refundRow(input.idempotencyKey)).status).toBe("pending");
    fetchRefund.mockImplementation(async () => ({ status: "succeeded", providerRef: ref }));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
  });

  it("escalates to manual_required (audited) when the provider never confirms within the window", async () => {
    const o = await paidOrder();
    const { provider, input, row } = await acceptedPending(o);
    stubFetchRefund(provider, async () => ({ status: "pending", providerRef: null }));
    await withSystem((tx) => tx.execute(sql`update refunds set created_at = now() - interval '3 days' where id = ${row.id}`));
    const r = await recoverPendingRefunds({ olderThanMs: 0 });
    expect(r.escalated).toBe(1);
    expect(await refundRow(input.idempotencyKey)).toMatchObject({ status: "manual_required", failureReason: "provider_unconfirmed" });
    expect(await count(sql`select count(*) n from audit_logs where entity_id = ${row.id} and action = 'refund.escalated'`)).toBe(1);
  });

  it("reconciles refunds of one payment in order, so one refund's money is never credited to another", async () => {
    const o = await paidOrder();
    const first = await acceptedPending(o, "5.00");
    const second = await acceptedPending(o, "7.00");
    // sweep 1: the provider has confirmed nothing → only the OLDEST refund may be examined
    const fetchRefund = stubFetchRefund(first.provider, async () => ({ status: "pending", providerRef: null }));
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect(fetchRefund.mock.calls.map((c) => c[0].amountMinor)).toEqual([500]);
    // sweep 2: the provider has returned 5.00 in total → the first completes, the second is judged against 5.00 already confirmed
    fetchRefund.mockClear();
    fetchRefund.mockImplementation(async (i) => ({ status: i.refundedBeforeMinor + i.amountMinor <= 500 ? "succeeded" : "pending", providerRef: null }));
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect(fetchRefund.mock.calls.map((c) => [c[0].amountMinor, c[0].refundedBeforeMinor])).toEqual([[500, 0], [700, 500]]);
    expect((await refundRow(first.input.idempotencyKey)).status).toBe("succeeded");
    expect((await refundRow(second.input.idempotencyKey)).status).toBe("pending");
    // sweep 3: the provider total now covers both
    fetchRefund.mockImplementation(async (i) => ({ status: i.refundedBeforeMinor + i.amountMinor <= 1200 ? "succeeded" : "pending", providerRef: null }));
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect((await refundRow(second.input.idempotencyKey)).status).toBe("succeeded");
  });

  it("concurrent sweeps complete the refund exactly once", async () => {
    const o = await paidOrder();
    const { provider, ref, input } = await acceptedPending(o);
    stubFetchRefund(provider, async () => ({ status: "succeeded", providerRef: ref }));
    await Promise.all(Array.from({ length: 5 }, () => recoverPendingRefunds({ olderThanMs: 0 })));
    expect((await refundRow(input.idempotencyKey)).status).toBe("succeeded");
    expect(await creditNotes(o.orderId)).toBe(1);
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("5.00");
  });
});

describe("R2-2 (OBS-1): a late payment that is refunded leaves the books untouched", () => {
  async function lateRefundedOrder() {
    const o = await placeCardOrder();
    await withSystem((tx) => tx.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, o.orderId)));
    await expireUnpaidOrders();
    TestPaymentProvider.settle(o.intent.providerRef!, "succeeded");
    return o;
  }

  it("posts no reversal for a payment that was never booked: supplier, commission, VAT and clearing all stay at zero", async () => {
    const o = await lateRefundedOrder();
    const before = { platform: await platformTotals(), supplier: await supplierBalance(o.sup.ctx) };
    expect((await webhook(o.intent.providerRef!)).result).toBe("refund_late_payment");

    expect(await net(o.orderId)).toEqual({ platform_clearing: "0.00", supplier_payable: "0.00", commission_revenue: "0.00", vat_payable: "0.00" });
    expect(await count(sql`select count(*) n from ledger_entries where order_id = ${o.orderId}`)).toBe(0);
    expect((await supplierBalance(o.sup.ctx)).payable).toBe(before.supplier.payable);
    expect(await platformTotals()).toEqual(before.platform);
    // customer-facing state is unchanged: money returned in full, no credit note for an invoice that never existed
    const order = await getMyOrder(o.c.ctx, o.orderId);
    expect(order.order).toMatchObject({ paymentStatus: "refunded", refundedTotal: o.intent.amount });
    expect(await creditNotes(o.orderId)).toBe(0);
    const [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.orderId, o.orderId)));
    expect(rf).toMatchObject({ reason: "late_payment", status: "succeeded" });
  });

  it("a late payment whose refund is delayed by an outage ends with the same untouched books", async () => {
    const o = await lateRefundedOrder();
    const before = await supplierBalance(o.sup.ctx);
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValueOnce(new Error("ECONNRESET"));
    await webhook(o.intent.providerRef!);
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(await net(o.orderId)).toEqual({ platform_clearing: "0.00", supplier_payable: "0.00", commission_revenue: "0.00", vat_payable: "0.00" });
    expect((await supplierBalance(o.sup.ctx)).payable).toBe(before.payable);
  });

  it("booked payments are unchanged: exact per-account balances after payment, partial refund and full refund", async () => {
    const baseSupplier = (await supplierBalance((await placeCardOrder()).sup.ctx)).payable; // supplier balance before this order is paid
    const o = await paidOrder();
    const g = (await getMyOrder(o.c.ctx, o.orderId)).groups[0]!;
    expect(g.total).toBe("23.00");
    const split = { commission: g.commissionNet, commissionVat: g.commissionVat, payable: g.supplierPayable };
    expect(split).toEqual({ commission: "0.00", commissionVat: "0.00", payable: "23.00" });

    expect(await net(o.orderId)).toEqual({ platform_clearing: "23.00", supplier_payable: "-23.00", commission_revenue: "0.00", vat_payable: "0.00" });
    expect((await supplierBalance(o.sup.ctx)).payable).toBe((Number(baseSupplier) + 23).toFixed(2));

    expect((await refundPayment({ ...adj(o.orderId, "5.00"), groupId: o.groupId })).status).toBe("succeeded");
    expect(await net(o.orderId)).toEqual({ platform_clearing: "18.00", supplier_payable: "-18.00", commission_revenue: "0.00", vat_payable: "0.00" });
    expect((await supplierBalance(o.sup.ctx)).payable).toBe((Number(baseSupplier) + 18).toFixed(2));

    expect((await refundPayment({ ...adj(o.orderId, "18.00"), groupId: o.groupId })).status).toBe("succeeded");
    expect(await net(o.orderId)).toEqual({ platform_clearing: "0.00", supplier_payable: "0.00", commission_revenue: "0.00", vat_payable: "0.00" });
    expect((await supplierBalance(o.sup.ctx)).payable).toBe(Number(baseSupplier).toFixed(2));
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).toBe("refunded");
  });

  it("supplier cancellation of a paid order still reverses exactly what was booked", async () => {
    const o = await paidOrder();
    await cancelBySupplier(o.sup.ctx, o.groupId, "out of stock");
    expect(await net(o.orderId)).toEqual({ platform_clearing: "0.00", supplier_payable: "0.00", commission_revenue: "0.00", vat_payable: "0.00" });
  });
});

describe("R2-3: historical duplicate captures (flagged by migration 0013) are settled manually after verification", () => {
  /** What migration 0013 leaves behind: a captured second intent marked duplicate_of, with no refund and no event. */
  async function legacyDuplicate(opts: { providerAmountMinor?: number } = {}) {
    const o = await paidOrder();
    const ref = `test_legacy_${randomToken(8)}`;
    TestPaymentProvider.settle(ref, "succeeded", opts.providerAmountMinor ?? 2300);
    const [dup] = await withSystem((tx) =>
      tx
        .insert(paymentIntents)
        .values({ orderId: o.orderId, userId: o.intent.userId, orgId: o.intent.orgId, provider: "test", providerRef: ref, providerPaymentId: ref, amount: o.intent.amount, currency: "SAR", status: "succeeded", succeededAt: new Date(), duplicateOf: o.intent.id })
        .returning(),
    );
    return { ...o, dup: dup!, ref };
  }

  it("nothing is refunded automatically: neither the sweeper nor a webhook touches a legacy duplicate", async () => {
    const o = await legacyDuplicate();
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect((await webhook(o.ref)).status).toBeLessThan(500);
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.intentId, o.dup.id)))).toHaveLength(0);
    const list = await listDuplicateCaptures(await adminCtx());
    expect(list.find((d) => d.intentId === o.dup.id)).toMatchObject({ orderId: o.orderId, primaryIntentId: o.intent.id, amount: "23.00", state: "needs_review", refundStatus: null });
  });

  it("requires finance permission and a reconciliation note", async () => {
    const o = await legacyDuplicate();
    await expect(settleDuplicateCapture(o.c.ctx, o.dup.id, { action: "refund", note: "customer paid twice" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(settleDuplicateCapture(await adminCtx(), o.dup.id, { action: "refund", note: " " })).rejects.toMatchObject({ messageKey: "note_required" });
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.intentId, o.dup.id)))).toHaveLength(0);
  });

  it("verifies the capture at the provider first: amount mismatch or non-captured payments are not refunded", async () => {
    const wrongAmount = await legacyDuplicate({ providerAmountMinor: 100 });
    await expect(settleDuplicateCapture(await adminCtx(), wrongAmount.dup.id, { action: "refund", note: "verified by finance" })).rejects.toMatchObject({ messageKey: "duplicate_not_verified" });
    const notCaptured = await legacyDuplicate();
    TestPaymentProvider.settle(notCaptured.ref, "failed");
    await expect(settleDuplicateCapture(await adminCtx(), notCaptured.dup.id, { action: "refund", note: "verified by finance" })).rejects.toMatchObject({ messageKey: "duplicate_not_verified" });
    expect(await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.intentId, notCaptured.dup.id)))).toHaveLength(0);
  });

  it("refunds a verified duplicate once (idempotent, concurrent-safe), audited, without touching the books", async () => {
    const o = await legacyDuplicate();
    const admin = await adminCtx();
    const before = await platformTotals();
    const res = await Promise.all(Array.from({ length: 4 }, () => settleDuplicateCapture(admin, o.dup.id, { action: "refund", note: "verified in Moyasar dashboard" })));
    expect(new Set(res.map((r) => r.refundId)).size).toBe(1);
    expect(TestPaymentProvider.refundedMinor(o.ref)).toBe(2300);
    const [rf] = await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.intentId, o.dup.id)));
    expect(rf).toMatchObject({ reason: "duplicate_payment", status: "succeeded", amount: "23.00", requestedBy: admin.userId });
    expect(await platformTotals()).toEqual(before);
    expect(await creditNotes(o.orderId)).toBe(0);
    expect((await getMyOrder(o.c.ctx, o.orderId)).order).toMatchObject({ paymentStatus: "paid", refundedTotal: "0.00" });
    expect(await count(sql`select count(*) n from audit_logs where entity_id = ${o.dup.id} and action = 'payment.duplicate_capture_settled'`)).toBe(1);
    const list = await listDuplicateCaptures(admin);
    expect(list.find((d) => d.intentId === o.dup.id)).toMatchObject({ state: "refunded", refundStatus: "succeeded" });
  });

  it("can be dismissed with a note (e.g. already refunded out of band); dismissal and refund exclude each other", async () => {
    const dismissed = await legacyDuplicate();
    const admin = await adminCtx();
    await settleDuplicateCapture(admin, dismissed.dup.id, { action: "dismiss", note: "refunded manually on 2026-11-01, ref 123" });
    expect((await listDuplicateCaptures(admin)).find((d) => d.intentId === dismissed.dup.id)?.state).toBe("dismissed");
    await expect(settleDuplicateCapture(admin, dismissed.dup.id, { action: "refund", note: "second thoughts" })).rejects.toMatchObject({ messageKey: "duplicate_already_settled" });
    const refunded = await legacyDuplicate();
    await settleDuplicateCapture(admin, refunded.dup.id, { action: "refund", note: "verified" });
    await expect(settleDuplicateCapture(admin, refunded.dup.id, { action: "dismiss", note: "oops" })).rejects.toMatchObject({ messageKey: "duplicate_already_settled" });
  });

  it("a settled refund survives a provider outage like any other refund", async () => {
    const o = await legacyDuplicate();
    const provider = await providerFor("test");
    vi.spyOn(provider, "refund").mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await settleDuplicateCapture(await adminCtx(), o.dup.id, { action: "refund", note: "verified" })).status).toBe("pending");
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(TestPaymentProvider.refundedMinor(o.ref)).toBe(2300);
  });

  it("rejects intents that are not legacy duplicates", async () => {
    const o = await paidOrder();
    await expect(settleDuplicateCapture(await adminCtx(), o.intent.id, { action: "refund", note: "try" })).rejects.toMatchObject({ messageKey: "not_a_duplicate" });
  });
});
