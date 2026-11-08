import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, conflict, forbidden, notFound, randomToken, sha256, validation } from "@platform/core";
import { slugify } from "@platform/core/text";
import { withContext, withSystem, type Tx } from "@platform/db";
import { authUsers, invitations, membershipRoles, memberships, organizations, roles } from "@platform/db/schema";
import { audit, diff } from "../audit";
import { authorize, OWNER_ROLE_KEY, permissionsForOrgType, requireOrg, requireUser, ROLE_TEMPLATES, type Permission } from "../authz";
import { dbCtx, type Ctx, type OrgType } from "../context";
import { emit } from "../outbox";
import { queueEmail } from "../notifications";

// ---------------------------------------------------------------------------------------------
// System roles
// ---------------------------------------------------------------------------------------------

/** Upsert system role templates (org_id NULL). Idempotent; run on worker start, seed and tests. */
export async function syncSystemRoles(): Promise<void> {
  await withSystem(async (tx) => {
    for (const t of ROLE_TEMPLATES) {
      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(isNull(roles.orgId), eq(roles.orgType, t.orgType), eq(roles.key, t.key)))
        .limit(1);
      if (existing) {
        await tx.update(roles).set({ nameAr: t.nameAr, nameEn: t.nameEn, permissions: [...t.permissions], isSystem: true }).where(eq(roles.id, existing.id));
      } else {
        await tx.insert(roles).values({ orgId: null, orgType: t.orgType, key: t.key, nameAr: t.nameAr, nameEn: t.nameEn, isSystem: true, permissions: [...t.permissions] });
      }
    }
  });
}

async function systemRoleId(tx: Tx, orgType: OrgType, key: string): Promise<string> {
  const [r] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.orgId), eq(roles.orgType, orgType), eq(roles.key, key)))
    .limit(1);
  if (!r) throw new AppError("INTERNAL", `System role ${orgType}/${key} missing — run syncSystemRoles()`);
  return r.id;
}

// ---------------------------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------------------------

const vat = z
  .string()
  .trim()
  .regex(/^3\d{13}3$/, "VAT number must be 15 digits starting and ending with 3")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const orgProfileSchema = z.object({
  nameAr: z.string().trim().min(2).max(200),
  nameEn: z.string().trim().min(2).max(200),
  activityType: z.enum(["contractor", "developer", "operations_maintenance", "consultant", "factory", "trading", "government", "other"]).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  website: z.string().trim().url().max(300).optional().or(z.literal("").transform(() => undefined)),
  vatNumber: vat,
  crNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "CR number must be 10 digits")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  addressLine: z.string().trim().max(300).optional(),
  district: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type OrgProfileInput = z.input<typeof orgProfileSchema>;

export const createOrgSchema = orgProfileSchema.extend({ type: z.enum(["buyer", "supplier"]) });

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const root = slugify(base) || "org";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? root : `${root}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const [hit] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate)).limit(1);
    if (!hit) return candidate;
  }
  throw conflict("Could not allocate organization slug");
}

/**
 * Any authenticated user may create a buyer or supplier organization and becomes its owner.
 * Bootstrap runs in system mode (the user has no membership yet) after explicit checks.
 */
export async function createOrganization(ctx: Ctx, input: z.input<typeof createOrgSchema>, opts: { isTestData?: boolean } = {}) {
  requireUser(ctx);
  const data = createOrgSchema.parse(input);
  return withSystem(async (tx) => {
    const slug = await uniqueSlug(tx, data.nameEn);
    const [org] = await tx
      .insert(organizations)
      .values({ ...data, slug, createdBy: ctx.userId, isTestData: opts.isTestData ?? false })
      .returning();
    if (!org) throw new AppError("INTERNAL", "Org insert failed");
    const [m] = await tx.insert(memberships).values({ orgId: org.id, userId: ctx.userId!, status: "active" }).returning();
    const roleId = await systemRoleId(tx, data.type, OWNER_ROLE_KEY[data.type]);
    await tx.insert(membershipRoles).values({ membershipId: m!.id, roleId, orgId: org.id });
    await audit({ ...ctx, orgId: org.id }, { action: "org.created", entityType: "organization", entityId: org.id, orgId: org.id, data: { type: data.type } }, tx);
    await emit({ topic: "org.created", aggregateType: "organization", aggregateId: org.id, orgId: org.id, payload: { type: data.type, createdBy: ctx.userId } }, tx);
    return org;
  });
}

export async function getOrganization(ctx: Ctx, orgId?: string) {
  requireUser(ctx);
  const id = orgId ?? ctx.orgId;
  if (!id) throw notFound("Organization");
  return withContext(dbCtx(ctx), async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!org) throw notFound("Organization");
    return org;
  });
}

export async function updateOrganization(ctx: Ctx, input: Partial<OrgProfileInput>) {
  requireOrg(ctx);
  authorize(ctx, "org.update", { write: true });
  const data = orgProfileSchema.partial().parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    if (!before) throw notFound("Organization");
    const [after] = await tx.update(organizations).set(data).where(eq(organizations.id, ctx.orgId)).returning();
    await audit(ctx, { action: "org.updated", entityType: "organization", entityId: ctx.orgId, data: { changes: diff(before as Record<string, unknown>, data) } }, tx);
    return after!;
  });
}

export const orgSettingsSchema = z.object({
  allowExternalAI: z.boolean().optional(),
  aiMonthlyBudgetUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  requireMfaForApprovers: z.boolean().optional(),
  defaultLocale: z.enum(["ar", "en"]).optional(),
  rfqAllowRevisionsUntilClose: z.boolean().optional(),
  preferredSupplierIds: z.array(z.string().uuid()).max(500).optional(),
  blockedSupplierIds: z.array(z.string().uuid()).max(500).optional(),
});

export async function updateOrgSettings(ctx: Ctx, input: z.input<typeof orgSettingsSchema>) {
  requireOrg(ctx);
  authorize(ctx, "settings.manage", { write: true });
  const patch = orgSettingsSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const [org] = await tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    if (!org) throw notFound("Organization");
    const settings = { ...org.settings, ...patch };
    await tx.update(organizations).set({ settings }).where(eq(organizations.id, ctx.orgId));
    await audit(ctx, { action: "org.settings_updated", entityType: "organization", entityId: ctx.orgId, data: { patch } }, tx);
    return settings;
  });
}

// ---------------------------------------------------------------------------------------------
// Members & roles
// ---------------------------------------------------------------------------------------------

export async function listMembers(ctx: Ctx) {
  requireOrg(ctx);
  authorize(ctx, "members.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        status: memberships.status,
        title: memberships.title,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.orgId), ne(memberships.status, "removed")))
      .orderBy(memberships.createdAt);
    // user names/emails are read through system context for members of this org only
    const userIds = rows.map((r) => r.userId);
    const users = userIds.length
      ? await withSystem((s) => s.select({ id: authUsers.id, name: authUsers.name, email: authUsers.email, twoFactorEnabled: authUsers.twoFactorEnabled }).from(authUsers).where(inArray(authUsers.id, userIds)))
      : [];
    const roleRows = rows.length
      ? await tx
          .select({ membershipId: membershipRoles.membershipId, roleId: roles.id, key: roles.key, nameAr: roles.nameAr, nameEn: roles.nameEn })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .where(eq(membershipRoles.orgId, ctx.orgId))
      : [];
    return rows.map((r) => ({
      ...r,
      user: users.find((u) => u.id === r.userId) ?? null,
      roles: roleRows.filter((x) => x.membershipId === r.membershipId),
    }));
  });
}

/** Roles assignable in the active org: system templates of the org type + org custom roles. */
export async function listAssignableRoles(ctx: Ctx) {
  requireOrg(ctx);
  authorize(ctx, "members.view");
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .select()
      .from(roles)
      .where(sql`(${roles.orgId} is null and ${roles.orgType} = ${ctx.orgType}) or ${roles.orgId} = ${ctx.orgId}`)
      .orderBy(roles.isSystem, roles.nameEn),
  );
}

async function loadRoles(tx: Tx, ctx: Ctx, roleIds: string[]) {
  if (!roleIds.length) throw validation("At least one role is required");
  const rs = await tx
    .select()
    .from(roles)
    .where(and(inArray(roles.id, roleIds), sql`((${roles.orgId} is null and ${roles.orgType} = ${ctx.orgType}) or ${roles.orgId} = ${ctx.orgId})`));
  if (rs.length !== new Set(roleIds).size) throw validation("Unknown role for this organization");
  return rs;
}

/** A member may only grant permissions they hold themselves (owners hold all). */
function assertCanGrant(ctx: Ctx, rs: { permissions: string[] }[]) {
  for (const r of rs) for (const p of r.permissions) if (!ctx.permissions.has(p as Permission)) throw forbidden(`Cannot grant permission ${p} you do not hold`);
}

const OWNER_KEYS = new Set(Object.values(OWNER_ROLE_KEY));

async function ownerCount(tx: Tx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${memberships.id})::int` })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(and(eq(membershipRoles.orgId, orgId), inArray(roles.key, [...OWNER_KEYS]), isNull(roles.orgId), eq(memberships.status, "active")));
  return row?.n ?? 0;
}

async function isOwnerMembership(tx: Tx, membershipId: string): Promise<boolean> {
  const rs = await tx
    .select({ key: roles.key, orgId: roles.orgId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(eq(membershipRoles.membershipId, membershipId));
  return rs.some((r) => r.orgId === null && OWNER_KEYS.has(r.key));
}

export async function setMemberRoles(ctx: Ctx, membershipId: string, roleIds: string[]) {
  requireOrg(ctx);
  authorize(ctx, "members.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.orgId))).limit(1);
    if (!m) throw notFound("Member");
    const rs = await loadRoles(tx, ctx, roleIds);
    assertCanGrant(ctx, rs);
    const wasOwner = await isOwnerMembership(tx, m.id);
    const willBeOwner = rs.some((r) => r.orgId === null && OWNER_KEYS.has(r.key));
    if (wasOwner && !willBeOwner && (await ownerCount(tx, ctx.orgId)) <= 1) throw conflict("Cannot remove the last owner", { key: "last_owner" });
    const before = await tx.select({ roleId: membershipRoles.roleId }).from(membershipRoles).where(eq(membershipRoles.membershipId, m.id));
    await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, m.id));
    await tx.insert(membershipRoles).values(rs.map((r) => ({ membershipId: m.id, roleId: r.id, orgId: ctx.orgId })));
    await audit(ctx, { action: "member.roles_changed", entityType: "membership", entityId: m.id, data: { userId: m.userId, from: before.map((b) => b.roleId), to: roleIds } }, tx);
    return { ok: true };
  });
}

export async function setMemberStatus(ctx: Ctx, membershipId: string, status: "active" | "suspended" | "removed") {
  requireOrg(ctx);
  authorize(ctx, "members.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.orgId, ctx.orgId))).limit(1);
    if (!m) throw notFound("Member");
    if (m.userId === ctx.userId && status !== "active") throw conflict("You cannot suspend or remove yourself");
    if (status !== "active" && (await isOwnerMembership(tx, m.id)) && (await ownerCount(tx, ctx.orgId)) <= 1) throw conflict("Cannot remove the last owner", { key: "last_owner" });
    await tx.update(memberships).set({ status }).where(eq(memberships.id, m.id));
    await audit(ctx, { action: `member.${status}`, entityType: "membership", entityId: m.id, data: { userId: m.userId, from: m.status, to: status } }, tx);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Custom roles
// ---------------------------------------------------------------------------------------------

export const customRoleSchema = z.object({
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  permissions: z.array(z.string()).min(1).max(100),
});

export async function createCustomRole(ctx: Ctx, input: z.input<typeof customRoleSchema>) {
  requireOrg(ctx);
  authorize(ctx, "roles.manage", { write: true });
  const data = customRoleSchema.parse(input);
  const allowed = new Set<string>(permissionsForOrgType(ctx.orgType!));
  for (const p of data.permissions) {
    if (!allowed.has(p)) throw validation(`Permission ${p} is not valid for this organization type`);
    if (!ctx.permissions.has(p as Permission)) throw forbidden(`Cannot grant permission ${p} you do not hold`);
  }
  return withContext(dbCtx(ctx), async (tx) => {
    const key = `custom_${slugify(data.nameEn).replace(/-/g, "_")}_${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const [r] = await tx.insert(roles).values({ orgId: ctx.orgId, orgType: ctx.orgType!, key, nameAr: data.nameAr, nameEn: data.nameEn, isSystem: false, permissions: data.permissions }).returning();
    await audit(ctx, { action: "role.created", entityType: "role", entityId: r!.id, data: { permissions: data.permissions } }, tx);
    return r!;
  });
}

export async function updateCustomRole(ctx: Ctx, roleId: string, input: z.input<typeof customRoleSchema>) {
  requireOrg(ctx);
  authorize(ctx, "roles.manage", { write: true });
  const data = customRoleSchema.parse(input);
  const allowed = new Set<string>(permissionsForOrgType(ctx.orgType!));
  for (const p of data.permissions) {
    if (!allowed.has(p)) throw validation(`Permission ${p} is not valid for this organization type`);
    if (!ctx.permissions.has(p as Permission)) throw forbidden(`Cannot grant permission ${p} you do not hold`);
  }
  return withContext(dbCtx(ctx), async (tx) => {
    const [r] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId))).limit(1);
    if (!r) throw notFound("Role");
    await tx.update(roles).set(data).where(eq(roles.id, roleId));
    await audit(ctx, { action: "role.updated", entityType: "role", entityId: roleId, data: { from: r.permissions, to: data.permissions } }, tx);
    return { ok: true };
  });
}

export async function deleteCustomRole(ctx: Ctx, roleId: string) {
  requireOrg(ctx);
  authorize(ctx, "roles.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const [r] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.orgId, ctx.orgId))).limit(1);
    if (!r) throw notFound("Role");
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(membershipRoles).where(eq(membershipRoles.roleId, roleId));
    if ((used?.n ?? 0) > 0) throw conflict("Role is assigned to members", { key: "role_in_use" });
    await tx.delete(roles).where(eq(roles.id, roleId));
    await audit(ctx, { action: "role.deleted", entityType: "role", entityId: roleId }, tx);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  roleIds: z.array(z.string().uuid()).min(1).max(10),
});

const INVITE_TTL_DAYS = 7;

export async function inviteMember(ctx: Ctx, input: z.input<typeof inviteSchema>) {
  requireOrg(ctx);
  authorize(ctx, "members.manage", { write: true });
  const data = inviteSchema.parse(input);
  const token = randomToken(32);
  const result = await withContext(dbCtx(ctx), async (tx) => {
    const rs = await loadRoles(tx, ctx, data.roleIds);
    assertCanGrant(ctx, rs);
    // already a member?
    const existingUser = await withSystem((s) => s.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = ${data.email}`).limit(1));
    if (existingUser[0]) {
      const [m] = await tx.select({ id: memberships.id, status: memberships.status }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, existingUser[0].id))).limit(1);
      if (m && m.status === "active") throw conflict("User is already a member", { key: "already_member" });
    }
    // revoke previous pending invitation for same email
    await tx
      .update(invitations)
      .set({ status: "revoked" })
      .where(and(eq(invitations.orgId, ctx.orgId), eq(invitations.status, "pending"), sql`lower(${invitations.email}) = ${data.email}`));
    const [inv] = await tx
      .insert(invitations)
      .values({
        orgId: ctx.orgId,
        email: data.email,
        roleIds: data.roleIds,
        tokenHash: sha256(token),
        invitedBy: ctx.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
      })
      .returning();
    await audit(ctx, { action: "member.invited", entityType: "invitation", entityId: inv!.id, data: { email: data.email, roleIds: data.roleIds } }, tx);
    const [org] = await tx.select({ nameAr: organizations.nameAr, nameEn: organizations.nameEn }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
    const [inviter] = await withSystem((s) => s.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, ctx.userId)).limit(1));
    const actionUrl = new URL(`/${ctx.locale}/invite/${token}`, process.env.APP_URL ?? "http://localhost:3100").toString();
    await queueEmail(
      {
        to: data.email,
        template: "org.invitation",
        locale: ctx.locale,
        params: { orgName: ctx.locale === "ar" ? org!.nameAr : org!.nameEn, inviterName: inviter?.name ?? "", actionUrl },
        orgId: ctx.orgId,
        dedupeKey: `invitation:${inv!.id}`,
      },
      tx,
    );
    return inv!;
  });
  return { invitation: result, token };
}

export async function listInvitations(ctx: Ctx) {
  requireOrg(ctx);
  authorize(ctx, "members.view");
  return withContext(dbCtx(ctx), (tx) => tx.select().from(invitations).where(eq(invitations.orgId, ctx.orgId)).orderBy(sql`${invitations.createdAt} desc`).limit(200));
}

export async function revokeInvitation(ctx: Ctx, invitationId: string) {
  requireOrg(ctx);
  authorize(ctx, "members.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const rows = await tx
      .update(invitations)
      .set({ status: "revoked" })
      .where(and(eq(invitations.id, invitationId), eq(invitations.orgId, ctx.orgId), eq(invitations.status, "pending")))
      .returning({ id: invitations.id });
    if (!rows.length) throw notFound("Invitation");
    await audit(ctx, { action: "member.invitation_revoked", entityType: "invitation", entityId: invitationId }, tx);
    return { ok: true };
  });
}

/** Look up an invitation by raw token (for the accept page). */
export async function getInvitationByToken(token: string) {
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ id: invitations.id, email: invitations.email, status: invitations.status, expiresAt: invitations.expiresAt, orgNameAr: organizations.nameAr, orgNameEn: organizations.nameEn, orgType: organizations.type })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.orgId))
      .where(eq(invitations.tokenHash, sha256(token)))
      .limit(1);
    return row ?? null;
  });
}

/** Accept an invitation. The signed-in user's verified email must match the invitation email. */
export async function acceptInvitation(ctx: Ctx, token: string) {
  requireUser(ctx);
  return withSystem(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, sha256(token))).limit(1).for("update");
    if (!inv || inv.status !== "pending") throw notFound("Invitation");
    if (inv.expiresAt < new Date()) {
      await tx.update(invitations).set({ status: "expired" }).where(eq(invitations.id, inv.id));
      throw new AppError("INVALID_STATE", "Invitation expired", { key: "invitation_expired" });
    }
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, ctx.userId!)).limit(1);
    if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) throw forbidden("Invitation was sent to a different email address");
    if (!user.emailVerified) throw new AppError("FORBIDDEN", "Verify your email first", { key: "email_not_verified" });
    let [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, inv.orgId), eq(memberships.userId, user.id))).limit(1);
    if (m) {
      await tx.update(memberships).set({ status: "active" }).where(eq(memberships.id, m.id));
      await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, m.id));
    } else {
      [m] = await tx.insert(memberships).values({ orgId: inv.orgId, userId: user.id, status: "active" }).returning();
    }
    // re-validate roles still exist & belong to org/type
    const [org] = await tx.select({ type: organizations.type }).from(organizations).where(eq(organizations.id, inv.orgId)).limit(1);
    const rs = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, inv.roleIds), sql`((${roles.orgId} is null and ${roles.orgType} = ${org!.type}) or ${roles.orgId} = ${inv.orgId})`));
    if (!rs.length) throw new AppError("INVALID_STATE", "Invitation roles no longer exist");
    await tx.insert(membershipRoles).values(rs.map((r) => ({ membershipId: m!.id, roleId: r.id, orgId: inv.orgId })));
    await tx.update(invitations).set({ status: "accepted", acceptedBy: user.id }).where(eq(invitations.id, inv.id));
    await audit({ ...ctx, orgId: inv.orgId }, { action: "member.joined", entityType: "membership", entityId: m!.id, orgId: inv.orgId, data: { invitationId: inv.id } }, tx);
    return { orgId: inv.orgId, membershipId: m!.id };
  });
}
