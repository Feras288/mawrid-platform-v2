import "./load-env";
import pg from "pg";
import { runMigrations } from "../../packages/db/src/migrator";

/** Recreate the test database schema once per integration run. */
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  if (!ownerUrl || !/platform_test/.test(ownerUrl)) throw new Error("TEST_DATABASE_OWNER_URL must point to platform_test");
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await c.end();
  await runMigrations({ ownerUrl, appUserPassword: process.env.APP_DB_PASSWORD!, log: () => undefined });
}
