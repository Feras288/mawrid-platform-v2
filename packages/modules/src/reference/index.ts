import { asc, eq } from "drizzle-orm";
import { withPublic, withSystem, type Tx } from "@platform/db";
import { attributeDefinitions, categories, categoryAttributes, cities, regions, units } from "@platform/db/schema";
import { ATTRIBUTES, CATEGORY_TREE, CITIES, REGIONS, UNITS, type CatSeed } from "./data";

export { SYSTEMS } from "@platform/db/schema";

/** Idempotently upsert platform reference data (regions, cities, units, attributes, category tree). */
export async function syncReferenceData(): Promise<void> {
  await withSystem(async (tx) => {
    for (const [i, [code, ar, en]] of REGIONS.entries()) {
      await tx.insert(regions).values({ code, nameAr: ar, nameEn: en, sortOrder: i }).onConflictDoUpdate({ target: regions.code, set: { nameAr: ar, nameEn: en, sortOrder: i } });
    }
    for (const [code, region, ar, en] of CITIES) {
      await tx.insert(cities).values({ code, regionCode: region, nameAr: ar, nameEn: en }).onConflictDoUpdate({ target: cities.code, set: { regionCode: region, nameAr: ar, nameEn: en } });
    }
    for (const u of UNITS) {
      await tx
        .insert(units)
        .values({ code: u.code, nameAr: u.ar, nameEn: u.en, dimension: u.dimension, toBase: u.toBase, aliases: u.aliases })
        .onConflictDoUpdate({ target: units.code, set: { nameAr: u.ar, nameEn: u.en, dimension: u.dimension, toBase: u.toBase, aliases: u.aliases } });
    }
    const attrIds = new Map<string, string>();
    for (const a of ATTRIBUTES) {
      const options = (a.options ?? []).map(([value, nameAr, nameEn]) => ({ value, nameAr, nameEn }));
      const [row] = await tx
        .insert(attributeDefinitions)
        .values({ key: a.key, nameAr: a.ar, nameEn: a.en, dataType: a.type, unit: a.unit ?? null, options, isCritical: a.critical ?? false })
        .onConflictDoUpdate({ target: attributeDefinitions.key, set: { nameAr: a.ar, nameEn: a.en, dataType: a.type, unit: a.unit ?? null, options, isCritical: a.critical ?? false } })
        .returning({ id: attributeDefinitions.id });
      attrIds.set(a.key, row!.id);
    }
    for (const [i, root] of CATEGORY_TREE.entries()) await upsertCategory(tx, root, root.system, null, root.slug, 0, i, attrIds);
  });
}

async function upsertCategory(tx: Tx, c: CatSeed, system: string, parentId: string | null, path: string, depth: number, sort: number, attrIds: Map<string, string>): Promise<void> {
  const [existing] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.slug)).limit(1);
  let id = existing?.id;
  if (id) {
    await tx.update(categories).set({ nameAr: c.ar, nameEn: c.en, parentId, system, path, depth, sortOrder: sort }).where(eq(categories.id, id));
  } else {
    const [row] = await tx.insert(categories).values({ slug: c.slug, nameAr: c.ar, nameEn: c.en, parentId, system, path, depth, sortOrder: sort }).returning({ id: categories.id });
    id = row!.id;
  }
  for (const [j, key] of (c.attrs ?? []).entries()) {
    const attributeId = attrIds.get(key);
    if (!attributeId) throw new Error(`Unknown attribute ${key} in category ${c.slug}`);
    await tx.insert(categoryAttributes).values({ categoryId: id, attributeId, sortOrder: j }).onConflictDoNothing();
  }
  for (const [k, child] of (c.children ?? []).entries()) await upsertCategory(tx, child, system, id, `${path}/${child.slug}`, depth + 1, k, attrIds);
}

export async function listRegions() {
  return withPublic((tx) => tx.select().from(regions).orderBy(asc(regions.sortOrder)));
}

export async function listCities() {
  return withPublic((tx) => tx.select().from(cities).where(eq(cities.isActive, true)).orderBy(asc(cities.nameEn)));
}

export async function listUnits() {
  return withPublic((tx) => tx.select().from(units).orderBy(asc(units.dimension), asc(units.code)));
}

/** Resolve a free-text unit (ar/en, any alias) to a unit code. */
export function resolveUnitCode(raw: string | null | undefined, unitRows: { code: string; aliases: string[] }[]): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  for (const u of unitRows) {
    if (u.code === k) return u.code;
    if (u.aliases.some((a) => a.toLowerCase() === k)) return u.code;
  }
  const compact = k.replace(/[\s.]/g, "");
  for (const u of unitRows) if (u.aliases.some((a) => a.toLowerCase().replace(/[\s.]/g, "") === compact)) return u.code;
  return null;
}
