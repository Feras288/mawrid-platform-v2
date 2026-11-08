/**
 * Product matching: BOQ line → canonical catalog products. Multi-signal scoring with hard filters.
 * A critical-attribute conflict or a unit-dimension conflict eliminates a candidate; a missing critical
 * attribute caps confidence below the auto-suggest threshold (never invent values). Nothing is ever
 * auto-approved — results are suggestions for human review.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { normalizeText, tokenJaccard, tokens } from "@platform/core/text";
import type { Tx } from "@platform/db";
import { attributeDefinitions, canonicalProducts, units, type AttrValues } from "@platform/db/schema";

export const THRESHOLDS = {
  autoSuggest: Number(process.env.MATCH_AUTO_SUGGEST ?? 0.85),
  review: Number(process.env.MATCH_REVIEW_MIN ?? 0.4),
  margin: 0.05,
  missingCriticalCap: 0.7,
};

export interface MatchInput {
  text: string;
  attributes: AttrValues;
  unit: string | null;
  categoryId: string | null;
}

export interface CandidateRow {
  id: string;
  normalizedName: string;
  attributes: AttrValues;
  baseUnit: string;
  categoryId: string;
  sim: number;
}

export interface ScoredCandidate {
  id: string;
  score: number;
  signals: { lexical: number; attributes: number; unit: number; ai?: number };
  reasons: string[];
  rejected: boolean;
}

const eqAttr = (a: unknown, b: unknown) => {
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a).toLowerCase() === String(b).toLowerCase();
};

/** Pure scoring of one candidate. */
export function scoreCandidate(item: MatchInput, c: CandidateRow, critical: Set<string>, unitDims: Map<string, string>): ScoredCandidate {
  const reasons: string[] = [];
  const lexical = Math.max(c.sim, tokenJaccard(tokens(item.text), tokens(c.normalizedName)));
  let matched = 0;
  let missing = 0;
  let conflict = false;
  for (const k of critical) {
    const iv = item.attributes[k];
    const cv = c.attributes[k];
    if (cv === undefined) continue;
    if (iv === undefined) {
      missing++;
      reasons.push(`missing:${k}`);
    } else if (eqAttr(iv, cv)) {
      matched++;
      reasons.push(`match:${k}`);
    } else {
      conflict = true;
      reasons.push(`conflict:${k}`);
    }
  }
  const attrScore = matched + missing === 0 ? 0.5 : matched / (matched + missing);
  let unitScore = 0.5;
  if (item.unit && c.baseUnit) {
    const a = unitDims.get(item.unit);
    const b = unitDims.get(c.baseUnit);
    if (a && b && a !== b && a !== "other" && b !== "other") {
      conflict = true;
      reasons.push("conflict:unit_dimension");
      unitScore = 0;
    } else unitScore = item.unit === c.baseUnit ? 1 : 0.8;
  }
  let score = 0.45 * lexical + 0.45 * attrScore + 0.1 * unitScore;
  if (missing > 0) score = Math.min(score, THRESHOLDS.missingCriticalCap);
  if (item.categoryId && item.categoryId !== c.categoryId) score *= 0.9;
  return { id: c.id, score: Number(score.toFixed(4)), signals: { lexical: Number(lexical.toFixed(4)), attributes: Number(attrScore.toFixed(4)), unit: unitScore }, reasons, rejected: conflict };
}

export type MatchStatus = "auto_suggested" | "needs_review" | "no_match";

export function decide(ranked: ScoredCandidate[]): { status: MatchStatus; best: ScoredCandidate | null } {
  const viable = ranked.filter((r) => !r.rejected && r.score >= THRESHOLDS.review);
  const best = viable[0] ?? null;
  if (!best) return { status: "no_match", best: null };
  const second = viable[1];
  const clear = !second || best.score - second.score >= THRESHOLDS.margin;
  const noMissing = !best.reasons.some((r) => r.startsWith("missing:"));
  return { status: best.score >= THRESHOLDS.autoSuggest && clear && noMissing ? "auto_suggested" : "needs_review", best };
}

export interface MatchContext {
  critical: Set<string>;
  unitDims: Map<string, string>;
}

export async function loadMatchContext(tx: Tx): Promise<MatchContext> {
  const crit = await tx.select({ key: attributeDefinitions.key }).from(attributeDefinitions).where(eq(attributeDefinitions.isCritical, true));
  const us = await tx.select({ code: units.code, dimension: units.dimension }).from(units);
  return { critical: new Set(crit.map((c) => c.key)), unitDims: new Map(us.map((u) => [u.code, u.dimension])) };
}

/** Retrieve candidates (trigram on name within category, plus attribute containment) and score them. */
export async function findMatches(tx: Tx, item: MatchInput, ctx: MatchContext, limit = 5): Promise<ScoredCandidate[]> {
  const q = normalizeText(item.text).slice(0, 300);
  if (!q) return [];
  const base = and(ne(canonicalProducts.status, "archived"), item.categoryId ? eq(canonicalProducts.categoryId, item.categoryId) : undefined);
  const byName = await tx
    .select({ id: canonicalProducts.id, normalizedName: canonicalProducts.normalizedName, attributes: canonicalProducts.attributes, baseUnit: canonicalProducts.baseUnit, categoryId: canonicalProducts.categoryId, sim: sql<number>`similarity(${canonicalProducts.normalizedName}, ${q})` })
    .from(canonicalProducts)
    .where(and(base, sql`similarity(${canonicalProducts.normalizedName}, ${q}) > 0.12`))
    .orderBy(sql`similarity(${canonicalProducts.normalizedName}, ${q}) desc`)
    .limit(20);
  const critAttrs = Object.fromEntries(Object.entries(item.attributes).filter(([k]) => ctx.critical.has(k)));
  const byAttr =
    Object.keys(critAttrs).length && item.categoryId
      ? await tx
          .select({ id: canonicalProducts.id, normalizedName: canonicalProducts.normalizedName, attributes: canonicalProducts.attributes, baseUnit: canonicalProducts.baseUnit, categoryId: canonicalProducts.categoryId, sim: sql<number>`similarity(${canonicalProducts.normalizedName}, ${q})` })
          .from(canonicalProducts)
          .where(and(base, sql`${canonicalProducts.attributes} @> ${JSON.stringify(critAttrs)}::jsonb`))
          .limit(20)
      : [];
  const all = new Map<string, CandidateRow>();
  for (const r of [...byName, ...byAttr]) all.set(r.id, { ...r, sim: Number(r.sim) });
  return [...all.values()]
    .map((c) => scoreCandidate(item, c, ctx.critical, ctx.unitDims))
    .sort((a, b) => Number(a.rejected) - Number(b.rejected) || b.score - a.score)
    .slice(0, limit);
}

export async function canonicalNames(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx.select({ id: canonicalProducts.id, nameAr: canonicalProducts.nameAr, nameEn: canonicalProducts.nameEn, attributes: canonicalProducts.attributes, baseUnit: canonicalProducts.baseUnit }).from(canonicalProducts).where(inArray(canonicalProducts.id, ids));
}
