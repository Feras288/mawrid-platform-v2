import { AppError } from "@platform/core";
import type { Ctx, OrgType } from "../context";
import type { Permission } from "./permissions";

export * from "./permissions";

export function requireUser(ctx: Ctx): asserts ctx is Ctx & { userId: string } {
  if (ctx.mode === "system") return;
  if (!ctx.userId) throw new AppError("UNAUTHENTICATED", "Authentication required", { key: "unauthenticated" });
}

export function requireOrg(ctx: Ctx, type?: OrgType | OrgType[]): asserts ctx is Ctx & { userId: string; orgId: string } {
  requireUser(ctx);
  if (!ctx.orgId) throw new AppError("FORBIDDEN", "An active organization is required", { key: "org_required" });
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    if (!ctx.orgType || !types.includes(ctx.orgType)) {
      throw new AppError("FORBIDDEN", `Operation requires a ${types.join("/")} organization`, { key: "wrong_org_type" });
    }
  }
}

export function can(ctx: Ctx, perm: Permission): boolean {
  if (ctx.mode === "system") return true;
  return ctx.permissions.has(perm);
}

/** Server-side permission check. Break-glass sessions are read-only. */
export function authorize(ctx: Ctx, perm: Permission, opts: { write?: boolean } = {}): void {
  if (ctx.mode === "system") return;
  requireUser(ctx);
  if (ctx.breakglass && opts.write) throw new AppError("FORBIDDEN", "Break-glass access is read-only", { key: "breakglass_readonly" });
  if (!ctx.permissions.has(perm)) {
    throw new AppError("FORBIDDEN", `Missing permission ${perm}`, { key: "forbidden", details: { permission: perm } });
  }
}

export function authorizeAdmin(ctx: Ctx, perm: Permission = "admin.access", opts: { requireMfa?: boolean } = { requireMfa: true }): void {
  if (ctx.mode === "system") return;
  requireUser(ctx);
  if (!ctx.isPlatformAdmin || !ctx.permissions.has(perm)) throw new AppError("FORBIDDEN", "Platform admin only", { key: "forbidden" });
  if (opts.requireMfa !== false && !ctx.mfaEnabled && process.env.APP_ENV !== "test" && process.env.ADMIN_MFA_OPTIONAL !== "true") {
    throw new AppError("FORBIDDEN", "Two-factor authentication is required for platform administration", { key: "mfa_required" });
  }
}
