import { cache } from "react";
import { listCategories } from "@platform/modules/catalog";

/**
 * Public category tree helpers for the storefront chrome (navigation, category art). Deduplicated per request.
 */
export const categoryIndex = cache(async () => {
  const rows = await listCategories();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = new Map<string, string>();
  for (const r of rows) {
    let cur = r;
    for (let i = 0; i < 6 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!;
    rootOf.set(r.id, cur.slug);
  }
  return {
    roots: rows.filter((r) => r.depth === 0),
    children: rows.filter((r) => r.depth === 1),
    bySlug: new Map(rows.map((r) => [r.slug, r])),
    byId,
    /** root system slug for any category id (drives the fallback illustration) */
    rootSlug: (categoryId: string | null | undefined) => (categoryId ? (rootOf.get(categoryId) ?? null) : null),
  };
});
