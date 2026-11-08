import { and, asc, eq, lte, sql } from "drizzle-orm";
import { currentTx, withSystem, type Tx } from "@platform/db";
import { outboxEvents } from "@platform/db/schema";

export interface OutboxEvent {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  orgId?: string | null;
  payload: Record<string, unknown>;
  /** Optional dedupe key: a second emit with the same key is ignored. */
  dedupeKey?: string;
}

/** Write a domain event in the caller's transaction (transactional outbox). */
export async function emit(event: OutboxEvent, tx?: Tx): Promise<void> {
  const t = tx ?? currentTx();
  if (!t) throw new Error("emit() must be called inside a transaction");
  await t
    .insert(outboxEvents)
    .values({
      topic: event.topic,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      orgId: event.orgId ?? null,
      payload: event.payload,
      dedupeKey: event.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

export type ClaimedEvent = typeof outboxEvents.$inferSelect;

/**
 * Claim a batch of pending events (SKIP LOCKED) and hand them to `dispatch`. Successful events are
 * marked dispatched; failures are retried with backoff up to `maxAttempts`, then marked failed.
 */
export async function dispatchOutbox(dispatch: (e: ClaimedEvent) => Promise<void>, opts: { batch?: number; maxAttempts?: number } = {}): Promise<number> {
  const batch = opts.batch ?? 50;
  const maxAttempts = opts.maxAttempts ?? 10;
  return withSystem(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, new Date())))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(batch)
      .for("update", { skipLocked: true });
    for (const e of rows) {
      try {
        await dispatch(e);
        await tx.update(outboxEvents).set({ status: "dispatched", dispatchedAt: new Date(), attempts: e.attempts + 1, lastError: null }).where(eq(outboxEvents.id, e.id));
      } catch (err) {
        const attempts = e.attempts + 1;
        const delayMs = Math.min(60_000 * 2 ** Math.min(attempts, 6), 3_600_000);
        await tx
          .update(outboxEvents)
          .set({
            attempts,
            lastError: String((err as Error).message).slice(0, 1000),
            status: attempts >= maxAttempts ? "failed" : "pending",
            availableAt: sql`now() + make_interval(secs => ${delayMs / 1000})`,
          })
          .where(eq(outboxEvents.id, e.id));
      }
    }
    return rows.length;
  });
}
