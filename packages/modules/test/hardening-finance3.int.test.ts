/**
 * Engineering hardening, review round 3 (PR #1): Moyasar documents idempotency for payment creation (`given_id`)
 * only — not for refunds. For providers whose refund idempotency is not proven, an unknown outcome must NEVER lead
 * to an automatic second POST; the outcome is reconciled by reading the payment, and escalated when it cannot be
 * established. See docs/HARDENING_REPORT.md (R3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { paymentIntents, refunds } from "@platform/db/schema";
import { TestPaymentProvider, type PaymentProvider, type RefundResult } from "@platform/integrations/payments";
import { getMyOrder } from "../src/commerce";
import { providerFor, recoverPendingRefunds, refundPayment } from "../src/payments";
import { count, creditNotes, paidOrder } from "./hardening-helpers";

const restores: (() => void)[] = [];
// the recovery job is global by design: park refunds left over by earlier tests so every sweep here concerns this test only
beforeEach(async () => {
  await withSystem((tx) => tx.execute(sql`update refunds set status = 'manual_required' where status = 'pending'`));
});
afterEach(() => {
  vi.restoreAllMocks();
  while (restores.length) restores.pop()!();
});

type FetchRefundInput = { paymentId: string; providerRef: string | null; amountMinor: number; refundedBeforeMinor: number; idempotencyKey: string };

/**
 * Turn the test provider into one that behaves like Moyasar as documented: refund idempotency is not guaranteed, so
 * every POST is a brand-new refund at the provider (no replay by key) and the payment's cumulative refunded total
 * is the only thing a lookup can read.
 */
async function moyasarLike() {
  const provider = (await providerFor("test")) as TestPaymentProvider & { refundIdempotency?: string; fetchRefund?: unknown };
  const real = provider.refund.bind(provider);
  const post = vi.spyOn(provider, "refund").mockImplementation((id, amount) => real(id, amount, `nokey-${randomToken(10)}`));
  const prevIdem = Object.getOwnPropertyDescriptor(provider, "refundIdempotency");
  Object.defineProperty(provider, "refundIdempotency", { value: "unproven", configurable: true, writable: true });
  const lookup = vi.fn(async (i: FetchRefundInput): Promise<RefundResult> => ({ status: TestPaymentProvider.refundedMinor(i.paymentId) >= i.refundedBeforeMinor + i.amountMinor ? "succeeded" : "pending", providerRef: null }));
  provider.fetchRefund = lookup;
  restores.push(() => {
    const bag = provider as unknown as Record<string, unknown>;
    if (prevIdem) Object.defineProperty(provider, "refundIdempotency", prevIdem);
    else delete bag.refundIdempotency;
    delete bag.fetchRefund;
  });
  return { provider: provider as PaymentProvider, real, post, lookup };
}

const refundRow = async (key: string) => (await withSystem((tx) => tx.select().from(refunds).where(eq(refunds.idempotencyKey, key))))[0]!;
const adj = (orderId: string, amount = "5.00") => ({ orderId, groupId: null, amount, reason: "adjustment" as const, idempotencyKey: `adj:${randomToken(8)}`, actorUserId: null });

describe("R3: a provider without proven refund idempotency is never sent a second refund after an unknown outcome", () => {
  it("the provider EXECUTED the refund but the response was lost: recovery reconciles it, the money moves exactly once", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockImplementationOnce(async (id, amount) => {
      await m.real(id, amount, `nokey-${randomToken(10)}`); // executed at the provider…
      throw new Error("ETIMEDOUT"); // …but the reply never arrived
    });
    const input = adj(o.orderId);
    expect((await refundPayment(input)).status).toBe("pending");
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(500);

    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(await refundRow(input.idempotencyKey)).toMatchObject({ status: "succeeded" });
    expect(m.post).toHaveBeenCalledTimes(1); // the recovery attempt did not POST
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(500); // no duplicate refund
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(m.lookup.mock.calls[0]![0]).toMatchObject({ amountMinor: 500, refundedBeforeMinor: 0 });
    const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, o.intent.id)));
    expect(i!.refundedAmount).toBe("5.00");
    expect(await creditNotes(o.orderId)).toBe(1);
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(await creditNotes(o.orderId)).toBe(1);
  });

  it("the request never reached the provider: still no automatic re-POST — the refund escalates to manual_required when it cannot be established", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockRejectedValueOnce(new Error("ECONNRESET")); // nothing executed
    const input = adj(o.orderId);
    await refundPayment(input);
    for (let n = 0; n < 3; n++) expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(0);
    expect(m.post).toHaveBeenCalledTimes(1);
    expect((await refundRow(input.idempotencyKey)).status).toBe("pending"); // still inside the settling window

    const row = await refundRow(input.idempotencyKey);
    await withSystem((tx) => tx.execute(sql`update refunds set created_at = now() - interval '2 hours' where id = ${row.id}`));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).escalated).toBe(1);
    expect(await refundRow(input.idempotencyKey)).toMatchObject({ status: "manual_required", failureReason: "outcome_unknown" });
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(0);
    expect(await count(sql`select count(*) n from audit_logs where entity_id = ${row.id} and action = 'refund.escalated'`)).toBe(1);
    // the amount stays reserved so it cannot be refunded again through another path
    await expect(refundPayment({ ...adj(o.orderId, "23.00") })).rejects.toMatchObject({ messageKey: "refund_exceeds" });
  });

  it("an explicit retry with the same idempotency key does not POST again either", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockRejectedValueOnce(new Error("socket hang up"));
    const input = adj(o.orderId);
    await refundPayment(input);
    await withSystem((tx) => tx.execute(sql`update refunds set last_attempt_at = now() - interval '1 hour' where idempotency_key = ${input.idempotencyKey}`));
    expect((await refundPayment(input)).status).toBe("pending");
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it("a failing lookup is not a verdict: nothing is sent, the refund waits, then follows the same escalation", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    m.lookup.mockRejectedValue(new Error("lookup down"));
    const input = adj(o.orderId);
    await refundPayment(input);
    await recoverPendingRefunds({ olderThanMs: 0 });
    expect((await refundRow(input.idempotencyKey)).status).toBe("pending");
    m.lookup.mockImplementation(async () => ({ status: "succeeded", providerRef: null })); // provider back, shows the refund
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it("a refund that was never attempted (crash between request and first send) still gets its first POST", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockRejectedValueOnce(new Error("ECONNRESET"));
    const input = adj(o.orderId);
    await refundPayment(input);
    // as if the process had died before the first send ever started
    await withSystem((tx) => tx.execute(sql`update refunds set attempts = 0, last_attempt_at = null where idempotency_key = ${input.idempotencyKey}`));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(500);
  });

  it("a definitive provider answer is unaffected: accepted-as-pending refunds are still only reconciled", async () => {
    const o = await paidOrder();
    const m = await moyasarLike();
    m.post.mockResolvedValueOnce({ status: "pending", providerRef: "rf_x" });
    const input = adj(o.orderId);
    expect((await refundPayment(input)).status).toBe("pending");
    m.lookup.mockImplementation(async () => ({ status: "succeeded", providerRef: "rf_x" }));
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(m.post).toHaveBeenCalledTimes(1);
    expect((await getMyOrder(o.c.ctx, o.orderId)).order.paymentStatus).toBe("partially_refunded");
  });
});

describe("R3: providers that PROVE refund idempotency keep the same-key retry", () => {
  it("the simulated idempotent provider replays the original refund on retry (no double money)", async () => {
    const o = await paidOrder();
    const provider = await providerFor("test");
    expect((provider as PaymentProvider & { refundIdempotency?: string }).refundIdempotency).toBe("proven");
    const real = provider.refund.bind(provider);
    vi.spyOn(provider, "refund").mockImplementationOnce(async (...a: Parameters<typeof real>) => {
      await real(...a);
      throw new Error("ETIMEDOUT");
    });
    const input = adj(o.orderId, "7.50");
    expect((await refundPayment(input)).status).toBe("pending");
    expect((await recoverPendingRefunds({ olderThanMs: 0 })).completed).toBe(1);
    expect(TestPaymentProvider.refundedMinor(o.intent.providerRef!)).toBe(750);
  });
});
