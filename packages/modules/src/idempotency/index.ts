import { and, eq, sql } from "drizzle-orm";
import { conflict, hashObject } from "@platform/core";
import { currentTx, type Tx } from "@platform/db";
import { idempotencyKeys } from "@platform/db/schema";

/**
 * Execute `fn` at most once per (scope, key) — must be called inside the transaction that performs the
 * write so the key commits/rolls back together with it. Concurrent duplicates block on the primary key
 * and then observe the committed result.
 *  - same key + same request → returns the stored response
 *  - same key + different request → CONFLICT
 */
export async function idempotent<T>(scope: string, key: string, request: unknown, fn: () => Promise<T>, opts: { ttlHours?: number; tx?: Tx } = {}): Promise<T> {
  const tx = opts.tx ?? currentTx();
  if (!tx) throw new Error("idempotent() must run inside a transaction");
  if (!key || key.length < 8 || key.length > 200) throw conflict("Invalid idempotency key");
  const requestHash = hashObject(request);
  const inserted = await tx
    .insert(idempotencyKeys)
    .values({ scope, key, requestHash, expiresAt: sql`now() + make_interval(hours => ${opts.ttlHours ?? 72})` })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted.length === 0) {
    const [row] = await tx.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))).limit(1);
    if (!row) throw conflict("Idempotency key race");
    if (row.requestHash !== requestHash) throw conflict("Idempotency key reused with a different request", { scope });
    if (row.status !== "completed") throw conflict("Request with this idempotency key is still in progress", { scope });
    return row.response as T;
  }
  const result = await fn();
  await tx
    .update(idempotencyKeys)
    .set({ status: "completed", response: (result ?? null) as unknown })
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  return result;
}
