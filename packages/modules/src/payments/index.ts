import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { allocate, AppError, conflict, dec, invalidState, money, notFound, sha256, toDb, uuidv7 } from "@platform/core";
import { env } from "@platform/core/env";
import { nextDocNumber, withContext, withSystem, type Tx } from "@platform/db";
import { authUsers, invoices, ledgerEntries, memberships, membershipRoles, orderEvents, orderGroups, orderLines, orders, organizations, paymentAttempts, paymentIntents, paymentWebhookEvents, refunds, roles } from "@platform/db/schema";
import { BankTransferProvider, fromMinor, getPaymentProvider, MoyasarProvider, setPaymentProvider, TestPaymentProvider, toMinor, type FetchedPayment, type PaymentProvider } from "@platform/integrations/payments";
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
  const inserted = await withSystem((tx) =>
    tx.insert(paymentWebhookEvents).values({ provider: providerName, eventId: ev.eventId, eventType: ev.type, signatureValid: true, payload: ev.raw }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id }),
  );
  if (!inserted.length) return { status: 200, result: "duplicate" };
  const eventRowId = inserted[0]!.id;
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
 */
export async function applyProviderStatus(intentId: string, f: FetchedPayment, source: string): Promise<string> {
  let refundAfter: { orderId: string; amount: string } | null = null;
  const outcome = await withSystem(async (tx) => {
    const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1).for("update");
    if (!i) throw notFound("Payment intent");
    await tx.insert(paymentAttempts).values({ intentId, kind: source, status: f.status, detail: { amountMinor: f.amountMinor, currency: f.currency, paymentId: f.paymentId } });
    if (i.status === "succeeded" || i.status === f.status) return "noop";
    if (f.status === "pending") return "pending";
    const [o] = await tx.select().from(orders).where(eq(orders.id, i.orderId)).limit(1).for("update");
    if (!o) throw notFound("Order");
    if (f.status !== "succeeded") {
      const st = f.status === "expired" ? "expired" : f.status === "cancelled" ? "cancelled" : "failed";
      await tx.update(paymentIntents).set({ status: st, failureReason: f.failureReason ?? f.status }).where(eq(paymentIntents.id, i.id));
      if (o.paymentStatus !== "paid") {
        await tx.update(orders).set({ paymentStatus: "failed", status: o.status === "pending_payment" ? "payment_failed" : o.status }).where(eq(orders.id, o.id));
        await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "payment_failed", data: { reason: f.failureReason ?? f.status } });
      }
      return st;
    }
    if (f.amountMinor !== toMinor(i.amount) || f.currency !== i.currency) {
      await tx.update(paymentIntents).set({ status: "failed", failureReason: "amount_mismatch" }).where(eq(paymentIntents.id, i.id));
      await audit(SYS_CTX, { action: "payment.amount_mismatch", entityType: "payment_intent", entityId: i.id, orgId: o.orgId, data: { expected: i.amount, received: fromMinor(f.amountMinor), currency: f.currency } }, tx);
      return "amount_mismatch";
    }
    await tx.update(paymentIntents).set({ status: "succeeded", succeededAt: new Date(), providerPaymentId: f.paymentId ?? i.providerRef }).where(eq(paymentIntents.id, i.id));
    if (o.status === "expired" || o.status === "cancelled") {
      // paid after expiry: goods are no longer reserved → refund automatically
      await tx.update(orders).set({ paymentStatus: "paid" }).where(eq(orders.id, o.id));
      await tx.insert(orderEvents).values({ orderId: o.id, userId: o.userId, orgId: o.orgId, kind: "paid_after_expiry" });
      refundAfter = { orderId: o.id, amount: i.amount };
      return "refund_late_payment";
    }
    await markOrderPaid(tx, o);
    return "succeeded";
  });
  if (refundAfter) {
    const r = refundAfter as { orderId: string; amount: string };
    await refundPayment({ orderId: r.orderId, groupId: null, amount: r.amount, reason: "late_payment", idempotencyKey: `late:${intentId}`, actorUserId: null });
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
  reason: "cancellation" | "return" | "adjustment" | "late_payment";
  idempotencyKey: string;
  actorUserId: string | null;
}

/**
 * Refund (part of) a captured payment. Bounded by what was paid and not yet refunded, per order and per
 * supplier group. The provider is called after the refund row is committed; balances and the ledger
 * move only when the provider confirms. Bank-transfer refunds require a manual, audited confirmation.
 */
export async function refundPayment(input: RefundInput): Promise<{ refundId: string; status: string }> {
  const amt = money(input.amount);
  if (amt.lte(0)) throw invalidState("Refund amount must be positive", { key: "refund_invalid" });
  const prep = await withSystem(async (tx) => {
    const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { existing };
    const [o] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update");
    if (!o) throw notFound("Order");
    const [i] = await tx.select().from(paymentIntents).where(and(eq(paymentIntents.orderId, o.id), eq(paymentIntents.status, "succeeded"))).limit(1).for("update");
    if (!i) throw invalidState("Order has no captured payment", { key: "refund_not_paid" });
    const pendingSum = await tx.select({ s: sql<string>`coalesce(sum(${refunds.amount}),0)::text` }).from(refunds).where(and(eq(refunds.intentId, i.id), inArray(refunds.status, ["pending", "manual_required"])));
    const capacity = dec(i.amount).minus(dec(i.refundedAmount)).minus(dec(pendingSum[0]?.s ?? 0));
    if (amt.gt(capacity)) throw invalidState("Refund exceeds the refundable amount", { key: "refund_exceeds", details: { refundable: toDb(capacity) } });
    let g: typeof orderGroups.$inferSelect | undefined;
    if (input.groupId) {
      [g] = await tx.select().from(orderGroups).where(and(eq(orderGroups.id, input.groupId), eq(orderGroups.orderId, o.id))).limit(1).for("update");
      if (!g) throw notFound("Order group");
      if (amt.gt(dec(g.total).minus(dec(g.refundedTotal)))) throw invalidState("Refund exceeds the supplier group total", { key: "refund_exceeds" });
    }
    const [r] = await tx
      .insert(refunds)
      .values({ orderId: o.id, groupId: g?.id ?? null, intentId: i.id, userId: o.userId, orgId: o.orgId, supplierOrgId: g?.supplierOrgId ?? null, amount: toDb(amt), reason: input.reason, idempotencyKey: input.idempotencyKey, requestedBy: input.actorUserId })
      .returning();
    return { refund: r!, intent: i };
  });
  if ("existing" in prep && prep.existing) return { refundId: prep.existing.id, status: prep.existing.status };
  const { refund, intent } = prep as { refund: typeof refunds.$inferSelect; intent: typeof paymentIntents.$inferSelect };
  const provider = await providerFor(intent.provider);
  const res = await provider.refund(intent.providerPaymentId ?? intent.providerRef ?? "", toMinor(refund.amount), refund.idempotencyKey);
  if (res.status === "succeeded") {
    await completeRefund(refund.id, res.providerRef);
    return { refundId: refund.id, status: "succeeded" };
  }
  const status = res.failureReason === "manual_refund_required" ? "manual_required" : res.status === "pending" ? "pending" : "failed";
  await withSystem(async (tx) => {
    await tx.update(refunds).set({ status, failureReason: res.failureReason ?? null, providerRef: res.providerRef }).where(eq(refunds.id, refund.id));
    await tx.insert(paymentAttempts).values({ intentId: intent.id, kind: "refund", status, detail: { refundId: refund.id, reason: res.failureReason ?? null } });
  });
  return { refundId: refund.id, status };
}

/** Apply a confirmed refund to balances, ledger and a credit note. Idempotent. */
export async function completeRefund(refundId: string, providerRef: string | null, actor?: Ctx) {
  if (actor) authorizeAdmin(actor, "admin.finance");
  await withSystem(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1).for("update");
    if (!r) throw notFound("Refund");
    if (r.status === "succeeded") return;
    if (r.status === "failed") throw invalidState("Refund failed", { key: "refund_failed" });
    const [i] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, r.intentId!)).limit(1).for("update");
    const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId)).limit(1).for("update");
    if (!i || !o) throw notFound("Payment");
    await tx.update(refunds).set({ status: "succeeded", providerRef, processedAt: new Date() }).where(eq(refunds.id, r.id));
    await tx.update(paymentIntents).set({ refundedAmount: toDb(dec(i.refundedAmount).plus(dec(r.amount))) }).where(eq(paymentIntents.id, i.id));
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
      // reverse payable and commission in the group's proportion
      const [payable, commNet, commVat] = allocate(part, [g.supplierPayable, g.commissionNet, g.commissionVat]);
      await postJournal(tx, o, g, `refund:${r.reason}`, [
        { account: "supplier_payable", debit: toDb(payable!) },
        { account: "commission_revenue", debit: toDb(commNet!) },
        { account: "vat_payable", debit: toDb(commVat!) },
        { account: "platform_clearing", credit: toDb(part) },
      ]);
      const [gInv] = await tx.select().from(invoices).where(and(eq(invoices.groupId, g.id), sql`${invoices.kind} <> 'credit_note'`)).limit(1);
      if (gInv ?? orig) await issueInvoice(tx, o, g, null, { amount: toDb(part), originalId: (gInv ?? orig)!.id });
    }
    await tx.insert(orderEvents).values({ orderId: o.id, groupId: r.groupId, userId: o.userId, orgId: o.orgId, supplierOrgId: r.supplierOrgId, kind: "refunded", data: { amount: r.amount, reason: r.reason } });
    await notifyUsers({ userIds: [o.userId], kind: "order.status_changed", params: { orderNumber: o.code, supplierName: "", status: `refund ${r.amount} SAR` }, link: `/account/orders/${o.id}`, dedupeKey: `refund:${r.id}`, email: true }, tx);
    if (actor) await audit(actor, { action: "refund.manual_completed", entityType: "refund", entityId: r.id, orgId: o.orgId, data: { amount: r.amount } }, tx);
  });
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
