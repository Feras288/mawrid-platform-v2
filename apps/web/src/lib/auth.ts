import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { brandName, uuidv7 } from "@platform/core";
import { eq } from "drizzle-orm";
import { getDb, withSystem } from "@platform/db";
import { authAccounts, authRateLimits, authSessions, authTwoFactors, authUsers, authVerifications } from "@platform/db/schema";
import { queueEmail } from "@platform/modules/notifications";
import { audit } from "@platform/modules/audit";
import { systemCtx } from "@platform/modules/context";
import { POLICY_VERSIONS, recordConsent } from "@platform/modules/identity";

const appUrl = process.env.APP_URL ?? "http://localhost:3100";
// Scales auth rate limits (1 in production). Dev/E2E environments may raise it; never below 1.
const rl = Math.max(1, Number(process.env.AUTH_RATE_LIMIT_MULTIPLIER ?? 1) || 1);
const brand = brandName("en");

function localeOf(user: { locale?: unknown }): "ar" | "en" {
  return user.locale === "en" ? "en" : "ar";
}

/** Rewrite Better Auth's callback URL so the link lands on our localized page. */
function localizeUrl(url: string, locale: "ar" | "en"): string {
  const u = new URL(url);
  const cb = u.searchParams.get("callbackURL");
  if (cb && cb.startsWith("/") && !cb.startsWith(`/${locale}/`)) u.searchParams.set("callbackURL", `/${locale}${cb}`);
  return u.toString();
}

export const auth = betterAuth({
  appName: brand,
  baseURL: appUrl,
  secret: process.env.AUTH_SECRET,
  trustedOrigins: [appUrl],
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: authUsers,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
      twoFactor: authTwoFactors,
      rateLimit: authRateLimits,
    },
  }),
  advanced: {
    cookiePrefix: "pl",
    database: { generateId: () => uuidv7() },
    useSecureCookies: process.env.APP_ENV === "production" || process.env.APP_ENV === "staging",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 15,
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "ar", input: true },
      phone: { type: "string", required: false, input: true },
      isPlatformAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const locale = localeOf(user as { locale?: unknown });
      await queueEmail({
        to: user.email,
        template: "auth.reset_password",
        locale,
        params: { name: user.name, actionUrl: localizeUrl(url, locale) },
        userId: user.id,
        dedupeKey: `reset:${user.id}:${Date.now()}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      const locale = localeOf(user as { locale?: unknown });
      await queueEmail({
        to: user.email,
        template: "auth.verify_email",
        locale,
        params: { name: user.name, actionUrl: localizeUrl(url, locale) },
        userId: user.id,
        dedupeKey: `verify:${user.id}:${Date.now()}`,
      });
    },
  },
  rateLimit: {
    enabled: process.env.APP_ENV !== "test",
    storage: "database",
    window: 60,
    max: 100 * rl,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 * rl },
      "/sign-up/email": { window: 60, max: 3 * rl },
      "/request-password-reset": { window: 300, max: 3 * rl },
      "/two-factor/verify-totp": { window: 60, max: 5 * rl },
      "/two-factor/verify-backup-code": { window: 60, max: 5 * rl },
    },
  },
  hooks: {
    // Sign-up requires explicit acceptance of the terms & privacy policy (recorded below).
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const body = (ctx.body ?? {}) as { acceptTerms?: unknown };
        if (body.acceptTerms !== true) throw new APIError("BAD_REQUEST", { message: "Terms and privacy policy must be accepted", code: "TERMS_REQUIRED" });
      }
    }),
  },
  plugins: [twoFactor({ issuer: brand, skipVerificationOnEnable: false }), nextCookies()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordConsent(user.id, "terms", true, POLICY_VERSIONS.terms);
          await recordConsent(user.id, "privacy_policy", true, POLICY_VERSIONS.privacy_policy);
        },
      },
    },
    session: {
      create: {
        // suspended or deleted accounts cannot sign in (existing sessions are revoked on suspension)
        before: async (session) => {
          const [u] = await withSystem((tx) => tx.select({ status: authUsers.status }).from(authUsers).where(eq(authUsers.id, session.userId)).limit(1));
          if (!u || u.status !== "active") throw new APIError("FORBIDDEN", { message: "Account is not active", code: "ACCOUNT_INACTIVE" });
        },
        after: async (session) => {
          await audit({ ...systemCtx(), userId: session.userId, ip: session.ipAddress ?? null, userAgent: session.userAgent ?? null }, { action: "auth.session_created", entityType: "user", entityId: session.userId, orgId: null });
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
