import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { getDb, type Schema } from "./client";

export type Tx = PgTransaction<NodePgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * Database security context. Mapped to Postgres GUCs consumed by RLS policies:
 *   app.user_id, app.org_id, app.mode ('user' | 'system' | 'public').
 * 'system' mode is only for trusted framework/worker code paths (never derived from user input).
 */
export interface DbContext {
  userId: string | null;
  orgId: string | null;
  mode: "user" | "system" | "public";
}

interface Frame {
  tx: Tx;
  key: string;
}

const als = new AsyncLocalStorage<Frame>();

const keyOf = (c: DbContext) => `${c.mode}|${c.userId ?? ""}|${c.orgId ?? ""}`;

async function applyContext(tx: Tx, c: DbContext): Promise<void> {
  await tx.execute(
    sql`select set_config('app.user_id', ${c.userId ?? ""}, true), set_config('app.org_id', ${c.orgId ?? ""}, true), set_config('app.mode', ${c.mode}, true)`,
  );
}

/**
 * Run `fn` inside a transaction with the given security context. Re-entrant: nested calls with the
 * same context reuse the open transaction; a different context inside an open transaction switches
 * GUCs for the nested scope (savepoint) and restores them afterwards.
 */
export async function withContext<T>(c: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const frame = als.getStore();
  const key = keyOf(c);
  if (frame) {
    if (frame.key === key) return fn(frame.tx);
    return frame.tx.transaction(async (sp) => {
      await applyContext(sp as Tx, c);
      const result = await als.run({ tx: sp as Tx, key }, () => fn(sp as Tx));
      // Restore the outer context for the rest of the outer transaction. On error the savepoint
      // rollback reverts the GUC changes automatically.
      const [mode, userId, orgId] = frame.key.split("|");
      await applyContext(sp as Tx, {
        mode: mode as DbContext["mode"],
        userId: userId || null,
        orgId: orgId || null,
      });
      return result;
    });
  }
  return getDb().transaction(async (tx) => {
    await applyContext(tx, c);
    return als.run({ tx, key }, () => fn(tx));
  });
}

export const systemContext: DbContext = { userId: null, orgId: null, mode: "system" };
export const publicContext: DbContext = { userId: null, orgId: null, mode: "public" };

export const withSystem = <T>(fn: (tx: Tx) => Promise<T>) => withContext(systemContext, fn);
export const withPublic = <T>(fn: (tx: Tx) => Promise<T>) => withContext(publicContext, fn);

/** Current transaction, if any (for helpers like audit/outbox that join the caller's tx). */
export const currentTx = (): Tx | undefined => als.getStore()?.tx;
