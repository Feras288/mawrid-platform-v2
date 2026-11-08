import { and, eq, gte, sql } from "drizzle-orm";
import { AppError } from "@platform/core";
import { withSystem } from "@platform/db";
import { aiUsage, organizations } from "@platform/db/schema";
import { getAiProvider, type AiConfig, type AiProvider, type AiUsage } from "@platform/integrations/ai";
import { getSetting, isEnabled } from "../config";

/**
 * Data policy gate: documents go to an external AI provider only when (1) a provider is configured,
 * (2) the feature flag is on, and (3) the organization explicitly opted in.
 */
let aiCache: { at: number; cfg: AiConfig | null } | null = null;

/** Provider from admin settings (key encrypted at rest) when set, else environment. Cached 60s. */
export async function resolveAiProvider(): Promise<AiProvider> {
  if (!aiCache || Date.now() - aiCache.at > 60_000) {
    const s = await getSetting<{ provider?: string; modelExtraction?: string; modelFast?: string }>("ai").catch(() => ({ value: null, secret: null }));
    const v = s.value;
    aiCache = { at: Date.now(), cfg: v?.provider === "anthropic" || v?.provider === "none" ? { provider: v.provider, apiKey: s.secret ?? undefined, extractionModel: v.modelExtraction, fastModel: v.modelFast } : null };
  }
  return getAiProvider(aiCache.cfg);
}

export function invalidateAiSettings() {
  aiCache = null;
}

export async function aiPolicyFor(orgId: string): Promise<{ allowed: boolean; reason: string | null; provider: AiProvider }> {
  const provider = await resolveAiProvider();
  if (!provider.isConfigured()) return { allowed: false, reason: "provider_not_configured", provider };
  if (!(await isEnabled("boq.ai_extraction", { orgId }))) return { allowed: false, reason: "feature_disabled", provider };
  const [org] = await withSystem((tx) => tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId)).limit(1));
  if (!org?.settings.allowExternalAI) return { allowed: false, reason: "org_not_opted_in", provider };
  return { allowed: true, reason: null, provider };
}

export async function monthlySpendUsd(orgId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [r] = await withSystem((tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
      .from(aiUsage)
      .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, start))),
  );
  return Number(r?.total ?? 0);
}

/** Throws when the org's monthly AI budget is exhausted. Default budget: 50 USD. */
export async function assertBudget(orgId: string): Promise<void> {
  const [org] = await withSystem((tx) => tx.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId)).limit(1));
  const budget = Number(org?.settings.aiMonthlyBudgetUsd ?? 50);
  if ((await monthlySpendUsd(orgId)) >= budget) throw new AppError("INVALID_STATE", "Monthly AI budget exhausted", { key: "ai_budget_exhausted" });
}

export async function recordAiUsage(entry: { orgId: string | null; purpose: string; documentId?: string | null; usage?: AiUsage | null; provider?: string; model?: string; error?: string | null }) {
  await withSystem((tx) =>
    tx.insert(aiUsage).values({
      orgId: entry.orgId,
      provider: entry.usage?.provider ?? entry.provider ?? "unknown",
      model: entry.usage?.model ?? entry.model ?? "unknown",
      purpose: entry.purpose,
      documentId: entry.documentId ?? null,
      inputTokens: entry.usage?.inputTokens ?? 0,
      outputTokens: entry.usage?.outputTokens ?? 0,
      costUsd: (entry.usage?.costUsd ?? 0).toFixed(6),
      status: entry.error ? "error" : "ok",
      error: entry.error ?? null,
    }),
  );
}
