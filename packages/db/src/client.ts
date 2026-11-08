import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

// numeric → string (default), int8 → number when safe
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
});

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
      application_name: process.env.SERVICE_NAME ?? "platform",
    });
  }
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema, casing: "snake_case" });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}

export { schema };
