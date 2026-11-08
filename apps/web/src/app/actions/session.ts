"use server";
import { cookies } from "next/headers";
import { isUuid } from "@platform/core";
import { listUserOrganizations } from "@platform/modules/context";
import { ACTIVE_ORG_COOKIE, getSession } from "@/lib/ctx";

/** Switch the active organization. Membership is verified here and again on every request. */
export async function switchOrgAction(orgId: string | null): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const jar = await cookies();
  if (!orgId) {
    jar.delete(ACTIVE_ORG_COOKIE);
    return { ok: true };
  }
  if (!isUuid(orgId)) return { ok: false };
  const orgs = await listUserOrganizations(session.user.id);
  if (!orgs.some((o) => o.orgId === orgId)) {
    // platform admins may enter an organization only through an active, audited break-glass grant
    const { activeGrant } = await import("@platform/modules/admin");
    if (!(session.user as { isPlatformAdmin?: boolean }).isPlatformAdmin || !(await activeGrant(session.user.id, orgId))) return { ok: false };
  }
  jar.set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.APP_ENV === "production" || process.env.APP_ENV === "staging", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return { ok: true };
}
