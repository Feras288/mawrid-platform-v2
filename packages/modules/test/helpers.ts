import { eq } from "drizzle-orm";
import pg from "pg";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { authUsers } from "@platform/db/schema";
import { resolveContext, type Ctx } from "../src/context";
import { createOrganization } from "../src/organizations";

export async function createUser(opts: { email?: string; name?: string; verified?: boolean; platformAdmin?: boolean; twoFactor?: boolean } = {}) {
  const email = opts.email ?? `u-${randomToken(6).toLowerCase()}@test.local`;
  const [u] = await withSystem((tx) =>
    tx
      .insert(authUsers)
      .values({ email, name: opts.name ?? email.split("@")[0]!, emailVerified: opts.verified ?? true, isPlatformAdmin: opts.platformAdmin ?? false, twoFactorEnabled: opts.twoFactor ?? false })
      .returning(),
  );
  return u!;
}

export async function ctxFor(userId: string, orgId?: string | null): Promise<Ctx> {
  return resolveContext({ userId, orgId: orgId ?? null });
}

/** Create a user + org (owner) and return the org-scoped context. */
export async function setupOrg(type: "buyer" | "supplier", name?: string) {
  const user = await createUser();
  const base = await ctxFor(user.id);
  const n = name ?? `${type} ${randomToken(4)}`;
  const org = await createOrganization(base, { type, nameAr: `مؤسسة ${n}`, nameEn: n }, { isTestData: true });
  const ctx = await ctxFor(user.id, org.id);
  return { user, org, ctx };
}

/**
 * Run raw SQL as the runtime role (app_user) with explicit GUCs — bypasses all application code so
 * RLS is tested directly at the database layer.
 */
export async function rawAsApp<T extends pg.QueryResultRow = pg.QueryResultRow>(
  gucs: { userId?: string | null; orgId?: string | null; mode?: "user" | "system" | "public" },
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.org_id', $2, true), set_config('app.mode', $3, true)", [gucs.userId ?? "", gucs.orgId ?? "", gucs.mode ?? "user"]);
    const r = await c.query<T>(text, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

export async function getUser(id: string) {
  const [u] = await withSystem((tx) => tx.select().from(authUsers).where(eq(authUsers.id, id)));
  return u!;
}
