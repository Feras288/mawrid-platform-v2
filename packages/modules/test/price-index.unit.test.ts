import { describe, expect, it } from "vitest";
import { dec } from "@platform/core";
import { computeStats, privacyCheck, quality, quantile } from "../src/price-index/stats";

const cfg = { minObs: 5, minOrgs: 3, maxSharePct: 60 };
const obs = (prices: string[], suppliers: string[], buyers: (string | null)[] = []) => prices.map((p, i) => ({ price: p, supplierOrgId: suppliers[i % suppliers.length]!, buyerOrgId: buyers[i % (buyers.length || 1)] ?? null }));

describe("price index statistics", () => {
  it("interpolates quantiles", () => {
    const s = ["1", "2", "3", "4"].map(dec);
    expect(quantile(s, 0.5).toString()).toBe("2.5");
    expect(quantile(s, 0.25).toString()).toBe("1.75");
    expect(quantile([dec(7)], 0.9).toString()).toBe("7");
  });

  it("drops Tukey outliers only with enough data", () => {
    const st = computeStats(obs(["10", "11", "12", "10.5", "11.5", "95"], ["a", "b", "c"]))!;
    expect(st.outliers).toBe(1);
    expect(st.median.toString()).toBe("11");
    expect(st.max.toString()).toBe("12");
    const small = computeStats(obs(["10", "95"], ["a", "b"]))!;
    expect(small.outliers).toBe(0);
  });

  it("enforces minimum observations, organizations and dominance", () => {
    expect(privacyCheck("catalog_retail", obs(["1", "2", "3", "4"], ["a", "b", "c", "d"]), cfg).reason).toBe("min_observations");
    expect(privacyCheck("catalog_retail", obs(["1", "2", "3", "4", "5"], ["a", "b"]), cfg).reason).toBe("min_organizations");
    expect(privacyCheck("catalog_retail", obs(["1", "2", "3", "4", "5", "6", "7"], ["a", "a", "a", "a", "a", "b", "c"]), cfg).reason).toBe("dominance");
    expect(privacyCheck("catalog_retail", obs(["1", "2", "3", "4", "5"], ["a", "b", "c"]), cfg)).toEqual({ published: true, orgCount: 3, reason: null });
  });

  it("counts buyers too for quotes, awards and POs", () => {
    const r = privacyCheck("po", obs(["1", "2", "3", "4", "5", "6"], ["a", "b", "c"], ["x", "y"]), cfg);
    expect(r).toMatchObject({ published: false, orgCount: 2, reason: "min_organizations" });
    expect(privacyCheck("po", obs(["1", "2", "3", "4", "5", "6"], ["a", "b", "c"], ["x", "y", "z"]), cfg).published).toBe(true);
  });

  it("grades quality by sample size and dispersion", () => {
    expect(quality(25, dec("0.1"))).toBe("high");
    expect(quality(12, dec("0.9"))).toBe("medium");
    expect(quality(5, dec("0.9"))).toBe("low");
  });
});
