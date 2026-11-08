import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, dec, hashObject, invalidState, money, notFound, sum, toDb, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { withContext, type Tx } from "@platform/db";
import { awardLines, awards, evaluationScores, memberships, quotationItems, quotations, rfqEvents, rfqItems, rfqs } from "@platform/db/schema";
import { invalidateFor, latestRequest, onApprovalResolved, requestApproval } from "../approvals";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";

async function loadRfq(tx: Tx, ctx: Ctx, rfqId: string) {
  const [r] = await tx.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.orgId, ctx.orgId!))).limit(1);
  if (!r) throw notFound("RFQ");
  return r;
}

// ------------------------------------------------------------------------------------------ technical / financial notes

export const scoreSchema = z.object({
  rfqItemId: z.string().uuid(),
  supplierOrgId: z.string().uuid(),
  technicalStatus: z.enum(["compliant", "non_compliant", "clarification", "not_evaluated"]).optional(),
  technicalNote: z.string().trim().max(2000).optional().nullable(),
  financialNote: z.string().trim().max(2000).optional().nullable(),
});

export async function setEvaluation(ctx: Ctx, rfqId: string, input: z.input<typeof scoreSchema>) {
  requireOrg(ctx, "buyer");
  const d = scoreSchema.parse(input);
  if (d.technicalStatus !== undefined || d.technicalNote !== undefined) authorize(ctx, "evaluation.technical", { write: true });
  if (d.financialNote !== undefined) authorize(ctx, "evaluation.financial", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!["under_evaluation", "revision_requested", "partially_responded", "open"].includes(r.status)) throw invalidState("RFQ is not under evaluation", { key: "rfq_not_evaluating" });
    const set: Partial<typeof evaluationScores.$inferInsert> = { updatedBy: ctx.userId };
    if (d.technicalStatus !== undefined) set.technicalStatus = d.technicalStatus;
    if (d.technicalNote !== undefined) set.technicalNote = d.technicalNote;
    if (d.financialNote !== undefined) set.financialNote = d.financialNote;
    await tx
      .insert(evaluationScores)
      .values({ rfqId, orgId: ctx.orgId, rfqItemId: d.rfqItemId, supplierOrgId: d.supplierOrgId, ...set })
      .onConflictDoUpdate({ target: [evaluationScores.rfqId, evaluationScores.rfqItemId, evaluationScores.supplierOrgId], set });
    await tx.insert(rfqEvents).values({ rfqId, orgId: ctx.orgId, actorUserId: ctx.userId, kind: "evaluation_updated", data: { ...d } });
    // technical change can affect a pending/approved award
    if (d.technicalStatus === "non_compliant") await invalidateAwardIfUses(tx, ctx, rfqId, d.rfqItemId, d.supplierOrgId);
  });
}

export async function listEvaluations(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "quotation.view");
  return withContext(dbCtx(ctx), async (tx) => {
    await loadRfq(tx, ctx, rfqId);
    return tx.select().from(evaluationScores).where(eq(evaluationScores.rfqId, rfqId));
  });
}

// ------------------------------------------------------------------------------------------ awards

async function currentAward(tx: Tx, ctx: Ctx, rfqId: string, create: boolean) {
  const [a] = await tx.select().from(awards).where(and(eq(awards.rfqId, rfqId), inArray(awards.status, ["draft", "pending_approval", "approved"]))).orderBy(desc(awards.createdAt)).limit(1);
  if (a || !create) return a ?? null;
  const [n] = await tx.insert(awards).values({ rfqId, orgId: ctx.orgId! }).returning();
  return n!;
}

function awardSnapshot(lines: (typeof awardLines.$inferSelect)[]) {
  return lines
    .map((l) => ({ i: l.rfqItemId, s: l.supplierOrgId, q: l.quantity, p: l.unitPrice, qi: l.quotationItemId }))
    .sort((a, b) => a.i.localeCompare(b.i));
}

/** Award becomes stale (approval invalidated, back to draft) when a material input changes. */
async function reopenAward(tx: Tx, ctx: Ctx, award: typeof awards.$inferSelect, reason: string) {
  if (award.status === "draft") return award;
  const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, award.id), eq(awardLines.isCurrent, true)));
  await invalidateFor(tx, "award", award.id, `changed:${Date.now()}`);
  await tx.update(awards).set({ status: "invalidated" }).where(eq(awards.id, award.id));
  const [n] = await tx.insert(awards).values({ rfqId: award.rfqId, orgId: award.orgId, notes: award.notes }).returning();
  if (lines.length) await tx.insert(awardLines).values(lines.map(({ id: _i, awardId: _a, decidedAt: _d, ...l }) => ({ ...l, awardId: n!.id })));
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, award.rfqId)).limit(1);
  if (r?.status === "awarded") {
    await tx.update(rfqs).set({ status: "under_evaluation", awardedAt: null }).where(eq(rfqs.id, r.id));
    await tx.insert(rfqEvents).values({ rfqId: r.id, orgId: r.orgId, actorUserId: ctx.userId, fromStatus: "awarded", toStatus: "under_evaluation", kind: "award_invalidated", data: { reason } });
  }
  await audit(ctx, { action: "award.invalidated", entityType: "award", entityId: award.id, data: { reason } }, tx);
  return n!;
}

async function invalidateAwardIfUses(tx: Tx, ctx: Ctx, rfqId: string, rfqItemId: string, supplierOrgId: string) {
  const a = await currentAward(tx, ctx, rfqId, false);
  if (!a || a.status === "draft") return;
  const [hit] = await tx.select({ id: awardLines.id }).from(awardLines).where(and(eq(awardLines.awardId, a.id), eq(awardLines.isCurrent, true), eq(awardLines.rfqItemId, rfqItemId), eq(awardLines.supplierOrgId, supplierOrgId))).limit(1);
  if (hit) await reopenAward(tx, ctx, a, "technical_non_compliant");
}

export const awardLineSchema = z.object({
  rfqItemId: z.string().uuid(),
  supplierOrgId: z.string().uuid().nullable(),
  quantity: z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : parseLocaleNumber(v)), z.string().optional()),
  reason: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Select a supplier for one RFQ line (or explicitly none). Must reference that supplier's current
 * submitted quotation offering the line; technically non-compliant offers cannot be awarded. A new
 * decision supersedes the previous one (history kept). Changing a submitted/approved award reopens it.
 */
export async function selectAward(ctx: Ctx, rfqId: string, input: z.input<typeof awardLineSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "award.create", { write: true });
  const d = awardLineSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!["under_evaluation", "awarded"].includes(r.status)) throw invalidState("Awards are made during evaluation", { key: "rfq_not_evaluating" });
    const [line] = await tx.select().from(rfqItems).where(and(eq(rfqItems.id, d.rfqItemId), eq(rfqItems.rfqId, rfqId))).limit(1);
    if (!line) throw notFound("RFQ line");
    let award = await currentAward(tx, ctx, rfqId, true);
    const posExist = await tx.execute(sql`select 1 from purchase_orders where award_id = ${award!.id} and approval_status <> 'cancelled' limit 1`);
    if (posExist.rows.length) throw invalidState("Purchase orders already exist for this award", { key: "award_has_pos" });
    let values: Partial<typeof awardLines.$inferInsert> = { supplierOrgId: null, quotationId: null, quotationItemId: null, quantity: null, unitPrice: null, lineTotal: null };
    if (d.supplierOrgId) {
      const [q] = await tx.select().from(quotations).where(and(eq(quotations.rfqId, rfqId), eq(quotations.supplierOrgId, d.supplierOrgId), eq(quotations.status, "submitted"))).limit(1);
      if (!q) throw validation("Supplier has no submitted quotation", { key: "award_no_quote" });
      if (q.validUntil && q.validUntil.getTime() < Date.now()) throw validation("Quotation validity has expired", { key: "award_quote_expired" });
      const [qi] = await tx.select().from(quotationItems).where(and(eq(quotationItems.quotationId, q.id), eq(quotationItems.rfqItemId, line.id))).limit(1);
      if (!qi || !qi.offered || !qi.unitPrice || !qi.quantity) throw validation("Supplier did not quote this line", { key: "award_line_not_quoted" });
      const [ev] = await tx.select().from(evaluationScores).where(and(eq(evaluationScores.rfqId, rfqId), eq(evaluationScores.rfqItemId, line.id), eq(evaluationScores.supplierOrgId, d.supplierOrgId))).limit(1);
      if (ev?.technicalStatus === "non_compliant") throw validation("Technically non-compliant offers cannot be awarded", { key: "award_non_compliant" });
      const qty = d.quantity ?? qi.quantity;
      if (dec(qty).lte(0) || dec(qty).gt(dec(qi.quantity))) throw validation("Awarded quantity must be within the offered quantity", { key: "award_qty_invalid" });
      const eff = dec(qi.unitPrice).times(dec(1).minus(dec(qi.discountPct).div(100)));
      values = { supplierOrgId: d.supplierOrgId, quotationId: q.id, quotationItemId: qi.id, quantity: dec(qty).toFixed(4), unitPrice: eff.toFixed(4), lineTotal: toDb(money(eff.times(qty))) };
    }
    award = await reopenAward(tx, ctx, award!, "selection_changed");
    await tx.update(awardLines).set({ isCurrent: false }).where(and(eq(awardLines.awardId, award.id), eq(awardLines.rfqItemId, line.id), eq(awardLines.isCurrent, true)));
    await tx.insert(awardLines).values({ ...values, awardId: award.id, rfqId, orgId: ctx.orgId, rfqItemId: line.id, reason: d.reason ?? null, decidedBy: ctx.userId });
    await tx.insert(rfqEvents).values({ rfqId, orgId: ctx.orgId, actorUserId: ctx.userId, kind: "award_line_selected", data: { rfqItemId: line.id, supplierOrgId: d.supplierOrgId, reason: d.reason } });
    return { awardId: award.id };
  });
}

export async function getAward(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "quotation.view");
  return withContext(dbCtx(ctx), async (tx) => {
    await loadRfq(tx, ctx, rfqId);
    const award = await currentAward(tx, ctx, rfqId, false);
    if (!award) return { award: null, lines: [], history: [], approval: null };
    const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, award.id), eq(awardLines.isCurrent, true)));
    const history = await tx
      .select({ l: awardLines, by: sql<string>`(select name from auth_users u where u.id = ${awardLines.decidedBy})` })
      .from(awardLines)
      .where(eq(awardLines.rfqId, rfqId))
      .orderBy(desc(awardLines.decidedAt))
      .limit(200);
    const approval = await latestRequest(tx, "award", award.id);
    return { award, lines, history, approval };
  });
}

/** Submit the award for approval (operation `award`, amount = awarded total). */
export async function submitAward(ctx: Ctx, rfqId: string, notes?: string | null) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "award.create", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (r.status !== "under_evaluation") throw invalidState("RFQ is not under evaluation", { key: "rfq_not_evaluating" });
    const award = await currentAward(tx, ctx, rfqId, false);
    if (!award || award.status !== "draft") throw invalidState("No draft award", { key: "award_not_draft" });
    const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, award.id), eq(awardLines.isCurrent, true)));
    const awarded = lines.filter((l) => l.supplierOrgId);
    if (!awarded.length) throw new AppError("VALIDATION", "Award at least one line", { key: "award_empty" });
    // all referenced quotations must still be current & submitted
    const qIds = [...new Set(awarded.map((l) => l.quotationId!))];
    const qs = await tx.select().from(quotations).where(inArray(quotations.id, qIds));
    if (qs.some((q) => q.status !== "submitted")) throw invalidState("A selected quotation was revised or withdrawn; reselect", { key: "award_quote_stale" });
    const total = sum(awarded.map((l) => l.lineTotal ?? "0"));
    const hash = hashObject(awardSnapshot(lines));
    await tx.update(awards).set({ status: "pending_approval", total: toDb(total), subjectHash: hash, notes: notes ?? award.notes, submittedBy: ctx.userId, submittedAt: new Date() }).where(eq(awards.id, award.id));
    const res = await requestApproval(tx, ctx, { operation: "award", subjectType: "award", subjectId: award.id, subjectLabel: `${r.code} — ${r.title}`, snapshot: awardSnapshot(lines), amount: toDb(total), projectId: r.projectId });
    await tx.update(awards).set({ approvalRequestId: res.requestId }).where(eq(awards.id, award.id));
    if (res.status === "auto_approved") await applyAwardApproved(tx, ctx, award.id);
    await audit(ctx, { action: "award.submitted", entityType: "award", entityId: award.id, data: { total: toDb(total), lines: awarded.length } }, tx);
    return { status: res.status, awardId: award.id };
  });
}

async function applyAwardApproved(tx: Tx, ctx: Ctx, awardId: string) {
  const [a] = await tx.update(awards).set({ status: "approved", decidedAt: new Date() }).where(eq(awards.id, awardId)).returning();
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, a!.rfqId)).limit(1);
  if (r?.status === "under_evaluation") {
    await tx.update(rfqs).set({ status: "awarded", awardedAt: new Date() }).where(eq(rfqs.id, r.id));
    await tx.insert(rfqEvents).values({ rfqId: r.id, orgId: r.orgId, actorUserId: ctx.userId, fromStatus: "under_evaluation", toStatus: "awarded", kind: "awarded", data: { awardId } });
  }
  const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, awardId), eq(awardLines.isCurrent, true)));
  const winners = [...new Set(lines.map((l) => l.supplierOrgId).filter(Boolean))] as string[];
  await withContext({ userId: null, orgId: null, mode: "system" }, async (s) => {
    for (const w of winners) {
      const users = await s.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, w), eq(memberships.status, "active")));
      await notifyUsers({ userIds: users.map((u) => u.userId), kind: "award.decided", params: { rfqNumber: r!.code, title: r!.title }, link: `/supplier/rfqs/${r!.id}`, orgId: w, dedupeKey: `award:${awardId}:${w}`, email: true }, s);
    }
  });
  await emit({ topic: "award.approved", aggregateType: "award", aggregateId: awardId, orgId: r!.orgId, payload: { awardId, rfqId: r!.id } }, tx);
}

onApprovalResolved("award", async (tx, ctx, req, outcome) => {
  const [a] = await tx.select().from(awards).where(eq(awards.id, req.subjectId)).limit(1);
  if (!a || a.status !== "pending_approval") return;
  if (outcome === "approved") {
    const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, a.id), eq(awardLines.isCurrent, true)));
    if (hashObject(awardSnapshot(lines)) !== req.subjectHash) throw new AppError("INVALID_STATE", "Award changed since approval was requested", { key: "approval_invalidated" });
    await applyAwardApproved(tx, ctx, a.id);
  } else {
    await tx.update(awards).set({ status: "rejected", decidedAt: new Date() }).where(eq(awards.id, a.id));
  }
});

/** Hash of the current award content (used by the approval UI to detect changes before deciding). */
export async function awardHash(tx: Tx, awardId: string): Promise<string> {
  const lines = await tx.select().from(awardLines).where(and(eq(awardLines.awardId, awardId), eq(awardLines.isCurrent, true))).orderBy(asc(awardLines.rfqItemId));
  return hashObject(awardSnapshot(lines));
}
