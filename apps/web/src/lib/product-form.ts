import type { ProductInput } from "@platform/modules/supplier-products";

/** Product form fields (supplier portal and admin "on behalf" form share the same form). */
export function productFromForm(o: Record<string, unknown>): ProductInput {
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (k.startsWith("attr.") && v !== "") attributes[k.slice(5)] = v;
  return {
    sku: String(o.sku ?? ""),
    categoryId: String(o.categoryId ?? ""),
    canonicalProductId: (o.canonicalProductId as string) || null,
    nameAr: String(o.nameAr ?? ""),
    nameEn: String(o.nameEn ?? ""),
    descriptionAr: (o.descriptionAr as string) || null,
    descriptionEn: (o.descriptionEn as string) || null,
    brandName: (o.brandName as string) || null,
    model: (o.model as string) || null,
    countryOfOrigin: (o.countryOfOrigin as string) || null,
    certifications: String(o.certifications ?? "")
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean),
    attributes,
    saleUnit: String(o.saleUnit ?? ""),
    packSize: String(o.packSize || "1"),
    moq: String(o.moq || "1"),
    orderIncrement: String(o.orderIncrement || "1"),
    leadTimeDays: o.leadTimeDays ? Number(o.leadTimeDays) : null,
    vatRate: String(o.vatRate || "0.15"),
    status: (o.status as "draft" | "active" | "inactive") ?? "draft",
  };
}
