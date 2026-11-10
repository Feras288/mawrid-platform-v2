import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { allocate, AppError, conflict, dec, invalidState, money, notFound, sha256, toDb, uuidv7 } from "@platform/core";
import { env } from "@platform/core/env";
import { logger } from "@platform/core/logger";
import { nextDocNumber, withContext, withSystem, type Tx } from "@platform/db";
import { authUsers, invoices, ledgerEntries, memberships, membershipRoles, orderEvents, orderGroups, orderLines, orders, organizations, paymentAttempts, paymentIntents, paymentWebhookEvents, refunds, returnRequests, roles } from "@platform/db/schema";
import { BankTransferProvider, fromMinor, getPaymentProvider, MoyasarProvider, setPaymentProvider, TestPaymentProvider, toMinor, type FetchedPayment, type PaymentProvider, type RefundResult } from "@platform/integrations/payments";
import { isSaudiVatNumber, zatcaQrTlv } from "@platform/integrations/zatca";
import { audit } from "../audit";
import { authorize, authorizeAdmin, requireOrg, requireUser } from "../authz";
import { getSetting, isEnabled } from "../config";
import { dbCtx, systemCtx, type Ctx } from "../context";

const SYS_CTX = systemCtx();
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { settleReservation } from "../supplier-products";

/**
 * Payments: intents per order, provider adapters, signed webhooks (deduplicated, re-verified against
 * the provider), refunds, the reconciliation ledger and per-supplier tax invoices. No money is ever
 * paid out to suppliers here — `settlements.payouts` is locked off until the business model is approved.
 */


export type PaymentMethod = "card" | "bank_transfer";

// ------------------------------------------------------------------------------------------ providers

function cardProviderName(): "test" | "moyasar" | null {
  const p = env().PAYMENT_PROVIDER;
  return p === "none" ? null : p;
}

async function bankSettings() {
  const s = await getSetting<{ enabled?: boolean; bankName?: string; iban?: string; beneficiary?: string }>("payments.bank_transfer");
  return s.value ?? {};
}

export async function providerFor(name: string): Promise<PaymentProvider> {
  const existing = getPaymentProvider(name);
  if (existing) return existing;
  const e = env();
  let p: PaymentProvider;
  if (name === "test") p = new TestPaymentProvider(e.TEST_PAYMENT_WEBHOOK_SECRET ?? "", (id) => `${e.APP_URL}/checkout/pay/${id}`);
  else if (name === "moyasar") p = new MoyasarProvider({ secretKey: e.MOYASAR_SECRET_KEY, webhookSecret: e.MOYASAR_WEBHOOK_SECRET });
  else if (name === "bank_transfer") return new BankTransferProvider(await bankSettings()); // settings may change: not cached
  else throw new AppError("INTEGRATION_UNAVAILABLE", `Unknown payment provider ${name}`, { key: "payment_not_configured" });
  setPaymentProvider(p);
  return p;
}

/** Which payment methods can be offered right now (and why not). */
export async function availableMethods(): Promise<{ card: boolean; bankTransfer: boolean; cardProvider: string | null }> {
  if (!(await isEnabled("store.checkout"))) return { card: false, bankTransfer: false, cardProvider: null };
  const name = cardProviderName();
  let card = false;
  if (name) {
    try {
      card = (await providerFor(name)).isConfigured();
    } catch {
      card = false;
    }
  }
  const bank = await bankSettings();
  return { card, bankTransfer: Boolean(bank.enabled && bank.iban && bank.beneficiary), cardProvider: name };
}

// ------------------------------------------------------------------------------------------ intents

/** Create an intent for an unpaid order and hand it to the provider (call outside other transactions). */
export async function startPayment(orderId: string, locale: "ar" | "en" = "ar") {
  const { intent, order, providerName } = await withSystem(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    if (!o) throw notFound("Order");
    if (o.status !== "pending_payment" && o.status !== "payment_failed") throw invalidState("Order is not awaiting payment", { key: "order_not_payable" });
    if (o.expiresAt && o.expiresAt.getTime() < Date.now()) throw invalidState("Order expired", { key: "order_expired" });
    const providerName = o.paymentMethod === "bank_transfer" ? "bank_transfer" : cardProviderName();
    if (!providerName) throw new AppError("INTEGRATION_UNAVAILABLE", "No card payment provider configured", { key: "payment_not_configured" });
    // only one live intent per order
    await tx.update(paymentIntents).set({ status: "cancelled" }).where(and(eq(paymentIntents.orderId, o.id), inArray(paymentIntents.status, ["created", "pending"])));
    const [i] = await tx
      .insert(paymentIntents)
      .values({ orderId: o.id, userId: o.userId, orgId: o.orgId, provider: providerName, amount: o.total, currency: o.currency, status: "created", expiresAt: o.expiresAt })
      .returning();
    return { intent: i!, order: o, providerName };
  });
  const provider = await providerFor(providerName);
  const base = env().APP_URL;
  try {
    const r = await provider.createPayment({
      intentId: intent.id,
      amountMinor: toMinor(intent.amount),
      currency: intent.currency,
      description: `Order ${order.code}`,
      successUrl: `${base}/${locale}/checkout/result?order=${order.id}`,
      backUrl: `${base}/${locale}/account/orders/${order.id}`,
      callbackUrl: `${base}/api/webhooks/payments/${providerName}`,
      expiresAt: order.expiresAt,
      metadata: { order_code: order.code },
    });
    await withSystem(async (tx) => {
      await tx.update(paymentIntents).set({ providerRef: r.providerRef, status: "pending", redirectUrl: r.redirectUrl, instructions: r.instructions ?? null }).where(eq(paymentIntents.id, intent.id));
      await tx.update(orders).set({ paymentStatus: "pending", status: "pending_payment" }).where(eq(orders.id, order.id));
      await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "create", status: "pending", detail: { providerRef: r.providerRef } });
    });
    return { intentId: intent.id, redirectUrl: r.redirectUrl, instructions: r.instructions ?? null };
  } catch (e) {
    const reason = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await withSystem(async (tx) => {
      await tx.update(paymentIntents).set({ status: "failed", failureReason: reason }).where(eq(paymentIntents.id, intent.id));
      await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "create", status: "failed", detail: { error: reason } });
    });
    throw e instanceof AppError ? e : new AppError("INTEGRATION_FAILED", "Payment provider unavailable", { key: "payment_provider", cause: e });
  }
}

/** Customer retries payment for an unpaid, unexpired order. */
export async function retryPayment(ctx: Ctx, orderId: string, locale: "ar" | "en" = "ar") {
  requireUser(ctx);
  const [o] = await withContext(dbCtx(ctx), (tx) => tx.select().from(orders).where(eq(orders.id, orderId)).limit(1));
  if (!o) throw notFound("Order");
  return startPayment(orderId, locale);
}

// ------------------------------------------------------------------------------------------ webhooks & sync

/** A 'received' event whose last attempt is older than this is considered abandoned (worker crashed). */
export const WEBHOOK_LEASE_MS = 5 * 60_000;

/**
 * Take responsibility for processing a provider event. Returns the row id when this call should process it:
 * a first delivery, a redelivery of an event whose earlier processing FAILED, or one stranded in 'received'
 * past its lease. Returns null for events that are processed, ignored or being processed right now. The
 * re-claim is a single conditional UPDATE, so concurrent redeliveries cannot both win.
 */
async function claimWebhookEvent(providerName: string, ev: { eventId: string; type: string; raw: Record<string, unknown> }): Promise<string | null> {
  return withSystem(async (tx) => {
    const inserted = await tx.insert(paymentWebhookEvents).values({ provider: providerName, eventId: ev.eventId, eventType: ev.type, signatureValid: true, payload: ev.raw }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
    if (inserted.length) return inserted[0]!.id;
    const reclaimed = await tx
      .update(paymentWebhookEvents)
      .set({ status: "received", error: null, processedAt: null, attempts: sql`${paymentWebhookEvents.attempts} + 1`, lastAttemptAt: sql`now()` })
      .where(
        and(
          eq(paymentWebhookEvents.provider, providerName),
          eq(paymentWebhookEvents.eventId, ev.eventId),
          eq(paymentWebhookEvents.signatureValid, true),
          or(eq(paymentWebhookEvents.status, "failed"), and(eq(paymentWebhookEvents.status, "received"), sql`${paymentWebhookEvents.lastAttemptAt} <= now() - (${WEBHOOK_LEASE_MS}::double precision * interval '1 millisecond')`)),
        ),
      )
      .returning({ id: paymentWebhookEvents.id });
    return reclaimed[0]?.id ?? null;
  });
}

export async function processWebhook(providerName: string, rawBody: string, headers: Headers): Promise<{ status: number; result: string }> {
  if (!["test", "moyasar"].includes(providerName)) return { status: 404, result: "unknown_provider" };
  const provider = await providerFor(providerName);
  const ev = provider.parseWebhook(rawBody, headers);
  if (!ev) {
    await withSystem((tx) =>
      tx
        .insert(paymentWebhookEvents)
        .values({ provider: providerName, eventId: `invalid:${sha256(rawBody)}`, signatureValid: false, payload: { size: rawBody.length }, status: "ignored", error: "invalid_signature" })
        .onConflictDoNothing(),
    );
    return { status: 401, result: "invalid_signature" };
  }
  const eventRowId = await claimWebhookEvent(providerName, ev);
  if (!eventRowId) return { status: 200, result: "duplicate" };
  try {
    if (!ev.providerRef) throw new Error("missing payment reference");
    const [intent] = await withSystem((tx) => tx.select().from(paymentIntents).where(and(eq(paymentIntents.provider, providerName), eq(paymentIntents.providerRef, ev.providerRef!))).limit(1));
    if (!intent) {
      await withSystem((tx) => tx.update(paymentWebhookEvents).set({ status: "ignored", error: "unknown_reference", processedAt: new Date() }).where(eq(paymentWebhookEvents.id, eventRowId)));
      return { status: 200, result: "ignored" };
    }
    // never trust the webhook body for state: re-fetch from the provider
    const fetched = await provider.fetchPayment(ev.providerRef);
    const outcome = await applyProviderStatus(intent.id, fetched, "webhook");
    await withSystem((tx) => tx.update(paymentWebhookEvents).set({ status: "processed", processedAt: new Date() }).where(eq(paymentWebhookEvents.id, eventRowId)));
    return { status: 200, result: outcome };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await withSystem((tx) => tx.update(paymentWebhookEvents).set({ status: "failed", error: msg.slice(0, 500), processedAt: new Date() }).where(eq(paymentWebhookEvents.id, eventRowId)));
    // 500 makes the provider retry; the event row is kept for inspection
    return { status: 500, result: "failed" };
  }
}

/** Customer-side status check on return from the hosted page (in case the webhook is late). */
export async function syncOrderPayment(ctx: Ctx, orderId: string) {
  requireUser(ctx);
  const [o] = await withContext(dbCtx(ctx), (tx) => tx.select().from(orders).where(eq(orders.id, orderId)).limit(1));
  if (!o) throw notFound("Order");
  const [intent] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.orderId, orderId)).orderBy(desc(paymentIntents.createdAt)).limit(1));
  if (!intent || intent.status !== "pending" || !intent.providerRef || intent.provider === "bank_transfer") return intent?.status ?? null;
  const provider = await providerFor(intent.provider);
  const fetched = await provider.fetchPayment(intent.providerRef);
  await applyProviderStatus(intent.id, fetched, "sync");
  const [after] = await withSystem((tx) => tx.select({ status: paymentIntents.status }).from(paymentIntents).where(eq(paymentIntents.id, intent.id)).limit(1));
  return after?.status ?? null;
}

async function supplierUserIds(tx: Tx, orgId: string, perm: string) {
  const rows = await tx
    .selectDistinct({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), sql`${perm} = any(${roles.permissions})`));
  return rows.map((r) => r.userId);
}

/**
 * Apply an authoritative provider status to an intent and its order. Idempotent; amount and currency
 * must match the intent exactly or the payment is flagged for manual review (never marked paid).
 *
 * Lock order (shared with refunds): order → payment intent → refund → group. Holding the order lock for
 * the whole decision serialises concurrent notifications for different intents of the same order, so
 * exactly one capture becomes the order's payment and any further capture is flagged as a duplicate
 * (`duplicate_of`) and refunded in full. The refund request is written in the same transaction as the
 * classification; the provider call happens after commit and is recoverable (see `executeRefund`).
 */
export async function applyProviderStatus(intentId: string, f: FetchedPayment, source: string): Promise<string> {
  let refundAfter: string | null = null;
  const outcome = await withSystem(async (tx) => {
    const [i0] = await tx.select({ orderId: paymentIntents.orderId }).from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    if (!i0) throw notFound("Payment intent");
    const [o] = await tx.select().from(orders).where(eq(orders.id, i0.orderId)).limit(1).for("update");
    if (!o) throw notFound("Order");
    const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1).for("update");
    if (!i) throw notFound("Payment intent");
    await tx.insert(paymentAttempts).values({ intentId, kind: source, status: f.status, detail: { amountMinor: f.amountMinor, currency: f.currency, paymentId: f.paymentId } });
    if (i.status === "succeeded" || i.status === f.status) return "noop";
    if (f.status === "pending") return "pending";
    if (f.status !== "succeeded") {
      const st = f.status === "expired" ? "expired" : f.status === "cancelled" ? "cancelled" : "failed";
      await tx.update(paymentIntents).set({ status: st, failureReason: f.failureReason ?? f.status }).where(eq(paymentIntents.id, i.id));
      if (o.paymentStatus !== "paid") {
        // a superseded intent ending badly must not fail an order that another intent can still pay
        const [other] = await tx
          .select({ id: paymentIntents.id })
          .from(paymentIntents)
          .where(and(eq(paymentIntents.orderId, o.id), ne(paymentIntents.id, i.id), inArray(paymentIntents.status, ["created", "pending", "succeeded"])))
          .limit(1);
        if (!other) {
          await tx.update(orders).set({ paymentStatus: "failed", status: o.status === "pending_payment" ? "payment_failed" : o.status }).where(eq(orders.id, o.id));
          await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "payment_failed", data: { reason: f.failureReason ?? f.status } });
        }
      }
      return st;
    }
    if (f.amountMinor !== toMinor(i.amount) || f.currency !== i.currency) {
      await tx.update(paymentIntents).set({ status: "failed", failureReason: "amount_mismatch" }).where(eq(paymentIntents.id, i.id));
      await audit(SYS_CTX, { action: "payment.amount_mismatch", entityType: "payment_intent", entityId: i.id, orgId: o.orgId, data: { expected: i.amount, received: fromMinor(f.amountMinor), currency: f.currency } }, tx);
      return "amount_mismatch";
    }
    const [primary] = await tx
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(and(eq(paymentIntents.orderId, o.id), eq(paymentIntents.status, "succeeded"), isNull(paymentIntents.duplicateOf), ne(paymentIntents.id, i.id)))
      .limit(1);
    if (primary) {
      // the order is already paid by another capture: this money must go back, and must not touch the books
      await tx.update(paymentIntents).set({ status: "succeeded", succeededAt: new Date(), providerPaymentId: f.paymentId ?? i.providerRef, duplicateOf: primary.id }).where(eq(paymentIntents.id, i.id));
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "duplicate_payment", data: { intentId: i.id, primaryIntentId: primary.id, amount: i.amount } });
      await audit(SYS_CTX, { action: "payment.duplicate_capture", entityType: "payment_intent", entityId: i.id, orgId: o.orgId, data: { orderId: o.id, primaryIntentId: primary.id, amount: i.amount, provider: i.provider } }, tx);
      refundAfter = (await requestRefund(tx, { orderId: o.id, groupId: null, intentId: i.id, amount: i.amount, reason: "duplicate_payment", idempotencyKey: `dup:${i.id}`, actorUserId: null })).refund.id;
      return "refund_duplicate_payment";
    }
    await tx.update(paymentIntents).set({ status: "succeeded", succeededAt: new Date(), providerPaymentId: f.paymentId ?? i.providerRef }).where(eq(paymentIntents.id, i.id));
    if (o.status === "expired" || o.status === "cancelled") {
      // paid after expiry: goods are no longer reserved → refund automatically
      await tx.update(orders).set({ paymentStatus: "paid" }).where(eq(orders.id, o.id));
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "paid_after_expiry" });
      refundAfter = (await requestRefund(tx, { orderId: o.id, groupId: null, amount: i.amount, reason: "late_payment", idempotencyKey: `late:${intentId}`, actorUserId: null })).refund.id;
      return "refund_late_payment";
    }
    await markOrderPaid(tx, o);
    return "succeeded";
  });
  if (refundAfter) {
    try {
      await executeRefund(refundAfter);
    } catch (err) {
      // the refund request is durable; the recovery job finishes it. The payment itself is already applied.
      logger.error({ err, refundId: refundAfter }, "refund execution failed after payment classification");
    }
  }
  return outcome;
}

async function markOrderPaid(tx: Tx, o: typeof orders.$inferSelect) {
  const now = new Date();
  await tx.update(orders).set({ status: "placed", paymentStatus: "paid", placedAt: now }).where(eq(orders.id, o.id));
  const groups = await tx.update(orderGroups).set({ status: "confirmed", confirmedAt: now }).where(and(eq(orderGroups.orderId, o.id), eq(orderGroups.status, "awaiting_payment"))).returning();
  await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "paid" });
  const [buyer] = await tx.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, o.userId)).limit(1);
  for (const g of groups) {
    await postJournal(tx, o, g, "payment", [
      { account: "platform_clearing", debit: g.total },
      { account: "supplier_payable", credit: g.supplierPayable },
      { account: "commission_revenue", credit: g.commissionNet },
      { account: "vat_payable", credit: g.commissionVat },
    ]);
    await issueInvoice(tx, o, g, buyer?.name ?? null);
    await tx.insert(orderEvents).values({ orderId: o.id, groupId: g.id, userId: o.userId, orgId: o.orgId, supplierOrgId: g.supplierOrgId, kind: "confirmed" });
    const users = await supplierUserIds(tx, g.supplierOrgId, "supplier.orders.view");
    await notifyUsers({ userIds: users, kind: "order.new_for_supplier", params: { orderNumber: g.code, total: `${g.total} SAR` }, link: `/supplier/orders/${g.id}`, orgId: g.supplierOrgId, dedupeKey: `order-new:${g.id}`, email: true }, tx);
  }
  await notifyUsers({ userIds: [o.userId], kind: "order.confirmed", params: { orderNumber: o.code, total: `${o.total} SAR` }, link: `/account/orders/${o.id}`, dedupeKey: `order-paid:${o.id}`, email: true }, tx);
  await emit({ topic: "store.order_paid", aggregateType: "order", aggregateId: o.id, orgId: o.orgId, payload: { orderId: o.id }, dedupeKey: `order-paid:${o.id}` }, tx);
}

// ------------------------------------------------------------------------------------------ ledger

type Leg = { account: "platform_clearing" | "supplier_payable" | "commission_revenue" | "vat_payable"; debit?: string; credit?: string };

async function postJournal(tx: Tx, o: { id: string; currency: string }, g: { id: string; supplierOrgId: string } | null, memo: string, legs: Leg[]) {
  const rows = legs.filter((l) => dec(l.debit ?? 0).gt(0) || dec(l.credit ?? 0).gt(0));
  const dr = rows.reduce((a, l) => a.plus(dec(l.debit ?? 0)), dec(0));
  const cr = rows.reduce((a, l) => a.plus(dec(l.credit ?? 0)), dec(0));
  if (!dr.eq(cr)) throw new AppError("INTERNAL", `Unbalanced journal ${memo}: ${dr.toFixed(2)} != ${cr.toFixed(2)}`);
  if (!rows.length) return;
  const journalId = uuidv7();
  await tx.insert(ledgerEntries).values(
    rows.map((l) => ({ journalId, orderId: o.id, groupId: g?.id ?? null, supplierOrgId: g?.supplierOrgId ?? null, account: l.account, debit: toDb(l.debit ?? 0), credit: toDb(l.credit ?? 0), currency: o.currency, memo })),
  );
}

/** Supplier balance (reconciliation view only — no payouts are executed). */
export async function supplierBalance(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.orders.view");
  const [r] = await withSystem((tx) =>
    tx
      .select({ credit: sql<string>`coalesce(sum(${ledgerEntries.credit}),0)::text`, debit: sql<string>`coalesce(sum(${ledgerEntries.debit}),0)::text` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.supplierOrgId, ctx.orgId), eq(ledgerEntries.account, "supplier_payable"))),
  );
  const payoutsEnabled = await isEnabled("settlements.payouts");
  return { payable: toDb(dec(r?.credit ?? 0).minus(dec(r?.debit ?? 0))), payoutsEnabled };
}

/** Payouts are deliberately not implemented until the settlement model is approved (DEC-01/02). */
export async function requestPayout(ctx: Ctx): Promise<never> {
  requireOrg(ctx, "supplier");
  if (!(await isEnabled("settlements.payouts"))) throw invalidState("Payouts are disabled", { key: "payouts_disabled" });
  throw new AppError("INTEGRATION_UNAVAILABLE", "Payout execution is not implemented pending the settlement model decision", { key: "payouts_disabled" });
}

/** Admin: platform-level balances per account and the trial-balance check. */
export async function ledgerSummary(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.finance");
  const rows = await withSystem((tx) =>
    tx
      .select({ account: ledgerEntries.account, debit: sql<string>`sum(${ledgerEntries.debit})::text`, credit: sql<string>`sum(${ledgerEntries.credit})::text` })
      .from(ledgerEntries)
      .groupBy(ledgerEntries.account),
  );
  const dr = rows.reduce((a, r) => a.plus(dec(r.debit)), dec(0));
  const cr = rows.reduce((a, r) => a.plus(dec(r.credit)), dec(0));
  return { accounts: rows, balanced: dr.eq(cr), totalDebit: toDb(dr), totalCredit: toDb(cr) };
}

// ------------------------------------------------------------------------------------------ invoices

async function issueInvoice(tx: Tx, o: typeof orders.$inferSelect, g: typeof orderGroups.$inferSelect, buyerName: string | null, credit?: { amount: string; originalId: string }) {
  const [sup] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn, vat: organizations.vatNumber }).from(organizations).where(eq(organizations.id, g.supplierOrgId)).limit(1);
  const seller = sup?.nameAr || sup?.nameEn || "";
  const issuedAt = new Date();
  let net: string, vat: string, total: string;
  if (credit) {
    // split the credited gross amount into net/VAT in the group's proportion
    const groupVat = dec(g.goodsVat).plus(dec(g.shippingVat));
    const [v, n] = allocate(credit.amount, [groupVat, dec(g.total).minus(groupVat)]);
    vat = toDb(v!);
    net = toDb(n!);
    total = toDb(credit.amount);
  } else {
    net = toDb(dec(g.goodsNet).plus(dec(g.shippingNet)));
    vat = toDb(dec(g.goodsVat).plus(dec(g.shippingVat)));
    total = g.total;
  }
  const number = await nextDocNumber(tx, g.supplierOrgId, credit ? "credit_note" : "invoice", credit ? "CN" : "INV", issuedAt);
  const qr = zatcaQrTlv({ sellerName: seller.slice(0, 120), vatNumber: sup?.vat ?? "", timestamp: issuedAt, total, vatTotal: vat });
  await tx.insert(invoices).values({
    number,
    kind: credit ? "credit_note" : isSaudiVatNumber(o.buyerVatNumber) ? "standard" : "simplified",
    orderId: o.id,
    groupId: g.id,
    userId: o.userId,
    orgId: o.orgId,
    supplierOrgId: g.supplierOrgId,
    sellerName: seller,
    sellerVatNumber: sup?.vat ?? null,
    buyerName: o.buyerName ?? buyerName,
    buyerVatNumber: o.buyerVatNumber,
    issuedAt,
    netTotal: net,
    vatTotal: vat,
    total,
    qrTlv: qr,
    originalInvoiceId: credit?.originalId ?? null,
  });
}

// ------------------------------------------------------------------------------------------ refunds

export interface RefundInput {
  orderId: string;
  groupId: string | null;
  amount: string;
  reason: "cancellation" | "return" | "adjustment" | "late_payment" | "duplicate_payment";
  idempotencyKey: string;
  actorUserId: string | null;
  /** refund a specific captured intent (duplicate captures); default: the order's primary capture */
  intentId?: string;
}

/** Minimum time between provider attempts for one refund, and attempts before finance takes over. */
export const REFUND_RETRY_AFTER_MS = 60_000;
export const REFUND_MAX_ATTEMPTS = 6;
/** A refund the provider accepted but never confirmed within this window is handed to finance (manual_required). */
export const REFUND_CONFIRM_MAX_AGE_MS = 48 * 3_600_000;
/**
 * A refund sent to a provider WITHOUT proven refund idempotency whose outcome is unknown (call failed, timed out, process
 * died) is only reconciled by reading the payment — never re-sent. If the read does not show it within this window it is
 * handed to finance (manual_required, `outcome_unknown`).
 */
export const REFUND_UNKNOWN_OUTCOME_MAX_AGE_MS = 30 * 60_000;

const resendIsSafe = (p: PaymentProvider) => p.refundIdempotency === "proven";

/**
 * Record a refund request (idempotent per key). Bounded by what was captured and not yet refunded, per
 * intent and per supplier group, including refunds still in flight. Runs in the caller's transaction and
 * locks order → intent → group so it can be composed with payment classification without deadlocks.
 */
async function requestRefund(tx: Tx, input: RefundInput): Promise<{ refund: typeof refunds.$inferSelect; created: boolean }> {
  const amt = money(input.amount);
  if (amt.lte(0)) throw invalidState("Refund amount must be positive", { key: "refund_invalid" });
  const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update");
  if (!o) throw notFound("Order");
  // checked under the order lock: concurrent callers with one key queue here and then see the first one's row
  const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing) return { refund: existing, created: false };
  const intentFilter = input.intentId
    ? and(eq(paymentIntents.id, input.intentId), eq(paymentIntents.orderId, o.id), eq(paymentIntents.status, "succeeded"))
    : and(eq(paymentIntents.orderId, o.id), eq(paymentIntents.status, "succeeded"), isNull(paymentIntents.duplicateOf));
  const [i] = await tx.select().from(paymentIntents).where(intentFilter).limit(1).for("update");
  if (!i) throw invalidState("Order has no captured payment", { key: "refund_not_paid" });
  const inFlight = ["pending", "manual_required"];
  const pendingSum = await tx.select({ s: sql<string>`coalesce(sum(${refunds.amount}),0)::text` }).from(refunds).where(and(eq(refunds.intentId, i.id), inArray(refunds.status, inFlight)));
  const capacity = dec(i.amount).minus(dec(i.refundedAmount)).minus(dec(pendingSum[0]?.s ?? 0));
  if (amt.gt(capacity)) throw invalidState("Refund exceeds the refundable amount", { key: "refund_exceeds", details: { refundable: toDb(capacity) } });
  let g: typeof orderGroups.$inferSelect | undefined;
  if (input.groupId) {
    [g] = await tx.select().from(orderGroups).where(and(eq(orderGroups.id, input.groupId), eq(orderGroups.orderId, o.id))).limit(1).for("update");
    if (!g) throw notFound("Order group");
    const groupPending = await tx.select({ s: sql<string>`coalesce(sum(${refunds.amount}),0)::text` }).from(refunds).where(and(eq(refunds.groupId, g.id), inArray(refunds.status, inFlight)));
    if (amt.gt(dec(g.total).minus(dec(g.refundedTotal)).minus(dec(groupPending[0]?.s ?? 0)))) throw invalidState("Refund exceeds the supplier group total", { key: "refund_exceeds" });
  }
  const [r] = await tx
    .insert(refunds)
    .values({ orderId: o.id, groupId: g?.id ?? null, intentId: i.id, userId: o.userId, orgId: o.orgId, supplierOrgId: g?.supplierOrgId ?? null, amount: toDb(amt), reason: input.reason, idempotencyKey: input.idempotencyKey, requestedBy: input.actorUserId })
    .returning();
  return { refund: r!, created: true };
}

/**
 * Refund (part of) a captured payment. The request is committed first, then the provider is called;
 * balances and the ledger move only when the provider confirms. Never fails because the provider is
 * unreachable: the refund stays `pending`, is retried by `recoverPendingRefunds` (or by calling this
 * again with the same key) using the same idempotency key, and moves to `manual_required` once the
 * attempt budget is spent. Bank-transfer refunds require a manual, audited confirmation.
 */
export async function refundPayment(input: RefundInput): Promise<{ refundId: string; status: string }> {
  const { refund } = await withSystem((tx) => requestRefund(tx, input));
  if (refund.status !== "pending") return { refundId: refund.id, status: refund.status };
  return executeRefund(refund.id);
}

/**
 * One provider attempt for a pending refund. The attempt is claimed with a conditional UPDATE (lease), so
 * concurrent callers, retries and the recovery job never call the provider at the same time, and a refund
 * the provider already acknowledged (provider_ref set) is never re-sent. A failed or timed-out call has an
 * unknown outcome; retrying with the same idempotency key is safe at the provider, so the refund simply
 * stays pending.
 */
async function executeRefund(refundId: string, opts: { leaseMs?: number; maxAttempts?: number } = {}): Promise<{ refundId: string; status: string }> {
  const leaseMs = opts.leaseMs ?? REFUND_RETRY_AFTER_MS;
  const maxAttempts = opts.maxAttempts ?? REFUND_MAX_ATTEMPTS;
  const [pre] = await withSystem((tx) => tx.select({ intent: paymentIntents }).from(refunds).innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId)).where(eq(refunds.id, refundId)).limit(1));
  if (!pre) throw notFound("Refund");
  const intent = pre.intent;
  const provider: PaymentProvider | null = await providerFor(intent.provider).catch(() => null);
  // Without PROVEN refund idempotency only the very first send is allowed (attempts = 0); every later look is a read.
  const firstSendOnly = !provider || !resendIsSafe(provider);
  const claimed = await withSystem(async (tx) => {
    const rows = await tx
      .update(refunds)
      .set({ attempts: sql`${refunds.attempts} + 1`, lastAttemptAt: sql`now()` })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, "pending"), isNull(refunds.providerRef), firstSendOnly ? eq(refunds.attempts, 0) : undefined, sql`(${refunds.lastAttemptAt} is null or ${refunds.lastAttemptAt} <= now() - (${leaseMs}::double precision * interval '1 millisecond'))`))
      .returning();
    return rows[0] ?? null;
  });
  if (!claimed) {
    const [cur] = await withSystem((tx) => tx.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, refundId)).limit(1));
    return { refundId, status: cur?.status ?? "pending" };
  }
  let res: RefundResult;
  try {
    res = await (provider ?? (await providerFor(intent.provider))).refund(intent.providerPaymentId ?? intent.providerRef ?? "", toMinor(claimed.amount), claimed.idempotencyKey);
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 300) : String(e);
    // proven-idempotent provider: retry with the same key until the attempt budget is spent.
    // otherwise: the request may or may not have been executed — keep it pending for READ-ONLY reconciliation, never re-send.
    const exhausted = !firstSendOnly && claimed.attempts >= maxAttempts;
    await withSystem(async (tx) => {
      await tx
        .update(refunds)
        .set({ failureReason: firstSendOnly ? "outcome_unknown" : "provider_unreachable", ...(exhausted ? { status: "manual_required" } : {}) })
        .where(and(eq(refunds.id, claimed.id), eq(refunds.status, "pending")));
      await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "refund", status: exhausted ? "manual_required" : "error", detail: { refundId: claimed.id, attempt: claimed.attempts, error: detail, outcome: firstSendOnly ? "unknown" : "retryable" } });
      if (exhausted) await audit(SYS_CTX, { action: "refund.escalated", entityType: "refund", entityId: claimed.id, orgId: claimed.orgId, data: { attempts: claimed.attempts, reason: "provider_unreachable" } }, tx);
    });
    return { refundId: claimed.id, status: exhausted ? "manual_required" : "pending" };
  }
  if (res.status === "succeeded") {
    await completeRefund(claimed.id, res.providerRef);
    return { refundId: claimed.id, status: "succeeded" };
  }
  const status = res.failureReason === "manual_refund_required" ? "manual_required" : res.status === "pending" ? "pending" : "failed";
  await withSystem(async (tx) => {
    await tx.update(refunds).set({ status, failureReason: res.failureReason ?? null, providerRef: res.providerRef }).where(and(eq(refunds.id, claimed.id), eq(refunds.status, "pending")));
    await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "refund", status, detail: { refundId: claimed.id, reason: res.failureReason ?? null } });
  });
  return { refundId: claimed.id, status };
}

/**
 * Reconcile one refund the provider ACCEPTED as pending (provider_ref set) by reading its status from the provider.
 * Read-only towards the provider: the refund is never sent again. Safeguards:
 * - the check is claimed with the same lease as other attempts (concurrent sweeps do not double-process);
 * - refunds of one payment are reconciled oldest first, and only when no older refund of that payment is still
 *   pending or manual_required — otherwise a cumulative provider total could be credited to the wrong refund;
 * - `succeeded` goes through `completeRefund` (idempotent, order → intent → refund locks); `failed` is applied only
 *   when the provider reports a rejection; anything else stays pending until the confirmation window passes.
 */
async function reconcileAcknowledgedRefund(refundId: string, opts: { leaseMs: number; maxAgeMs: number; unknownMaxAgeMs: number }): Promise<"succeeded" | "failed" | "pending" | "manual_required" | "skipped"> {
  const claimed = await withSystem(async (tx) => {
    const rows = await tx
      .update(refunds)
      .set({ lastAttemptAt: sql`now()` })
      .where(
        and(
          eq(refunds.id, refundId),
          eq(refunds.status, "pending"),
          or(isNotNull(refunds.providerRef), sql`${refunds.attempts} >= 1`),
          sql`(${refunds.lastAttemptAt} is null or ${refunds.lastAttemptAt} <= now() - (${opts.leaseMs}::double precision * interval '1 millisecond'))`,
          sql`not exists (select 1 from refunds o where o.intent_id = ${refunds.intentId} and o.status in ('pending','manual_required') and (o.created_at, o.id) < (${refunds.createdAt}, ${refunds.id}))`,
        ),
      )
      .returning();
    return rows[0] ?? null;
  });
  if (!claimed) return "skipped";
  const [intent] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, claimed.intentId!)).limit(1));
  if (!intent) throw notFound("Payment");
  const provider = await providerFor(intent.provider);
  let res: RefundResult | null = null;
  if (provider.fetchRefund) {
    try {
      res = await provider.fetchRefund({
        paymentId: intent.providerPaymentId ?? intent.providerRef ?? "",
        providerRef: claimed.providerRef,
        amountMinor: toMinor(claimed.amount),
        refundedBeforeMinor: toMinor(intent.refundedAmount),
        idempotencyKey: claimed.idempotencyKey,
      });
    } catch (e) {
      await withSystem((tx) => tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "refund_lookup", status: "error", detail: { refundId: claimed.id, error: e instanceof Error ? e.message.slice(0, 300) : String(e) } }));
    }
  }
  if (res?.status === "succeeded") {
    await completeRefund(claimed.id, res.providerRef ?? claimed.providerRef);
    return "succeeded";
  }
  if (res?.status === "failed") {
    const failure = res.failureReason ?? "rejected_by_provider";
    await withSystem(async (tx) => {
      await tx.update(refunds).set({ status: "failed", failureReason: failure, processedAt: new Date() }).where(and(eq(refunds.id, claimed.id), eq(refunds.status, "pending")));
      await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "refund_lookup", status: "failed", detail: { refundId: claimed.id, reason: failure } });
    });
    return "failed";
  }
  const acknowledged = claimed.providerRef != null;
  if (Date.now() - claimed.createdAt.getTime() >= (acknowledged ? opts.maxAgeMs : opts.unknownMaxAgeMs)) {
    const reason = acknowledged ? "provider_unconfirmed" : "outcome_unknown";
    await withSystem(async (tx) => {
      await tx.update(refunds).set({ status: "manual_required", failureReason: reason }).where(and(eq(refunds.id, claimed.id), eq(refunds.status, "pending")));
      await audit(SYS_CTX, { action: "refund.escalated", entityType: "refund", entityId: claimed.id, orgId: claimed.orgId, data: { reason, providerRef: claimed.providerRef } }, tx);
    });
    return "manual_required";
  }
  return "pending";
}

/**
 * Job, two kinds of unfinished refunds:
 * 1. outcome unknown (no provider_ref: the call failed or the process died) → retried with the same idempotency key;
 * 2. accepted by the provider as pending (provider_ref set) → reconciled by reading the provider, never re-sent.
 * Both honour the lease `olderThanMs` and escalate to manual_required (attempt budget / confirmation window).
 */
export async function recoverPendingRefunds(opts: { olderThanMs?: number; maxAttempts?: number; confirmMaxAgeMs?: number; unknownMaxAgeMs?: number; limit?: number } = {}): Promise<{ examined: number; completed: number; failed: number; stillPending: number; escalated: number }> {
  const olderThanMs = opts.olderThanMs ?? REFUND_RETRY_AFTER_MS * 2;
  const idle = sql`coalesce(${refunds.lastAttemptAt}, ${refunds.createdAt}) <= now() - (${olderThanMs}::double precision * interval '1 millisecond')`;
  const due = await withSystem((tx) =>
    tx
      .select({ id: refunds.id, acknowledged: sql<boolean>`${refunds.providerRef} is not null`, attempts: refunds.attempts, provider: paymentIntents.provider })
      .from(refunds)
      .innerJoin(paymentIntents, eq(paymentIntents.id, refunds.intentId))
      .where(and(eq(refunds.status, "pending"), idle))
      .orderBy(refunds.createdAt, refunds.id)
      .limit(opts.limit ?? 100),
  );
  const out = { examined: due.length, completed: 0, failed: 0, stillPending: 0, escalated: 0 };
  const tally = (status: string) => {
    if (status === "succeeded") out.completed++;
    else if (status === "failed") out.failed++;
    else if (status === "manual_required") out.escalated++;
    else out.stillPending++;
  };
  for (const { id, acknowledged, attempts, provider } of due) {
    try {
      // accepted by the provider, or already sent once to a provider without proven refund idempotency → read-only reconciliation
      const safeToResend = await providerFor(provider).then(resendIsSafe, () => false);
      const reconcile = acknowledged || (attempts >= 1 && !safeToResend);
      const status = reconcile
        ? await reconcileAcknowledgedRefund(id, { leaseMs: olderThanMs, maxAgeMs: opts.confirmMaxAgeMs ?? REFUND_CONFIRM_MAX_AGE_MS, unknownMaxAgeMs: opts.unknownMaxAgeMs ?? REFUND_UNKNOWN_OUTCOME_MAX_AGE_MS })
        : (await executeRefund(id, { leaseMs: olderThanMs, maxAttempts: opts.maxAttempts })).status;
      tally(status);
    } catch (err) {
      out.stillPending++;
      logger.error({ err, refundId: id }, "refund recovery failed");
    }
  }
  return out;
}

/** Apply a confirmed refund to balances, ledger and a credit note. Idempotent. */
export async function completeRefund(refundId: string, providerRef: string | null, actor?: Ctx) {
  if (actor) authorizeAdmin(actor, "admin.finance");
  await withSystem(async (tx) => {
    const [r0] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1);
    if (!r0) throw notFound("Refund");
    // lock order: order → intent → refund (same as payment classification and refund requests)
    const [o] = await tx.select().from(orders).where(eq(orders.id, r0.orderId)).limit(1).for("update");
    const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, r0.intentId!)).limit(1).for("update");
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1).for("update");
    if (!r) throw notFound("Refund");
    if (r.status === "succeeded") return;
    if (r.status === "failed") throw invalidState("Refund failed", { key: "refund_failed" });
    if (!i || !o) throw notFound("Payment");
    await tx.update(refunds).set({ status: "succeeded", providerRef: providerRef ?? r.providerRef, failureReason: null, processedAt: new Date() }).where(eq(refunds.id, r.id));
    await tx.update(paymentIntents).set({ refundedAmount: toDb(dec(i.refundedAmount).plus(dec(r.amount))) }).where(eq(paymentIntents.id, i.id));
    if (r.reason === "duplicate_payment") {
      // the extra capture was never booked: only the customer's money moves, balances and the ledger stay as they are
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "duplicate_payment_refunded", data: { amount: r.amount, intentId: i.id } });
      await notifyUsers({ userIds: [o.userId], kind: "order.status_changed", params: { orderNumber: o.code, supplierName: "", status: `refund ${r.amount} SAR` }, link: `/account/orders/${o.id}`, dedupeKey: `refund:${r.id}`, email: true }, tx);
      if (actor) await audit(actor, { action: "refund.manual_completed", entityType: "refund", entityId: r.id, orgId: o.orgId, data: { amount: r.amount } }, tx);
      return;
    }
    const orderRefunded = dec(o.refundedTotal).plus(dec(r.amount));
    await tx.update(orders).set({ refundedTotal: toDb(orderRefunded), paymentStatus: orderRefunded.gte(dec(o.total)) ? "refunded" : "partially_refunded" }).where(eq(orders.id, o.id));
    // allocate the refund over the groups it concerns (the named group, else pro rata over all groups)
    const groups = r.groupId ? await tx.select().from(orderGroups).where(eq(orderGroups.id, r.groupId)) : await tx.select().from(orderGroups).where(eq(orderGroups.orderId, o.id));
    const parts = allocate(r.amount, groups.map((g) => dec(g.total).minus(dec(g.refundedTotal)).gt(0) ? dec(g.total).minus(dec(g.refundedTotal)) : dec(0)));
    const [orig] = await tx.select().from(invoices).where(and(eq(invoices.orderId, o.id), sql`${invoices.kind} <> 'credit_note'`)).limit(1);
    for (const [idx, g] of groups.entries()) {
      const part = parts[idx]!;
      if (part.lte(0)) continue;
      await tx.update(orderGroups).set({ refundedTotal: toDb(dec(g.refundedTotal).plus(part)) }).where(eq(orderGroups.id, g.id));
      // Reverse payable and commission in the group's proportion — but only what was actually booked. A payment that
      // arrived after the order expired (late_payment) is refunded without ever being posted: no supplier payable,
      // commission or VAT was recognised, so there is nothing to reverse, and posting the legs would drive the
      // supplier balance negative. The customer-facing refund state above is unaffected.
      const [booked] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.groupId, g.id), eq(ledgerEntries.memo, "payment"))).limit(1);
      if (booked) {
        const [payable, commNet, commVat] = allocate(part, [g.supplierPayable, g.commissionNet, g.commissionVat]);
        await postJournal(tx, o, g, `refund:${r.reason}`, [
          { account: "supplier_payable", debit: toDb(payable!) },
          { account: "commission_revenue", debit: toDb(commNet!) },
          { account: "vat_payable", debit: toDb(commVat!) },
          { account: "platform_clearing", credit: toDb(part) },
        ]);
      }
      const [gInv] = await tx.select().from(invoices).where(and(eq(invoices.groupId, g.id), sql`${invoices.kind} <> 'credit_note'`)).limit(1);
      if (gInv ?? orig) await issueInvoice(tx, o, g, null, { amount: toDb(part), originalId: (gInv ?? orig)!.id });
    }
    await tx.insert(orderEvents).values({ orderId: o.id, groupId: r.groupId, userId: o.userId, orgId: o.orgId, supplierOrgId: r.supplierOrgId, kind: "refunded", data: { amount: r.amount, reason: r.reason } });
    await notifyUsers({ userIds: [o.userId], kind: "order.status_changed", params: { orderNumber: o.code, supplierName: "", status: `refund ${r.amount} SAR` }, link: `/account/orders/${o.id}`, dedupeKey: `refund:${r.id}`, email: true }, tx);
    if (r.reason === "return" && r.idempotencyKey.startsWith("return:")) {
      // a return whose refund completed later (recovery job / manual confirmation) is now refunded
      await tx.update(returnRequests).set({ status: "refunded", refundId: r.id }).where(and(eq(returnRequests.id, r.idempotencyKey.slice("return:".length)), inArray(returnRequests.status, ["received", "approved"])));
    }
    if (actor) await audit(actor, { action: "refund.manual_completed", entityType: "refund", entityId: r.id, orgId: o.orgId, data: { amount: r.amount } }, tx);
  });
}

// ------------------------------------------------------------------------------------------ duplicate captures (manual settlement)

/**
 * Duplicate captures created by the live flow are refunded automatically (their refund request is written with
 * the classification). Captures flagged by MIGRATION 0013 on historical data have no refund request and are never
 * refunded automatically: finance lists them here, verifies each one at the provider and settles it explicitly.
 */
export async function listDuplicateCaptures(ctx: Ctx, limit = 200) {
  authorizeAdmin(ctx, "admin.finance");
  const rows = await withSystem((tx) =>
    tx.execute(sql`
      select pi.id as "intentId", pi.order_id as "orderId", o.code as "orderCode", pi.duplicate_of as "primaryIntentId", pi.amount, pi.currency, pi.provider,
             pi.succeeded_at as "capturedAt", r.id as "refundId", r.status as "refundStatus",
             exists (select 1 from order_events e where e.order_id = pi.order_id and e.kind = 'duplicate_payment_dismissed' and e.data->>'intentId' = pi.id::text) as dismissed
      from payment_intents pi
      join orders o on o.id = pi.order_id
      left join refunds r on r.idempotency_key = 'dup:' || pi.id::text
      where pi.duplicate_of is not null and pi.status = 'succeeded'
      order by pi.created_at desc
      limit ${limit}`),
  );
  type Row = { intentId: string; orderId: string; orderCode: string; primaryIntentId: string; amount: string; currency: string; provider: string; capturedAt: Date | null; refundId: string | null; refundStatus: string | null; dismissed: boolean };
  return (rows.rows as Row[]).map((r) => ({
    ...r,
    state: (r.dismissed ? "dismissed" : r.refundStatus === "succeeded" ? "refunded" : r.refundStatus ? "refund_in_progress" : "needs_review") as "needs_review" | "refund_in_progress" | "refunded" | "dismissed",
  }));
}

/**
 * Settle a flagged duplicate capture. `refund` first re-reads the payment from the provider and refuses unless it
 * is still captured for exactly the intent's amount/currency (bank transfers cannot be re-read: the note is the
 * evidence), then requests the refund through the normal, idempotent, recoverable pipeline. `dismiss` records that
 * the capture was handled outside the system. Each intent can be settled one way only; repeating the same action
 * is idempotent. Everything is audited with the finance note.
 */
export async function settleDuplicateCapture(ctx: Ctx, intentId: string, input: { action: "refund" | "dismiss"; note: string }): Promise<{ refundId: string | null; status: string }> {
  authorizeAdmin(ctx, "admin.finance");
  const note = input.note?.trim() ?? "";
  if (note.length < 3) throw invalidState("A reconciliation note is required", { key: "note_required" });
  const [i0] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1));
  if (!i0 || !i0.duplicateOf || i0.status !== "succeeded") throw invalidState("Not a duplicate capture", { key: "not_a_duplicate" });
  if (input.action === "refund" && i0.provider !== "bank_transfer") {
    const provider = await providerFor(i0.provider);
    const f: FetchedPayment | null = await provider.fetchPayment(i0.providerRef ?? "").catch(() => null);
    if (!f || f.status !== "succeeded" || f.amountMinor !== toMinor(i0.amount) || f.currency !== i0.currency) throw invalidState("The capture could not be verified at the provider", { key: "duplicate_not_verified" });
  }
  const settled = await withSystem(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, i0.orderId)).limit(1).for("update");
    if (!o) throw notFound("Order");
    const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, `dup:${i0.id}`)).limit(1);
    const dismissed = (await tx.execute(sql`select 1 from order_events where order_id = ${o.id} and kind = 'duplicate_payment_dismissed' and data->>'intentId' = ${i0.id} limit 1`)).rows.length > 0;
    if (input.action === "dismiss") {
      if (existing) throw invalidState("Already settled", { key: "duplicate_already_settled" });
      if (dismissed) return { refundId: null, status: "dismissed", run: null as string | null };
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "duplicate_payment_dismissed", actorUserId: ctx.userId, data: { intentId: i0.id, note } });
      await audit(ctx, { action: "payment.duplicate_capture_settled", entityType: "payment_intent", entityId: i0.id, orgId: o.orgId, data: { action: "dismiss", note, orderId: o.id, amount: i0.amount } }, tx);
      return { refundId: null, status: "dismissed", run: null as string | null };
    }
    if (dismissed) throw invalidState("Already settled", { key: "duplicate_already_settled" });
    const { refund, created } = await requestRefund(tx, { orderId: o.id, groupId: null, intentId: i0.id, amount: i0.amount, reason: "duplicate_payment", idempotencyKey: `dup:${i0.id}`, actorUserId: ctx.userId });
    if (created) await audit(ctx, { action: "payment.duplicate_capture_settled", entityType: "payment_intent", entityId: i0.id, orgId: o.orgId, data: { action: "refund", note, orderId: o.id, amount: i0.amount, refundId: refund.id } }, tx);
    return { refundId: refund.id as string | null, status: refund.status, run: (refund.status === "pending" ? refund.id : null) as string | null };
  });
  if (settled.run) return executeRefund(settled.run);
  return { refundId: settled.refundId, status: settled.status };
}

// ------------------------------------------------------------------------------------------ admin & jobs

/** Admin confirms a received bank transfer (manual reconciliation; audited). */
export async function confirmBankTransfer(ctx: Ctx, intentId: string, note: string) {
  authorizeAdmin(ctx, "admin.finance");
  if (!note || note.trim().length < 3) throw invalidState("A reconciliation note is required", { key: "note_required" });
  const [i] = await withSystem((tx) => tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1));
  if (!i) throw notFound("Payment intent");
  if (i.provider !== "bank_transfer" || i.status !== "pending") throw invalidState("Not a pending bank transfer", { key: "invalid_state" });
  const res = await applyProviderStatus(i.id, { providerRef: i.providerRef ?? "", status: "succeeded", amountMinor: toMinor(i.amount), currency: i.currency, paymentId: i.providerRef, raw: { manual: true } }, "manual");
  await withSystem((tx) => audit(ctx, { action: "payment.bank_transfer_confirmed", entityType: "payment_intent", entityId: i.id, orgId: i.orgId, data: { note: note.trim(), amount: i.amount } }, tx));
  return res;
}

/** Expire unpaid orders past their deadline and release reserved stock. */
export async function expireUnpaidOrders(): Promise<number> {
  const due = await withSystem((tx) => tx.select({ id: orders.id }).from(orders).where(and(inArray(orders.status, ["pending_payment", "payment_failed"]), lt(orders.expiresAt, new Date()))).limit(200));
  let n = 0;
  for (const { id } of due) {
    await withSystem(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1).for("update");
      if (!o || !["pending_payment", "payment_failed"].includes(o.status) || o.paymentStatus === "paid") return;
      await tx.update(orders).set({ status: "expired", cancelledAt: new Date(), cancelReason: "payment_timeout" }).where(eq(orders.id, o.id));
      await tx.update(orderGroups).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "system", cancelReason: "payment_timeout" }).where(eq(orderGroups.orderId, o.id));
      await tx.update(paymentIntents).set({ status: "expired" }).where(and(eq(paymentIntents.orderId, o.id), inArray(paymentIntents.status, ["created", "pending"])));
      const lines = await tx.select({ productId: orderLines.supplierProductId }).from(orderLines).where(eq(orderLines.orderId, o.id));
      for (const l of lines) await settleReservation(tx, l.productId, `order:${o.id}`, "release");
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "expired" });
      n++;
    });
  }
  return n;
}

export async function listWebhookEvents(ctx: Ctx, limit = 100) {
  authorizeAdmin(ctx, "admin.finance");
  return withSystem((tx) => tx.select({ id: paymentWebhookEvents.id, provider: paymentWebhookEvents.provider, eventId: paymentWebhookEvents.eventId, eventType: paymentWebhookEvents.eventType, signatureValid: paymentWebhookEvents.signatureValid, status: paymentWebhookEvents.status, error: paymentWebhookEvents.error, createdAt: paymentWebhookEvents.createdAt }).from(paymentWebhookEvents).orderBy(desc(paymentWebhookEvents.createdAt)).limit(limit));
}

export async function listPendingBankTransfers(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.finance");
  return withSystem((tx) =>
    tx
      .select({ intent: paymentIntents, code: orders.code })
      .from(paymentIntents)
      .innerJoin(orders, eq(orders.id, paymentIntents.orderId))
      .where(and(eq(paymentIntents.provider, "bank_transfer"), eq(paymentIntents.status, "pending")))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(200),
  );
}

export async function listRefundsNeedingAction(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.finance");
  return withSystem((tx) => tx.select().from(refunds).where(inArray(refunds.status, ["manual_required", "failed", "pending"])).orderBy(desc(refunds.createdAt)).limit(200));
}

export { conflict };
