import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, brandName, dec, documentTotals, hashObject, invalidState, lineTotals, notFound, randomToken, toDb, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { nextDocNumber, pageParams, withContext, withSystem, type Tx } from "@platform/db";
import {
  approvalDecisions,
  approvalRequestSteps,
  authUsers,
  awardLines,
  awards,
  files,
  goodsReceiptItems,
  goodsReceipts,
  memberships,
  membershipRoles,
  organizations,
  poEvents,
  poItems,
  projects,
  purchaseOrders,
  quotationItems,
  quotations,
  rfqItems,
  rfqs,
  roles,
  shipmentItems,
  shipments,
} from "@platform/db/schema";
import { getPdfRenderer, qrDataUrl } from "@platform/integrations/pdf";
import { getStorage } from "@platform/integrations/storage";
import { latestRequest, onApprovalResolved, requestApproval } from "../approvals";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { idempotent } from "../idempotency";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { logActivity } from "../projects";
import { poHtml, type PoPdfData } from "./pdf";

export type Fulfillment = "not_started" | "preparing" | "partially_fulfilled" | "shipped" | "partially_delivered" | "delivered" | "completed" | "cancelled";

/** Fulfilment status is derived from quantities, never edited freely. */
export function deriveFulfillment(items: { quantity: string; shippedQty: string; receivedQty: string }[], flags: { preparing: boolean; completed: boolean; cancelled: boolean }): Fulfillment {
  if (flags.cancelled) return "cancelled";
  if (flags.completed) return "completed";
  const all = (f: (i: (typeof items)[number]) => boolean) => items.length > 0 && items.every(f);
  const any = (f: (i: (typeof items)[number]) => boolean) => items.some(f);
  if (all((i) => dec(i.receivedQty).gte(dec(i.quantity)))) return "delivered";
  if (any((i) => dec(i.receivedQty).gt(0))) return "partially_delivered";
  if (all((i) => dec(i.shippedQty).gte(dec(i.quantity)))) return "shipped";
  if (any((i) => dec(i.shippedQty).gt(0))) return "partially_fulfilled";
  return flags.preparing ? "preparing" : "not_started";
}

async function event(tx: Tx, po: typeof purchaseOrders.$inferSelect, ctx: Ctx, kind: string, data: Record<string, unknown> = {}, visibleToSupplier = true) {
  await withContext({ userId: null, orgId: null, mode: "system" }, (s) => s.insert(poEvents).values({ poId: po.id, orgId: po.orgId, supplierOrgId: po.supplierOrgId, actorUserId: ctx.userId, actorOrgId: ctx.orgId, kind, data, visibleToSupplier }));
  void tx;
}

async function refreshFulfillment(tx: Tx, poId: string) {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
  const items = await tx.select().from(poItems).where(eq(poItems.poId, poId));
  const status = deriveFulfillment(items, { preparing: Boolean(po!.acknowledgedAt) || po!.fulfillmentStatus === "preparing", completed: po!.fulfillmentStatus === "completed", cancelled: po!.approvalStatus === "cancelled" });
  const delayed = Boolean(po!.expectedDeliveryAt && po!.expectedDeliveryAt.getTime() < Date.now() && !["delivered", "completed", "cancelled"].includes(status));
  await tx.update(purchaseOrders).set({ fulfillmentStatus: status, isDelayed: delayed || (po!.isDelayed && !["delivered", "completed"].includes(status)) }).where(eq(purchaseOrders.id, poId));
  return status;
}

/**
 * Buyer-side PO load. With `lock`, the row is locked FOR UPDATE and returned in its latest committed state.
 * Every writer of PO state (cancel, ship, receive, complete, acknowledge, delay) takes this lock first and
 * only then item rows, so they serialise and each re-validates the status it acts on under the lock.
 */
async function loadBuyerPo(tx: Tx, ctx: Ctx, poId: string, opts: { lock?: boolean } = {}) {
  const q = tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.orgId, ctx.orgId!))).limit(1);
  const [po] = await (opts.lock ? q.for("update") : q);
  if (!po) throw notFound("Purchase order");
  return po;
}

/** Supplier-side counterpart: lock the approved PO of this supplier and re-check that it is still open. */
async function lockSupplierPo(tx: Tx, ctx: Ctx, poId: string) {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.supplierOrgId, ctx.orgId!))).limit(1).for("update");
  if (!po) throw notFound("Purchase order");
  if (po.approvalStatus === "cancelled" || ["delivered", "completed", "cancelled"].includes(po.fulfillmentStatus)) throw invalidState("PO is closed", { key: "po_closed" });
  if (po.approvalStatus !== "approved") throw notFound("Purchase order");
  return po;
}

/** A PO line may appear once per shipment/receipt: repeated lines would be judged one by one against stale quantities. */
function assertUniqueLines(lines: { poItemId: string }[]) {
  const seen = new Set<string>();
  for (const l of lines) {
    const k = l.poItemId.toLowerCase();
    if (seen.has(k)) throw validation("A PO line can appear only once; combine the quantities", { key: "duplicate_line" });
    seen.add(k);
  }
}

// ------------------------------------------------------------------------------------------ create from award

/**
 * Create one draft PO per awarded supplier from an APPROVED award. Idempotent per key; a unique
 * constraint (award, supplier) prevents duplicates even across keys.
 */
export async function createFromAward(ctx: Ctx, rfqId: string, idempotencyKey: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.create", { write: true });
  return withContext(dbCtx(ctx), (tx) =>
    idempotent(`po-create:${ctx.orgId}`, idempotencyKey, { rfqId }, async () => {
      const [r] = await tx.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.orgId, ctx.orgId!))).limit(1);
      if (!r) throw notFound("RFQ");
      const [award] = await tx.select().from(awards).where(and(eq(awards.rfqId, rfqId), eq(awards.status, "approved"))).orderBy(desc(awards.createdAt)).limit(1);
      if (!award) throw invalidState("No approved award", { key: "award_not_approved" });
      const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, award.id), eq(awardLines.isCurrent, true)));
      const bySupplier = new Map<string, typeof lines>();
      for (const l of lines) if (l.supplierOrgId) bySupplier.set(l.supplierOrgId, [...(bySupplier.get(l.supplierOrgId) ?? []), l]);
      const existing = await tx.select({ supplierOrgId: purchaseOrders.supplierOrgId }).from(purchaseOrders).where(and(eq(purchaseOrders.awardId, award.id), sql`${purchaseOrders.approvalStatus} <> 'cancelled'`));
      const created: string[] = [];
      for (const [supplierOrgId, ls] of bySupplier) {
        if (existing.some((e) => e.supplierOrgId === supplierOrgId)) continue;
        const qIds = [...new Set(ls.map((l) => l.quotationId!))];
        const [q] = await tx.select().from(quotations).where(inArray(quotations.id, qIds)).limit(1);
        const qis = await tx.select().from(quotationItems).where(inArray(quotationItems.id, ls.map((l) => l.quotationItemId!)));
        const ris = await tx.select().from(rfqItems).where(inArray(rfqItems.id, ls.map((l) => l.rfqItemId)));
        const computed = ls
          .map((l) => {
            const qi = qis.find((x) => x.id === l.quotationItemId)!;
            const ri = ris.find((x) => x.id === l.rfqItemId)!;
            const t = lineTotals({ unitPrice: l.unitPrice!, quantity: l.quantity!, vatRate: qi.vatRate });
            return { l, qi, ri, t };
          })
          .sort((a, b) => a.ri.lineNo - b.ri.lineNo);
        const shipping = q?.shippingAmount ?? "0";
        const doc = documentTotals(computed.map((c) => c.t), { shipping, vatRate: "0.15" });
        const code = await nextDocNumber(tx, ctx.orgId!, "po", "PO");
        const [po] = await tx
          .insert(purchaseOrders)
          .values({
            orgId: ctx.orgId!,
            supplierOrgId,
            projectId: r.projectId,
            rfqId,
            awardId: award.id,
            code,
            subtotal: toDb(doc.subtotal),
            discountTotal: toDb(doc.discount),
            shippingAmount: toDb(doc.shipping),
            vatTotal: toDb(doc.vat),
            total: toDb(doc.total),
            paymentTerms: q?.paymentTerms ?? r.paymentTerms,
            deliveryTerms: q?.deliveryTerms ?? r.deliveryTerms,
            deliveryCity: r.deliveryCity,
            deliveryAddress: r.deliveryAddress,
            expectedDeliveryAt: q?.leadTimeDays ? new Date(Date.now() + q.leadTimeDays * 86400_000) : r.requiredBy,
            verificationCode: randomToken(12),
            createdBy: ctx.userId,
          })
          .returning();
        await tx.insert(poItems).values(
          computed.map((c, i) => ({
            poId: po!.id,
            orgId: ctx.orgId!,
            supplierOrgId,
            lineNo: i + 1,
            rfqItemId: c.ri.id,
            quotationItemId: c.qi.id,
            description: c.qi.isAlternative && c.qi.alternativeDescription ? `${c.ri.description} — ${c.qi.alternativeDescription}` : c.ri.description,
            brand: [c.qi.brand, c.qi.model].filter(Boolean).join(" ") || null,
            quantity: c.l.quantity!,
            unit: c.ri.unit,
            unitPrice: c.l.unitPrice!,
            vatRate: c.qi.vatRate,
            lineNet: toDb(c.t.net),
            lineVat: toDb(c.t.vat),
            lineTotal: toDb(c.t.total),
          })),
        );
        await event(tx, po!, ctx, "created", { awardId: award.id }, false);
        await audit(ctx, { action: "po.created", entityType: "purchase_order", entityId: po!.id, data: { code, total: po!.total, supplierOrgId } }, tx);
        created.push(po!.id);
      }
      if (!created.length && !existing.length) throw validation("Award has no supplier lines", { key: "award_empty" });
      return { created };
    }),
  );
}

export const poPatchSchema = z.object({
  notes: z.string().trim().max(5000).optional().nullable(),
  paymentTerms: z.string().trim().max(2000).optional().nullable(),
  deliveryTerms: z.string().trim().max(2000).optional().nullable(),
  deliveryAddress: z.string().trim().max(500).optional().nullable(),
  expectedDeliveryAt: z.preprocess((v) => (v === "" ? null : v), z.coerce.date().nullable().optional()),
});

export async function updatePoDraft(ctx: Ctx, poId: string, input: z.input<typeof poPatchSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.create", { write: true });
  const d = poPatchSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const po = await loadBuyerPo(tx, ctx, poId);
    if (!["draft", "rejected"].includes(po.approvalStatus)) throw invalidState("Only drafts can be edited", { key: "po_not_draft" });
    await tx.update(purchaseOrders).set({ ...d, approvalStatus: "draft" }).where(eq(purchaseOrders.id, poId));
    await audit(ctx, { action: "po.updated", entityType: "purchase_order", entityId: poId, data: { fields: Object.keys(d) } }, tx);
  });
}

function poSnapshot(po: typeof purchaseOrders.$inferSelect, items: (typeof poItems.$inferSelect)[]) {
  return { total: po.total, terms: [po.paymentTerms, po.deliveryTerms, po.deliveryAddress], items: items.map((i) => [i.rfqItemId, i.quantity, i.unitPrice]) };
}

/** Submit for approval (operation po_issue, amount = PO total). Issues immediately if no policy. */
export async function submitPo(ctx: Ctx, poId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.create", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const po = await loadBuyerPo(tx, ctx, poId);
    if (!["draft", "rejected"].includes(po.approvalStatus)) throw invalidState("PO is not a draft", { key: "po_not_draft" });
    const items = await tx.select().from(poItems).where(eq(poItems.poId, poId));
    await tx.update(purchaseOrders).set({ approvalStatus: "pending_approval" }).where(eq(purchaseOrders.id, poId));
    await event(tx, po, ctx, "submitted", {}, false);
    const res = await requestApproval(tx, ctx, { operation: "po_issue", subjectType: "purchase_order", subjectId: poId, subjectLabel: po.code, snapshot: poSnapshot(po, items), amount: po.total, projectId: po.projectId });
    if (res.status === "auto_approved") await issue(tx, ctx, poId);
    return res;
  });
}

onApprovalResolved("purchase_order", async (tx, ctx, req, outcome) => {
  const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, req.subjectId)).limit(1);
  if (!po || po.approvalStatus !== "pending_approval") return;
  const items = await tx.select().from(poItems).where(eq(poItems.poId, po.id));
  if (outcome === "approved") {
    if (hashObject(poSnapshot(po, items)) !== req.subjectHash) throw new AppError("INVALID_STATE", "PO changed since approval was requested", { key: "approval_invalidated" });
    await issue(tx, ctx, po.id);
  } else {
    await tx.update(purchaseOrders).set({ approvalStatus: "rejected" }).where(eq(purchaseOrders.id, po.id));
    await event(tx, po, ctx, "rejected", {}, false);
  }
});

/** Issue: approved → visible to supplier; PDFs generated by the worker; supplier notified. */
async function issue(tx: Tx, ctx: Ctx, poId: string) {
  const [po] = await tx.update(purchaseOrders).set({ approvalStatus: "approved", issuedAt: new Date() }).where(eq(purchaseOrders.id, poId)).returning();
  await event(tx, po!, ctx, "issued", { total: po!.total });
  if (po!.projectId) await withContext({ userId: ctx.userId, orgId: po!.orgId, mode: "user" }, (s) => logActivity(s, { ...ctx, orgId: po!.orgId }, po!.projectId!, "po.issued", { type: "purchase_order", id: po!.id }, { code: po!.code }));
  await audit(ctx, { action: "po.issued", entityType: "purchase_order", entityId: po!.id, orgId: po!.orgId, data: { total: po!.total } }, tx);
  await emit({ topic: "po.issued", aggregateType: "purchase_order", aggregateId: po!.id, orgId: po!.orgId, payload: { poId: po!.id } }, tx);
}

/** Worker: render AR and EN PDFs, store privately, notify the supplier. Idempotent. */
export async function generatePoDocuments(poId: string) {
  const data = await withSystem(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po || po.approvalStatus !== "approved") return null;
    const items = await tx.select().from(poItems).where(eq(poItems.poId, poId)).orderBy(asc(poItems.lineNo));
    const [buyer] = await tx.select().from(organizations).where(eq(organizations.id, po.orgId)).limit(1);
    const [sup] = await tx.select().from(organizations).where(eq(organizations.id, po.supplierOrgId)).limit(1);
    const [proj] = po.projectId ? await tx.select({ name: projects.name, code: projects.code }).from(projects).where(eq(projects.id, po.projectId)).limit(1) : [];
    const [rfq] = po.rfqId ? await tx.select({ code: rfqs.code }).from(rfqs).where(eq(rfqs.id, po.rfqId)).limit(1) : [];
    const req = await latestRequest(tx, "purchase_order", po.id);
    const approvals = req
      ? await tx
          .select({ name: authUsers.name, at: approvalDecisions.createdAt, step: approvalRequestSteps.name })
          .from(approvalDecisions)
          .innerJoin(authUsers, eq(authUsers.id, approvalDecisions.userId))
          .innerJoin(approvalRequestSteps, eq(approvalRequestSteps.id, approvalDecisions.stepId))
          .where(and(eq(approvalDecisions.requestId, req.id), eq(approvalDecisions.decision, "approve")))
      : [];
    return { po, items, buyer: buyer!, sup: sup!, proj, rfq, approvals };
  });
  if (!data) return { skipped: true };
  const { po, items, buyer, sup, proj, rfq, approvals } = data;
  const url = new URL(`/ar/verify/po/${po.verificationCode}`, process.env.APP_URL ?? "http://localhost:3100").toString();
  const qr = await qrDataUrl(url);
  const fileIds: Record<"ar" | "en", string> = { ar: "", en: "" };
  for (const locale of ["ar", "en"] as const) {
    const pdfData: PoPdfData = {
      brand: brandName(locale),
      code: po.code,
      issuedAt: po.issuedAt ?? new Date(),
      status: po.approvalStatus,
      buyer: { name: locale === "ar" ? buyer.nameAr : buyer.nameEn, vat: buyer.vatNumber, cr: buyer.crNumber, address: buyer.addressLine, city: buyer.city },
      supplier: { name: locale === "ar" ? sup.nameAr : sup.nameEn, vat: sup.vatNumber, cr: sup.crNumber, address: sup.addressLine, city: sup.city },
      project: proj ? `${proj.code} — ${proj.name}` : null,
      rfq: rfq?.code ?? null,
      lines: items.map((i) => ({ no: i.lineNo, description: i.description, brand: i.brand, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, vatRate: i.vatRate, lineNet: i.lineNet, lineVat: i.lineVat, lineTotal: i.lineTotal })),
      subtotal: dec(po.subtotal).minus(dec(po.discountTotal)).toFixed(2),
      shipping: po.shippingAmount,
      vat: po.vatTotal,
      total: po.total,
      currency: po.currency,
      paymentTerms: po.paymentTerms,
      deliveryTerms: po.deliveryTerms,
      deliveryAddress: po.deliveryAddress,
      expectedDeliveryAt: po.expectedDeliveryAt,
      notes: po.notes,
      approvals: approvals.map((a) => ({ name: a.name, at: a.at, step: a.step })),
      verificationCode: po.verificationCode,
      verificationUrl: url,
      qr,
    };
    const pdf = await getPdfRenderer().render(poHtml(pdfData, locale));
    const key = `org/${po.orgId}/po_document/${po.id}-${locale}.pdf`;
    await getStorage().put(key, pdf, "application/pdf");
    const [f] = await withSystem((tx) =>
      tx
        .insert(files)
        .values({ orgId: po.orgId, ownerType: "po_document", ownerId: po.id, classification: "confidential", storageKey: key, originalName: `${po.code}-${locale}.pdf`, mimeType: "application/pdf", sizeBytes: pdf.length, sha256: hashObject(pdf.toString("base64")), status: "ready" })
        .onConflictDoUpdate({ target: files.storageKey, set: { sizeBytes: pdf.length, status: "ready" } })
        .returning({ id: files.id }),
    );
    fileIds[locale] = f!.id;
  }
  await withSystem(async (tx) => {
    await tx.update(purchaseOrders).set({ pdfFileIdAr: fileIds.ar, pdfFileIdEn: fileIds.en }).where(eq(purchaseOrders.id, po.id));
    const users = await tx
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.orgId, po.supplierOrgId), eq(memberships.status, "active"), sql`'supplier.po.view' = any(${roles.permissions})`));
    await notifyUsers({ userIds: users.map((u) => u.userId), kind: "po.issued", params: { poNumber: po.code, buyerName: buyer.nameAr, total: `${po.total} SAR` }, link: `/supplier/purchase-orders/${po.id}`, orgId: po.supplierOrgId, dedupeKey: `po-issued:${po.id}`, email: true }, tx);
  });
  return { files: fileIds };
}

export async function cancelPo(ctx: Ctx, poId: string, reason: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.cancel", { write: true });
  const why = z.string().trim().min(3).max(500).parse(reason);
  return withContext(dbCtx(ctx), async (tx) => {
    const po = await loadBuyerPo(tx, ctx, poId, { lock: true });
    if (po.approvalStatus === "cancelled") throw invalidState("Already cancelled");
    const [s] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.poId, poId));
    if ((s?.n ?? 0) > 0) throw invalidState("POs with shipments cannot be cancelled", { key: "po_has_shipments" });
    await tx.update(purchaseOrders).set({ approvalStatus: "cancelled", fulfillmentStatus: "cancelled", cancelReason: why }).where(eq(purchaseOrders.id, poId));
    await tx.execute(sql`update approval_requests set status = 'cancelled' where subject_type = 'purchase_order' and subject_id = ${poId} and status = 'pending'`);
    await event(tx, po, ctx, "cancelled", { reason: why }, po.approvalStatus === "approved");
    await audit(ctx, { action: "po.cancelled", entityType: "purchase_order", entityId: poId, data: { reason: why } }, tx);
    if (po.approvalStatus === "approved") await notifySupplierStatus(tx, po, "cancelled");
  });
}

async function notifySupplierStatus(tx: Tx, po: typeof purchaseOrders.$inferSelect, status: string) {
  await withContext({ userId: null, orgId: null, mode: "system" }, async (s) => {
    const users = await s.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, po.supplierOrgId), eq(memberships.status, "active")));
    await notifyUsers({ userIds: users.map((u) => u.userId), kind: "po.status_changed", params: { poNumber: po.code, status }, link: `/supplier/purchase-orders/${po.id}`, orgId: po.supplierOrgId, dedupeKey: `po-status:${po.id}:${status}:${Date.now()}`, email: true }, s);
  });
  void tx;
}

async function notifyBuyerStatus(po: typeof purchaseOrders.$inferSelect, status: string, kind: "po.status_changed" | "po.shipment_created" = "po.status_changed", extra: Record<string, string> = {}) {
  await withSystem(async (s) => {
    const users = await s
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.orgId, po.orgId), eq(memberships.status, "active"), sql`'po.receive' = any(${roles.permissions})`));
    const ids = new Set(users.map((u) => u.userId));
    if (po.createdBy) ids.add(po.createdBy);
    await notifyUsers({ userIds: [...ids], kind, params: { poNumber: po.code, status, ...extra }, link: `/org/purchase-orders/${po.id}`, orgId: po.orgId, dedupeKey: `po-buyer:${po.id}:${kind}:${Date.now()}`, email: true }, s);
  });
}

// ------------------------------------------------------------------------------------------ supplier fulfilment

async function loadSupplierPo(ctx: Ctx, poId: string) {
  return withContext(dbCtx(ctx), async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.supplierOrgId, ctx.orgId!), eq(purchaseOrders.approvalStatus, "approved"))).limit(1);
    if (!po) throw notFound("Purchase order");
    return po;
  });
}

export async function acknowledgePo(ctx: Ctx, poId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.po.fulfil", { write: true });
  const po = await loadSupplierPo(ctx, poId);
  if (po.acknowledgedAt) return;
  const acknowledged = await withSystem(async (tx) => {
    const cur = await lockSupplierPo(tx, ctx, poId);
    if (cur.acknowledgedAt) return false;
    await tx.update(purchaseOrders).set({ acknowledgedAt: new Date(), fulfillmentStatus: cur.fulfillmentStatus === "not_started" ? "preparing" : cur.fulfillmentStatus }).where(eq(purchaseOrders.id, poId));
    await event(tx, cur, ctx, "acknowledged");
    await audit(ctx, { action: "po.acknowledged", entityType: "purchase_order", entityId: poId, orgId: ctx.orgId }, tx);
    return true;
  });
  if (acknowledged) await notifyBuyerStatus(po, "preparing");
}

export const delaySchema = z.object({ reason: z.string().trim().min(3).max(1000), newExpectedAt: z.coerce.date() });

export async function reportDelay(ctx: Ctx, poId: string, input: z.input<typeof delaySchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.po.fulfil", { write: true });
  const d = delaySchema.parse(input);
  const po = await loadSupplierPo(ctx, poId);
  if (["delivered", "completed", "cancelled"].includes(po.fulfillmentStatus)) throw invalidState("PO is closed", { key: "po_closed" });
  await withSystem(async (tx) => {
    await lockSupplierPo(tx, ctx, poId);
    await tx.update(purchaseOrders).set({ isDelayed: true, delayReason: d.reason, expectedDeliveryAt: d.newExpectedAt }).where(eq(purchaseOrders.id, poId));
    await event(tx, po, ctx, "delay_reported", { reason: d.reason, newExpectedAt: d.newExpectedAt.toISOString(), previous: po.expectedDeliveryAt?.toISOString() ?? null });
    await audit(ctx, { action: "po.delay_reported", entityType: "purchase_order", entityId: poId, orgId: ctx.orgId, data: { reason: d.reason } }, tx);
  });
  await notifyBuyerStatus(po, "delayed");
}

const qtyStr = z.preprocess((v) => (v === "" || v === undefined || v === null ? "0" : parseLocaleNumber(v)), z.string().regex(/^\d+(\.\d+)?$/));

export const shipmentSchema = z.object({
  carrier: z.string().trim().max(80).optional().nullable(),
  trackingNumber: z.string().trim().max(80).optional().nullable(),
  expectedAt: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.date().optional()),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(z.object({ poItemId: z.string().uuid(), quantity: qtyStr })).min(1),
});

/** Supplier ships (partially or fully). Shipped quantities cannot exceed ordered quantities. */
export async function createShipment(ctx: Ctx, poId: string, input: z.input<typeof shipmentSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.po.fulfil", { write: true });
  const d = shipmentSchema.parse(input);
  const po = await loadSupplierPo(ctx, poId);
  if (["delivered", "completed", "cancelled"].includes(po.fulfillmentStatus)) throw invalidState("PO is closed", { key: "po_closed" });
  const lines = d.items.filter((i) => dec(i.quantity).gt(0));
  if (!lines.length) throw validation("Ship at least one quantity", { key: "shipment_empty" });
  assertUniqueLines(lines);
  const shipment = await withSystem(async (tx) => {
    // the status checked above was read outside this transaction: re-check it under the PO lock, which
    // cancelPo also takes, so a shipment can never be registered against a PO that is being cancelled
    const cur = await lockSupplierPo(tx, ctx, poId);
    const items = await tx.select().from(poItems).where(eq(poItems.poId, poId)).for("update");
    for (const l of lines) {
      const it = items.find((i) => i.id === l.poItemId);
      if (!it) throw validation("Unknown line");
      if (dec(it.shippedQty).plus(l.quantity).gt(dec(it.quantity))) throw validation(`Line ${it.lineNo}: shipped quantity exceeds ordered`, { key: "shipment_qty_exceeds", line: it.lineNo });
    }
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.poId, poId))) as [{ n: number }];
    const [s] = await tx
      .insert(shipments)
      .values({ poId, orgId: po.orgId, supplierOrgId: po.supplierOrgId, reference: `${cur.code}-S${n + 1}`, carrier: d.carrier ?? null, trackingNumber: d.trackingNumber ?? null, expectedAt: d.expectedAt ?? null, notes: d.notes ?? null, createdBy: ctx.userId })
      .returning();
    for (const l of lines) {
      await tx.insert(shipmentItems).values({ shipmentId: s!.id, poItemId: l.poItemId, orgId: po.orgId, supplierOrgId: po.supplierOrgId, quantity: dec(l.quantity).toFixed(4) });
      await tx.update(poItems).set({ shippedQty: sql`${poItems.shippedQty} + ${dec(l.quantity).toFixed(4)}::numeric` }).where(eq(poItems.id, l.poItemId));
    }
    if (!cur.acknowledgedAt) await tx.update(purchaseOrders).set({ acknowledgedAt: new Date() }).where(eq(purchaseOrders.id, poId));
    const status = await refreshFulfillment(tx, poId);
    await event(tx, po, ctx, "shipment_created", { shipmentId: s!.id, reference: s!.reference, tracking: d.trackingNumber, lines: lines.length, status });
    await audit(ctx, { action: "po.shipment_created", entityType: "purchase_order", entityId: poId, orgId: ctx.orgId, data: { shipmentId: s!.id } }, tx);
    return s!;
  });
  await notifyBuyerStatus(po, "shipped", "po.shipment_created", { tracking: d.trackingNumber ?? "—" });
  return shipment;
}

// ------------------------------------------------------------------------------------------ buyer receipts

export const receiptSchema = z.object({
  shipmentId: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(z.object({ poItemId: z.string().uuid(), received: qtyStr, rejected: qtyStr, note: z.string().trim().max(500).optional().nullable() })).min(1),
});

/** Record goods received (partial allowed). Received + rejected cannot exceed shipped. */
export async function recordReceipt(ctx: Ctx, poId: string, input: z.input<typeof receiptSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.receive", { write: true });
  const d = receiptSchema.parse(input);
  const lines = d.items.filter((i) => dec(i.received).gt(0) || dec(i.rejected).gt(0));
  if (!lines.length) throw validation("Enter received quantities", { key: "receipt_empty" });
  assertUniqueLines(lines);
  return withContext(dbCtx(ctx), async (tx) => {
    const po = await loadBuyerPo(tx, ctx, poId, { lock: true });
    if (po.approvalStatus !== "approved" || ["completed", "cancelled"].includes(po.fulfillmentStatus)) throw invalidState("PO is not open for receiving", { key: "po_closed" });
    if (d.shipmentId) {
      const [sh] = await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.id, d.shipmentId), eq(shipments.poId, poId))).limit(1);
      if (!sh) throw validation("Shipment does not belong to this purchase order", { key: "shipment_not_in_po" });
    }
    const items = await tx.select().from(poItems).where(eq(poItems.poId, poId)).for("update");
    for (const l of lines) {
      const it = items.find((i) => i.id === l.poItemId);
      if (!it) throw validation("Unknown line");
      if (dec(it.receivedQty).plus(it.rejectedQty).plus(l.received).plus(l.rejected).gt(dec(it.shippedQty))) throw validation(`Line ${it.lineNo}: received exceeds shipped`, { key: "receipt_exceeds_shipped", line: it.lineNo });
    }
    const [g] = await tx.insert(goodsReceipts).values({ poId, shipmentId: d.shipmentId ?? null, orgId: ctx.orgId, supplierOrgId: po.supplierOrgId, receivedBy: ctx.userId, notes: d.notes ?? null }).returning();
    for (const l of lines) {
      await tx.insert(goodsReceiptItems).values({ receiptId: g!.id, poItemId: l.poItemId, orgId: ctx.orgId, supplierOrgId: po.supplierOrgId, quantityReceived: dec(l.received).toFixed(4), quantityRejected: dec(l.rejected).toFixed(4), note: l.note ?? null });
      await tx.update(poItems).set({ receivedQty: sql`${poItems.receivedQty} + ${dec(l.received).toFixed(4)}::numeric`, rejectedQty: sql`${poItems.rejectedQty} + ${dec(l.rejected).toFixed(4)}::numeric` }).where(eq(poItems.id, l.poItemId));
    }
    if (d.shipmentId) await tx.update(shipments).set({ status: "delivered" }).where(and(eq(shipments.id, d.shipmentId), eq(shipments.poId, poId)));
    const status = await refreshFulfillment(tx, poId);
    await event(tx, po, ctx, "goods_received", { receiptId: g!.id, lines: lines.length, rejected: lines.some((l) => dec(l.rejected).gt(0)), status });
    await audit(ctx, { action: "po.goods_received", entityType: "purchase_order", entityId: poId, data: { receiptId: g!.id } }, tx);
    await notifySupplierStatus(tx, po, status);
    return { receiptId: g!.id, status };
  });
}

export async function completePo(ctx: Ctx, poId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "po.receive", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const po = await loadBuyerPo(tx, ctx, poId, { lock: true });
    if (po.fulfillmentStatus !== "delivered") throw invalidState("Only delivered POs can be completed", { key: "po_not_delivered" });
    await tx.update(purchaseOrders).set({ fulfillmentStatus: "completed", completedAt: new Date(), isDelayed: false }).where(eq(purchaseOrders.id, poId));
    await event(tx, po, ctx, "completed");
    await audit(ctx, { action: "po.completed", entityType: "purchase_order", entityId: poId }, tx);
    await notifySupplierStatus(tx, po, "completed");
  });
}

/** Scheduled: flag overdue POs as delayed. */
export async function flagDelays(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx
      .update(purchaseOrders)
      .set({ isDelayed: true })
      .where(and(eq(purchaseOrders.approvalStatus, "approved"), eq(purchaseOrders.isDelayed, false), sql`${purchaseOrders.expectedDeliveryAt} < now()`, sql`${purchaseOrders.fulfillmentStatus} not in ('delivered','completed','cancelled')`))
      .returning({ id: purchaseOrders.id });
    return rows.length;
  });
}

// ------------------------------------------------------------------------------------------ reads

export async function listPos(ctx: Ctx, opts: { side: "buyer" | "supplier"; status?: string; page?: number; rfqId?: string }) {
  requireOrg(ctx, opts.side === "buyer" ? "buyer" : "supplier");
  authorize(ctx, opts.side === "buyer" ? "po.view" : "supplier.po.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(
      opts.side === "buyer" ? eq(purchaseOrders.orgId, ctx.orgId) : and(eq(purchaseOrders.supplierOrgId, ctx.orgId), eq(purchaseOrders.approvalStatus, "approved")),
      opts.status ? sql`(${purchaseOrders.approvalStatus} = ${opts.status} or ${purchaseOrders.fulfillmentStatus} = ${opts.status})` : undefined,
      opts.rfqId ? eq(purchaseOrders.rfqId, opts.rfqId) : undefined,
    );
    const items = await tx
      .select({ po: purchaseOrders, partyAr: organizations.nameAr, partyEn: organizations.nameEn })
      .from(purchaseOrders)
      .innerJoin(organizations, eq(organizations.id, opts.side === "buyer" ? purchaseOrders.supplierOrgId : purchaseOrders.orgId))
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(purchaseOrders).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getPo(ctx: Ctx, poId: string) {
  requireOrg(ctx, ["buyer", "supplier"]);
  authorize(ctx, ctx.orgType === "buyer" ? "po.view" : "supplier.po.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
    if (!po || (ctx.orgType === "buyer" ? po.orgId !== ctx.orgId : po.supplierOrgId !== ctx.orgId)) throw notFound("Purchase order");
    const items = await tx.select().from(poItems).where(eq(poItems.poId, poId)).orderBy(asc(poItems.lineNo));
    const ships = await tx.select().from(shipments).where(eq(shipments.poId, poId)).orderBy(desc(shipments.shippedAt));
    const shipLines = ships.length ? await tx.select().from(shipmentItems).where(inArray(shipmentItems.shipmentId, ships.map((s) => s.id))) : [];
    const receipts = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.poId, poId)).orderBy(desc(goodsReceipts.receivedAt));
    const events = await tx.select().from(poEvents).where(eq(poEvents.poId, poId)).orderBy(desc(poEvents.createdAt));
    const [buyer] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn }).from(organizations).where(eq(organizations.id, po.orgId)).limit(1);
    const [sup] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn }).from(organizations).where(eq(organizations.id, po.supplierOrgId)).limit(1);
    const approval = ctx.orgType === "buyer" ? await latestRequest(tx, "purchase_order", poId) : null;
    return { po, items, shipments: ships.map((s) => ({ ...s, lines: shipLines.filter((l) => l.shipmentId === s.id) })), receipts, events, buyer, supplier: sup, approval };
  });
}

/** Public verification by code: minimal, non-sensitive data. */
export async function verifyPo(code: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) return null;
  const [row] = await withSystem((tx) =>
    tx
      .select({ code: purchaseOrders.code, issuedAt: purchaseOrders.issuedAt, total: purchaseOrders.total, currency: purchaseOrders.currency, approvalStatus: purchaseOrders.approvalStatus, buyerAr: sql<string>`(select name_ar from organizations o where o.id = ${purchaseOrders.orgId})`, buyerEn: sql<string>`(select name_en from organizations o where o.id = ${purchaseOrders.orgId})`, supplierAr: sql<string>`(select name_ar from organizations o where o.id = ${purchaseOrders.supplierOrgId})`, supplierEn: sql<string>`(select name_en from organizations o where o.id = ${purchaseOrders.supplierOrgId})` })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.verificationCode, code))
      .limit(1),
  );
  return row && row.approvalStatus === "approved" ? row : row ? { ...row, total: null } : null;
}


