import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, notFound } from "@platform/core";
import { withSystem } from "@platform/db";
import { featureFlags, systemSettings } from "@platform/db/schema";
import { audit } from "../audit";
import { authorizeAdmin } from "../authz";
import type { Ctx } from "../context";

/** Known feature flags with safe defaults. Unknown keys are treated as disabled. */
export const FLAG_DEFAULTS = {
  "store.enabled": { enabled: true, description: "B2C storefront" },
  "store.checkout": { enabled: true, description: "Store checkout & payments" },
  "boq.ai_extraction": { enabled: true, description: "AI-assisted BOQ extraction (requires AI provider + org opt-in)" },
  "boq.ocr": { enabled: true, description: "Local OCR fallback for scanned BOQs" },
  "rfq.supplier_suggestions": { enabled: true, description: "Supplier suggestions for RFQs" },
  "price_index.public": { enabled: false, description: "Show aggregated price index to all signed-in buyers" },
  "settlements.payouts": { enabled: false, description: "Execute supplier payouts — MUST stay off until business/regulatory model is approved" },
  "commission.enabled": { enabled: false, description: "Charge platform commission on store orders" },
  "subscriptions.enabled": { enabled: false, description: "Enterprise subscriptions" },
} as const satisfies Record<string, { enabled: boolean; description: string }>;

export type FlagKey = keyof typeof FLAG_DEFAULTS;

/** Flags that can never be enabled in production by configuration alone. */
const PROD_LOCKED: FlagKey[] = ["settlements.payouts"];

export async function isEnabled(key: FlagKey, opts: { orgId?: string | null } = {}): Promise<boolean> {
  if (PROD_LOCKED.includes(key) && process.env.APP_ENV === "production" && process.env.SETTLEMENTS_APPROVED !== "yes") return false;
  const [row] = await withSystem((tx) => tx.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1));
  if (!row) return FLAG_DEFAULTS[key]?.enabled ?? false;
  if (!row.enabled) return false;
  const rules = row.rules ?? {};
  if (rules.envs?.length && !rules.envs.includes(process.env.APP_ENV ?? "development")) return false;
  if (rules.orgIds?.length && (!opts.orgId || !rules.orgIds.includes(opts.orgId))) return false;
  return true;
}

export async function listFlags(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.flags");
  const rows = await withSystem((tx) => tx.select().from(featureFlags));
  return (Object.keys(FLAG_DEFAULTS) as FlagKey[]).map((key) => {
    const r = rows.find((x) => x.key === key);
    return { key, description: FLAG_DEFAULTS[key].description, enabled: r ? r.enabled : FLAG_DEFAULTS[key].enabled, rules: r?.rules ?? {}, locked: PROD_LOCKED.includes(key), updatedAt: r?.updatedAt ?? null };
  });
}

export async function setFlag(ctx: Ctx, key: FlagKey, enabled: boolean, rules: { orgIds?: string[]; envs?: string[] } = {}) {
  authorizeAdmin(ctx, "admin.flags");
  if (!(key in FLAG_DEFAULTS)) throw notFound("Flag");
  await withSystem(async (tx) => {
    await tx
      .insert(featureFlags)
      .values({ key, enabled, rules, description: FLAG_DEFAULTS[key].description, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, rules, updatedBy: ctx.userId, updatedAt: new Date() } });
    await audit(ctx, { action: "flag.updated", entityType: "feature_flag", entityId: key, orgId: null, data: { enabled, rules } }, tx);
  });
}

// --------------------------------------------------------------------------------------------
// Settings (non-secret values in `value`, one secret per key encrypted in `secret_enc`)
// --------------------------------------------------------------------------------------------

const encKey = () => {
  const k = process.env.APP_ENCRYPTION_KEY;
  if (!k || k.length < 32) throw new Error("APP_ENCRYPTION_KEY missing");
  return k;
};

export async function getSetting<T extends Record<string, unknown>>(key: string): Promise<{ value: T | null; secret: string | null }> {
  const [row] = await withSystem((tx) => tx.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1));
  if (!row) return { value: null, secret: null };
  return { value: row.value as T, secret: row.secretEnc ? decryptSecret(row.secretEnc, encKey()) : null };
}

/** Admin view: never returns secrets, only whether one is set. */
export async function getSettingForAdmin(ctx: Ctx, key: string) {
  authorizeAdmin(ctx, "admin.settings");
  const [row] = await withSystem((tx) => tx.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1));
  return { value: (row?.value ?? {}) as Record<string, unknown>, hasSecret: Boolean(row?.secretEnc), updatedAt: row?.updatedAt ?? null };
}

export async function putSetting(ctx: Ctx, key: string, value: Record<string, unknown>, secret?: string | null) {
  authorizeAdmin(ctx, "admin.settings");
  await withSystem(async (tx) => {
    const [existing] = await tx.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
    const secretEnc = secret === undefined ? (existing?.secretEnc ?? null) : secret === null || secret === "" ? null : encryptSecret(secret, encKey());
    await tx
      .insert(systemSettings)
      .values({ key, value, secretEnc, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value, secretEnc, updatedBy: ctx.userId, updatedAt: new Date() } });
    await audit(ctx, { action: "setting.updated", entityType: "system_setting", entityId: key, orgId: null, data: { keys: Object.keys(value), secretChanged: secret !== undefined } }, tx);
  });
}
