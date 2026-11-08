import { and, eq, inArray } from "drizzle-orm";
import { AppError, uuidv7 } from "@platform/core";
import { withSystem, type DbContext } from "@platform/db";
import { authUsers, breakglassGrants, membershipRoles, memberships, organizations, roles } from "@platform/db/schema";
import { gt, isNull } from "drizzle-orm";
import { ADMIN_PERMISSIONS, type Permission } from "../authz";

export type OrgType = "buyer" | "supplier" | "platform";
export type Locale = "ar" | "en";

/** Request/service context. Built only by trusted code from an authenticated session. */
export interface Ctx {
  userId: string | null;
  email: string | null;
  orgId: string | null;
  orgType: OrgType | null;
  membershipId: string | null;
  roleKeys: readonly string[];
  permissions: ReadonlySet<Permission>;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
  breakglass: boolean;
  locale: Locale;
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
  mode: "user" | "system" | "public";
}

export const dbCtx = (c: Ctx): DbContext => ({ userId: c.userId, orgId: c.orgId, mode: c.mode });

export function publicCtx(locale: Locale = "ar"): Ctx {
  return {
    userId: null,
    email: null,
    orgId: null,
    orgType: null,
    membershipId: null,
    roleKeys: [],
    permissions: new Set(),
    isPlatformAdmin: false,
    mfaEnabled: false,
    breakglass: false,
    locale,
    requestId: uuidv7(),
    mode: "public",
  };
}

/** Trusted system context (worker, framework bootstrap). Never derived from user input. */
export function systemCtx(): Ctx {
  return { ...publicCtx("ar"), mode: "system" };
}

export interface ResolveInput {
  userId: string;
  orgId?: string | null;
  locale?: Locale;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Resolve the full context for an authenticated user and an (optional) active org. The active org is
 * accepted only if the user has an active membership in it — or, for platform admins, an unexpired
 * break-glass grant for that org.
 */
export async function resolveContext(input: ResolveInput): Promise<Ctx> {
  return withSystem(async (tx) => {
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, input.userId)).limit(1);
    if (!user || user.status !== "active") throw new AppError("UNAUTHENTICATED", "User not active");
    const base: Ctx = {
      userId: user.id,
      email: user.email,
      orgId: null,
      orgType: null,
      membershipId: null,
      roleKeys: [],
      permissions: new Set(user.isPlatformAdmin ? ADMIN_PERMISSIONS : []),
      isPlatformAdmin: user.isPlatformAdmin,
      mfaEnabled: Boolean(user.twoFactorEnabled),
      breakglass: false,
      locale: input.locale ?? (user.locale === "en" ? "en" : "ar"),
      requestId: input.requestId ?? uuidv7(),
      ip: input.ip,
      userAgent: input.userAgent,
      mode: "user",
    };
    if (!input.orgId) return base;

    const [m] = await tx
      .select({ id: memberships.id, orgType: organizations.type, orgStatus: organizations.status })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, input.orgId), eq(memberships.status, "active")))
      .limit(1);

    if (m) {
      if (m.orgStatus !== "active") return base;
      const rs = await tx
        .select({ key: roles.key, permissions: roles.permissions })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(membershipRoles.membershipId, m.id));
      const perms = new Set<Permission>(base.permissions);
      for (const r of rs) for (const p of r.permissions) perms.add(p as Permission);
      return {
        ...base,
        orgId: input.orgId,
        orgType: m.orgType as OrgType,
        membershipId: m.id,
        roleKeys: rs.map((r) => r.key),
        permissions: perms,
      };
    }

    if (user.isPlatformAdmin) {
      const [g] = await tx
        .select({ id: breakglassGrants.id, orgType: organizations.type })
        .from(breakglassGrants)
        .innerJoin(organizations, eq(organizations.id, breakglassGrants.orgId))
        .where(
          and(
            eq(breakglassGrants.adminUserId, user.id),
            eq(breakglassGrants.orgId, input.orgId),
            isNull(breakglassGrants.revokedAt),
            gt(breakglassGrants.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (g) {
        // Read-only view permissions during break-glass.
        const view: Permission[] = ["org.view", "members.view", "project.view", "boq.view", "rfq.view", "quotation.view", "po.view", "audit.view", "supplier.rfq.view", "supplier.po.view", "products.view"];
        return { ...base, orgId: input.orgId, orgType: g.orgType as OrgType, breakglass: true, permissions: new Set([...base.permissions, ...view]) };
      }
    }
    return base;
  });
}

export async function listUserOrganizations(userId: string) {
  return withSystem((tx) =>
    tx
      .select({
        orgId: organizations.id,
        type: organizations.type,
        nameAr: organizations.nameAr,
        nameEn: organizations.nameEn,
        status: organizations.status,
        membershipId: memberships.id,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(organizations.nameEn),
  );
}

export async function rolesOf(membershipIds: string[]) {
  if (!membershipIds.length) return [];
  return withSystem((tx) =>
    tx
      .select({ membershipId: membershipRoles.membershipId, roleId: roles.id, key: roles.key, nameAr: roles.nameAr, nameEn: roles.nameEn })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(inArray(membershipRoles.membershipId, membershipIds)),
  );
}
