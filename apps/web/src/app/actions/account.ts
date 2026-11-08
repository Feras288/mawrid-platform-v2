"use server";

import { cookies } from "next/headers";
import { createOrganization, acceptInvitation } from "@platform/modules/organizations";
import { updateProfile } from "@platform/modules/identity";
import { markRead } from "@platform/modules/notifications";
import { formToObject, run } from "@/lib/action";
import { ACTIVE_ORG_COOKIE, getCtx } from "@/lib/ctx";

export async function updateProfileAction(fd: FormData) {
  return run(async () => {
    const ctx = await getCtx();
    await updateProfile(ctx, formToObject(fd));
    return true;
  });
}

export async function createOrgAction(fd: FormData) {
  return run(async () => {
    const ctx = await getCtx();
    const org = await createOrganization(ctx, formToObject(fd) as never);
    (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", secure: process.env.APP_ENV === "production" || process.env.APP_ENV === "staging", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return { id: org.id, type: org.type };
  });
}

export async function acceptInviteAction(token: string) {
  return run(async () => {
    const ctx = await getCtx();
    const res = await acceptInvitation(ctx, token);
    (await cookies()).set(ACTIVE_ORG_COOKIE, res.orgId, { httpOnly: true, sameSite: "lax", secure: process.env.APP_ENV === "production" || process.env.APP_ENV === "staging", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return res;
  });
}

export async function markAllReadAction() {
  return run(async () => {
    const ctx = await getCtx();
    await markRead(ctx, "all");
    return true;
  });
}
