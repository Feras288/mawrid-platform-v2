import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getLocale } from "next-intl/server";
import { isUuid, uuidv7 } from "@platform/core";
import { publicCtx, resolveContext, type Ctx, type OrgType } from "@platform/modules/context";
import { redirect } from "@/i18n/navigation";
import { auth } from "./auth";

export const ACTIVE_ORG_COOKIE = "pl_active_org";

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Resolve the request context once per request. Active org comes from a cookie and is validated. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const locale = ((await getLocale()) === "en" ? "en" : "ar") as "ar" | "en";
  const session = await getSession();
  const h = await headers();
  if (!session) return publicCtx(locale);
  const orgCookie = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return resolveContext({
    userId: session.user.id,
    orgId: isUuid(orgCookie) ? orgCookie : null,
    locale,
    requestId: h.get("x-request-id") ?? uuidv7(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
});

/** Require a signed-in user, else redirect to login. */
export async function requireUserCtx(): Promise<Ctx & { userId: string }> {
  const ctx = await getCtx();
  if (!ctx.userId) {
    const locale = ctx.locale;
    redirect({ href: "/login", locale });
  }
  return ctx as Ctx & { userId: string };
}

/** Require an active org of the given type, else redirect to the org chooser. */
export async function requireOrgCtx(type?: OrgType | OrgType[]): Promise<Ctx & { userId: string; orgId: string }> {
  const ctx = await requireUserCtx();
  const types = type ? (Array.isArray(type) ? type : [type]) : null;
  if (!ctx.orgId || (types && !types.includes(ctx.orgType!))) {
    redirect({ href: `/account/organizations?need=${types?.join(",") ?? "any"}`, locale: ctx.locale });
  }
  return ctx as Ctx & { userId: string; orgId: string };
}

export async function requireAdminCtx(): Promise<Ctx & { userId: string }> {
  const ctx = await requireUserCtx();
  if (!ctx.isPlatformAdmin) redirect({ href: "/account", locale: ctx.locale });
  return ctx;
}
