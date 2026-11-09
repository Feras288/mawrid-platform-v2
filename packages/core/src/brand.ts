/**
 * The brand is temporary configuration (BRAND_NAME_AR / BRAND_NAME_EN). This is the only place that
 * holds a fallback; code, tables and API paths never contain the brand (enforced by brand.unit test).
 */
export const BRAND_DEFAULTS = { ar: "مَوْرِد", en: "Mawrid" } as const;

export function brandName(locale: "ar" | "en"): string {
  return (locale === "ar" ? process.env.BRAND_NAME_AR : process.env.BRAND_NAME_EN) || BRAND_DEFAULTS[locale];
}
