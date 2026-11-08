import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { hashObject, invalidState, notFound, uuidv7 } from "@platform/core";
import { withContext, withSystem } from "@platform/db";
import {
  addresses,
  authAccounts,
  authSessions,
  authTwoFactors,
  authUsers,
  cartItems,
  carts,
  consents,
  dataRequests,
  files,
  memberships,
  notifications,
  orders,
  priceAlerts,
  wishlistItems,
} from "@platform/db/schema";
import { getStorage } from "@platform/integrations/storage";
import { audit } from "../audit";
import { authorizeAdmin, requireUser } from "../authz";
import { dbCtx, systemCtx, type Ctx } from "../context";
import { POLICY_VERSIONS, recordConsent } from "../identity";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";

/**
 * Personal-data rights (PDPL-oriented): consent management, data export and deletion requests.
 * Deletion anonymizes the account; records the law requires us to keep (orders, tax invoices, audit
 * logs, purchase documents of organizations) are retained without the personal profile. The legal
 * texts and retention periods are drafts pending legal review (DEC-10).
 */

export const OPTIONAL_CONSENTS = ["marketing", "external_ai_processing"] as const;

export async function myPrivacy(ctx: Ctx) {
  requireUser(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const c = await tx.select().from(consents).where(eq(consents.userId, ctx.userId!)).orderBy(desc(consents.createdAt));
    const latest = new Map<string, (typeof c)[number]>();
    for (const row of c) if (!latest.has(row.kind)) latest.set(row.kind, row);
    const requests = await tx.select().from(dataRequests).where(eq(dataRequests.userId, ctx.userId!)).orderBy(desc(dataRequests.createdAt)).limit(20);
    return { consents: [...latest.values()], history: c.slice(0, 50), requests, policyVersions: POLICY_VERSIONS };
  });
}

export async function setConsent(ctx: Ctx, kind: (typeof OPTIONAL_CONSENTS)[number], granted: boolean) {
  requireUser(ctx);
  z.enum(OPTIONAL_CONSENTS).parse(kind);
  await recordConsent(ctx.userId!, kind, granted, POLICY_VERSIONS.privacy_policy, ctx.ip ?? null);
  await withSystem((tx) => audit(ctx, { action: `consent.${granted ? "granted" : "withdrawn"}`, entityType: "user", entityId: ctx.userId!, orgId: null, data: { kind } }, tx));
}

async function openRequest(userId: string, kind: "export" | "deletion") {
  const [open] = await withSystem((tx) =>
    tx
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(and(eq(dataRequests.userId, userId), eq(dataRequests.kind, kind), inArray(dataRequests.status, ["pending", "processing"])))
      .limit(1),
  );
  return open ?? null;
}

/** Queue a machine-readable export of the user's personal data (built by the worker). */
export async function requestExport(ctx: Ctx) {
  requireUser(ctx);
  if (await openRequest(ctx.userId!, "export")) throw invalidState("An export is already in progress", { key: "request_open" });
  return withSystem(async (tx) => {
    const [r] = await tx.insert(dataRequests).values({ userId: ctx.userId!, kind: "export" }).returning();
    await emit({ topic: "privacy.export_requested", aggregateType: "data_request", aggregateId: r!.id, payload: { requestId: r!.id }, dedupeKey: `privacy-export:${r!.id}` }, tx);
    await audit(ctx, { action: "privacy.export_requested", entityType: "data_request", entityId: r!.id, orgId: null }, tx);
    return r!;
  });
}

/** Worker: assemble the export as JSON, store it privately for the user, notify. Idempotent. */
export async function buildExport(requestId: string) {
  const [r] = await withSystem((tx) => tx.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1));
  if (!r || r.kind !== "export" || r.status === "completed") return "noop";
  await withSystem((tx) => tx.update(dataRequests).set({ status: "processing" }).where(eq(dataRequests.id, r.id)));
  const data = await withSystem(async (tx) => {
    const [user] = await tx.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email, phone: authUsers.phone, locale: authUsers.locale, createdAt: authUsers.createdAt, twoFactorEnabled: authUsers.twoFactorEnabled }).from(authUsers).where(eq(authUsers.id, r.userId)).limit(1);
    const ms = await tx.execute(sql`select o.name_ar, o.name_en, o.type, m.status, m.created_at from memberships m join organizations o on o.id = m.org_id where m.user_id = ${r.userId}`);
    const addr = await tx.select().from(addresses).where(eq(addresses.userId, r.userId));
    const cons = await tx.select({ kind: consents.kind, version: consents.version, granted: consents.granted, createdAt: consents.createdAt }).from(consents).where(eq(consents.userId, r.userId));
    const ords = await tx.select({ code: orders.code, status: orders.status, total: orders.total, currency: orders.currency, createdAt: orders.createdAt, shippingAddress: orders.shippingAddress }).from(orders).where(and(eq(orders.userId, r.userId), sql`${orders.orgId} is null`));
    const sessions = await tx.select({ createdAt: authSessions.createdAt, ipAddress: authSessions.ipAddress, userAgent: authSessions.userAgent }).from(authSessions).where(eq(authSessions.userId, r.userId));
    const notes = await tx.select({ kind: notifications.kind, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.userId, r.userId)).limit(1000);
    const wl = await tx.select({ productId: wishlistItems.supplierProductId, createdAt: wishlistItems.createdAt }).from(wishlistItems).where(eq(wishlistItems.userId, r.userId));
    return { generatedAt: new Date().toISOString(), format: "personal-data-export/v1", user, memberships: ms.rows, addresses: addr, consents: cons, personalOrders: ords, sessions, notifications: notes, wishlist: wl };
  });
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  const fileId = uuidv7();
  const key = `user/${r.userId}/data_export/${fileId}.json`;
  await getStorage().put(key, body, "application/json");
  await withSystem(async (tx) => {
    await tx.insert(files).values({ id: fileId, orgId: null, uploadedBy: r.userId, ownerType: "data_export", ownerId: r.id, classification: "confidential", storageKey: key, originalName: `my-data-${new Date().toISOString().slice(0, 10)}.json`, mimeType: "application/json", sizeBytes: body.length, sha256: hashObject(body.toString("base64")), status: "ready" });
    await tx.update(dataRequests).set({ status: "completed", resultFileId: fileId, completedAt: new Date() }).where(eq(dataRequests.id, r.id));
    await notifyUsers({ userIds: [r.userId], kind: "privacy.export_ready", params: {}, link: "/account/privacy", dedupeKey: `privacy-export-ready:${r.id}`, email: true }, tx);
    await audit(systemCtx(), { action: "privacy.export_completed", entityType: "data_request", entityId: r.id, orgId: null, data: { bytes: body.length } }, tx);
  });
  return "completed";
}

/** Ask for account deletion; reviewed by an admin (obligations such as open orders are checked). */
export async function requestDeletion(ctx: Ctx, reason?: string | null) {
  requireUser(ctx);
  if (await openRequest(ctx.userId!, "deletion")) throw invalidState("A deletion request is already open", { key: "request_open" });
  const note = z.string().trim().max(1000).optional().nullable().parse(reason);
  return withSystem(async (tx) => {
    const [r] = await tx.insert(dataRequests).values({ userId: ctx.userId!, kind: "deletion", notes: note ?? null }).returning();
    await audit(ctx, { action: "privacy.deletion_requested", entityType: "data_request", entityId: r!.id, orgId: null }, tx);
    return r!;
  });
}

export async function listDataRequests(ctx: Ctx, opts: { status?: string } = {}) {
  authorizeAdmin(ctx, "admin.privacy");
  return withSystem((tx) =>
    tx
      .select({ r: dataRequests, email: authUsers.email, name: authUsers.name, openOrders: sql<number>`(select count(*)::int from orders o where o.user_id = ${dataRequests.userId} and o.status in ('pending_payment','placed','in_progress'))`, memberships: sql<number>`(select count(*)::int from memberships m where m.user_id = ${dataRequests.userId} and m.status = 'active')` })
      .from(dataRequests)
      .innerJoin(authUsers, eq(authUsers.id, dataRequests.userId))
      .where(opts.status ? eq(dataRequests.status, opts.status) : undefined)
      .orderBy(desc(dataRequests.createdAt))
      .limit(200),
  );
}

/**
 * Admin decision on a deletion request. Approval anonymizes the user: profile fields replaced, login
 * methods, sessions, 2FA, addresses, carts, wishlist and alerts removed, memberships ended. Orders,
 * invoices, audit logs and organization documents are retained for legal obligations.
 */
export async function decideDeletion(ctx: Ctx, requestId: string, decision: "approve" | "reject", notes: string) {
  authorizeAdmin(ctx, "admin.privacy");
  const why = z.string().trim().min(3).max(1000).parse(notes);
  await withSystem(async (tx) => {
    const [r] = await tx.select().from(dataRequests).where(eq(dataRequests.id, requestId)).limit(1).for("update");
    if (!r || r.kind !== "deletion") throw notFound("Request");
    if (r.status !== "pending") throw invalidState("Request already decided", { key: "already_decided" });
    if (decision === "reject") {
      await tx.update(dataRequests).set({ status: "rejected", notes: why, handledBy: ctx.userId, completedAt: new Date() }).where(eq(dataRequests.id, r.id));
      await notifyUsers({ userIds: [r.userId], kind: "privacy.request_decided", params: { kind: "deletion", status: "rejected", notes: why }, dedupeKey: `privacy-decided:${r.id}`, email: true }, tx);
      await audit(ctx, { action: "privacy.deletion_rejected", entityType: "data_request", entityId: r.id, orgId: null, data: { notes: why } }, tx);
      return;
    }
    const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.userId, r.userId), inArray(orders.status, ["pending_payment", "placed", "in_progress"])));
    if ((open?.n ?? 0) > 0) throw invalidState("The user has open orders", { key: "deletion_open_orders" });
    const [u] = await tx.select().from(authUsers).where(eq(authUsers.id, r.userId)).limit(1);
    if (!u) throw notFound("User");
    if (u.isPlatformAdmin) throw invalidState("Platform admins cannot be deleted this way", { key: "last_admin" });
    // notify before the email address is removed
    await notifyUsers({ userIds: [r.userId], kind: "privacy.request_decided", params: { kind: "deletion", status: "approved", notes: why }, dedupeKey: `privacy-decided:${r.id}`, email: true }, tx);
    await tx.delete(authSessions).where(eq(authSessions.userId, r.userId));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, r.userId));
    await tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, r.userId));
    await tx.delete(addresses).where(eq(addresses.userId, r.userId));
    await tx.delete(cartItems).where(eq(cartItems.userId, r.userId));
    await tx.delete(carts).where(eq(carts.userId, r.userId));
    await tx.delete(wishlistItems).where(eq(wishlistItems.userId, r.userId));
    await tx.delete(priceAlerts).where(eq(priceAlerts.userId, r.userId));
    await tx.update(memberships).set({ status: "removed" }).where(eq(memberships.userId, r.userId));
    await tx
      .update(authUsers)
      .set({ name: "Deleted user", email: `deleted-${r.userId}@deleted.invalid`, phone: null, image: null, emailVerified: false, twoFactorEnabled: false, status: "deleted" })
      .where(eq(authUsers.id, r.userId));
    await tx.update(dataRequests).set({ status: "completed", notes: why, handledBy: ctx.userId, completedAt: new Date() }).where(eq(dataRequests.id, r.id));
    await audit(ctx, { action: "privacy.deletion_completed", entityType: "data_request", entityId: r.id, orgId: null, data: { notes: why } }, tx);
  });
}
