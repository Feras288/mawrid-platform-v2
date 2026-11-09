import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { normalizeText } from "@platform/core/text";
import { likeEscape, pageParams, withContext, withSystem, type Tx } from "@platform/db";
import { categories, organizations, storeCatalog, supplierProducts, units } from "@platform/db/schema";
import { attributesForCategory, categorySubtreeIds, getCategoryBySlug, listCategories } from "../catalog";
import { dbCtx, type Ctx } from "../context";
import { resolvePrices, type Buyer, type ResolvedPrice } from "../supplier-products";

/**
 * Public storefront reads. Visibility comes from RLS (active products of approved suppliers) plus
 * `is_published`. Prices are resolved for the viewer: anonymous/individuals get retail; buyer orgs
 * get enterprise / org-specific / regional prices they are entitled to (RLS hides others).
 */

export const SORTS = ["relevance", "newest", "price_asc", "price_desc", "name"] as const;
export type StoreSort = (typeof SORTS)[number];

export function buyerOf(ctx: Ctx, city?: string | null): Buyer {
  return { orgId: ctx.orgId, orgType: ctx.orgType ?? null, city: city ?? null };
}

/** Listing price (lowest current retail tier ≤ 1, ex-VAT), trigger-maintained and indexed — filter/sort only. */
const retailPriceSql = sql<string | null>`${storeCatalog.storePrice}`;

export interface SearchInput {
  q?: string;
  categorySlug?: string;
  brand?: string;
  supplierOrgId?: string;
  minPrice?: string;
  maxPrice?: string;
  inStock?: boolean;
  sort?: StoreSort;
  page?: number;
  pageSize?: number;
}

export interface StoreCard {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  brandName: string | null;
  saleUnit: string;
  categoryId: string;
  supplierOrgId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  imageFileId: string | null;
  price: ResolvedPrice | null;
  available: string;
  leadTimeDays: number | null;
}

async function cardsFor(tx: Tx, ctx: Ctx, rows: { p: typeof supplierProducts.$inferSelect; supAr: string; supEn: string }[]): Promise<StoreCard[]> {
  const prices = await resolvePrices(
    tx,
    rows.map((r) => r.p.id),
    buyerOf(ctx),
  );
  const ids = rows.map((r) => r.p.id);
  const avail = new Map<string, string>();
  if (ids.length) {
    const r = await tx.execute(sql`select id, product_available_qty(id)::text as q from unnest(ARRAY[${sql.join(ids.map((x) => sql`${x}`), sql`, `)}]::uuid[]) as id`);
    for (const row of r.rows as { id: string; q: string }[]) avail.set(row.id, row.q);
  }
  const out: StoreCard[] = [];
  for (const { p, supAr, supEn } of rows) {
    out.push({
      id: p.id,
      sku: p.sku,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      brandName: p.brandName,
      saleUnit: p.saleUnit,
      categoryId: p.categoryId,
      supplierOrgId: p.orgId,
      supplierNameAr: supAr,
      supplierNameEn: supEn,
      imageFileId: p.imageFileIds[0] ?? null,
      price: prices.get(p.id) ?? null,
      available: Number(avail.get(p.id) ?? 0).toFixed(4),
      leadTimeDays: p.leadTimeDays,
    });
  }
  return out;
}

/** Brand facet per category subtree: public data, cached 5 minutes per process. */
const brandCache = new Map<string, { at: number; list: string[] }>();

export async function searchProducts(ctx: Ctx, input: SearchInput) {
  const { limit, offset, page, pageSize } = pageParams(input.page, input.pageSize ?? 24);
  const sort: StoreSort = SORTS.includes(input.sort as StoreSort) ? (input.sort as StoreSort) : input.q ? "relevance" : "newest";
  return withContext(dbCtx(ctx), async (tx) => {
    const V = storeCatalog;
    const conds: (SQL | undefined)[] = [];
    let categoryIds: string[] | null = null;
    if (input.categorySlug) {
      const cat = await getCategoryBySlug(input.categorySlug);
      if (!cat) return { items: [] as StoreCard[], total: 0, page, pageSize, brands: [] as string[] };
      categoryIds = await categorySubtreeIds(tx, cat.id);
      conds.push(inArray(V.categoryId, categoryIds));
    }
    const q = input.q ? normalizeText(input.q).slice(0, 100) : "";
    const raw = (input.q ?? "").trim().slice(0, 100);
    if (q || raw) {
      // every word must appear in the normalized name (each ILIKE is served by the trigram GIN index →
      // BitmapAnd); or the raw text matches a SKU (trigram index) or a brand exactly
      const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
      const nameMatch = words.length ? sql.join(words.map((w) => sql`${V.normalizedName} ilike ${`%${likeEscape(w)}%`}`), sql` and `) : sql`false`;
      conds.push(sql`((${nameMatch}) or ${V.sku} ilike ${`%${likeEscape(raw)}%`} or lower(coalesce(${V.brandName}, '')) = lower(${raw}))`);
    }
    if (input.brand) conds.push(sql`lower(${V.brandName}) = lower(${input.brand})`);
    if (input.supplierOrgId) conds.push(eq(V.orgId, input.supplierOrgId));
    if (input.minPrice && /^\d+(\.\d+)?$/.test(input.minPrice)) conds.push(sql`${retailPriceSql} >= ${input.minPrice}::numeric`);
    if (input.maxPrice && /^\d+(\.\d+)?$/.test(input.maxPrice)) conds.push(sql`${retailPriceSql} <= ${input.maxPrice}::numeric`);
    if (input.inStock) conds.push(sql`product_available_qty(${V.id}) > 0`);
    // only products that have a retail price can be bought in the store
    conds.push(sql`${retailPriceSql} is not null`);
    // Public-catalog visibility, stated explicitly: the id/count queries below run in system mode so
    // trigram/btree indexes can be used (Postgres does not push non-leakproof ILIKE below RLS quals).
    // Rows are then re-read under the viewer's RLS context, so visibility is enforced twice.
    const where = and(...conds);
    const order =
      sort === "price_asc"
        ? [sql`${retailPriceSql} asc nulls last`]
        : sort === "price_desc"
          ? [sql`${retailPriceSql} desc nulls last`]
          : sort === "name"
            ? [asc(V.nameEn)]
            : sort === "relevance" && q
              ? [desc(sql`similarity(${V.normalizedName}, ${q})`)]
              : [desc(V.createdAt)];
    const [idRows, [c]] = await withSystem(async (sx) =>
      Promise.all([
        sx.select({ id: V.id }).from(V).where(where).orderBy(...order, asc(V.id)).limit(limit).offset(offset),
        sx.select({ n: sql<number>`count(*)::int` }).from(V).where(where),
      ]),
    );
    const ids = idRows.map((r) => r.id);
    const loaded = ids.length
      ? await tx
          .select({ p: supplierProducts, supAr: organizations.nameAr, supEn: organizations.nameEn })
          .from(supplierProducts)
          .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
          .where(inArray(supplierProducts.id, ids))
      : [];
    const rows = ids.map((id) => loaded.find((r) => r.p.id === id)).filter((r): r is (typeof loaded)[number] => Boolean(r));
    const brandKey = categoryIds ? categoryIds.join(",") : "*";
    let brands = brandCache.get(brandKey);
    if (!brands || brands.at < Date.now() - 5 * 60_000) {
      const rowsB = await tx
        .selectDistinct({ b: storeCatalog.brandName })
        .from(storeCatalog)
        .where(and(categoryIds ? inArray(storeCatalog.categoryId, categoryIds) : undefined, sql`${storeCatalog.brandName} is not null`))
        .orderBy(asc(storeCatalog.brandName))
        .limit(100);
      brands = { at: Date.now(), list: rowsB.map((b) => b.b!).filter(Boolean) };
      brandCache.set(brandKey, brands);
    }
    return { items: await cardsFor(tx, ctx, rows), total: c?.n ?? 0, page, pageSize, brands: brands.list };
  });
}

export async function storeHome(ctx: Ctx) {
  const cats = await listCategories();
  const roots = cats.filter((c) => c.depth === 0);
  const latest = await searchProducts(ctx, { sort: "newest", pageSize: 8 });
  return { roots, children: cats.filter((c) => c.depth === 1), latest: latest.items };
}

/** Product page: product, specs, viewer's price with tiers, stock, and other suppliers' offers. */
export async function getStoreProduct(ctx: Ctx, id: string) {
  return withContext(dbCtx(ctx), async (tx) => {
    const [row] = await tx
      .select({ p: supplierProducts, supAr: organizations.nameAr, supEn: organizations.nameEn, supCity: organizations.city })
      .from(supplierProducts)
      .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
      .where(and(eq(supplierProducts.id, id), eq(supplierProducts.isPublished, true), eq(supplierProducts.status, "active")))
      .limit(1);
    if (!row) return null;
    const [card] = await cardsFor(tx, ctx, [row]);
    const [cat] = await tx.select().from(categories).where(eq(categories.id, row.p.categoryId)).limit(1);
    const [u] = await tx.select().from(units).where(eq(units.code, row.p.saleUnit)).limit(1);
    const defs = await attributesForCategory(row.p.categoryId);
    const tiers = await tx.execute(sql`
      select i.min_qty, i.unit_price, i.discount_pct, l.prices_include_vat
      from price_list_items i join price_lists l on l.id = i.price_list_id
      where i.supplier_product_id = ${id} and l.id = ${card!.price?.priceListId ?? null}
      order by i.min_qty`);
    // other offers for the same canonical product
    const others = row.p.canonicalProductId
      ? await tx
          .select({ p: supplierProducts, supAr: organizations.nameAr, supEn: organizations.nameEn })
          .from(supplierProducts)
          .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
          .where(and(eq(supplierProducts.canonicalProductId, row.p.canonicalProductId), eq(supplierProducts.isPublished, true), eq(supplierProducts.status, "active"), sql`${supplierProducts.id} <> ${id}`))
          .limit(20)
      : [];
    const offers = (await cardsFor(tx, ctx, others)).filter((o) => o.price);
    return {
      product: row.p,
      card: card!,
      supplier: { orgId: row.p.orgId, nameAr: row.supAr, nameEn: row.supEn, city: row.supCity },
      category: cat ?? null,
      unit: u ?? null,
      attributes: defs
        .filter((d) => row.p.attributes[d.key] !== undefined && row.p.attributes[d.key] !== null && row.p.attributes[d.key] !== "")
        .map((d) => ({ key: d.key, nameAr: d.nameAr, nameEn: d.nameEn, unit: d.unit, value: row.p.attributes[d.key] })),
      tiers: (tiers.rows as { min_qty: string; unit_price: string; discount_pct: string; prices_include_vat: boolean }[]).map((t) => ({ minQty: t.min_qty, unitPrice: t.unit_price, discountPct: t.discount_pct, includesVat: t.prices_include_vat })),
      offers,
    };
  });
}
