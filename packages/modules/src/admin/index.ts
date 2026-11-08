import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, invalidState, notFound, validation } from "@platform/core";
import { likeEscape, pageParams, withSystem } from "@platform/db";
import {
  aiUsage,
  authSessions,
  authUsers,
  breakglassGrants,
  contentPages,
  jobRuns,
  memberships,
  membershipRoles,
  notificationDeliveries,
  orders,
  organizations,
  outboxEvents,
  roles,
} from "@platform/db/schema";
import { invalidateAiSettings, resolveAiProvider } from "../ai";
import { audit } from "../audit";
import { authorizeAdmin } from "../authz";
import { getSettingForAdmin, putSetting } from "../config";
import type { Ctx } from "../context";
import { invalidateEmailSettings, notifyUsers, resolveEmailTransport } from "../notifications";
import { emit } from "../outbox";
import { availableMethods } from "../payments";

/**
 * Super-admin services. Every mutation is audited. Platform admins have no implicit access to
 * organizations' commercial documents: exceptional access goes through time-boxed, read-only,
 * audited break-glass grants that the organization's owners are told about.
 */

// ------------------------------------------------------------------------------------------ users

export async function listUsers(ctx: Ctx, opts: { q?: string; status?: string; page?: number } = {}) {
  authorizeAdmin(ctx, "admin.users");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  return withSystem(async (tx) => {
    const q = opts.q?.trim();
    const where = and(
      q ? or(ilike(authUsers.email, `%${likeEscape(q)}%`), ilike(authUsers.name, `%${likeEscape(q)}%`)) : undefined,
      opts.status ? eq(authUsers.status, opts.status) : undefined,
    );
    const items = await tx
      .select({
        u: { id: authUsers.id, name: authUsers.name, email: authUsers.email, emailVerified: authUsers.emailVerified, twoFactorEnabled: authUsers.twoFactorEnabled, isPlatformAdmin: authUsers.isPlatformAdmin, status: authUsers.status, createdAt: authUsers.createdAt },
        orgs: sql<number>`(select count(*)::int from memberships m where m.user_id = ${authUsers.id} and m.status = 'active')`,
        lastSeen: sql<Date | null>`(select max(s.updated_at) from auth_sessions s where s.user_id = ${authUsers.id})`,
      })
      .from(authUsers)
      .where(where)
      .orderBy(desc(authUsers.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(authUsers).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

/** Suspend / reactivate a user. Suspension revokes all sessions. */
export async function setUserStatus(ctx: Ctx, userId: string, status: "active" | "suspended", reason: string) {
  authorizeAdmin(ctx, "admin.users");
  const why = z.string().trim().min(3).max(500).parse(reason);
  if (userId === ctx.userId) throw invalidState("You cannot change your own status", { key: "self_action" });
  await withSystem(async (tx) => {
    const [u] = await tx.select().from(authUsers).where(eq(authUsers.id, userId)).limit(1).for("update");
    if (!u || u.status === "deleted") throw notFound("User");
    if (u.isPlatformAdmin && status === "suspended") {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(authUsers).where(and(eq(authUsers.isPlatformAdmin, true), eq(authUsers.status, "active")));
      if ((n?.n ?? 0) <= 1) throw invalidState("Cannot suspend the last platform admin", { key: "last_admin" });
    }
    await tx.update(authUsers).set({ status }).where(eq(authUsers.id, userId));
    if (status === "suspended") await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await audit(ctx, { action: `user.${status}`, entityType: "user", entityId: userId, orgId: null, data: { reason: why } }, tx);
    await notifyUsers({ userIds: [userId], kind: "account.status_changed", params: { subject: u.email, status, reason: why }, dedupeKey: `user-status:${userId}:${Date.now()}`, email: true }, tx);
  });
}

// ------------------------------------------------------------------------------------------ organizations

export async function listOrganizations(ctx: Ctx, opts: { q?: string; type?: string; status?: string; page?: number } = {}) {
  authorizeAdmin(ctx, "admin.orgs");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  return withSystem(async (tx) => {
    const q = opts.q?.trim();
    const where = and(
      q ? or(ilike(organizations.nameEn, `%${likeEscape(q)}%`), ilike(organizations.nameAr, `%${likeEscape(q)}%`), ilike(organizations.crNumber, `%${likeEscape(q)}%`)) : undefined,
      opts.type ? eq(organizations.type, opts.type) : undefined,
      opts.status ? eq(organizations.status, opts.status) : undefined,
    );
    const items = await tx
      .select({ o: organizations, members: sql<number>`(select count(*)::int from memberships m where m.org_id = ${organizations.id} and m.status = 'active')` })
      .from(organizations)
      .where(where)
      .orderBy(desc(organizations.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(organizations).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

async function ownerIds(orgId: string) {
  return withSystem(async (tx) =>
    (
      await tx
        .selectDistinct({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), inArray(roles.key, ["owner", "supplier_admin", "admin"])))
    ).map((r) => r.userId),
  );
}

export async function setOrgStatus(ctx: Ctx, orgId: string, status: "active" | "suspended", reason: string) {
  authorizeAdmin(ctx, "admin.orgs");
  const why = z.string().trim().min(3).max(500).parse(reason);
  const owners = await ownerIds(orgId);
  await withSystem(async (tx) => {
    const [o] = await tx.update(organizations).set({ status }).where(eq(organizations.id, orgId)).returning();
    if (!o) throw notFound("Organization");
    await audit(ctx, { action: `org.${status}`, entityType: "organization", entityId: orgId, orgId, data: { reason: why } }, tx);
    await notifyUsers({ userIds: owners, kind: "account.status_changed", params: { subject: o.nameAr, status, reason: why }, orgId, dedupeKey: `org-status:${orgId}:${Date.now()}`, email: true }, tx);
  });
}

/** Test/demo flag: excluded from analytics and the price index. */
export async function setOrgTestFlag(ctx: Ctx, orgId: string, isTestData: boolean) {
  authorizeAdmin(ctx, "admin.orgs");
  await withSystem(async (tx) => {
    const r = await tx.update(organizations).set({ isTestData }).where(eq(organizations.id, orgId)).returning({ id: organizations.id });
    if (!r.length) throw notFound("Organization");
    await audit(ctx, { action: "org.test_flag", entityType: "organization", entityId: orgId, orgId, data: { isTestData } }, tx);
  });
}

// ------------------------------------------------------------------------------------------ break-glass

export const breakglassSchema = z.object({ orgId: z.string().uuid(), reason: z.string().trim().min(15).max(1000), minutes: z.coerce.number().int().min(5).max(240) });

/**
 * Exceptional, read-only access to one organization for a limited time. Requires MFA, a written reason,
 * notifies the organization's owners and audits the grant; every request in that context is tagged.
 */
export async function openBreakglass(ctx: Ctx, input: z.input<typeof breakglassSchema>) {
  authorizeAdmin(ctx, "admin.breakglass");
  const d = breakglassSchema.parse(input);
  const owners = await ownerIds(d.orgId);
  return withSystem(async (tx) => {
    const [o] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, d.orgId)).limit(1);
    if (!o) throw notFound("Organization");
    const expiresAt = new Date(Date.now() + d.minutes * 60_000);
    const [g] = await tx.insert(breakglassGrants).values({ adminUserId: ctx.userId!, orgId: d.orgId, reason: d.reason, expiresAt }).returning();
    await audit(ctx, { action: "breakglass.opened", entityType: "organization", entityId: d.orgId, orgId: d.orgId, data: { grantId: g!.id, reason: d.reason, expiresAt: expiresAt.toISOString() } }, tx);
    await notifyUsers({ userIds: owners, kind: "breakglass.opened", params: { reason: d.reason, until: expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" }, orgId: d.orgId, dedupeKey: `breakglass:${g!.id}`, email: true }, tx);
    return g!;
  });
}

export async function revokeBreakglass(ctx: Ctx, grantId: string) {
  authorizeAdmin(ctx, "admin.breakglass");
  await withSystem(async (tx) => {
    const [g] = await tx.update(breakglassGrants).set({ revokedAt: new Date() }).where(and(eq(breakglassGrants.id, grantId), isNull(breakglassGrants.revokedAt))).returning();
    if (!g) throw notFound("Grant");
    await audit(ctx, { action: "breakglass.revoked", entityType: "organization", entityId: g.orgId, orgId: g.orgId, data: { grantId } }, tx);
  });
}

export async function listBreakglass(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  authorizeAdmin(ctx, "admin.breakglass", { requireMfa: false });
  return withSystem((tx) =>
    tx
      .select({ g: breakglassGrants, adminEmail: authUsers.email, orgAr: organizations.nameAr, orgEn: organizations.nameEn })
      .from(breakglassGrants)
      .innerJoin(authUsers, eq(authUsers.id, breakglassGrants.adminUserId))
      .innerJoin(organizations, eq(organizations.id, breakglassGrants.orgId))
      .where(opts.activeOnly ? and(isNull(breakglassGrants.revokedAt), gt(breakglassGrants.expiresAt, new Date())) : undefined)
      .orderBy(desc(breakglassGrants.createdAt))
      .limit(200),
  );
}

/** Active grant for (admin, org) — used to allow switching into the org context read-only. */
export async function activeGrant(adminUserId: string, orgId: string) {
  const [g] = await withSystem((tx) =>
    tx
      .select()
      .from(breakglassGrants)
      .where(and(eq(breakglassGrants.adminUserId, adminUserId), eq(breakglassGrants.orgId, orgId), isNull(breakglassGrants.revokedAt), gt(breakglassGrants.expiresAt, new Date())))
      .limit(1),
  );
  return g ?? null;
}

// ------------------------------------------------------------------------------------------ jobs & deliveries

export async function jobsOverview(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.jobs");
  return withSystem(async (tx) => {
    const byQueue = await tx
      .select({ queue: jobRuns.queue, status: jobRuns.status, n: sql<number>`count(*)::int`, avgMs: sql<number | null>`avg(${jobRuns.durationMs})::int` })
      .from(jobRuns)
      .where(sql`${jobRuns.startedAt} > now() - interval '24 hours'`)
      .groupBy(jobRuns.queue, jobRuns.status);
    const failed = await tx.select().from(jobRuns).where(eq(jobRuns.status, "failed")).orderBy(desc(jobRuns.startedAt)).limit(50);
    const recent = await tx.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(50);
    const [outbox] = await tx
      .select({ pending: sql<number>`count(*) filter (where ${outboxEvents.status} = 'pending')::int`, failed: sql<number>`count(*) filter (where ${outboxEvents.status} = 'failed')::int` })
      .from(outboxEvents);
    const deliveries = await tx
      .select({ status: notificationDeliveries.status, n: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(sql`${notificationDeliveries.createdAt} > now() - interval '7 days'`)
      .groupBy(notificationDeliveries.status);
    const failedDeliveries = await tx
      .select({ id: notificationDeliveries.id, template: notificationDeliveries.template, recipient: notificationDeliveries.recipient, attempts: notificationDeliveries.attempts, lastError: notificationDeliveries.lastError, createdAt: notificationDeliveries.createdAt })
      .from(notificationDeliveries)
      .where(inArray(notificationDeliveries.status, ["failed"]))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(50);
    return { byQueue, failed, recent, outbox: outbox ?? { pending: 0, failed: 0 }, deliveries, failedDeliveries };
  });
}

/** Re-queue a failed email delivery (same dedupe row; attempts reset). */
export async function retryDelivery(ctx: Ctx, deliveryId: string) {
  authorizeAdmin(ctx, "admin.jobs");
  await withSystem(async (tx) => {
    const [d] = await tx.update(notificationDeliveries).set({ status: "pending", attempts: 0, lastError: null }).where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, "failed"))).returning();
    if (!d) throw notFound("Delivery");
    await emit({ topic: "email.send", aggregateType: "notification_delivery", aggregateId: d.id, orgId: d.orgId, payload: { deliveryId: d.id }, dedupeKey: `email-retry:${d.id}:${Date.now()}` }, tx);
    await audit(ctx, { action: "delivery.retried", entityType: "notification_delivery", entityId: d.id, orgId: null }, tx);
  });
}

// ------------------------------------------------------------------------------------------ AI usage

export async function aiUsageReport(ctx: Ctx, opts: { months?: number } = {}) {
  authorizeAdmin(ctx, "admin.integrations", { requireMfa: false });
  const months = Math.min(Math.max(opts.months ?? 6, 1), 24);
  return withSystem(async (tx) => {
    const byMonth = await tx.execute(sql`select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, model, purpose, count(*)::int as calls,
        sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens, sum(cost_usd)::text as cost, count(*) filter (where status = 'error')::int as errors
      from ai_usage where created_at > date_trunc('month', now()) - make_interval(months => ${months - 1}) group by 1, 2, 3 order by 1 desc, 2`);
    const byOrg = await tx
      .select({ orgId: aiUsage.orgId, nameAr: organizations.nameAr, nameEn: organizations.nameEn, cost: sql<string>`sum(${aiUsage.costUsd})::text`, calls: sql<number>`count(*)::int` })
      .from(aiUsage)
      .leftJoin(organizations, eq(organizations.id, aiUsage.orgId))
      .where(sql`${aiUsage.createdAt} > date_trunc('month', now())`)
      .groupBy(aiUsage.orgId, organizations.nameAr, organizations.nameEn)
      .orderBy(desc(sql`sum(${aiUsage.costUsd})`))
      .limit(20);
    const provider = await resolveAiProvider();
    return { byMonth: byMonth.rows as { month: string; model: string; purpose: string; calls: number; input_tokens: string; output_tokens: string; cost: string; errors: number }[], byOrg, provider: { name: provider.name, configured: provider.isConfigured() } };
  });
}

// ------------------------------------------------------------------------------------------ integration settings

const blankToUndef = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : v);
const num = <S extends z.ZodType<number, unknown>>(schema: S, def: number) => z.preprocess(blankToUndef, schema.optional().transform((v) => v ?? def));
const optStr = (max = 200) => z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.string().trim().max(max).optional());

export const SETTINGS = {
  smtp: z.object({ host: optStr(), port: num(z.coerce.number().int().min(1).max(65535), 587), user: optStr(), from: optStr(), secure: z.boolean().default(false) }),
  ai: z.object({ provider: z.enum(["none", "anthropic"]).default("none"), modelExtraction: optStr(80), modelFast: optStr(80) }),
  "payments.bank_transfer": z.object({ enabled: z.boolean().default(false), bankName: optStr(), iban: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^SA\d{22}$/).optional()), beneficiary: optStr() }),
  commission: z.object({ ratePct: num(z.coerce.number().min(0).max(50), 0) }),
  "store.policies": z.object({ returnWindowDays: num(z.coerce.number().int().min(0).max(90), 7) }),
  price_index: z.object({ windowDays: num(z.coerce.number().int().min(7).max(365), 90), minObs: num(z.coerce.number().int().min(5).max(1000), 5), minOrgs: num(z.coerce.number().int().min(3).max(100), 3), maxSharePct: num(z.coerce.number().min(20).max(60), 60) }),
} as const;
export type SettingKey = keyof typeof SETTINGS;
const SECRET_SETTINGS: SettingKey[] = ["smtp", "ai"];

/** Settings for the admin UI: values plus `hasSecret` — secrets are never returned. */
export async function getIntegrationSettings(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.integrations");
  const keys = Object.keys(SETTINGS) as SettingKey[];
  const out = {} as Record<SettingKey, { value: Record<string, unknown>; hasSecret: boolean; updatedAt: Date | null }>;
  for (const k of keys) out[k] = await getSettingForAdmin({ ...ctx, permissions: new Set([...ctx.permissions, "admin.settings"]) } as Ctx, k);
  return out;
}

/** Save a validated setting. `secret`: undefined = keep, "" = clear, otherwise replace (encrypted). */
export async function saveIntegrationSetting(ctx: Ctx, key: SettingKey, value: Record<string, unknown>, secret?: string) {
  authorizeAdmin(ctx, "admin.integrations");
  if (!(key in SETTINGS)) throw notFound("Setting");
  const parsed = SETTINGS[key].parse(value);
  if (secret !== undefined && !SECRET_SETTINGS.includes(key)) throw validation("This setting has no secret", { key: "validation" });
  if (key === "payments.bank_transfer" && (parsed as { enabled: boolean; iban?: string; beneficiary?: string }).enabled && !((parsed as { iban?: string }).iban && (parsed as { beneficiary?: string }).beneficiary)) {
    throw validation("IBAN and beneficiary are required", { key: "bank_details_required" });
  }
  await putSetting({ ...ctx, permissions: new Set([...ctx.permissions, "admin.settings"]) } as Ctx, key, parsed as Record<string, unknown>, secret);
  if (key === "smtp") invalidateEmailSettings();
  if (key === "ai") invalidateAiSettings();
}

/** Connectivity checks that never expose secrets. SMTP: verify + optional test email. */
export async function testIntegration(ctx: Ctx, kind: "smtp" | "ai" | "payments", opts: { sendTo?: string } = {}) {
  authorizeAdmin(ctx, "admin.integrations");
  let result: { ok: boolean; detail: string };
  if (kind === "smtp") {
    const t = await resolveEmailTransport();
    if (!t.isConfigured()) result = { ok: false, detail: "not_configured" };
    else {
      const v = await t.verify();
      result = { ok: v.ok, detail: v.ok ? "verified" : (v.error ?? "failed").slice(0, 200) };
      if (v.ok && opts.sendTo) {
        const to = z.string().email().parse(opts.sendTo);
        const { renderEmail, TEMPLATES } = await import("../notifications");
        const msg = renderEmail(TEMPLATES["system.test"][ctx.locale], ctx.locale, { brand: ctx.locale === "ar" ? (process.env.BRAND_NAME_AR ?? "") : (process.env.BRAND_NAME_EN ?? "") });
        try {
          await t.send({ to, ...msg });
          result = { ok: true, detail: "sent" };
        } catch (e) {
          result = { ok: false, detail: String((e as Error).message).slice(0, 200) };
        }
      }
    }
  } else if (kind === "ai") {
    const p = await resolveAiProvider();
    result = { ok: p.isConfigured(), detail: p.isConfigured() ? `${p.name} configured` : "not_configured" };
  } else {
    const m = await availableMethods();
    const name = m.cardProvider;
    result = { ok: m.card || m.bankTransfer, detail: `card:${m.card ? (name ?? "?") : "off"} bank_transfer:${m.bankTransfer ? "on" : "off"}` };
  }
  await withSystem((tx) => audit(ctx, { action: "integration.tested", entityType: "integration", entityId: kind, orgId: null, data: { ok: result.ok } }, tx));
  return result;
}

// ------------------------------------------------------------------------------------------ content pages

export const CONTENT_SLUGS = ["terms", "privacy", "returns", "seller-terms"] as const;
export const contentSchema = z.object({ slug: z.enum(CONTENT_SLUGS), locale: z.enum(["ar", "en"]), title: z.string().trim().min(2).max(200), body: z.string().trim().min(10).max(100_000) });

export async function listContent(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.content", { requireMfa: false });
  return withSystem((tx) => tx.select().from(contentPages).orderBy(contentPages.slug, contentPages.locale, desc(contentPages.version)));
}

/** Save a new draft version (pages are immutable once published; edits create versions). */
export async function saveContentDraft(ctx: Ctx, input: z.input<typeof contentSchema>) {
  authorizeAdmin(ctx, "admin.content");
  const d = contentSchema.parse(input);
  return withSystem(async (tx) => {
    const [last] = await tx.select({ v: sql<number>`coalesce(max(${contentPages.version}),0)::int` }).from(contentPages).where(and(eq(contentPages.slug, d.slug), eq(contentPages.locale, d.locale)));
    const [row] = await tx.insert(contentPages).values({ ...d, version: (last?.v ?? 0) + 1, updatedBy: ctx.userId }).returning();
    await audit(ctx, { action: "content.draft_saved", entityType: "content_page", entityId: row!.id, orgId: null, data: { slug: d.slug, locale: d.locale, version: row!.version } }, tx);
    return row!;
  });
}

export async function publishContent(ctx: Ctx, id: string) {
  authorizeAdmin(ctx, "admin.content");
  await withSystem(async (tx) => {
    const [p] = await tx.select().from(contentPages).where(eq(contentPages.id, id)).limit(1).for("update");
    if (!p) throw notFound("Page");
    if (p.status !== "draft") throw invalidState("Only drafts can be published", { key: "invalid_state" });
    await tx.update(contentPages).set({ status: "archived" }).where(and(eq(contentPages.slug, p.slug), eq(contentPages.locale, p.locale), eq(contentPages.status, "published")));
    await tx.update(contentPages).set({ status: "published", publishedAt: new Date() }).where(eq(contentPages.id, id));
    await audit(ctx, { action: "content.published", entityType: "content_page", entityId: id, orgId: null, data: { slug: p.slug, locale: p.locale, version: p.version } }, tx);
  });
}

/** Public: the currently published version of a page (or null → show the built-in draft notice). */
export async function publishedContent(slug: string, locale: "ar" | "en") {
  const [p] = await withSystem((tx) =>
    tx
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.slug, slug), eq(contentPages.locale, locale), eq(contentPages.status, "published")))
      .limit(1),
  );
  return p ?? null;
}

// ------------------------------------------------------------------------------------------ store orders (finance)

export async function listAllOrders(ctx: Ctx, opts: { q?: string; status?: string; page?: number } = {}) {
  authorizeAdmin(ctx, "admin.finance");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  return withSystem(async (tx) => {
    const where = and(opts.q ? ilike(orders.code, `%${likeEscape(opts.q.trim())}%`) : undefined, opts.status ? eq(orders.status, opts.status) : undefined);
    const items = await tx
      .select({ o: orders, email: authUsers.email })
      .from(orders)
      .innerJoin(authUsers, eq(authUsers.id, orders.userId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export function assertNotSelf(ctx: Ctx, userId: string) {
  if (ctx.userId === userId) throw new AppError("FORBIDDEN", "Not allowed on yourself", { key: "self_action" });
}

// ------------------------------------------------------------------------------------------ platform default shipping

/** Platform default delivery zones (used for suppliers without their own zones). */
export async function listDefaultZones(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.settings", { requireMfa: false });
  const { shippingRates, shippingZones } = await import("@platform/db/schema");
  return withSystem(async (tx) => {
    const zones = await tx.select().from(shippingZones).where(isNull(shippingZones.supplierOrgId));
    const rates = zones.length ? await tx.select().from(shippingRates).where(inArray(shippingRates.zoneId, zones.map((z) => z.id))) : [];
    return zones.map((z) => ({ ...z, rates: rates.filter((r) => r.zoneId === z.id) }));
  });
}

export async function saveDefaultZone(ctx: Ctx, id: string | null, input: unknown) {
  authorizeAdmin(ctx, "admin.settings");
  const { zoneSchema } = await import("../commerce");
  const { shippingRates, shippingZones } = await import("@platform/db/schema");
  const d = zoneSchema.parse(input);
  if (!d.nationwide && !d.cities.length && !d.regions.length) throw validation("Choose cities, regions or nationwide", { key: "zone_empty" });
  return withSystem(async (tx) => {
    let zoneId = id;
    if (id) {
      const [z] = await tx.update(shippingZones).set({ name: d.name, nationwide: d.nationwide, cities: d.cities, regions: d.regions, isActive: d.isActive }).where(and(eq(shippingZones.id, id), isNull(shippingZones.supplierOrgId))).returning();
      if (!z) throw notFound("Zone");
      await tx.delete(shippingRates).where(eq(shippingRates.zoneId, id));
    } else {
      const [z] = await tx.insert(shippingZones).values({ supplierOrgId: null, name: d.name, nationwide: d.nationwide, cities: d.cities, regions: d.regions, isActive: d.isActive }).returning();
      zoneId = z!.id;
    }
    await tx.insert(shippingRates).values(d.rates.map((r) => ({ zoneId: zoneId!, supplierOrgId: null, method: r.method, fee: r.fee, freeOver: r.freeOver, etaMinDays: r.etaMinDays, etaMaxDays: r.etaMaxDays })));
    await audit(ctx, { action: "shipping.default_zone_saved", entityType: "shipping_zone", entityId: zoneId!, orgId: null, data: { name: d.name } }, tx);
    return { id: zoneId! };
  });
}
