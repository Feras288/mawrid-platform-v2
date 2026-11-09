import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, defineMachine, invalidState, notFound, validation } from "@platform/core";
import { pageParams, withContext, withSystem, type Tx } from "@platform/db";
import {
  authUsers,
  categories,
  membershipRoles,
  memberships,
  organizations,
  roles,
  supplierCategories,
  supplierDocuments,
  supplierProfiles,
  supplierStatusHistory,
  warehouses,
  SUPPLIER_DOC_KINDS,
  type SupplierStatus,
} from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, authorizeAdmin, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { uploadFile } from "../files";
import { notifyUsers } from "../notifications";
import { emit } from "../outbox";

export const supplierMachine = defineMachine<SupplierStatus>({
  name: "supplier",
  states: ["new", "pending_verification", "under_review", "approved", "suspended", "rejected"],
  transitions: {
    new: ["pending_verification"],
    pending_verification: ["under_review", "new"],
    under_review: ["approved", "rejected", "pending_verification"],
    approved: ["suspended"],
    suspended: ["approved", "rejected"],
    rejected: ["pending_verification"],
  },
  terminal: [],
});

/** Documents that must be uploaded before submitting for verification. */
export const REQUIRED_DOCS = ["commercial_registration", "vat_certificate"] as const;

// --------------------------------------------------------------------------------- profile

async function ensureProfile(tx: Tx, orgId: string) {
  await tx.insert(supplierProfiles).values({ orgId }).onConflictDoNothing();
  const [p] = await tx.select().from(supplierProfiles).where(eq(supplierProfiles.orgId, orgId)).limit(1);
  return p!;
}

export async function getMyProfile(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "org.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const profile = await ensureProfile(tx, ctx.orgId);
    const cats = await tx.select({ categoryId: supplierCategories.categoryId }).from(supplierCategories).where(eq(supplierCategories.orgId, ctx.orgId));
    const docs = await tx.select().from(supplierDocuments).where(eq(supplierDocuments.orgId, ctx.orgId)).orderBy(desc(supplierDocuments.createdAt));
    const history = await tx.select().from(supplierStatusHistory).where(eq(supplierStatusHistory.orgId, ctx.orgId)).orderBy(desc(supplierStatusHistory.createdAt)).limit(20);
    return { profile, categoryIds: cats.map((c) => c.categoryId), documents: docs, history };
  });
}

export const profileSchema = z.object({
  descriptionAr: z.string().trim().max(3000).optional().nullable(),
  descriptionEn: z.string().trim().max(3000).optional().nullable(),
  establishedYear: z.coerce.number().int().min(1900).max(new Date().getFullYear()).optional().nullable(),
  employeesRange: z.enum(["1-10", "11-50", "51-200", "201-500", "500+"]).optional().nullable(),
  coverageRegions: z.array(z.string().max(4)).max(20).default([]),
  coverageCities: z.array(z.string().max(40)).max(100).default([]),
  deliversNationwide: z.boolean().default(false),
  minOrderValue: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  paymentTerms: z.string().trim().max(500).optional().nullable(),
  acceptsStoreOrders: z.boolean().default(true),
  acceptsRfqs: z.boolean().default(true),
  categoryIds: z.array(z.string().uuid()).max(200).default([]),
});

export async function updateMyProfile(ctx: Ctx, input: z.input<typeof profileSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.profile.manage", { write: true });
  const d = profileSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    await ensureProfile(tx, ctx.orgId);
    const { categoryIds, ...fields } = d;
    await tx.update(supplierProfiles).set({ ...fields, minOrderValue: fields.minOrderValue ?? null }).where(eq(supplierProfiles.orgId, ctx.orgId));
    if (categoryIds.length) {
      const valid = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, categoryIds));
      if (valid.length !== categoryIds.length) throw validation("Unknown category");
    }
    await tx.delete(supplierCategories).where(eq(supplierCategories.orgId, ctx.orgId));
    if (categoryIds.length) await tx.insert(supplierCategories).values(categoryIds.map((categoryId) => ({ orgId: ctx.orgId, categoryId })));
    await audit(ctx, { action: "supplier.profile_updated", entityType: "supplier_profile", entityId: ctx.orgId, data: { fields: Object.keys(fields), categories: categoryIds.length } }, tx);
    return { ok: true };
  });
}

// --------------------------------------------------------------------------------- documents

export const documentMetaSchema = z.object({
  kind: z.enum(SUPPLIER_DOC_KINDS),
  documentNumber: z.string().trim().max(60).optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
});

export async function uploadSupplierDocument(ctx: Ctx, meta: z.input<typeof documentMetaSchema>, file: { buffer: Buffer; fileName: string }) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.documents.manage", { write: true });
  const m = documentMetaSchema.parse(meta);
  if (m.expiresAt && m.expiresAt < new Date()) throw validation("Document is already expired", { key: "document_expired" });
  return withContext(dbCtx(ctx), async (tx) => {
    const f = await uploadFile(ctx, { buffer: file.buffer, fileName: file.fileName, ownerType: "supplier_document", classification: "confidential" }, tx);
    const [doc] = await tx
      .insert(supplierDocuments)
      .values({ orgId: ctx.orgId, kind: m.kind, fileId: f.id, documentNumber: m.documentNumber ?? null, expiresAt: m.expiresAt ?? null })
      .returning();
    await tx.execute(sql`update files set owner_id = ${doc!.id} where id = ${f.id}`);
    await audit(ctx, { action: "supplier.document_uploaded", entityType: "supplier_document", entityId: doc!.id, data: { kind: m.kind } }, tx);
    return doc!;
  });
}

export async function deleteSupplierDocument(ctx: Ctx, docId: string) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.documents.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [doc] = await tx.select().from(supplierDocuments).where(and(eq(supplierDocuments.id, docId), eq(supplierDocuments.orgId, ctx.orgId))).limit(1);
    if (!doc) throw notFound("Document");
    if (doc.status === "verified") throw invalidState("Verified documents cannot be deleted; upload a replacement");
    await tx.delete(supplierDocuments).where(eq(supplierDocuments.id, docId));
    await audit(ctx, { action: "supplier.document_deleted", entityType: "supplier_document", entityId: docId }, tx);
  });
}

// --------------------------------------------------------------------------------- lifecycle

async function transition(tx: Tx, ctx: Ctx, orgId: string, to: SupplierStatus, reason?: string | null) {
  const [p] = await tx.select().from(supplierProfiles).where(eq(supplierProfiles.orgId, orgId)).limit(1).for("update");
  if (!p) throw notFound("Supplier");
  supplierMachine.assert(p.status as SupplierStatus, to);
  const now = new Date();
  await tx
    .update(supplierProfiles)
    .set({
      status: to,
      statusReason: reason ?? null,
      submittedAt: to === "pending_verification" ? now : p.submittedAt,
      reviewedBy: ["approved", "rejected", "suspended"].includes(to) ? ctx.userId : p.reviewedBy,
      reviewedAt: ["approved", "rejected", "suspended"].includes(to) ? now : p.reviewedAt,
      approvedAt: to === "approved" ? (p.approvedAt ?? now) : p.approvedAt,
    })
    .where(eq(supplierProfiles.orgId, orgId));
  await tx.insert(supplierStatusHistory).values({ orgId, fromStatus: p.status, toStatus: to, reason: reason ?? null, actorUserId: ctx.userId });
  await audit({ ...ctx }, { action: `supplier.status_${to}`, entityType: "supplier_profile", entityId: orgId, orgId, data: { from: p.status, to, reason } }, tx);
  await emit({ topic: "supplier.status_changed", aggregateType: "supplier", aggregateId: orgId, orgId, payload: { from: p.status, to, reason: reason ?? null } }, tx);
  // notify supplier admins
  const admins = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active"), eq(roles.key, "supplier_admin")));
  const [org] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  await notifyUsers({ userIds: [...new Set(admins.map((a) => a.userId))], kind: "supplier.status_changed", params: { orgName: org?.nameEn ?? "", status: to, note: reason ?? "" }, link: "/supplier/profile", orgId, dedupeKey: `supplier-status:${orgId}:${to}:${now.getTime()}`, email: true }, tx);
}

/** Supplier submits for verification. Requires a complete profile and the mandatory documents. */
export async function submitForVerification(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.profile.manage", { write: true });
  // validation in user context, transition in system context (status column is platform-guarded)
  await withContext(dbCtx(ctx), async (tx) => {
    const p = await ensureProfile(tx, ctx.orgId);
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const missing: string[] = [];
    if (!org?.crNumber) missing.push("crNumber");
    if (!org?.vatNumber) missing.push("vatNumber");
    if (!org?.city) missing.push("city");
    if (!p.descriptionAr && !p.descriptionEn) missing.push("description");
    const docs = await tx.select({ kind: supplierDocuments.kind, status: supplierDocuments.status }).from(supplierDocuments).where(eq(supplierDocuments.orgId, ctx.orgId));
    for (const k of REQUIRED_DOCS) if (!docs.some((d) => d.kind === k && d.status !== "rejected")) missing.push(`document:${k}`);
    const cats = await tx.select({ c: supplierCategories.categoryId }).from(supplierCategories).where(eq(supplierCategories.orgId, ctx.orgId)).limit(1);
    if (!cats.length) missing.push("categories");
    if (missing.length) throw new AppError("VALIDATION", "Profile incomplete", { key: "supplier_profile_incomplete", details: { missing } });
  });
  await withSystem((tx) => transition(tx, ctx, ctx.orgId!, "pending_verification"));
}

// --------------------------------------------------------------------------------- admin review

export async function listSuppliersForAdmin(ctx: Ctx, opts: { status?: SupplierStatus; page?: number; q?: string } = {}) {
  authorizeAdmin(ctx, "admin.suppliers.review");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  return withSystem(async (tx) => {
    const where = and(
      eq(organizations.type, "supplier"),
      opts.status ? eq(supplierProfiles.status, opts.status) : undefined,
      opts.q ? sql`(${organizations.nameEn} ilike ${"%" + opts.q + "%"} or ${organizations.nameAr} ilike ${"%" + opts.q + "%"} or ${organizations.crNumber} = ${opts.q})` : undefined,
    );
    const items = await tx
      .select({
        orgId: organizations.id,
        nameAr: organizations.nameAr,
        nameEn: organizations.nameEn,
        crNumber: organizations.crNumber,
        vatNumber: organizations.vatNumber,
        city: organizations.city,
        status: sql<string>`coalesce(${supplierProfiles.status}, 'new')`,
        submittedAt: supplierProfiles.submittedAt,
        isTestData: organizations.isTestData,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .leftJoin(supplierProfiles, eq(supplierProfiles.orgId, organizations.id))
      .where(where)
      .orderBy(desc(sql`coalesce(${supplierProfiles.submittedAt}, ${organizations.createdAt})`))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(organizations).leftJoin(supplierProfiles, eq(supplierProfiles.orgId, organizations.id)).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

export async function getSupplierForAdmin(ctx: Ctx, orgId: string) {
  authorizeAdmin(ctx, "admin.suppliers.review");
  return withSystem(async (tx) => {
    const [org] = await tx.select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.type, "supplier"))).limit(1);
    if (!org) throw notFound("Supplier");
    const profile = await ensureProfile(tx, orgId);
    const docs = await tx.select().from(supplierDocuments).where(eq(supplierDocuments.orgId, orgId)).orderBy(asc(supplierDocuments.kind));
    const history = await tx.select().from(supplierStatusHistory).where(eq(supplierStatusHistory.orgId, orgId)).orderBy(desc(supplierStatusHistory.createdAt));
    const cats = await tx.select({ id: categories.id, nameAr: categories.nameAr, nameEn: categories.nameEn }).from(supplierCategories).innerJoin(categories, eq(categories.id, supplierCategories.categoryId)).where(eq(supplierCategories.orgId, orgId));
    const members = await tx.select({ name: authUsers.name, email: authUsers.email }).from(memberships).innerJoin(authUsers, eq(authUsers.id, memberships.userId)).where(eq(memberships.orgId, orgId));
    await audit(ctx, { action: "admin.supplier_viewed", entityType: "supplier_profile", entityId: orgId, orgId: null }, tx);
    return { org, profile, documents: docs, history, categories: cats, members };
  });
}

export async function startReview(ctx: Ctx, orgId: string) {
  authorizeAdmin(ctx, "admin.suppliers.review");
  await withSystem((tx) => transition(tx, ctx, orgId, "under_review"));
}

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "suspended", "pending_verification"]),
  reason: z.string().trim().max(1000).optional().nullable(),
});

/** Approve / reject / suspend / reinstate / return for more info. Rejection & suspension need a reason. */
export async function decideSupplier(ctx: Ctx, orgId: string, input: z.input<typeof decisionSchema>) {
  authorizeAdmin(ctx, "admin.suppliers.review");
  const d = decisionSchema.parse(input);
  if ((d.decision === "rejected" || d.decision === "suspended" || d.decision === "pending_verification") && !d.reason) throw validation("A reason is required", { key: "reason_required" });
  await withSystem(async (tx) => {
    if (d.decision === "approved") {
      const docs = await tx.select({ kind: supplierDocuments.kind, status: supplierDocuments.status }).from(supplierDocuments).where(eq(supplierDocuments.orgId, orgId));
      const unverified = REQUIRED_DOCS.filter((k) => !docs.some((x) => x.kind === k && x.status === "verified"));
      if (unverified.length) throw new AppError("INVALID_STATE", "Mandatory documents must be verified before approval", { key: "documents_not_verified", details: { unverified } });
    }
    await transition(tx, ctx, orgId, d.decision, d.reason);
  });
}

export async function reviewDocument(ctx: Ctx, docId: string, input: { status: "verified" | "rejected"; note?: string | null }) {
  authorizeAdmin(ctx, "admin.suppliers.review");
  if (input.status === "rejected" && !input.note) throw validation("A note is required to reject a document", { key: "reason_required" });
  await withSystem(async (tx) => {
    const [doc] = await tx.select().from(supplierDocuments).where(eq(supplierDocuments.id, docId)).limit(1);
    if (!doc) throw notFound("Document");
    if (input.status === "verified" && doc.expiresAt && doc.expiresAt < new Date()) throw invalidState("Expired documents cannot be verified");
    await tx.update(supplierDocuments).set({ status: input.status, reviewerNote: input.note ?? null, reviewedBy: ctx.userId, reviewedAt: new Date() }).where(eq(supplierDocuments.id, docId));
    await audit(ctx, { action: `supplier.document_${input.status}`, entityType: "supplier_document", entityId: docId, orgId: doc.orgId, data: { kind: doc.kind, note: input.note } }, tx);
  });
}

/** Mark expired documents (scheduled job). */
export async function expireDocuments(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx
      .update(supplierDocuments)
      .set({ status: "expired" })
      .where(and(sql`${supplierDocuments.expiresAt} < now()`, inArray(supplierDocuments.status, ["uploaded", "verified"])))
      .returning({ id: supplierDocuments.id });
    return rows.length;
  });
}

// --------------------------------------------------------------------------------- warehouses

export const warehouseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(60),
  region: z.string().trim().max(4).optional().nullable(),
  addressLine: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function listWarehouses(ctx: Ctx) {
  requireOrg(ctx, "supplier");
  return withContext(dbCtx(ctx), (tx) => tx.select().from(warehouses).where(eq(warehouses.orgId, ctx.orgId)).orderBy(asc(warehouses.name)));
}

export async function upsertWarehouse(ctx: Ctx, id: string | null, input: z.input<typeof warehouseSchema>) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "inventory.manage", { write: true });
  const d = warehouseSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    if (id) {
      const [row] = await tx.update(warehouses).set(d).where(and(eq(warehouses.id, id), eq(warehouses.orgId, ctx.orgId))).returning();
      if (!row) throw notFound("Warehouse");
      return row;
    }
    const [row] = await tx.insert(warehouses).values({ ...d, orgId: ctx.orgId }).returning();
    await audit(ctx, { action: "supplier.warehouse_created", entityType: "warehouse", entityId: row!.id }, tx);
    return row!;
  });
}

/** Approved suppliers covering a category/region (used for RFQ suggestions & store filters). */
export async function getSupplierStatus(orgId: string): Promise<SupplierStatus> {
  const [p] = await withSystem((tx) => tx.select({ status: supplierProfiles.status }).from(supplierProfiles).where(eq(supplierProfiles.orgId, orgId)).limit(1));
  return (p?.status as SupplierStatus) ?? "new";
}

/** Public directory of approved suppliers accepting RFQs (for recipient selection). */
export async function listApprovedSuppliers(q?: string) {
  const { withPublic } = await import("@platform/db");
  return withPublic((tx) =>
    tx
      .select({ orgId: organizations.id, nameAr: organizations.nameAr, nameEn: organizations.nameEn, city: organizations.city })
      .from(supplierProfiles)
      .innerJoin(organizations, eq(organizations.id, supplierProfiles.orgId))
      .where(and(eq(supplierProfiles.status, "approved"), eq(supplierProfiles.acceptsRfqs, true), eq(organizations.status, "active"), q ? sql`(${organizations.nameEn} ilike ${"%" + q + "%"} or ${organizations.nameAr} ilike ${"%" + q + "%"})` : undefined))
      .orderBy(asc(organizations.nameEn))
      .limit(300),
  );
}
