import { and, eq, sql } from "drizzle-orm";
import { formatDocNumber } from "@platform/core";
import type { Tx } from "./context";
import { orgCounters } from "./schema/organizations";

/** Allocate the next document number for (org, kind, year) with a row lock. */
export async function nextDocNumber(tx: Tx, orgId: string, kind: string, prefix: string, at = new Date()): Promise<string> {
  const year = at.getUTCFullYear();
  await tx
    .insert(orgCounters)
    .values({ orgId, kind, year, value: 0 })
    .onConflictDoNothing();
  const rows = await tx
    .update(orgCounters)
    .set({ value: sql`${orgCounters.value} + 1` })
    .where(and(eq(orgCounters.orgId, orgId), eq(orgCounters.kind, kind), eq(orgCounters.year, year)))
    .returning({ value: orgCounters.value });
  const v = rows[0]?.value;
  if (!v) throw new Error("Counter allocation failed");
  return formatDocNumber(prefix, year, v);
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageParams(page?: number | string | null, pageSize?: number | string | null, max = 100) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(max, Math.max(1, Number(pageSize) || 20));
  return { page: p, pageSize: s, offset: (p - 1) * s, limit: s };
}

/** Escape a string for use inside LIKE patterns. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
