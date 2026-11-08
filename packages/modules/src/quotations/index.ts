import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dec, documentTotals, invalidState, lineTotals, money, notFound, toDb, unit, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { withContext, type Tx } from "@platform/db";
import { memberships, organizations, quotationAttachments, quotationItems, quotations, rfqItems, rfqRecipients, rfqs, roles, membershipRoles, supplierProducts } from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { uploadFile } from "../files";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { acceptingQuotes, markResponded } from "../rfq";

async function loadSupplierRfq(tx: Tx, ctx: Ctx, rfqId: string) {
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  const [rc] = r ? await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, ctx.orgId!))).limit(1) : [];
  if (!r || !rc) throw notFound("RFQ");
  return { rfq: r, recipient: rc };
}

/** Current quotation (any status) of the calling supplier for an RFQ, with its lines. */
export async function getMyQuotation(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.rfq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    await loadSupplierRfq(tx, ctx, rfqId);
    const [q] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true))).limit(1);
    if (!q) return null;
    const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationId, q.id));
    const attachments = await tx.execute(sql`select qa.id, f.id as file_id, f.original_name from quotation_attachments qa join files f on f.id = qa.file_id where qa.quotation_id = ${q.id}`);
    const history = await tx.select({ id: quotations.id, version: quotations.version, status: quotations.status, total: quotations.total, submittedAt: quotations.submittedAt }).from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId))).orderBy(desc(quotations.version));
    return { quotation: q, items, attachments: attachments.rows as { id: string; file_id: string; original_name: string }[], history };
  });
}

const blank = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const decStr = z.preprocess((v) => (blank(v) === undefined ? undefined : parseLocaleNumber(v)), z.string().regex(/^\d+(\.\d+)?$/).optional());

export const quoteLineSchema = z.object({
  rfqItemId: z.string().uuid(),
  offered: z.boolean(),
  unitPrice: decStr,
  quantity: decStr,
  discountPct: z.preprocess((v) => (blank(v) === undefined ? 0 : Number(v)), z.number().min(0).max(99.99)),
  vatRate: z.preprocess((v) => (blank(v) === undefined ? "0.15" : String(v)), z.string().regex(/^0(\.\d{1,4})?$/)),
  leadTimeDays: z.preprocess(blank, z.coerce.number().int().min(0).max(730).optional()),
  supplierProductId: z.preprocess(blank, z.string().uuid().optional()),
  isAlternative: z.boolean().default(false),
  alternativeDescription: z.preprocess(blank, z.string().trim().max(2000).optional()),
  brand: z.preprocess(blank, z.string().trim().max(80).optional()),
  model: z.preprocess(blank, z.string().trim().max(80).optional()),
  origin: z.preprocess(blank, z.string().trim().max(60).optional()),
  exceptionNote: z.preprocess(blank, z.string().trim().max(2000).optional()),
});

export const quoteSchema = z.object({
  validUntil: z.preprocess(blank, z.coerce.date().optional()),
  leadTimeDays: z.preprocess(blank, z.coerce.number().int().min(0).max(730).optional()),
  paymentTerms: z.preprocess(blank, z.string().trim().max(2000).optional()),
  deliveryTerms: z.preprocess(blank, z.string().trim().max(2000).optional()),
  notes: z.preprocess(blank, z.string().trim().max(5000).optional()),
  exceptions: z.preprocess(blank, z.string().trim().max(5000).optional()),
  shippingAmount: decStr,
  lines: z.array(quoteLineSchema).max(5000),
});

/** Compute line and document totals server-side (never trust client totals). */
export function computeQuote(lines: z.output<typeof quoteLineSchema>[], shipping: string | undefined) {
  const computed = lines.map((l) => {
    if (!l.offered || !l.unitPrice || !l.quantity) return { ...l, totals: null };
    const t = lineTotals({ unitPrice: l.unitPrice, quantity: l.quantity, discount: money(dec(l.unitPrice).times(l.quantity).times(l.discountPct).div(100)), vatRate: l.vatRate });
    return { ...l, totals: t };
  });
  const offered = computed.filter((c) => c.totals);
  const doc = documentTotals(offered.map((c) => c.totals!), { shipping: shipping ?? "0", vatRate: "0.15" });
  return { lines: computed, doc, covered: offered.length };
}

/** Save the supplier's draft (creates version 1, or updates the current draft). */
export async function saveQuotation(ctx: Ctx, rfqId: string, input: z.input<typeof quoteSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  const d = quoteSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const { rfq, recipient } = await loadSupplierRfq(tx, ctx, rfqId);
    if (!acceptingQuotes(rfq, recipient.round, rfq.round)) throw invalidState("RFQ is not accepting quotations", { key: "rfq_not_open" });
    if (recipient.status === "declined") throw invalidState("You declined this RFQ", { key: "rfq_declined" });
    const rfqLines = await tx.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId));
    const byId = new Map(rfqLines.map((l) => [l.id, l]));
    for (const l of d.lines) {
      const rl = byId.get(l.rfqItemId);
      if (!rl) throw validation("Unknown RFQ line", { key: "rfq_line_unknown" });
      if (l.offered) {
        if (!l.unitPrice) throw validation(`Line ${rl.lineNo}: unit price required`, { key: "quote_price_required", line: rl.lineNo });
        const q = l.quantity ?? rl.quantity;
        if (dec(q).lte(0)) throw validation(`Line ${rl.lineNo}: quantity must be positive`, { key: "quote_qty_invalid", line: rl.lineNo });
        if (dec(q).gt(dec(rl.quantity))) throw validation(`Line ${rl.lineNo}: offered quantity exceeds requested`, { key: "quote_qty_exceeds", line: rl.lineNo });
        if (!rfq.allowPartialQuotes && dec(q).lt(dec(rl.quantity))) throw validation(`Line ${rl.lineNo}: partial quantities are not allowed`, { key: "quote_partial_not_allowed", line: rl.lineNo });
        if (l.isAlternative && !rfq.allowAlternatives) throw validation("Alternatives are not allowed for this RFQ", { key: "quote_alternatives_not_allowed" });
        if (l.isAlternative && !l.alternativeDescription) throw validation(`Line ${rl.lineNo}: describe the alternative`, { key: "quote_alternative_description", line: rl.lineNo });
        l.quantity = q;
      }
      if (l.supplierProductId) {
        const [sp] = await tx.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.id, l.supplierProductId), eq(supplierProducts.orgId, ctx.orgId))).limit(1);
        if (!sp) throw validation("Unknown product", { key: "product_unknown" });
      }
    }
    const calc = computeQuote(d.lines, d.shippingAmount);
    let [q] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true))).limit(1);
    if (q && q.status !== "draft") throw invalidState("Submitted quotations are revised by creating a new version", { key: "quote_not_draft" });
    const header = {
      validUntil: d.validUntil ?? null,
      leadTimeDays: d.leadTimeDays ?? null,
      paymentTerms: d.paymentTerms ?? null,
      deliveryTerms: d.deliveryTerms ?? null,
      notes: d.notes ?? null,
      exceptions: d.exceptions ?? null,
      shippingAmount: toDb(d.shippingAmount ?? "0"),
      subtotal: toDb(calc.doc.subtotal),
      discountTotal: toDb(calc.doc.discount),
      vatTotal: toDb(calc.doc.vat),
      total: toDb(calc.doc.total),
      coveredLines: calc.covered,
    };
    if (!q) {
      [q] = await tx.insert(quotations).values({ ...header, rfqId, buyerOrgId: rfq.orgId, supplierOrgId: ctx.orgId, version: 1, round: rfq.round, createdBy: ctx.userId }).returning();
    } else {
      [q] = await tx.update(quotations).set(header).where(eq(quotations.id, q.id)).returning();
      await tx.delete(quotationItems).where(eq(quotationItems.quotationId, q!.id));
    }
    if (calc.lines.length)
      await tx.insert(quotationItems).values(
        calc.lines.map((l) => ({
          quotationId: q!.id,
          rfqItemId: l.rfqItemId,
          buyerOrgId: rfq.orgId,
          supplierOrgId: ctx.orgId!,
          offered: l.offered,
          quantity: l.offered && l.quantity ? unit(l.quantity).toFixed(4) : null,
          unitPrice: l.offered && l.unitPrice ? unit(l.unitPrice).toFixed(4) : null,
          discountPct: dec(l.discountPct).toFixed(2),
          vatRate: l.vatRate,
          leadTimeDays: l.leadTimeDays ?? null,
          supplierProductId: l.supplierProductId ?? null,
          isAlternative: l.isAlternative,
          alternativeDescription: l.alternativeDescription ?? null,
          brand: l.brand ?? null,
          model: l.model ?? null,
          origin: l.origin ?? null,
          exceptionNote: l.exceptionNote ?? null,
          lineNet: toDb(l.totals?.net ?? 0),
          lineVat: toDb(l.totals?.vat ?? 0),
          lineTotal: toDb(l.totals?.total ?? 0),
        })),
      );
    return q!;
  });
}

/** Submit the current draft. Requires at least one offered line and a validity date. */
export async function submitQuotation(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const { rfq, recipient } = await loadSupplierRfq(tx, ctx, rfqId);
    if (!acceptingQuotes(rfq, recipient.round, rfq.round)) throw invalidState("RFQ is not accepting quotations", { key: "rfq_not_open" });
    const [q] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true))).limit(1).for("update");
    if (!q || q.status !== "draft") throw invalidState("No draft quotation to submit", { key: "quote_not_draft" });
    if (q.coveredLines < 1) throw validation("Quote at least one line", { key: "quote_empty" });
    if (!q.validUntil || q.validUntil.getTime() < Date.now()) throw validation("Validity date must be in the future", { key: "quote_validity" });
    // previous submitted version (revision) becomes superseded
    await tx.update(quotations).set({ status: "superseded" }).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.status, "submitted")));
    const [sub] = await tx.update(quotations).set({ status: "submitted", submittedAt: new Date(), submittedBy: ctx.userId, round: rfq.round }).where(eq(quotations.id, q.id)).returning();
    await markResponded(tx, rfqId, ctx.orgId);
    await audit(ctx, { action: "quotation.submitted", entityType: "quotation", entityId: q.id, data: { version: q.version, total: q.total } }, tx);
    await emit({ topic: "quotation.submitted", aggregateType: "quotation", aggregateId: q.id, orgId: rfq.orgId, payload: { quotationId: q.id, rfqId } }, tx);
    // notify buyer RFQ creator & evaluators
    await withContext({ userId: null, orgId: null, mode: "system" }, async (s) => {
      const [sup] = await s.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, ctx.orgId!)).limit(1);
      const users = await s
        .selectDistinct({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(and(eq(memberships.orgId, rfq.orgId), eq(memberships.status, "active"), sql`'rfq.evaluate' = any(${roles.permissions})`));
      const ids = new Set(users.map((u) => u.userId));
      if (rfq.createdBy) ids.add(rfq.createdBy);
      await notifyUsers({ userIds: [...ids], kind: "quotation.submitted", params: { rfqNumber: rfq.code, title: rfq.title, supplierName: sup?.nameAr ?? "" }, link: `/org/rfqs/${rfqId}/compare`, orgId: rfq.orgId, dedupeKey: `quote-submitted:${q.id}`, email: false }, s);
    });
    return sub!;
  });
}

/**
 * Start a revision: copy the submitted version into a new draft version. Allowed while the RFQ
 * accepts quotations and revisions are allowed (or during a revision round for this supplier).
 */
export async function reviseQuotation(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const { rfq, recipient } = await loadSupplierRfq(tx, ctx, rfqId);
    const inRound = rfq.status === "revision_requested" && recipient.round === rfq.round;
    if (!acceptingQuotes(rfq, recipient.round, rfq.round) || (!rfq.allowRevisions && !inRound)) throw invalidState("Revisions are not allowed now", { key: "quote_revision_not_allowed" });
    const [cur] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true))).limit(1).for("update");
    if (!cur || cur.status !== "submitted") throw invalidState("Only a submitted quotation can be revised", { key: "quote_not_submitted" });
    const items = await tx.select().from(quotationItems).where(eq(quotationItems.quotationId, cur.id));
    await tx.update(quotations).set({ isCurrent: false }).where(eq(quotations.id, cur.id));
    const { id: _id, createdAt: _c, updatedAt: _u, submittedAt: _s, submittedBy: _sb, ...rest } = cur;
    const [next] = await tx.insert(quotations).values({ ...rest, version: cur.version + 1, status: "draft", isCurrent: true, round: rfq.round, createdBy: ctx.userId }).returning();
    if (items.length) await tx.insert(quotationItems).values(items.map(({ id: _i, quotationId: _q, ...it }) => ({ ...it, quotationId: next!.id })));
    await audit(ctx, { action: "quotation.revision_started", entityType: "quotation", entityId: next!.id, data: { from: cur.version } }, tx);
    return next!;
  });
}

export async function withdrawQuotation(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const { rfq } = await loadSupplierRfq(tx, ctx, rfqId);
    if (["awarded", "closed"].includes(rfq.status)) throw invalidState("Cannot withdraw after award", { key: "quote_withdraw_late" });
    const rows = await tx.update(quotations).set({ status: "withdrawn" }).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true), eq(quotations.status, "submitted"))).returning({ id: quotations.id });
    if (!rows.length) throw invalidState("Nothing to withdraw", { key: "quote_not_submitted" });
    await audit(ctx, { action: "quotation.withdrawn", entityType: "quotation", entityId: rows[0]!.id }, tx);
  });
}

export async function addQuotationAttachment(ctx: Ctx, rfqId: string, file: { buffer: Buffer; fileName: string }) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const { rfq } = await loadSupplierRfq(tx, ctx, rfqId);
    const [q] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, ctx.orgId), eq(quotations.isCurrent, true))).limit(1);
    if (!q || q.status !== "draft") throw invalidState("Attach files to a draft quotation", { key: "quote_not_draft" });
    const f = await uploadFile(ctx, { buffer: file.buffer, fileName: file.fileName, ownerType: "quotation_attachment", ownerId: q.id, classification: "confidential" }, tx);
    await tx.insert(quotationAttachments).values({ quotationId: q.id, buyerOrgId: rfq.orgId, supplierOrgId: ctx.orgId, fileId: f.id });
    return f;
  });
}

// ------------------------------------------------------------------------------------------ buyer comparison

export interface MatrixCell {
  quotationId: string;
  quotationItemId: string;
  offered: boolean;
  unitPrice: string | null;
  quantity: string | null;
  discountPct: string;
  lineNet: string;
  lineVat: string;
  lineTotal: string;
  leadTimeDays: number | null;
  isAlternative: boolean;
  alternativeDescription: string | null;
  brand: string | null;
  model: string | null;
  exceptionNote: string | null;
  fullQuantity: boolean;
  lowestPrice: boolean;
}

/**
 * Comparison matrix built only from current submitted quotations the buyer can read (RLS).
 * Unit prices compared ex-VAT after discount; flags lowest effective price per line (among full and
 * partial offers) and per-supplier coverage. Lowest price is a signal, not a decision.
 */
export async function comparison(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "quotation.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [r] = await tx.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.orgId, ctx.orgId))).limit(1);
    if (!r) throw notFound("RFQ");
    const lines = await tx.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId)).orderBy(asc(rfqItems.lineNo));
    const qs = await tx
      .select({ q: quotations, nameAr: organizations.nameAr, nameEn: organizations.nameEn })
      .from(quotations)
      .innerJoin(organizations, eq(organizations.id, quotations.supplierOrgId))
      .where(and(eq(quotations.rfqId, rfqId), eq(quotations.status, "submitted")));
    const items = qs.length ? await tx.select().from(quotationItems).where(inArray(quotationItems.quotationId, qs.map((x) => x.q.id))) : [];
    const suppliers = qs.map(({ q, nameAr, nameEn }) => ({
      supplierOrgId: q.supplierOrgId,
      nameAr,
      nameEn,
      quotationId: q.id,
      version: q.version,
      validUntil: q.validUntil,
      leadTimeDays: q.leadTimeDays,
      paymentTerms: q.paymentTerms,
      deliveryTerms: q.deliveryTerms,
      exceptions: q.exceptions,
      notes: q.notes,
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      shippingAmount: q.shippingAmount,
      vatTotal: q.vatTotal,
      total: q.total,
      coveredLines: q.coveredLines,
      coveragePct: lines.length ? Math.round((q.coveredLines / lines.length) * 100) : 0,
      expired: Boolean(q.validUntil && q.validUntil.getTime() < Date.now()),
    }));
    const rows = lines.map((l) => {
      const cells: Record<string, MatrixCell> = {};
      for (const s of suppliers) {
        const it = items.find((i) => i.quotationId === s.quotationId && i.rfqItemId === l.id);
        if (!it) continue;
        const eff = it.unitPrice ? dec(it.unitPrice).times(dec(1).minus(dec(it.discountPct).div(100))) : null;
        cells[s.supplierOrgId] = {
          quotationId: s.quotationId,
          quotationItemId: it.id,
          offered: it.offered,
          unitPrice: eff ? unit(eff).toFixed(4) : null,
          quantity: it.quantity,
          discountPct: it.discountPct,
          lineNet: it.lineNet,
          lineVat: it.lineVat,
          lineTotal: it.lineTotal,
          leadTimeDays: it.leadTimeDays,
          isAlternative: it.isAlternative,
          alternativeDescription: it.alternativeDescription,
          brand: it.brand,
          model: it.model,
          exceptionNote: it.exceptionNote,
          fullQuantity: Boolean(it.quantity && dec(it.quantity).gte(dec(l.quantity))),
          lowestPrice: false,
        };
      }
      const offered = Object.values(cells).filter((c) => c.offered && c.unitPrice);
      const min = offered.reduce<string | null>((m, c) => (m === null || dec(c.unitPrice!).lt(dec(m)) ? c.unitPrice : m), null);
      for (const c of offered) if (min && dec(c.unitPrice!).eq(dec(min))) c.lowestPrice = true;
      const prices = offered.map((c) => dec(c.unitPrice!));
      const spreadPct = prices.length > 1 && !prices.reduce((a, b) => (a.lt(b) ? a : b)).isZero() ? Number(prices.reduce((a, b) => (a.gt(b) ? a : b)).div(prices.reduce((a, b) => (a.lt(b) ? a : b))).minus(1).times(100).toFixed(1)) : null;
      return { line: l, cells, offers: offered.length, minUnitPrice: min, spreadPct };
    });
    const bestCoverage = suppliers.reduce((m, s) => Math.max(m, s.coveredLines), 0);
    const lowestTotal = suppliers.filter((s) => s.coveredLines === lines.length).reduce<string | null>((m, s) => (m === null || dec(s.total).lt(dec(m)) ? s.total : m), null);
    return {
      rfq: r,
      suppliers: suppliers.map((s) => ({ ...s, bestCoverage: s.coveredLines === bestCoverage && bestCoverage > 0, lowestCompleteTotal: lowestTotal !== null && s.total === lowestTotal && s.coveredLines === lines.length })),
      rows,
    };
  });
}

/** Supplier products that could answer a line (helper for the quotation form). */
export async function myProductOptions(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  return withContext(dbCtx(ctx), (tx) =>
    tx.select({ id: supplierProducts.id, sku: supplierProducts.sku, nameAr: supplierProducts.nameAr, nameEn: supplierProducts.nameEn, canonicalProductId: supplierProducts.canonicalProductId }).from(supplierProducts).where(and(eq(supplierProducts.orgId, ctx.orgId), eq(supplierProducts.status, "active"))).limit(1000),
  );
}

