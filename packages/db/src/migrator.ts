import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_ROOT = join(here, "..");

function sqlFiles(dir: string): { name: string; sql: string }[] {
  const full = join(DB_ROOT, "sql", dir);
  return readdirSync(full)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(full, name), "utf8") }));
}

const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface MigrateOptions {
  ownerUrl: string;
  appUserPassword: string;
  log?: (msg: string) => void;
}

/**
 * Applies: pre SQL (extensions) → app role → drizzle migrations → post SQL (functions, grants, RLS).
 * Must run as the schema owner. Idempotent.
 */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => process.stdout.write(`${m}
`));
  const client = new pg.Client({ connectionString: opts.ownerUrl });
  await client.connect();
  try {
    for (const f of sqlFiles("pre")) {
      log(`pre: ${f.name}`);
      await client.query(f.sql);
    }
    // Runtime role: login, no superuser, no BYPASSRLS. Password set from env each run.
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;`);
    await client.query(`ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${quoteLiteral(opts.appUserPassword)}`);

    log("schema migrations");
    await migrate(drizzle(client), { migrationsFolder: join(DB_ROOT, "migrations") });

    await client.query(`CREATE TABLE IF NOT EXISTS _repeatable_sql (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    for (const f of sqlFiles("post")) {
      const checksum = createHash("sha256").update(f.sql).digest("hex");
      log(`post: ${f.name}`);
      await client.query("BEGIN");
      try {
        await client.query(f.sql);
        await client.query(
          `INSERT INTO _repeatable_sql(name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [f.name, checksum],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Failed applying ${f.name}: ${(e as Error).message}`, { cause: e });
      }
    }
    await client.query(`REVOKE ALL ON _repeatable_sql FROM app_user`);
  } finally {
    await client.end();
  }
}
