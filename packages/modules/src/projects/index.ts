import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { notFound, validation } from "@platform/core";
import { nextDocNumber, pageParams, withContext, type Tx } from "@platform/db";
import { authUsers, memberships, projectActivity, projectMembers, projects } from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, can, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";

export const PROJECT_TYPES = ["residential", "commercial", "industrial", "infrastructure", "healthcare", "education", "hospitality", "government", "other"] as const;
export const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  projectType: z.preprocess(blank, z.enum(PROJECT_TYPES).default("other")),
  city: z.string().trim().max(60).optional().nullable(),
  region: z.string().trim().max(4).optional().nullable(),
  siteAddress: z.string().trim().max(300).optional().nullable(),
  managerUserId: z.preprocess(blank, z.string().uuid().optional()),
  status: z.preprocess(blank, z.enum(PROJECT_STATUSES).default("planning")),
  visibility: z.preprocess(blank, z.enum(["org", "members"]).default("org")),
  startDate: z.preprocess(blank, z.coerce.date().optional()),
  endDate: z.preprocess(blank, z.coerce.date().optional()),
  budget: z.preprocess(
    blank,
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
  ),
});

/** Visibility filter: org-wide projects, or restricted projects where the user is a member/manager. */
function visibleWhere(ctx: Ctx) {
  if (can(ctx, "project.manage_members")) return undefined;
  return or(
    eq(projects.visibility, "org"),
    eq(projects.managerUserId, ctx.userId!),
    sql`exists (select 1 from project_members pm where pm.project_id = ${projects.id} and pm.user_id = ${ctx.userId})`,
  );
}

export async function logActivity(tx: Tx, ctx: Ctx, projectId: string, action: string, entity?: { type: string; id: string }, data: Record<string, unknown> = {}) {
  await tx.insert(projectActivity).values({ projectId, orgId: ctx.orgId!, actorUserId: ctx.userId, action, entityType: entity?.type ?? null, entityId: entity?.id ?? null, data });
}

/** Load a project the caller may see (throws not found otherwise — no existence leak). */
export async function loadProject(tx: Tx, ctx: Ctx, projectId: string) {
  const [p] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId!), visibleWhere(ctx)))
    .limit(1);
  if (!p) throw notFound("Project");
  return p;
}

async function assertOrgUser(tx: Tx, orgId: string, userId: string) {
  const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.status, "active"))).limit(1);
  if (!m) throw validation("User is not an active member of this organization");
}

export async function createProject(ctx: Ctx, input: z.input<typeof projectSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.create", { write: true });
  const d = projectSchema.parse(input);
  if (d.startDate && d.endDate && d.endDate < d.startDate) throw validation("End date before start date", { key: "dates_invalid" });
  return withContext(dbCtx(ctx), async (tx) => {
    if (d.managerUserId) await assertOrgUser(tx, ctx.orgId, d.managerUserId);
    const code = await nextDocNumber(tx, ctx.orgId, "project", "PRJ");
    const [p] = await tx
      .insert(projects)
      .values({ ...d, orgId: ctx.orgId, code, managerUserId: d.managerUserId ?? ctx.userId, createdBy: ctx.userId })
      .returning();
    await tx.insert(projectMembers).values({ projectId: p!.id, userId: p!.managerUserId!, orgId: ctx.orgId, role: "manager" }).onConflictDoNothing();
    await logActivity(tx, ctx, p!.id, "project.created");
    await audit(ctx, { action: "project.created", entityType: "project", entityId: p!.id }, tx);
    return p!;
  });
}

export async function updateProject(ctx: Ctx, projectId: string, input: z.input<typeof projectSchema>) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.update", { write: true });
  const d = projectSchema.parse(input);
  if (d.startDate && d.endDate && d.endDate < d.startDate) throw validation("End date before start date", { key: "dates_invalid" });
  return withContext(dbCtx(ctx), async (tx) => {
    const before = await loadProject(tx, ctx, projectId);
    if (d.managerUserId) await assertOrgUser(tx, ctx.orgId, d.managerUserId);
    const [p] = await tx.update(projects).set({ ...d, managerUserId: d.managerUserId ?? before.managerUserId }).where(eq(projects.id, projectId)).returning();
    if (before.status !== p!.status) await logActivity(tx, ctx, projectId, "project.status_changed", undefined, { from: before.status, to: p!.status });
    else await logActivity(tx, ctx, projectId, "project.updated");
    await audit(ctx, { action: "project.updated", entityType: "project", entityId: projectId }, tx);
    return p!;
  });
}

export async function listProjects(ctx: Ctx, opts: { q?: string; status?: string; page?: number } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.view");
  const { limit, offset, page, pageSize } = pageParams(opts.page, 20);
  return withContext(dbCtx(ctx), async (tx) => {
    const where = and(
      eq(projects.orgId, ctx.orgId),
      visibleWhere(ctx),
      opts.status ? eq(projects.status, opts.status) : undefined,
      opts.q ? sql`(${projects.name} ilike ${"%" + opts.q + "%"} or ${projects.code} ilike ${"%" + opts.q + "%"})` : undefined,
    );
    const items = await tx.select().from(projects).where(where).orderBy(desc(projects.createdAt)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(projects).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

/** Minimal list for selects (id, code, name). */
export async function projectOptions(ctx: Ctx) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.view");
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .select({ id: projects.id, code: projects.code, name: projects.name })
      .from(projects)
      .where(and(eq(projects.orgId, ctx.orgId), visibleWhere(ctx), inArray(projects.status, ["planning", "active", "on_hold"])))
      .orderBy(desc(projects.createdAt))
      .limit(500),
  );
}

export async function getProject(ctx: Ctx, projectId: string) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const p = await loadProject(tx, ctx, projectId);
    const members = await tx
      .select({ userId: projectMembers.userId, role: projectMembers.role, name: authUsers.name, email: authUsers.email })
      .from(projectMembers)
      .innerJoin(authUsers, eq(authUsers.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId));
    const activity = await tx.select().from(projectActivity).where(eq(projectActivity.projectId, projectId)).orderBy(desc(projectActivity.createdAt)).limit(50);
    return { project: p, members, activity };
  });
}

export async function setProjectMember(ctx: Ctx, projectId: string, userId: string, role: "manager" | "member" | "viewer" | null) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "project.manage_members", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    await loadProject(tx, ctx, projectId);
    if (role) {
      await assertOrgUser(tx, ctx.orgId, userId);
      await tx.insert(projectMembers).values({ projectId, userId, orgId: ctx.orgId, role }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role } });
    } else {
      await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    }
    await logActivity(tx, ctx, projectId, role ? "project.member_set" : "project.member_removed", { type: "user", id: userId }, { role });
    await audit(ctx, { action: "project.member_changed", entityType: "project", entityId: projectId, data: { userId, role } }, tx);
  });
}

/** Ensure a project id (when provided) is visible to the caller — used by BOQ/RFQ/PO modules. */
export async function assertProjectAccess(tx: Tx, ctx: Ctx, projectId: string | null | undefined) {
  if (!projectId) return;
  await loadProject(tx, ctx, projectId);
}
