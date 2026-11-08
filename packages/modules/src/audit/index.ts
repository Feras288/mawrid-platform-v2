import { currentTx, withContext, type Tx } from "@platform/db";
import { auditLogs } from "@platform/db/schema";
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
