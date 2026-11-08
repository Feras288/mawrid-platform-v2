import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { conflict, invalidState, notFound, validation } from "@platform/core";
import { normalizeText, slugify } from "@platform/core/text";
import { likeEscape, pageParams, withPublic, withSystem, type Tx } from "@platform/db";
import {
  attributeDefinitions,
  brands,
  canonicalProducts,
  categories,
  categoryAttributes,
  duplicateCandidates,
  supplierProducts,
  units,
  type AttrValues,
} from "@platform/db/schema";
import { audit } from "../audit";
import { authorizeAdmin } from "../authz";
import type { Ctx } from "../context";

// ------------------------------------------------------------------------------------- categories

export type CategoryNode = typeof categories.$inferSelect & { children: CategoryNode[] };

export async function listCategories(opts: { includeInactive?: boolean } = {}) {
  return withPublic((tx) =>
    tx
      .select()
      .from(categories)
      .where(opts.includeInactive ? undefined : eq(categories.isActive, true))
      .orderBy(asc(categories.depth), asc(categories.sortOrder), asc(categories.nameEn)),
  );
}

export function buildTree(rows: (typeof categories.$inferSelect)[]): CategoryNode[] {
  const map = new Map<string, CategoryNode>();
  for (const r of rows) map.set(r.id, { ...r, children: [] });
  const roots: CategoryNode[] = [];
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export async function getCategoryBySlug(slug: string) {
  const [c] = await withPublic((tx) => tx.select().from(categories).where(eq(categories.slug, slug)).limit(1));
  return c ?? null;
}

/** All descendant category ids (inclusive) using the materialized path. */
export async function categorySubtreeIds(tx: Tx, categoryId: string): Promise<string[]> {
  const [c] = await tx.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!c) return [];
  const rows = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(or(eq(categories.id, categoryId), sql`${categories.path} like ${likeEscape(c.path) + "/%"}`));
  return rows.map((r) => r.id);
}

/** Attribute definitions applicable to a category (own + ancestors). */
export async function attributesForCategory(categoryId: string) {
  return withPublic(async (tx) => {
    const [c] = await tx.select({ path: categories.path }).from(categories).where(eq(categories.id, categoryId)).limit(1);
    if (!c) throw notFound("Category");
    const prefixes = c.path.split("/").map((_, i, arr) => arr.slice(0, i + 1).join("/"));
    const cats = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.path, prefixes));
    if (!cats.length) return [];
    return tx
      .selectDistinctOn([attributeDefinitions.id], {
        id: attributeDefinitions.id,
        key: attributeDefinitions.key,
        nameAr: attributeDefinitions.nameAr,
        nameEn: attributeDefinitions.nameEn,
        dataType: attributeDefinitions.dataType,
        unit: attributeDefinitions.unit,
        options: attributeDefinitions.options,
        isCritical: attributeDefinitions.isCritical,
        required: categoryAttributes.required,
        sortOrder: categoryAttributes.sortOrder,
      })
      .from(categoryAttributes)
      .innerJoin(attributeDefinitions, eq(attributeDefinitions.id, categoryAttributes.attributeId))
      .where(inArray(categoryAttributes.categoryId, cats.map((x) => x.id)))
      .orderBy(attributeDefinitions.id);
  });
}

export const categorySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  system: z.enum(["electrical", "plumbing", "hvac", "fire_fighting", "fire_alarm", "mechanical_equipment", "building_materials", "low_current", "infrastructure"]).optional(),
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(80).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

export async function createCategory(ctx: Ctx, input: z.input<typeof categorySchema>) {
  authorizeAdmin(ctx, "admin.catalog");
  const data = categorySchema.parse(input);
  return withSystem(async (tx) => {
    let system = data.system;
    let path = "";
    let depth = 0;
    if (data.parentId) {
      const [p] = await tx.select().from(categories).where(eq(categories.id, data.parentId)).limit(1);
      if (!p) throw notFound("Parent category");
      system = p.system as typeof system;
      path = p.path;
      depth = p.depth + 1;
    }
    if (!system) throw validation("Root categories need a system");
    const slug = slugify(data.slug || data.nameEn);
    const [dup] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
    if (dup) throw conflict("Category slug already exists");
    const [row] = await tx
      .insert(categories)
      .values({ parentId: data.parentId ?? null, system, slug, path: path ? `${path}/${slug}` : slug, depth, nameAr: data.nameAr, nameEn: data.nameEn, sortOrder: data.sortOrder ?? 0 })
      .returning();
    await audit(ctx, { action: "catalog.category_created", entityType: "category", entityId: row!.id, orgId: null }, tx);
    return row!;
  });
}

export async function updateCategory(ctx: Ctx, id: string, input: Partial<z.input<typeof categorySchema>>) {
  authorizeAdmin(ctx, "admin.catalog");
  const data = categorySchema.partial().parse(input);
  return withSystem(async (tx) => {
    const [row] = await tx
      .update(categories)
      .set({ nameAr: data.nameAr, nameEn: data.nameEn, sortOrder: data.sortOrder, isActive: data.isActive })
      .where(eq(categories.id, id))
      .returning();
    if (!row) throw notFound("Category");
    await audit(ctx, { action: "catalog.category_updated", entityType: "category", entityId: id, orgId: null, data }, tx);
    return row;
  });
}

export async function setCategoryAttributes(ctx: Ctx, categoryId: string, items: { attributeId: string; required: boolean }[]) {
  authorizeAdmin(ctx, "admin.catalog");
  return withSystem(async (tx) => {
    await tx.delete(categoryAttributes).where(eq(categoryAttributes.categoryId, categoryId));
    if (items.length) await tx.insert(categoryAttributes).values(items.map((it, i) => ({ categoryId, attributeId: it.attributeId, required: it.required, sortOrder: i })));
    await audit(ctx, { action: "catalog.category_attributes_set", entityType: "category", entityId: categoryId, orgId: null, data: { count: items.length } }, tx);
  });
}

export async function listAttributes() {
  return withPublic((tx) => tx.select().from(attributeDefinitions).orderBy(asc(attributeDefinitions.key)));
}

export const attributeSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/),
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  dataType: z.enum(["number", "text", "enum", "boolean"]),
  unit: z.string().trim().max(20).optional().nullable(),
  isCritical: z.boolean().default(false),
  options: z.array(z.object({ value: z.string().min(1).max(40), nameAr: z.string().min(1), nameEn: z.string().min(1) })).default([]),
});

export async function upsertAttribute(ctx: Ctx, input: z.input<typeof attributeSchema>) {
  authorizeAdmin(ctx, "admin.catalog");
  const d = attributeSchema.parse(input);
  if (d.dataType === "enum" && d.options.length === 0) throw validation("Enum attributes need options");
  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(attributeDefinitions)
      .values({ key: d.key, nameAr: d.nameAr, nameEn: d.nameEn, dataType: d.dataType, unit: d.unit ?? null, isCritical: d.isCritical, options: d.options })
      .onConflictDoUpdate({ target: attributeDefinitions.key, set: { nameAr: d.nameAr, nameEn: d.nameEn, unit: d.unit ?? null, isCritical: d.isCritical, options: d.options } })
      .returning();
    await audit(ctx, { action: "catalog.attribute_upserted", entityType: "attribute", entityId: row!.id, orgId: null, data: { key: d.key } }, tx);
    return row!;
  });
}

// ------------------------------------------------------------------------------------- brands

export async function listBrands(q?: string) {
  return withPublic((tx) =>
    tx
      .select()
      .from(brands)
      .where(q ? or(ilike(brands.name, `%${likeEscape(q)}%`), ilike(brands.nameAr, `%${likeEscape(q)}%`)) : undefined)
      .orderBy(asc(brands.name))
      .limit(200),
  );
}

/** Find or create a brand by name (used by product forms and imports). */
export async function ensureBrand(tx: Tx, name: string): Promise<string> {
  const clean = name.trim().slice(0, 80);
  const slug = slugify(clean) || `brand-${clean.length}`;
  const [existing] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.slug, slug)).limit(1);
  if (existing) return existing.id;
  const [row] = await withSystem((s) => s.insert(brands).values({ slug, name: clean }).onConflictDoUpdate({ target: brands.slug, set: { name: clean } }).returning({ id: brands.id }));
  return row!.id;
}

// ------------------------------------------------------------------------------------- attribute values

type AttrDef = { key: string; dataType: string; options: { value: string }[]; required?: boolean };

/** Validate & normalize attribute values against definitions. Unknown keys are rejected. */
export function normalizeAttributes(values: Record<string, unknown>, defs: AttrDef[], opts: { enforceRequired?: boolean } = {}): AttrValues {
  const out: AttrValues = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [k, raw] of Object.entries(values)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const d = byKey.get(k);
    if (!d) throw validation(`Unknown attribute ${k} for this category`, { attribute: k });
    if (d.dataType === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "."));
      if (!Number.isFinite(n)) throw validation(`Attribute ${k} must be a number`, { attribute: k });
      out[k] = n;
    } else if (d.dataType === "boolean") {
      out[k] = raw === true || raw === "true" || raw === "1" || raw === "yes";
    } else if (d.dataType === "enum") {
      const v = String(raw).trim().toLowerCase();
      if (!d.options.some((o) => o.value === v)) throw validation(`Invalid value for ${k}`, { attribute: k, value: v });
      out[k] = v;
    } else {
      out[k] = String(raw).trim().slice(0, 200);
    }
  }
  if (opts.enforceRequired) for (const d of defs) if (d.required && !(d.key in out)) throw validation(`Attribute ${d.key} is required`, { attribute: d.key });
  return out;
}

// ------------------------------------------------------------------------------------- canonical products

export const canonicalSchema = z.object({
  categoryId: z.string().uuid(),
  nameAr: z.string().trim().min(2).max(300),
  nameEn: z.string().trim().min(2).max(300),
  descriptionAr: z.string().trim().max(4000).optional().nullable(),
  descriptionEn: z.string().trim().max(4000).optional().nullable(),
  baseUnit: z.string().trim().min(1).max(10),
  attributes: z.record(z.string(), z.unknown()).default({}),
  standards: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  status: z.enum(["draft", "active", "archived"]).default("active"),
});

export async function getCanonical(id: string) {
  const [row] = await withPublic((tx) => tx.select().from(canonicalProducts).where(eq(canonicalProducts.id, id)).limit(1));
  return row ?? null;
}

export async function searchCanonical(opts: { q?: string; categoryId?: string; page?: number; pageSize?: number; status?: string }) {
  const { limit, offset, page, pageSize } = pageParams(opts.page, opts.pageSize);
  return withPublic(async (tx) => {
    const cats = opts.categoryId ? await categorySubtreeIds(tx, opts.categoryId) : null;
    const q = opts.q ? normalizeText(opts.q) : null;
    const where = and(
      eq(canonicalProducts.status, opts.status ?? "active"),
      cats ? inArray(canonicalProducts.categoryId, cats.length ? cats : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      q ? or(sql`${canonicalProducts.normalizedName} % ${q}`, sql`${canonicalProducts.normalizedName} like ${"%" + likeEscape(q) + "%"}`) : undefined,
    );
    const items = await tx
      .select()
      .from(canonicalProducts)
      .where(where)
      .orderBy(q ? sql`similarity(${canonicalProducts.normalizedName}, ${q}) desc` : asc(canonicalProducts.nameEn))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(canonicalProducts).where(where);
    return { items, total: c?.n ?? 0, page, pageSize };
  });
}

/**
 * Detect likely duplicates of a canonical product: same category subtree root, high name similarity,
 * and no conflicting critical attribute. Candidates are recorded for human review — never merged.
 */
export async function detectDuplicates(tx: Tx, productId: string): Promise<number> {
  const [p] = await tx.select().from(canonicalProducts).where(eq(canonicalProducts.id, productId)).limit(1);
  if (!p) return 0;
  const crit = await tx.select({ key: attributeDefinitions.key }).from(attributeDefinitions).where(eq(attributeDefinitions.isCritical, true));
  const critical = new Set(crit.map((c) => c.key));
  const similar = await tx
    .select({ id: canonicalProducts.id, attributes: canonicalProducts.attributes, sim: sql<number>`similarity(${canonicalProducts.normalizedName}, ${p.normalizedName})` })
    .from(canonicalProducts)
    .where(and(ne(canonicalProducts.id, p.id), eq(canonicalProducts.categoryId, p.categoryId), ne(canonicalProducts.status, "archived"), sql`${canonicalProducts.normalizedName} % ${p.normalizedName}`))
    .orderBy(desc(sql`similarity(${canonicalProducts.normalizedName}, ${p.normalizedName})`))
    .limit(10);
  let n = 0;
  for (const s of similar) {
    const reasons: string[] = [`name_similarity:${Number(s.sim).toFixed(2)}`];
    let conflicting = false;
    for (const k of critical) {
      const a = p.attributes[k];
      const b = s.attributes[k];
      if (a !== undefined && b !== undefined) {
        if (String(a) !== String(b)) conflicting = true;
        else reasons.push(`same:${k}`);
      }
    }
    if (conflicting || Number(s.sim) < 0.55) continue;
    const [aId, bId] = p.id < s.id ? [p.id, s.id] : [s.id, p.id];
    const res = await tx
      .insert(duplicateCandidates)
      .values({ aId, bId, score: Number(s.sim).toFixed(4), reasons })
      .onConflictDoNothing()
      .returning({ id: duplicateCandidates.id });
    n += res.length;
  }
  return n;
}

async function validateCanonical(tx: Tx, d: z.output<typeof canonicalSchema>) {
  const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, d.categoryId)).limit(1);
  if (!cat) throw validation("Unknown category");
  const [u] = await tx.select({ code: units.code }).from(units).where(eq(units.code, d.baseUnit)).limit(1);
  if (!u) throw validation("Unknown unit");
  const defs = await attributesForCategory(d.categoryId);
  return normalizeAttributes(d.attributes, defs);
}

export async function createCanonical(ctx: Ctx, input: z.input<typeof canonicalSchema>, opts: { source?: "manual" | "import" | "boq" } = {}) {
  authorizeAdmin(ctx, "admin.catalog");
  const d = canonicalSchema.parse(input);
  return withSystem(async (tx) => {
    const attributes = await validateCanonical(tx, d);
    const [row] = await tx
      .insert(canonicalProducts)
      .values({ ...d, attributes, normalizedName: normalizeText(`${d.nameEn} ${d.nameAr}`), source: opts.source ?? "manual", createdBy: ctx.userId })
      .returning();
    const dups = await detectDuplicates(tx, row!.id);
    await audit(ctx, { action: "catalog.canonical_created", entityType: "canonical_product", entityId: row!.id, orgId: null, data: { duplicatesFlagged: dups } }, tx);
    return { product: row!, duplicatesFlagged: dups };
  });
}

export async function updateCanonical(ctx: Ctx, id: string, input: z.input<typeof canonicalSchema>) {
  authorizeAdmin(ctx, "admin.catalog");
  const d = canonicalSchema.parse(input);
  return withSystem(async (tx) => {
    const attributes = await validateCanonical(tx, d);
    const [row] = await tx
      .update(canonicalProducts)
      .set({ ...d, attributes, normalizedName: normalizeText(`${d.nameEn} ${d.nameAr}`) })
      .where(eq(canonicalProducts.id, id))
      .returning();
    if (!row) throw notFound("Product");
    await detectDuplicates(tx, id);
    await audit(ctx, { action: "catalog.canonical_updated", entityType: "canonical_product", entityId: id, orgId: null }, tx);
    return row;
  });
}

export async function listDuplicateCandidates(ctx: Ctx, opts: { page?: number } = {}) {
  authorizeAdmin(ctx, "admin.catalog");
  const { limit, offset } = pageParams(opts.page, 50);
  return withSystem(async (tx) => {
    const rows = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.status, "open")).orderBy(desc(duplicateCandidates.score)).limit(limit).offset(offset);
    const ids = [...new Set(rows.flatMap((r) => [r.aId, r.bId]))];
    const prods = ids.length ? await tx.select().from(canonicalProducts).where(inArray(canonicalProducts.id, ids)) : [];
    return rows.map((r) => ({ ...r, a: prods.find((p) => p.id === r.aId) ?? null, b: prods.find((p) => p.id === r.bId) ?? null }));
  });
}

/**
 * Resolve a duplicate candidate. `merge` is an explicit admin decision: supplier products pointing at
 * the duplicate are re-pointed to the kept product and the duplicate is archived (history retained).
 */
export async function resolveDuplicate(ctx: Ctx, candidateId: string, decision: { action: "dismiss" } | { action: "merge"; keepId: string }) {
  authorizeAdmin(ctx, "admin.catalog");
  return withSystem(async (tx) => {
    const [c] = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).limit(1).for("update");
    if (!c) throw notFound("Candidate");
    if (c.status !== "open") throw invalidState("Candidate already resolved");
    if (decision.action === "dismiss") {
      await tx.update(duplicateCandidates).set({ status: "dismissed", resolvedBy: ctx.userId }).where(eq(duplicateCandidates.id, c.id));
    } else {
      if (decision.keepId !== c.aId && decision.keepId !== c.bId) throw validation("keepId must be one of the pair");
      const dropId = decision.keepId === c.aId ? c.bId : c.aId;
      await tx.update(supplierProducts).set({ canonicalProductId: decision.keepId }).where(eq(supplierProducts.canonicalProductId, dropId));
      await tx.update(canonicalProducts).set({ status: "archived", mergedIntoId: decision.keepId }).where(eq(canonicalProducts.id, dropId));
      await tx.update(duplicateCandidates).set({ status: "merged", resolvedBy: ctx.userId }).where(eq(duplicateCandidates.id, c.id));
    }
    await audit(ctx, { action: `catalog.duplicate_${decision.action}`, entityType: "duplicate_candidate", entityId: c.id, orgId: null, data: decision }, tx);
  });
}
