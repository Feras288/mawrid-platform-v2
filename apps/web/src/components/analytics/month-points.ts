import type { Point } from "@/components/charts/charts";

/** Server-side: turn YYYY-MM series into localized chart points with formatted SAR values. */
export function monthPoints(series: { month: string; value: string }[], locale: string): Point[] {
  const monthFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en", { month: "short", year: "2-digit", timeZone: "UTC" });
  const moneyFmt = new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en", { style: "currency", currency: "SAR" });
  return series.map((s) => ({ label: monthFmt.format(new Date(`${s.month}-01T00:00:00Z`)), value: Number(s.value), display: moneyFmt.format(Number(s.value)) }));
}
