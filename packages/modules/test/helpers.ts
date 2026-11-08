import { eq } from "drizzle-orm";
import pg from "pg";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { authUsers } from "@platform/db/schema";
import { resolveContext, type Ctx } from "../src/context";
import { categories } from "@platform/db/schema";
import { createOrganization, updateOrganization } from "../src/organizations";
import { decideSupplier, reviewDocument, startReview, submitForVerification, updateMyProfile, uploadSupplierDocument } from "../src/suppliers";

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

export const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1");

export async function categoryBySlug(slug: string) {
  const [c] = await withSystem((tx) => tx.select().from(categories).where(eq(categories.slug, slug)).limit(1));
  return c!;
}

export async function adminCtx() {
  const admin = await createUser({ platformAdmin: true, twoFactor: true });
  return ctxFor(admin.id);
}

/** Create a supplier and drive it to approved through the real lifecycle. */
export async function approvedSupplier() {
  const s = await setupOrg("supplier");
  const pipes = await categoryBySlug("pipes");
  await updateOrganization(s.ctx, { crNumber: "1010123456", vatNumber: "300000000000003", city: "Riyadh" });
  await updateMyProfile(s.ctx, { descriptionAr: "مورد مواد سباكة", coverageRegions: ["RD"], categoryIds: [pipes.id], deliversNationwide: true });
  const cr = await uploadSupplierDocument(s.ctx, { kind: "commercial_registration", documentNumber: "1010123456" }, { buffer: PDF, fileName: "cr.pdf" });
  const vat = await uploadSupplierDocument(s.ctx, { kind: "vat_certificate" }, { buffer: PDF, fileName: "vat.pdf" });
  await submitForVerification(s.ctx);
  const admin = await adminCtx();
  await startReview(admin, s.org.id);
  await reviewDocument(admin, cr.id, { status: "verified" });
  await reviewDocument(admin, vat.id, { status: "verified" });
  await decideSupplier(admin, s.org.id, { decision: "approved" });
  return { ...s, ctx: await ctxFor(s.user.id, s.org.id), admin };
}

