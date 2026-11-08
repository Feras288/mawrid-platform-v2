import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@platform/db";
import { authUsers, consents } from "@platform/db/schema";
import { audit } from "../audit";
import { requireUser } from "../authz";
import type { Ctx } from "../context";

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ]{7,20}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  locale: z.enum(["ar", "en"]).optional(),
});

export async function getMe(ctx: Ctx) {
  requireUser(ctx);
  const [u] = await withSystem((tx) =>
    tx
      .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email, emailVerified: authUsers.emailVerified, phone: authUsers.phone, locale: authUsers.locale, twoFactorEnabled: authUsers.twoFactorEnabled, isPlatformAdmin: authUsers.isPlatformAdmin, createdAt: authUsers.createdAt })
      .from(authUsers)
      .where(eq(authUsers.id, ctx.userId!))
      .limit(1),
  );
  return u ?? null;
}

export async function updateProfile(ctx: Ctx, input: z.input<typeof profileSchema>) {
  requireUser(ctx);
  const data = profileSchema.parse(input);
  await withSystem(async (tx) => {
    await tx.update(authUsers).set(data).where(eq(authUsers.id, ctx.userId!));
    await audit(ctx, { action: "user.profile_updated", entityType: "user", entityId: ctx.userId, orgId: null, data: { fields: Object.keys(data) } }, tx);
  });
}

export const POLICY_VERSIONS = { privacy_policy: "2026-11-draft", terms: "2026-11-draft" } as const;

export async function recordConsent(userId: string, kind: "privacy_policy" | "terms" | "marketing" | "external_ai_processing", granted: boolean, version: string, ip?: string | null) {
  await withSystem((tx) => tx.insert(consents).values({ userId, kind, granted, version, ip: ip ?? null }));
}
