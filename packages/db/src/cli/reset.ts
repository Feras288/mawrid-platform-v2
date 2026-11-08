import "./_env";
import pg from "pg";
import { runMigrations } from "../migrator";

// Development/test only: drops and recreates the public schema of the configured database.
const env = process.env.APP_ENV ?? "development";
if (env !== "development" && env !== "test") {
  console.error(`Refusing to reset database in APP_ENV=${env}`);
  process.exit(1);
}
const ownerUrl = process.env.DATABASE_OWNER_URL!;
const dbName = new URL(ownerUrl).pathname.slice(1);
if (!/^platform(_test)?$/.test(dbName)) {
  console.error(`Refusing to reset unexpected database ${dbName}`);
  process.exit(1);
}
const c = new pg.Client({ connectionString: ownerUrl });
await c.connect();
await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
await c.end();
await runMigrations({ ownerUrl, appUserPassword: process.env.APP_DB_PASSWORD! });
console.log(`reset complete: ${dbName}`);
