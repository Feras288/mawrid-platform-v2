import { dec, D, type Dec } from "@platform/core";

/**
 * Pure statistics for the price index (decimal arithmetic, no floats in results).
 * Method v1:
 *  - quantiles: linear interpolation between closest ranks (type 7)
 *  - outliers: Tukey fences Q1 − 1.5·IQR / Q3 + 1.5·IQR, applied only when n ≥ 5
 *  - publication: n ≥ minObs AND contributing orgs ≥ minOrgs AND no single org above maxSharePct
 *  - quality: high (n ≥ 20 and CV ≤ 0.25), medium (n ≥ 10 or CV ≤ 0.5), else low
 */
export const METHOD_VERSION = "pi-v1";

export function quantile(sorted: Dec[], q: number): Dec {
  if (!sorted.length) throw new Error("empty");
  if (sorted.length === 1) return sorted[0]!;
  const pos = new D(sorted.length - 1).times(q);
  const lo = pos.floor().toNumber();
  const hi = pos.ceil().toNumber();
  const frac = pos.minus(lo);
  return sorted[lo]!.plus(sorted[hi]!.minus(sorted[lo]!).times(frac));
}

export interface Obs {
  price: string;
  supplierOrgId: string | null;
  buyerOrgId: string | null;
}

export interface Stats {
  n: number;
  outliers: number;
  median: Dec;
  p25: Dec;
  p75: Dec;
  min: Dec;
  max: Dec;
  mean: Dec;
  cv: Dec;
  kept: Obs[];
  outlierFlags: boolean[];
}

export function computeStats(obs: Obs[]): Stats | null {
  if (!obs.length) return null;
  const vals = obs.map((o) => dec(o.price));
  const sorted = [...vals].sort((a, b) => a.cmp(b));
  let flags = obs.map(() => false);
  if (obs.length >= 5) {
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3.minus(q1);
    const lo = q1.minus(iqr.times(1.5));
    const hi = q3.plus(iqr.times(1.5));
    flags = vals.map((v) => v.lt(lo) || v.gt(hi));
  }
  const kept = obs.filter((_, i) => !flags[i]);
  const ks = kept.map((o) => dec(o.price)).sort((a, b) => a.cmp(b));
  const mean = ks.reduce((a, b) => a.plus(b), new D(0)).div(ks.length);
  const variance = ks.reduce((a, b) => a.plus(b.minus(mean).pow(2)), new D(0)).div(ks.length);
  const cv = mean.isZero() ? new D(0) : variance.sqrt().div(mean);
  return { n: ks.length, outliers: obs.length - kept.length, median: quantile(ks, 0.5), p25: quantile(ks, 0.25), p75: quantile(ks, 0.75), min: ks[0]!, max: ks.at(-1)!, mean, cv, kept, outlierFlags: flags };
}

export interface PrivacyConfig {
  minObs: number;
  minOrgs: number;
  maxSharePct: number;
}

const BUYER_SIDE = new Set(["rfq_quote", "rfq_award", "po"]);

/**
 * Contributing organizations: distinct suppliers; for buyer-side prices (quotes, awards, POs) also
 * distinct buyers, taking the smaller count so neither side can be singled out.
 */
export function privacyCheck(kind: string, kept: Obs[], cfg: PrivacyConfig): { published: boolean; orgCount: number; reason: string | null } {
  const suppliers = new Map<string, number>();
  for (const o of kept) if (o.supplierOrgId) suppliers.set(o.supplierOrgId, (suppliers.get(o.supplierOrgId) ?? 0) + 1);
  let orgCount = suppliers.size;
  if (BUYER_SIDE.has(kind)) {
    const buyers = new Set(kept.map((o) => o.buyerOrgId).filter(Boolean));
    orgCount = Math.min(orgCount, buyers.size);
  }
  if (kept.length < cfg.minObs) return { published: false, orgCount, reason: "min_observations" };
  if (orgCount < cfg.minOrgs) return { published: false, orgCount, reason: "min_organizations" };
  const top = Math.max(...suppliers.values());
  if ((top / kept.length) * 100 > cfg.maxSharePct) return { published: false, orgCount, reason: "dominance" };
  return { published: true, orgCount, reason: null };
}

export function quality(n: number, cv: Dec): "high" | "medium" | "low" {
  if (n >= 20 && cv.lte(0.25)) return "high";
  if (n >= 10 || cv.lte(0.5)) return "medium";
  return "low";
}
