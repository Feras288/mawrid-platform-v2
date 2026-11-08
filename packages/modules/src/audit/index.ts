import { and, desc, eq, sql } from "drizzle-orm";
import { currentTx, pageParams, withContext, withSystem, type Tx } from "@platform/db";
import { auditLogs } from "@platform/db/schema";
import { authorize, authorizeAdmin } from "../authz";
import { dbCtx, type Ctx } from "../context";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  orgId?: string | null;
  data?: Record<string, unknown>;
}

/**
 * Append an audit record. Joins the caller's transaction when present so the audit row commits or
 * rolls back together with the change it describes.
 */
export async function audit(ctx: Ctx, entry: AuditEntry, tx?: Tx): Promise<void> {
  const row = {
    orgId: entry.orgId === undefined ? ctx.orgId : entry.orgId,
    actorUserId: ctx.userId,
    actorType: ctx.mode === "system" ? "system" : ctx.isPlatformAdmin && ctx.orgId === null ? "admin" : "user",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: { ...(entry.data ?? {}), ...(ctx.breakglass ? { breakglass: true } : {}) },
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId,
  };
  const t = tx ?? currentTx();
  if (t) {
    await t.insert(auditLogs).values(row);
    return;
  }
  await withContext(dbCtx(ctx), (x) => x.insert(auditLogs).values(row));
}

/** Shallow diff for audit payloads. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return out;
}

// ------------------------------------------------------------------------------------------ reads

export async function listOrgAudit(ctx: Ctx, opts: { page?: number; entityType?: string } = {}) {
  authorize(ctx, "audit.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 50);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(eq(auditLogs.orgId, ctx.orgId!), opts.entityType ? eq(auditLogs.entityType, opts.entityType) : undefined);
    const items = await tx.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function listAllAudit(ctx: Ctx, opts: { page?: number; action?: string; orgId?: string } = {}) {
  authorizeAdmin(ctx, "admin.audit");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 50);
  return withSystem(async (tx) => {
    const where = and(opts.action ? sql`${auditLogs.action} like ${opts.action + "%"}` : undefined, opts.orgId ? eq(auditLogs.orgId, opts.orgId) : undefined);
    const items = await tx.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}
