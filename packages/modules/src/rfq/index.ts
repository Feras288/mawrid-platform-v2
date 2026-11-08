import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, dec, defineMachine, invalidState, notFound, validation } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { nextDocNumber, pageParams, withContext, withSystem, type Tx } from "@platform/db";
import {
  authUsers,
  boqVersions,
  categories,
  memberships,
  membershipRoles,
  organizations,
  rfqAttachments,
  rfqEvents,
  rfqItems,
  rfqRecipientEvents,
  rfqRecipients,
  rfqs,
  roles,
  supplierCategories,
  supplierProducts,
  supplierProfiles,
  units,
} from "@platform/db/schema";
import { onApprovalResolved, requestApproval } from "../approvals";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { uploadFile } from "../files";
import { idempotent } from "../idempotency";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";
import { assertProjectAccess, logActivity } from "../projects";

export type RfqStatus = (typeof rfqMachine.states)[number];

export const rfqMachine = defineMachine({
  name: "rfq",
  states: ["draft", "pending_review", "approved_for_sending", "sending", "open", "partially_responded", "under_evaluation", "revision_requested", "awarded", "closed", "cancelled"] as const,
  transitions: {
    draft: ["pending_review", "cancelled"],
    pending_review: ["draft", "approved_for_sending", "cancelled"],
    approved_for_sending: ["sending", "draft", "cancelled"],
    sending: ["open", "cancelled"],
    open: ["partially_responded", "under_evaluation", "cancelled"],
    partially_responded: ["under_evaluation", "cancelled"],
    under_evaluation: ["revision_requested", "awarded", "cancelled"],
    revision_requested: ["under_evaluation", "cancelled"],
    awarded: ["closed", "under_evaluation"],
    closed: [],
    cancelled: [],
  },
  terminal: ["closed", "cancelled"],
});

const EDITABLE: RfqStatus[] = ["draft"];

async function transition(tx: Tx, ctx: Ctx, rfqId: string, to: RfqStatus, kind = "status_changed", data: Record<string, unknown> = {}) {
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1).for("update");
  if (!r) throw notFound("RFQ");
  rfqMachine.assert(r.status as RfqStatus, to);
  const now = new Date();
  await tx
    .update(rfqs)
    .set({
      status: to,
      submittedAt: to === "pending_review" ? now : r.submittedAt,
      sentAt: to === "open" ? (r.sentAt ?? now) : r.sentAt,
      awardedAt: to === "awarded" ? now : r.awardedAt,
      closedAt: to === "closed" || to === "cancelled" ? now : r.closedAt,
    })
    .where(eq(rfqs.id, rfqId));
  await tx.insert(rfqEvents).values({ rfqId, orgId: r.orgId, actorUserId: ctx.userId, fromStatus: r.status, toStatus: to, kind, data });
  await emit({ topic: "rfq.status_changed", aggregateType: "rfq", aggregateId: rfqId, orgId: r.orgId, payload: { from: r.status, to } }, tx);
  return r;
}

async function loadRfq(tx: Tx, ctx: Ctx, rfqId: string) {
  const [r] = await tx.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.orgId, ctx.orgId!))).limit(1);
  if (!r) throw notFound("RFQ");
  if (r.projectId)
    await assertProjectAccess(tx, ctx, r.projectId).catch(() => {
      throw notFound("RFQ");
    });
  return r;
}

// ------------------------------------------------------------------------------------------ create & edit

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

export const rfqSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  projectId: z.preprocess(blank, z.string().uuid().optional()),
  boqVersionId: z.preprocess(blank, z.string().uuid().optional()),
  boqItemIds: z.array(z.string().uuid()).optional(),
  closesAt: z.preprocess(blank, z.coerce.date().optional()),
  requiredBy: z.preprocess(blank, z.coerce.date().optional()),
  deliveryCity: z.string().trim().max(60).optional().nullable(),
  deliveryAddress: z.string().trim().max(300).optional().nullable(),
  deliveryTerms: z.string().trim().max(2000).optional().nullable(),
  paymentTerms: z.string().trim().max(2000).optional().nullable(),
  allowRevisions: z.boolean().default(true),
  allowPartialQuotes: z.boolean().default(true),
  allowAlternatives: z.boolean().default(true),
});

export async function createRfq(ctx: Ctx, input: z.input<typeof rfqSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  const d = rfqSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    await assertProjectAccess(tx, ctx, d.projectId);
    let lines: { boqItemId: string | null; canonicalProductId: string | null; categoryId: string | null; section: string | null; description: string; quantity: string; unit: string; attributes: Record<string, string | number | boolean> }[] = [];
    let projectId = d.projectId ?? null;
    if (d.boqVersionId) {
      const [v] = await tx.select().from(boqVersions).where(and(eq(boqVersions.id, d.boqVersionId), eq(boqVersions.orgId, ctx.orgId))).limit(1);
      if (!v) throw notFound("BOQ version");
      const doc = await tx.execute(sql`select project_id from boq_documents where id = ${v.documentId}`);
      projectId = projectId ?? ((doc.rows[0] as { project_id: string | null } | undefined)?.project_id ?? null);
      await assertProjectAccess(tx, ctx, projectId);
      const chosen = d.boqItemIds?.length ? new Set(d.boqItemIds) : null;
      lines = v.lines
        .filter((l) => !chosen || chosen.has(l.itemId))
        .map((l) => ({ boqItemId: l.itemId, canonicalProductId: l.canonicalProductId, categoryId: l.categoryId, section: l.section, description: l.description, quantity: l.quantity, unit: l.unit, attributes: l.attributes }));
      if (!lines.length) throw validation("Select at least one BOQ line", { key: "rfq_no_lines" });
    }
    const code = await nextDocNumber(tx, ctx.orgId, "rfq", "RFQ");
    const [r] = await tx
      .insert(rfqs)
      .values({
        orgId: ctx.orgId,
        projectId,
        boqVersionId: d.boqVersionId ?? null,
        code,
        title: d.title,
        description: d.description ?? null,
        closesAt: d.closesAt ?? null,
        requiredBy: d.requiredBy ?? null,
        deliveryCity: d.deliveryCity ?? null,
        deliveryAddress: d.deliveryAddress ?? null,
        deliveryTerms: d.deliveryTerms ?? null,
        paymentTerms: d.paymentTerms ?? null,
        allowRevisions: d.allowRevisions,
        allowPartialQuotes: d.allowPartialQuotes,
        allowAlternatives: d.allowAlternatives,
        createdBy: ctx.userId,
      })
      .returning();
    if (lines.length) await tx.insert(rfqItems).values(lines.map((l, i) => ({ ...l, rfqId: r!.id, orgId: ctx.orgId, lineNo: i + 1 })));
    await tx.insert(rfqEvents).values({ rfqId: r!.id, orgId: ctx.orgId, actorUserId: ctx.userId, toStatus: "draft", kind: "created", data: { lines: lines.length } });
    if (projectId) await logActivity(tx, ctx, projectId, "rfq.created", { type: "rfq", id: r!.id }, { code });
    await audit(ctx, { action: "rfq.created", entityType: "rfq", entityId: r!.id, data: { lines: lines.length } }, tx);
    return r!;
  });
}

export async function updateRfq(ctx: Ctx, rfqId: string, input: Partial<z.input<typeof rfqSchema>>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  const d = rfqSchema.partial().parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!EDITABLE.includes(r.status as RfqStatus)) throw invalidState("RFQ can only be edited as a draft", { key: "rfq_not_draft" });
    const { boqVersionId: _v, boqItemIds: _i, projectId: _p, ...fields } = d;
    const [row] = await tx.update(rfqs).set(fields).where(eq(rfqs.id, rfqId)).returning();
    return row!;
  });
}

export const itemSchema = z.object({
  description: z.string().trim().min(2).max(4000),
  quantity: z
    .union([z.string(), z.number()])
    .transform((v) => parseLocaleNumber(v))
    .refine((v) => v !== null && Number(v) > 0, "Invalid quantity"),
  unit: z.string().trim().min(1).max(10),
  categoryId: z.preprocess(blank, z.string().uuid().optional()),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function addRfqItem(ctx: Ctx, rfqId: string, input: z.input<typeof itemSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  const d = itemSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!EDITABLE.includes(r.status as RfqStatus)) throw invalidState("RFQ can only be edited as a draft", { key: "rfq_not_draft" });
    const [u] = await tx.select({ code: units.code }).from(units).where(eq(units.code, d.unit)).limit(1);
    if (!u) throw validation("Unknown unit", { key: "unit_unknown" });
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${rfqItems.lineNo}),0)::int` }).from(rfqItems).where(eq(rfqItems.rfqId, rfqId));
    const [row] = await tx.insert(rfqItems).values({ rfqId, orgId: ctx.orgId, lineNo: (max?.n ?? 0) + 1, description: d.description, quantity: dec(d.quantity!).toFixed(4), unit: d.unit, categoryId: d.categoryId ?? null, notes: d.notes ?? null }).returning();
    return row!;
  });
}

export async function removeRfqItem(ctx: Ctx, itemId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [it] = await tx.select().from(rfqItems).where(and(eq(rfqItems.id, itemId), eq(rfqItems.orgId, ctx.orgId))).limit(1);
    if (!it) throw notFound("Item");
    const r = await loadRfq(tx, ctx, it.rfqId);
    if (!EDITABLE.includes(r.status as RfqStatus)) throw invalidState("RFQ can only be edited as a draft", { key: "rfq_not_draft" });
    await tx.delete(rfqItems).where(eq(rfqItems.id, itemId));
  });
}

export async function addRfqAttachment(ctx: Ctx, rfqId: string, file: { buffer: Buffer; fileName: string }) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!["draft", "pending_review"].includes(r.status)) throw invalidState("Attachments can be added before sending", { key: "rfq_not_draft" });
    const f = await uploadFile(ctx, { buffer: file.buffer, fileName: file.fileName, ownerType: "rfq_attachment", ownerId: rfqId, classification: "confidential" }, tx);
    const [a] = await tx.insert(rfqAttachments).values({ rfqId, orgId: ctx.orgId, fileId: f.id }).returning();
    return a!;
  });
}

// ------------------------------------------------------------------------------------------ suppliers

export interface SupplierSuggestion {
  orgId: string;
  nameAr: string;
  nameEn: string;
  score: number;
  reasons: string[];
  coveredCategories: number;
  matchingProducts: number;
  preferred: boolean;
}

/**
 * Suggest approved suppliers for an RFQ from category coverage, regional coverage, catalog products
 * matching the RFQ lines, and org preferences. Suggestions are guidance only, not a guarantee.
 */
export async function suggestSuppliers(ctx: Ctx, rfqId: string, limit = 20): Promise<SupplierSuggestion[]> {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    const items = await tx.select({ categoryId: rfqItems.categoryId, canonicalProductId: rfqItems.canonicalProductId }).from(rfqItems).where(eq(rfqItems.rfqId, rfqId));
    const catIds = [...new Set(items.map((i) => i.categoryId).filter(Boolean))] as string[];
    const parentIds = catIds.length ? (await tx.select({ parentId: categories.parentId }).from(categories).where(inArray(categories.id, catIds))).map((c) => c.parentId).filter(Boolean) : [];
    const canonIds = [...new Set(items.map((i) => i.canonicalProductId).filter(Boolean))] as string[];
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const preferred = new Set(org?.settings.preferredSupplierIds ?? []);
    const blocked = new Set(org?.settings.blockedSupplierIds ?? []);
    const regionRow = r.deliveryCity ? await tx.execute(sql`select region_code from cities where code = ${r.deliveryCity}`) : null;
    const region = (regionRow?.rows[0] as { region_code?: string } | undefined)?.region_code ?? null;
    const sups = await tx
      .select({ orgId: supplierProfiles.orgId, nameAr: organizations.nameAr, nameEn: organizations.nameEn, regions: supplierProfiles.coverageRegions, nationwide: supplierProfiles.deliversNationwide })
      .from(supplierProfiles)
      .innerJoin(organizations, eq(organizations.id, supplierProfiles.orgId))
      .where(and(eq(supplierProfiles.status, "approved"), eq(supplierProfiles.acceptsRfqs, true)));
    const supCats = sups.length ? await tx.select().from(supplierCategories).where(inArray(supplierCategories.orgId, sups.map((s) => s.orgId))) : [];
    const prodCounts = canonIds.length
      ? await tx
          .select({ orgId: supplierProducts.orgId, n: sql<number>`count(distinct ${supplierProducts.canonicalProductId})::int` })
          .from(supplierProducts)
          .where(and(inArray(supplierProducts.canonicalProductId, canonIds), eq(supplierProducts.status, "active")))
          .groupBy(supplierProducts.orgId)
      : [];
    const out: SupplierSuggestion[] = [];
    for (const s of sups) {
      if (blocked.has(s.orgId)) continue;
      const mine = new Set(supCats.filter((c) => c.orgId === s.orgId).map((c) => c.categoryId));
      const covered = catIds.filter((c) => mine.has(c)).length + parentIds.filter((p) => p && mine.has(p)).length * 0.5;
      const products = prodCounts.find((p) => p.orgId === s.orgId)?.n ?? 0;
      const regionOk = s.nationwide || (region ? s.regions.includes(region) : false);
      const reasons: string[] = [];
      let score = 0;
      if (catIds.length) {
        const ratio = Math.min(1, covered / catIds.length);
        score += 0.5 * ratio;
        if (ratio > 0) reasons.push("category_coverage");
      }
      if (canonIds.length && products) {
        score += 0.3 * Math.min(1, products / canonIds.length);
        reasons.push("catalog_products");
      }
      if (regionOk) {
        score += 0.15;
        reasons.push(s.nationwide ? "nationwide" : "region_coverage");
      }
      if (preferred.has(s.orgId)) {
        score += 0.1;
        reasons.push("preferred");
      }
      if (score <= 0) continue;
      out.push({ orgId: s.orgId, nameAr: s.nameAr, nameEn: s.nameEn, score: Number(score.toFixed(3)), reasons, coveredCategories: Math.floor(covered), matchingProducts: products, preferred: preferred.has(s.orgId) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  });
}

/** Replace the recipient list (draft / pending review). Only approved suppliers accepting RFQs. */
export async function setRecipients(ctx: Ctx, rfqId: string, supplierOrgIds: string[], source: "manual" | "suggestion" = "manual") {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.create", { write: true });
  const ids = [...new Set(z.array(z.string().uuid()).max(100).parse(supplierOrgIds))];
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!["draft", "pending_review"].includes(r.status)) throw invalidState("Recipients can be changed before sending", { key: "rfq_not_draft" });
    if (ids.length) {
      const ok = await tx.select({ orgId: supplierProfiles.orgId }).from(supplierProfiles).where(and(inArray(supplierProfiles.orgId, ids), eq(supplierProfiles.status, "approved"), eq(supplierProfiles.acceptsRfqs, true)));
      if (ok.length !== ids.length) throw validation("Only approved suppliers accepting RFQs can be invited", { key: "supplier_not_eligible" });
    }
    await tx.delete(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), ids.length ? notInArray(rfqRecipients.supplierOrgId, ids) : undefined));
    for (const sid of ids) await tx.insert(rfqRecipients).values({ rfqId, orgId: ctx.orgId, supplierOrgId: sid, suggestedBy: source }).onConflictDoNothing();
    await audit(ctx, { action: "rfq.recipients_set", entityType: "rfq", entityId: rfqId, data: { count: ids.length } }, tx);
    return { count: ids.length };
  });
}

// ------------------------------------------------------------------------------------------ submit / approve / send

function snapshot(r: typeof rfqs.$inferSelect, items: (typeof rfqItems.$inferSelect)[], recipients: string[]) {
  return { title: r.title, closesAt: r.closesAt?.toISOString() ?? null, terms: [r.deliveryTerms, r.paymentTerms], items: items.map((i) => [i.description, i.quantity, i.unit]), recipients: [...recipients].sort() };
}

/** Submit for review. Opens an approval request (operation rfq_send) or auto-approves if no policy. */
export async function submitRfq(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    const items = await tx.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId));
    const recips = await tx.select({ supplierOrgId: rfqRecipients.supplierOrgId }).from(rfqRecipients).where(eq(rfqRecipients.rfqId, rfqId));
    const problems: string[] = [];
    if (!items.length) problems.push("no_lines");
    if (!recips.length) problems.push("no_recipients");
    if (!r.closesAt || r.closesAt.getTime() < Date.now() + 60 * 60 * 1000) problems.push("closing_date");
    if (problems.length) throw new AppError("VALIDATION", "RFQ is incomplete", { key: "rfq_incomplete", details: { problems } });
    await transition(tx, ctx, rfqId, "pending_review", "submitted");
    const res = await requestApproval(tx, ctx, { operation: "rfq_send", subjectType: "rfq", subjectId: rfqId, subjectLabel: `${r.code} — ${r.title}`, snapshot: snapshot(r, items, recips.map((x) => x.supplierOrgId)), amount: null, projectId: r.projectId });
    if (res.status === "auto_approved") await transition(tx, ctx, rfqId, "approved_for_sending", "auto_approved");
    return res;
  });
}

onApprovalResolved("rfq", async (tx, ctx, req, outcome) => {
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, req.subjectId)).limit(1);
  if (!r || r.status !== "pending_review") return;
  await transition(tx, ctx, r.id, outcome === "approved" ? "approved_for_sending" : "draft", outcome === "approved" ? "send_approved" : "send_rejected", { requestId: req.id });
});

/** Return a submitted RFQ to draft (withdraw before approval). */
export async function withdrawRfq(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.submit", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    await loadRfq(tx, ctx, rfqId);
    await transition(tx, ctx, rfqId, "draft", "withdrawn");
    await tx.execute(sql`update approval_requests set status = 'cancelled' where subject_type = 'rfq' and subject_id = ${rfqId} and status = 'pending'`);
  });
}

/**
 * Send to all recipients (idempotent per key). Each recipient is prepared and a delivery job is
 * enqueued via the outbox; delivery results are tracked per recipient.
 */
export async function sendRfq(ctx: Ctx, rfqId: string, idempotencyKey: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.send", { write: true });
  return withContext(dbCtx(ctx), async (tx) =>
    idempotent(`rfq-send:${ctx.orgId}`, idempotencyKey, { rfqId }, async () => {
      const r = await loadRfq(tx, ctx, rfqId);
      if (r.closesAt && r.closesAt.getTime() < Date.now()) throw invalidState("Closing date has passed", { key: "rfq_closing_passed" });
      await transition(tx, ctx, rfqId, "sending", "sending");
      const recips = await tx.update(rfqRecipients).set({ status: "prepared", round: r.round }).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.status, "pending"))).returning();
      for (const rc of recips) {
        await tx.insert(rfqRecipientEvents).values({ recipientId: rc.id, orgId: ctx.orgId!, supplierOrgId: rc.supplierOrgId, kind: "prepared" });
        await emit({ topic: "rfq.recipient_send", aggregateType: "rfq_recipient", aggregateId: rc.id, orgId: ctx.orgId, payload: { recipientId: rc.id }, dedupeKey: `rfq-send:${rc.id}:${r.round}` }, tx);
      }
      await audit(ctx, { action: "rfq.sent", entityType: "rfq", entityId: rfqId, data: { recipients: recips.length } }, tx);
      return { recipients: recips.length };
    }),
  );
}

/** Worker: deliver one recipient (in-app + email to supplier users who can view RFQs). Idempotent. */
export async function deliverRecipient(recipientId: string): Promise<"sent" | "failed" | "noop"> {
  return withSystem(async (tx) => {
    const [rc] = await tx.select().from(rfqRecipients).where(eq(rfqRecipients.id, recipientId)).limit(1).for("update");
    if (!rc || !["prepared", "failed"].includes(rc.status)) return "noop";
    const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, rc.rfqId)).limit(1);
    const [buyer] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn }).from(organizations).where(eq(organizations.id, rc.orgId)).limit(1);
    const users = await tx
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(and(eq(memberships.orgId, rc.supplierOrgId), eq(memberships.status, "active"), sql`'supplier.rfq.view' = any(${roles.permissions})`));
    const attempts = rc.attempts + 1;
    if (!users.length) {
      await tx.update(rfqRecipients).set({ status: "failed", attempts, lastAttemptAt: new Date(), lastError: "no_recipient_users" }).where(eq(rfqRecipients.id, rc.id));
      await tx.insert(rfqRecipientEvents).values({ recipientId: rc.id, orgId: rc.orgId, supplierOrgId: rc.supplierOrgId, kind: "failed", detail: { reason: "no_recipient_users" } });
      await maybeOpen(tx, rc.rfqId);
      return "failed";
    }
    await notifyUsers(
      {
        userIds: users.map((u) => u.userId),
        kind: "rfq.invitation",
        params: { rfqNumber: r!.code, title: r!.title, buyerName: buyer?.nameAr ?? "", closesAt: r!.closesAt?.toISOString().slice(0, 16).replace("T", " ") ?? "" },
        link: `/supplier/rfqs/${r!.id}`,
        orgId: rc.supplierOrgId,
        dedupeKey: `rfq-invite:${rc.id}:${rc.round}`,
        email: true,
      },
      tx,
    );
    await tx.update(rfqRecipients).set({ status: "sent", attempts, lastAttemptAt: new Date(), sentAt: new Date(), lastError: null }).where(eq(rfqRecipients.id, rc.id));
    await tx.insert(rfqRecipientEvents).values({ recipientId: rc.id, orgId: rc.orgId, supplierOrgId: rc.supplierOrgId, kind: "sent", detail: { users: users.length } });
    await maybeOpen(tx, rc.rfqId);
    return "sent";
  });
}

async function maybeOpen(tx: Tx, rfqId: string) {
  const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  if (r?.status !== "sending") return;
  const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), inArray(rfqRecipients.status, ["pending", "prepared"])));
  if ((p?.n ?? 0) === 0) {
    await tx.update(rfqs).set({ status: "open", sentAt: new Date() }).where(eq(rfqs.id, rfqId));
    await tx.insert(rfqEvents).values({ rfqId, orgId: r.orgId, fromStatus: "sending", toStatus: "open", kind: "opened" });
  }
}

/** Retry a failed recipient (buyer action). */
export async function resendRecipient(ctx: Ctx, recipientId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.send", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [rc] = await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.id, recipientId), eq(rfqRecipients.orgId, ctx.orgId))).limit(1);
    if (!rc) throw notFound("Recipient");
    if (rc.status !== "failed") throw invalidState("Only failed deliveries can be resent", { key: "recipient_not_failed" });
    await tx.insert(rfqRecipientEvents).values({ recipientId, orgId: ctx.orgId, supplierOrgId: rc.supplierOrgId, kind: "resend" });
    await emit({ topic: "rfq.recipient_send", aggregateType: "rfq_recipient", aggregateId: recipientId, orgId: ctx.orgId, payload: { recipientId }, dedupeKey: `rfq-resend:${recipientId}:${rc.attempts}` }, tx);
  });
}

export async function cancelRfq(ctx: Ctx, rfqId: string, reason: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.cancel", { write: true });
  const why = z.string().trim().min(3).max(500).parse(reason);
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    await transition(tx, ctx, rfqId, "cancelled", "cancelled", { reason: why });
    await tx.update(rfqs).set({ cancelReason: why }).where(eq(rfqs.id, rfqId));
    const recips = await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), inArray(rfqRecipients.status, ["sent", "responded"])));
    for (const rc of recips) await emit({ topic: "rfq.cancelled_notify", aggregateType: "rfq_recipient", aggregateId: rc.id, orgId: ctx.orgId, payload: { recipientId: rc.id, reason: why, code: r.code, title: r.title } }, tx);
    await audit(ctx, { action: "rfq.cancelled", entityType: "rfq", entityId: rfqId, data: { reason: why } }, tx);
  });
}

export async function notifyCancelled(recipientId: string, reason: string, code: string, title: string) {
  await withSystem(async (tx) => {
    const [rc] = await tx.select().from(rfqRecipients).where(eq(rfqRecipients.id, recipientId)).limit(1);
    if (!rc) return;
    const users = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, rc.supplierOrgId), eq(memberships.status, "active")));
    await notifyUsers({ userIds: users.map((u) => u.userId), kind: "rfq.cancelled", params: { rfqNumber: code, title, reason }, link: `/supplier/rfqs/${rc.rfqId}`, orgId: rc.supplierOrgId, dedupeKey: `rfq-cancel:${rc.id}`, email: true }, tx);
  });
}

/** Move open RFQs whose closing date passed to evaluation (scheduled) or on buyer request. */
export async function closeSubmissions(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.evaluate", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    if (!["open", "partially_responded", "revision_requested"].includes(r.status)) throw invalidState("RFQ is not accepting quotations", { key: "rfq_not_open" });
    await transition(tx, ctx, rfqId, "under_evaluation", "submissions_closed");
  });
}

export async function closeDueRfqs(): Promise<number> {
  return withSystem(async (tx) => {
    const due = await tx
      .select({ id: rfqs.id, status: rfqs.status, orgId: rfqs.orgId })
      .from(rfqs)
      .where(
        sql`(${rfqs.status} in ('open','partially_responded') and ${rfqs.closesAt} <= now()) or (${rfqs.status} = 'revision_requested' and ${rfqs.revisionDeadline} <= now())`,
      );
    for (const r of due) {
      await tx.update(rfqs).set({ status: "under_evaluation" }).where(eq(rfqs.id, r.id));
      await tx.insert(rfqEvents).values({ rfqId: r.id, orgId: r.orgId, fromStatus: r.status, toStatus: "under_evaluation", kind: "auto_closed" });
    }
    return due.length;
  });
}

export const revisionSchema = z.object({ supplierOrgIds: z.array(z.string().uuid()).min(1), deadline: z.coerce.date(), note: z.string().trim().max(1000).optional().nullable() });

/** Ask selected suppliers to revise their quotations (new round). */
export async function requestRevision(ctx: Ctx, rfqId: string, input: z.input<typeof revisionSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.evaluate", { write: true });
  const d = revisionSchema.parse(input);
  if (d.deadline.getTime() < Date.now() + 30 * 60 * 1000) throw validation("Deadline must be in the future", { key: "deadline_invalid" });
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    await transition(tx, ctx, rfqId, "revision_requested", "revision_requested", { suppliers: d.supplierOrgIds, note: d.note });
    await tx.update(rfqs).set({ round: r.round + 1, revisionDeadline: d.deadline }).where(eq(rfqs.id, rfqId));
    const recips = await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), inArray(rfqRecipients.supplierOrgId, d.supplierOrgIds)));
    if (recips.length !== d.supplierOrgIds.length) throw validation("Supplier is not a recipient");
    const [buyer] = await tx.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    for (const rc of recips) {
      await tx.update(rfqRecipients).set({ round: r.round + 1 }).where(eq(rfqRecipients.id, rc.id));
      const users = await withSystem((s) => s.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, rc.supplierOrgId), eq(memberships.status, "active"))));
      await notifyUsers({ userIds: users.map((u) => u.userId), kind: "rfq.revision_requested", params: { rfqNumber: r.code, title: r.title, buyerName: buyer?.nameAr ?? "", closesAt: d.deadline.toISOString().slice(0, 16).replace("T", " "), note: d.note ?? "" }, link: `/supplier/rfqs/${rfqId}`, orgId: rc.supplierOrgId, dedupeKey: `rfq-revision:${rc.id}:${r.round + 1}`, email: true }, tx);
    }
  });
}

/** Buyer ends a revision round early. */
export async function endRevisionRound(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.evaluate", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    await loadRfq(tx, ctx, rfqId);
    await transition(tx, ctx, rfqId, "under_evaluation", "revision_round_closed");
  });
}

// ------------------------------------------------------------------------------------------ reads (buyer)

export async function listRfqs(ctx: Ctx, opts: { status?: string; projectId?: string; page?: number } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(
      eq(rfqs.orgId, ctx.orgId),
      opts.status ? eq(rfqs.status, opts.status) : undefined,
      opts.projectId ? eq(rfqs.projectId, opts.projectId) : undefined,
      sql`(${rfqs.projectId} is null or ${rfqs.projectId} in (select p.id from projects p where p.org_id = ${ctx.orgId} and (p.visibility = 'org' or p.manager_user_id = ${ctx.userId} or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${ctx.userId}) or ${ctx.permissions.has("project.manage_members")})))`,
    );
    const items = await tx
      .select({
        rfq: rfqs,
        lines: sql<number>`(select count(*)::int from rfq_items i where i.rfq_id = ${rfqs.id})`,
        recipients: sql<number>`(select count(*)::int from rfq_recipients r where r.rfq_id = ${rfqs.id})`,
        responses: sql<number>`(select count(distinct q.supplier_org_id)::int from quotations q where q.rfq_id = ${rfqs.id} and q.status = 'submitted')`,
      })
      .from(rfqs)
      .where(where)
      .orderBy(desc(rfqs.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(rfqs).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getRfq(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "rfq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const r = await loadRfq(tx, ctx, rfqId);
    const items = await tx.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId)).orderBy(asc(rfqItems.lineNo));
    const recipients = await tx
      .select({ rc: rfqRecipients, nameAr: organizations.nameAr, nameEn: organizations.nameEn })
      .from(rfqRecipients)
      .innerJoin(organizations, eq(organizations.id, rfqRecipients.supplierOrgId))
      .where(eq(rfqRecipients.rfqId, rfqId))
      .orderBy(asc(organizations.nameEn));
    const events = await tx.select().from(rfqEvents).where(eq(rfqEvents.rfqId, rfqId)).orderBy(desc(rfqEvents.createdAt)).limit(100);
    const attachments = await tx.execute(sql`select a.id, f.id as file_id, f.original_name from rfq_attachments a join files f on f.id = a.file_id where a.rfq_id = ${rfqId}`);
    const approval = await tx.execute(sql`select id, status from approval_requests where subject_type = 'rfq' and subject_id = ${rfqId} order by created_at desc limit 1`);
    const creator = r.createdBy ? (await withSystem((s) => s.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, r.createdBy!)).limit(1)))[0] : null;
    return { rfq: r, items, recipients, events, attachments: attachments.rows as { id: string; file_id: string; original_name: string }[], approval: (approval.rows[0] as { id: string; status: string } | undefined) ?? null, creatorName: creator?.name ?? null };
  });
}

// ------------------------------------------------------------------------------------------ supplier side

export async function supplierInbox(ctx: Ctx, opts: { page?: number } = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.rfq.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(eq(rfqRecipients.supplierOrgId, ctx.orgId), inArray(rfqRecipients.status, ["sent", "responded", "declined"]));
    const items = await tx
      .select({ rc: rfqRecipients, rfq: rfqs, buyerAr: organizations.nameAr, buyerEn: organizations.nameEn, quotationStatus: sql<string | null>`(select q.status from quotations q where q.rfq_id = ${rfqs.id} and q.supplier_org_id = ${ctx.orgId} and q.is_current limit 1)` })
      .from(rfqRecipients)
      .innerJoin(rfqs, eq(rfqs.id, rfqRecipients.rfqId))
      .innerJoin(organizations, eq(organizations.id, rfqRecipients.orgId))
      .where(where)
      .orderBy(desc(rfqRecipients.sentAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(rfqRecipients).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

/** Supplier view of an RFQ: only the RFQ, its lines and the supplier's own recipient row. */
export async function getRfqForSupplier(ctx: Ctx, rfqId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.rfq.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [r] = await tx.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
    if (!r) throw notFound("RFQ");
    const [rc] = await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, ctx.orgId))).limit(1);
    if (!rc) throw notFound("RFQ");
    const items = await tx.select().from(rfqItems).where(eq(rfqItems.rfqId, rfqId)).orderBy(asc(rfqItems.lineNo));
    const [buyer] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn, city: organizations.city }).from(organizations).where(eq(organizations.id, r.orgId)).limit(1);
    const attachments = await tx.execute(sql`select a.id, f.id as file_id, f.original_name from rfq_attachments a join files f on f.id = a.file_id where a.rfq_id = ${rfqId}`);
    await withContext({ userId: null, orgId: null, mode: "system" }, (s) => s.insert(rfqRecipientEvents).values({ recipientId: rc.id, orgId: r.orgId, supplierOrgId: ctx.orgId!, kind: "viewed" }));
    // buyer-internal fields are not exposed to suppliers
    const { cancelReason: _c, createdBy: _cb, boqVersionId: _b, projectId: _p, ...pub } = r;
    return { rfq: pub, recipient: rc, items, buyer: buyer ?? null, attachments: attachments.rows as { id: string; file_id: string; original_name: string }[] };
  });
}

export async function declineRfq(ctx: Ctx, rfqId: string, reason: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.quotation.submit", { write: true });
  const why = z.string().trim().min(3).max(500).parse(reason);
  await withContext(dbCtx(ctx), async (tx) => {
    const [rc] = await tx.select().from(rfqRecipients).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, ctx.orgId))).limit(1);
    if (!rc || rc.status !== "sent") throw invalidState("Cannot decline this RFQ", { key: "rfq_not_open" });
  });
  await withSystem(async (tx) => {
    const [rc] = await tx.update(rfqRecipients).set({ status: "declined", declineReason: why }).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, ctx.orgId!))).returning();
    await tx.insert(rfqRecipientEvents).values({ recipientId: rc!.id, orgId: rc!.orgId, supplierOrgId: ctx.orgId!, kind: "declined", detail: { reason: why } });
    await audit({ ...ctx }, { action: "rfq.declined", entityType: "rfq", entityId: rfqId, orgId: ctx.orgId, data: { reason: why } }, tx);
  });
}

/** Statuses in which suppliers may submit/revise. */
export function acceptingQuotes(r: { status: string; closesAt: Date | null; revisionDeadline: Date | null }, recipientRound: number, rfqRound: number): boolean {
  const now = Date.now();
  if (r.status === "revision_requested") return recipientRound === rfqRound && (!r.revisionDeadline || r.revisionDeadline.getTime() > now);
  if (r.status === "open" || r.status === "partially_responded") return !r.closesAt || r.closesAt.getTime() > now;
  return false;
}

/** Called by quotations when the first quotation arrives. */
export async function markResponded(tx: Tx, rfqId: string, supplierOrgId: string) {
  await withContext({ userId: null, orgId: null, mode: "system" }, async (s) => {
    await s.update(rfqRecipients).set({ status: "responded" }).where(and(eq(rfqRecipients.rfqId, rfqId), eq(rfqRecipients.supplierOrgId, supplierOrgId), ne(rfqRecipients.status, "responded")));
    const [r] = await s.select().from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
    if (r?.status === "open") {
      await s.update(rfqs).set({ status: "partially_responded" }).where(eq(rfqs.id, rfqId));
      await s.insert(rfqEvents).values({ rfqId, orgId: r.orgId, fromStatus: "open", toStatus: "partially_responded", kind: "first_response" });
    }
  });
  void tx;
}

