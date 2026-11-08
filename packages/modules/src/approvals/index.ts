import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, conflict, dec, forbidden, hashObject, invalidState, notFound, validation } from "@platform/core";
import { pageParams, withContext, type Tx } from "@platform/db";
import {
  approvalDecisions,
  approvalPolicies,
  approvalPolicySteps,
  approvalRequests,
  approvalRequestSteps,
  memberships,
  membershipRoles,
  organizations,
  roles,
} from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, requireOrg, type Permission } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";

export type Operation = "rfq_send" | "award" | "po_issue";
export type SubjectType = "rfq" | "award" | "purchase_order";

/** Subject handlers invoked (same transaction) when a request resolves. Registered by subject modules. */
type Resolver = (tx: Tx, ctx: Ctx, req: typeof approvalRequests.$inferSelect, outcome: "approved" | "rejected") => Promise<void>;
const resolvers = new Map<SubjectType, Resolver>();
export function onApprovalResolved(subject: SubjectType, fn: Resolver) {
  resolvers.set(subject, fn);
}

/** Subject modules register resolvers on import; load them lazily (avoids static import cycles). */
async function ensureResolvers() {
  if (resolvers.size >= 3) return;
  await Promise.all([import("../rfq"), import("../evaluation"), import("../purchase-orders")]);
}

// ------------------------------------------------------------------------------------------ policies

export const policySchema = z.object({
  name: z.string().trim().min(2).max(120),
  operation: z.enum(["rfq_send", "award", "po_issue"]),
  projectId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  minAmount: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional()),
  maxAmount: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional()),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  distinctApprovers: z.boolean().default(true),
  isActive: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        stepOrder: z.coerce.number().int().min(1).max(20),
        name: z.string().trim().min(1).max(120),
        requiredRoleKey: z.preprocess((v) => (v === "" ? null : v), z.string().max(80).nullable().optional()),
        requiredPermission: z.string().default("approval.decide"),
        minApprovals: z.coerce.number().int().min(1).max(10).default(1),
      }),
    )
    .min(1)
    .max(20),
});

export async function listPolicies(ctx: Ctx) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "approvals.policies.manage");
  return withContext(dbCtx(ctx), async (tx) => {
    const ps = await tx.select().from(approvalPolicies).where(eq(approvalPolicies.orgId, ctx.orgId)).orderBy(asc(approvalPolicies.operation), desc(approvalPolicies.priority));
    const steps = ps.length ? await tx.select().from(approvalPolicySteps).where(inArray(approvalPolicySteps.policyId, ps.map((p) => p.id))).orderBy(asc(approvalPolicySteps.stepOrder)) : [];
    return ps.map((p) => ({ ...p, steps: steps.filter((s) => s.policyId === p.id) }));
  });
}

export async function savePolicy(ctx: Ctx, id: string | null, input: z.input<typeof policySchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "approvals.policies.manage", { write: true });
  const d = policySchema.parse(input);
  if (d.minAmount && d.maxAmount && dec(d.maxAmount).lt(dec(d.minAmount))) throw validation("Max amount below min amount", { key: "amount_range_invalid" });
  const orders = [...new Set(d.steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i + 1)) throw validation("Step orders must be consecutive starting at 1", { key: "steps_not_consecutive" });
  return withContext(dbCtx(ctx), async (tx) => {
    const { steps, ...p } = d;
    let row;
    if (id) {
      [row] = await tx.update(approvalPolicies).set({ ...p, projectId: p.projectId ?? null, minAmount: p.minAmount ?? null, maxAmount: p.maxAmount ?? null }).where(and(eq(approvalPolicies.id, id), eq(approvalPolicies.orgId, ctx.orgId))).returning();
      if (!row) throw notFound("Policy");
      await tx.delete(approvalPolicySteps).where(eq(approvalPolicySteps.policyId, id));
    } else {
      [row] = await tx.insert(approvalPolicies).values({ ...p, projectId: p.projectId ?? null, minAmount: p.minAmount ?? null, maxAmount: p.maxAmount ?? null, orgId: ctx.orgId, createdBy: ctx.userId }).returning();
    }
    await tx.insert(approvalPolicySteps).values(steps.map((s) => ({ ...s, requiredRoleKey: s.requiredRoleKey ?? null, policyId: row!.id, orgId: ctx.orgId })));
    await audit(ctx, { action: id ? "approval.policy_updated" : "approval.policy_created", entityType: "approval_policy", entityId: row!.id, data: { operation: p.operation, steps: steps.length } }, tx);
    return row!;
  });
}

/** Most specific active policy: project match beats org-wide, then priority, then narrowest range. */
export async function selectPolicy(tx: Tx, orgId: string, operation: Operation, amount: string | null, projectId: string | null) {
  const amt = amount ?? "0";
  const ps = await tx
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.orgId, orgId),
        eq(approvalPolicies.operation, operation),
        eq(approvalPolicies.isActive, true),
        projectId ? or(isNull(approvalPolicies.projectId), eq(approvalPolicies.projectId, projectId)) : isNull(approvalPolicies.projectId),
        sql`(${approvalPolicies.minAmount} is null or ${approvalPolicies.minAmount} <= ${amt}::numeric)`,
        sql`(${approvalPolicies.maxAmount} is null or ${approvalPolicies.maxAmount} >= ${amt}::numeric)`,
      ),
    );
  ps.sort((a, b) => Number(Boolean(b.projectId)) - Number(Boolean(a.projectId)) || b.priority - a.priority || Number(Boolean(b.minAmount)) - Number(Boolean(a.minAmount)));
  return ps[0] ?? null;
}

// ------------------------------------------------------------------------------------------ requests

export interface RequestInput {
  operation: Operation;
  subjectType: SubjectType;
  subjectId: string;
  subjectLabel: string;
  snapshot: unknown; // material content; its hash detects later changes
  amount: string | null;
  projectId: string | null;
}

/**
 * Open an approval request in the caller's transaction. Returns `auto_approved` when no policy applies
 * (recorded as an approved request without steps so the decision trail is complete).
 */
export async function requestApproval(tx: Tx, ctx: Ctx, input: RequestInput): Promise<{ status: "pending" | "auto_approved"; requestId: string }> {
  const policy = await selectPolicy(tx, ctx.orgId!, input.operation, input.amount, input.projectId);
  // cancel previous open requests for this subject
  await tx
    .update(approvalRequests)
    .set({ status: "cancelled" })
    .where(and(eq(approvalRequests.subjectType, input.subjectType), eq(approvalRequests.subjectId, input.subjectId), eq(approvalRequests.status, "pending")));
  const [req] = await tx
    .insert(approvalRequests)
    .values({
      orgId: ctx.orgId!,
      operation: input.operation,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectHash: hashObject(input.snapshot),
      subjectLabel: input.subjectLabel,
      amount: input.amount,
      policyId: policy?.id ?? null,
      status: policy ? "pending" : "approved",
      requestedBy: ctx.userId!,
      decidedAt: policy ? null : new Date(),
    })
    .returning();
  await audit(ctx, { action: policy ? "approval.requested" : "approval.auto_approved", entityType: input.subjectType, entityId: input.subjectId, data: { requestId: req!.id, policyId: policy?.id, amount: input.amount } }, tx);
  if (!policy) return { status: "auto_approved", requestId: req!.id };
  const steps = await tx.select().from(approvalPolicySteps).where(eq(approvalPolicySteps.policyId, policy.id)).orderBy(asc(approvalPolicySteps.stepOrder));
  await tx.insert(approvalRequestSteps).values(
    steps.map((s) => ({ requestId: req!.id, orgId: ctx.orgId!, stepOrder: s.stepOrder, name: s.name, requiredRoleKey: s.requiredRoleKey, requiredPermission: s.requiredPermission, minApprovals: s.minApprovals, status: s.stepOrder === 1 ? "active" : "waiting" })),
  );
  await notifyApprovers(tx, ctx.orgId!, req!.id);
  await emit({ topic: "approval.requested", aggregateType: "approval_request", aggregateId: req!.id, orgId: ctx.orgId, payload: { requestId: req!.id, subjectType: input.subjectType, subjectId: input.subjectId } }, tx);
  return { status: "pending", requestId: req!.id };
}

async function eligibleUsers(tx: Tx, orgId: string, step: { requiredPermission: string; requiredRoleKey: string | null }) {
  const rows = await tx
    .select({ userId: memberships.userId, key: roles.key, permissions: roles.permissions })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active")));
  const byUser = new Map<string, { keys: Set<string>; perms: Set<string> }>();
  for (const r of rows) {
    const u = byUser.get(r.userId) ?? { keys: new Set(), perms: new Set() };
    u.keys.add(r.key);
    r.permissions.forEach((p) => u.perms.add(p));
    byUser.set(r.userId, u);
  }
  return [...byUser.entries()].filter(([, u]) => u.perms.has(step.requiredPermission) && (!step.requiredRoleKey || u.keys.has(step.requiredRoleKey))).map(([id]) => id);
}

async function notifyApprovers(tx: Tx, orgId: string, requestId: string) {
  const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  const active = await tx.select().from(approvalRequestSteps).where(and(eq(approvalRequestSteps.requestId, requestId), eq(approvalRequestSteps.status, "active")));
  const users = new Set<string>();
  for (const s of active) for (const u of await eligibleUsers(tx, orgId, s)) if (u !== req!.requestedBy) users.add(u);
  await notifyUsers({ userIds: [...users], kind: "approval.requested", params: { subject: req!.subjectLabel ?? "", amount: req!.amount ? `${req!.amount} SAR` : "—" }, link: `/org/approvals/${requestId}`, orgId, dedupeKey: `approval:${requestId}:${active.map((a) => a.id).join(",")}`, email: true }, tx);
}

export const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().trim().max(2000).optional().nullable() });

/**
 * Record a human decision. Enforces: active step, eligible permission/role, separation of duties
 * (requester cannot approve; optionally one decision per person across steps), MFA policy, and the
 * subject hash (a materially changed subject invalidates the request).
 */
export async function decide(ctx: Ctx, requestId: string, input: z.input<typeof decisionSchema>, currentHash?: (tx: Tx, req: typeof approvalRequests.$inferSelect) => Promise<string | null>) {
  requireOrg(ctx, "buyer");
  if (ctx.mode !== "user") throw forbidden("Only people can decide approvals");
  const d = decisionSchema.parse(input);
  await ensureResolvers();
  if (d.decision === "reject" && !d.comment) throw validation("A comment is required to reject", { key: "reason_required" });
  return withContext(dbCtx(ctx), async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.orgId, ctx.orgId))).limit(1).for("update");
    if (!req) throw notFound("Approval request");
    if (req.status !== "pending") throw invalidState("Request is not pending", { key: "approval_not_pending" });
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    if (org?.settings.requireMfaForApprovers && !ctx.mfaEnabled) throw new AppError("FORBIDDEN", "Two-factor authentication required to approve", { key: "mfa_required" });
    if (req.requestedBy === ctx.userId) throw new AppError("FORBIDDEN", "Requester cannot approve own request", { key: "sod_requester" });
    if (currentHash) {
      const h = await currentHash(tx, req);
      if (h && h !== req.subjectHash) {
        await tx.update(approvalRequests).set({ status: "invalidated", decidedAt: new Date() }).where(eq(approvalRequests.id, req.id));
        throw new AppError("INVALID_STATE", "Subject changed since approval was requested", { key: "approval_invalidated" });
      }
    }
    const active = await tx.select().from(approvalRequestSteps).where(and(eq(approvalRequestSteps.requestId, req.id), eq(approvalRequestSteps.status, "active")));
    const step = active.find((s) => ctx.permissions.has(s.requiredPermission as Permission) && (!s.requiredRoleKey || ctx.roleKeys.includes(s.requiredRoleKey)));
    if (!step) throw new AppError("FORBIDDEN", "You are not an approver for the current step", { key: "not_approver" });
    const [policy] = req.policyId ? await tx.select().from(approvalPolicies).where(eq(approvalPolicies.id, req.policyId)).limit(1) : [];
    if (policy?.distinctApprovers) {
      const prior = await tx.select({ id: approvalDecisions.id }).from(approvalDecisions).where(and(eq(approvalDecisions.requestId, req.id), eq(approvalDecisions.userId, ctx.userId))).limit(1);
      if (prior.length) throw new AppError("FORBIDDEN", "You already decided on this request", { key: "sod_distinct" });
    }
    const [dup] = await tx.select({ id: approvalDecisions.id }).from(approvalDecisions).where(and(eq(approvalDecisions.stepId, step.id), eq(approvalDecisions.userId, ctx.userId))).limit(1);
    if (dup) throw conflict("Decision already recorded", { key: "already_decided" });
    await tx.insert(approvalDecisions).values({ requestId: req.id, stepId: step.id, orgId: ctx.orgId, userId: ctx.userId, decision: d.decision, comment: d.comment ?? null });
    await audit(ctx, { action: `approval.${d.decision}`, entityType: req.subjectType, entityId: req.subjectId, data: { requestId: req.id, step: step.name, comment: d.comment } }, tx);

    let outcome: "approved" | "rejected" | null = null;
    if (d.decision === "reject") {
      await tx.update(approvalRequestSteps).set({ status: "rejected", decidedAt: new Date() }).where(eq(approvalRequestSteps.id, step.id));
      await tx.update(approvalRequestSteps).set({ status: "cancelled" }).where(and(eq(approvalRequestSteps.requestId, req.id), inArray(approvalRequestSteps.status, ["waiting", "active"])));
      outcome = "rejected";
    } else {
      const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(approvalDecisions).where(and(eq(approvalDecisions.stepId, step.id), eq(approvalDecisions.decision, "approve")));
      if ((cnt?.n ?? 0) >= step.minApprovals) {
        await tx.update(approvalRequestSteps).set({ status: "approved", decidedAt: new Date() }).where(eq(approvalRequestSteps.id, step.id));
        const stillActive = await tx.select({ id: approvalRequestSteps.id }).from(approvalRequestSteps).where(and(eq(approvalRequestSteps.requestId, req.id), eq(approvalRequestSteps.status, "active")));
        if (!stillActive.length) {
          const nextOrder = step.stepOrder + 1;
          const next = await tx.update(approvalRequestSteps).set({ status: "active" }).where(and(eq(approvalRequestSteps.requestId, req.id), eq(approvalRequestSteps.stepOrder, nextOrder))).returning({ id: approvalRequestSteps.id });
          if (!next.length) outcome = "approved";
          else await notifyApprovers(tx, ctx.orgId, req.id);
        }
      }
    }
    if (outcome) {
      const [updated] = await tx.update(approvalRequests).set({ status: outcome, decidedAt: new Date() }).where(eq(approvalRequests.id, req.id)).returning();
      await resolvers.get(req.subjectType as SubjectType)?.(tx, ctx, updated!, outcome);
      await notifyUsers({ userIds: [req.requestedBy], kind: "approval.decided", params: { subject: req.subjectLabel ?? "", decision: outcome }, link: `/org/approvals/${req.id}`, orgId: ctx.orgId, dedupeKey: `approval-decided:${req.id}`, email: true }, tx);
      await emit({ topic: `approval.${outcome}`, aggregateType: "approval_request", aggregateId: req.id, orgId: ctx.orgId, payload: { requestId: req.id, subjectType: req.subjectType, subjectId: req.subjectId } }, tx);
    }
    return { outcome: outcome ?? "pending" };
  });
}

/** Mark a request invalidated when its subject changed materially (called by subject modules). */
export async function invalidateFor(tx: Tx, subjectType: SubjectType, subjectId: string, newHash: string) {
  const rows = await tx
    .update(approvalRequests)
    .set({ status: "invalidated", decidedAt: new Date() })
    .where(and(eq(approvalRequests.subjectType, subjectType), eq(approvalRequests.subjectId, subjectId), inArray(approvalRequests.status, ["pending", "approved"]), sql`${approvalRequests.subjectHash} <> ${newHash}`))
    .returning({ id: approvalRequests.id });
  return rows.length;
}

export async function latestRequest(tx: Tx, subjectType: SubjectType, subjectId: string) {
  const [r] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.subjectType, subjectType), eq(approvalRequests.subjectId, subjectId))).orderBy(desc(approvalRequests.createdAt)).limit(1);
  return r ?? null;
}

// ------------------------------------------------------------------------------------------ inbox

export async function listRequests(ctx: Ctx, opts: { scope?: "mine" | "all"; status?: string; page?: number } = {}) {
  requireOrg(ctx, "buyer");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(eq(approvalRequests.orgId, ctx.orgId), opts.status ? eq(approvalRequests.status, opts.status) : undefined);
    const items = await tx.select().from(approvalRequests).where(where).orderBy(desc(approvalRequests.createdAt)).limit(200).offset(0);
    const steps = items.length ? await tx.select().from(approvalRequestSteps).where(inArray(approvalRequestSteps.requestId, items.map((i) => i.id))) : [];
    const mine = items.filter(
      (r) => r.status === "pending" && r.requestedBy !== ctx.userId && steps.some((s) => s.requestId === r.id && s.status === "active" && ctx.permissions.has(s.requiredPermission as Permission) && (!s.requiredRoleKey || ctx.roleKeys.includes(s.requiredRoleKey))),
    );
    const list = opts.scope === "mine" ? mine : items;
    return { items: list.slice(offset, offset + limit).map((r) => ({ ...r, canDecide: mine.some((m) => m.id === r.id) })), total: list.length, page, pageSize };
  });
}

export async function getRequest(ctx: Ctx, requestId: string) {
  requireOrg(ctx, "buyer");
  return withContext(dbCtx(ctx), async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.orgId, ctx.orgId))).limit(1);
    if (!req) throw notFound("Approval request");
    const steps = await tx.select().from(approvalRequestSteps).where(eq(approvalRequestSteps.requestId, requestId)).orderBy(asc(approvalRequestSteps.stepOrder));
    const decisions = await tx
      .select({ id: approvalDecisions.id, stepId: approvalDecisions.stepId, userId: approvalDecisions.userId, decision: approvalDecisions.decision, comment: approvalDecisions.comment, createdAt: approvalDecisions.createdAt, name: sql<string>`(select name from auth_users u where u.id = ${approvalDecisions.userId})` })
      .from(approvalDecisions)
      .where(eq(approvalDecisions.requestId, requestId))
      .orderBy(asc(approvalDecisions.createdAt));
    const canDecide = req.status === "pending" && req.requestedBy !== ctx.userId && steps.some((s) => s.status === "active" && ctx.permissions.has(s.requiredPermission as Permission) && (!s.requiredRoleKey || ctx.roleKeys.includes(s.requiredRoleKey)) && !decisions.some((d) => d.stepId === s.id && d.userId === ctx.userId));
    return { request: req, steps, decisions, canDecide };
  });
}
