"use server";

import { z } from "zod";
import {
  createCustomRole,
  deleteCustomRole,
  inviteMember,
  revokeInvitation,
  setMemberRoles,
  setMemberStatus,
  updateOrganization,
  updateOrgSettings,
} from "@platform/modules/organizations";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

export async function inviteAction(fd: FormData) {
  return run(async () => {
    const ctx = await getCtx();
    const o = formToObject(fd);
    const { invitation } = await inviteMember(ctx, { email: String(o.email ?? ""), roleIds: (o.roleIds as string[]) ?? [] });
    return { id: invitation.id };
  });
}

export async function revokeInviteAction(id: string) {
  return run(async () => revokeInvitation(await getCtx(), z.string().uuid().parse(id)));
}

export async function setRolesAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    return setMemberRoles(await getCtx(), z.string().uuid().parse(o.membershipId), (o.roleIds as string[]) ?? []);
  });
}

export async function setStatusAction(membershipId: string, status: "active" | "suspended" | "removed") {
  return run(async () => setMemberStatus(await getCtx(), z.string().uuid().parse(membershipId), z.enum(["active", "suspended", "removed"]).parse(status)));
}

export async function createRoleAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const r = await createCustomRole(await getCtx(), { nameAr: String(o.nameAr ?? ""), nameEn: String(o.nameEn ?? ""), permissions: (o.permissions as string[]) ?? [] });
    return { id: r.id };
  });
}

export async function deleteRoleAction(id: string) {
  return run(async () => deleteCustomRole(await getCtx(), z.string().uuid().parse(id)));
}

export async function updateOrgProfileAction(fd: FormData) {
  return run(async () => {
    await updateOrganization(await getCtx(), formToObject(fd));
    return true;
  });
}

export async function updateOrgSettingsAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await updateOrgSettings(await getCtx(), {
      allowExternalAI: o.allowExternalAI === "1",
      requireMfaForApprovers: o.requireMfaForApprovers === "1",
      rfqAllowRevisionsUntilClose: o.rfqAllowRevisionsUntilClose === "1",
      aiMonthlyBudgetUsd: o.aiMonthlyBudgetUsd ? String(o.aiMonthlyBudgetUsd) : undefined,
    });
    return true;
  });
}
