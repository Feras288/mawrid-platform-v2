import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { normalizeText } from "@platform/core/text";
import { likeEscape, pageParams, withContext, type Tx } from "@platform/db";
import { categories, organizations, supplierProducts, units } from "@platform/db/schema";
import { attributesForCategory, categorySubtreeIds, getCategoryBySlug, listCategories } from "../catalog";
import { dbCtx, type Ctx } from "../context";
import { availableQty, resolvePrices, type Buyer, type ResolvedPrice } from "../supplier-products";

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

/** Lowest current retail price (tier min_qty ≤ 1) — used for public sorting/filtering only. */
const retailPriceSql = sql<string | null>`(
  select min(i.unit_price * (1 - i.discount_pct / 100) / case when l.prices_include_vat then (1 + ${supplierProducts.vatRate}) else 1 end)
  from price_list_items i join price_lists l on l.id = i.price_list_id
  where i.supplier_product_id = ${supplierProducts.id} and l.kind = 'retail' and l.is_active
    and (l.valid_from is null or l.valid_from <= now()) and (l.valid_to is null or l.valid_to > now()) and i.min_qty <= 1
)`;

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
      available: (await availableQty(tx, p.id)).toFixed(4),
      leadTimeDays: p.leadTimeDays,
    });
  }
  return out;
}

export async function searchProducts(ctx: Ctx, input: SearchInput) {
  const { limit, offset, page, pageSize } = pageParams(input.page, input.pageSize ?? 24);
  const sort: StoreSort = SORTS.includes(input.sort as StoreSort) ? (input.sort as StoreSort) : input.q ? "relevance" : "newest";
  return withContext(dbCtx(ctx), async (tx) => {
    const conds: (SQL | undefined)[] = [eq(supplierProducts.isPublished, true), eq(supplierProducts.status, "active")];
    let categoryIds: string[] | null = null;
    if (input.categorySlug) {
      const cat = await getCategoryBySlug(input.categorySlug);
      if (!cat) return { items: [] as StoreCard[], total: 0, page, pageSize, brands: [] as string[] };
      categoryIds = await categorySubtreeIds(tx, cat.id);
      conds.push(inArray(supplierProducts.categoryId, categoryIds));
    }
    const q = input.q ? normalizeText(input.q).slice(0, 100) : "";
    const raw = (input.q ?? "").trim().slice(0, 100);
    if (q || raw) {
      const like = `%${likeEscape(q)}%`;
      const rawLike = `%${likeEscape(raw)}%`;
      conds.push(sql`(${supplierProducts.normalizedName} ilike ${like} or ${supplierProducts.sku} ilike ${rawLike} or ${supplierProducts.normalizedName} % ${q} or lower(coalesce(${supplierProducts.brandName}, '')) = lower(${raw}))`);
    }
    if (input.brand) conds.push(sql`lower(${supplierProducts.brandName}) = lower(${input.brand})`);
    if (input.supplierOrgId) conds.push(eq(supplierProducts.orgId, input.supplierOrgId));
    if (input.minPrice && /^\d+(\.\d+)?$/.test(input.minPrice)) conds.push(sql`${retailPriceSql} >= ${input.minPrice}::numeric`);
    if (input.maxPrice && /^\d+(\.\d+)?$/.test(input.maxPrice)) conds.push(sql`${retailPriceSql} <= ${input.maxPrice}::numeric`);
    if (input.inStock) conds.push(sql`product_available_qty(${supplierProducts.id}) > 0`);
    // only products that have a retail price can be bought in the store
    conds.push(sql`${retailPriceSql} is not null`);
    const where = and(...conds);
    const order =
      sort === "price_asc"
        ? [sql`${retailPriceSql} asc nulls last`]
        : sort === "price_desc"
          ? [sql`${retailPriceSql} desc nulls last`]
          : sort === "name"
            ? [asc(supplierProducts.nameEn)]
            : sort === "relevance" && q
              ? [desc(sql`similarity(${supplierProducts.normalizedName}, ${q})`)]
              : [desc(supplierProducts.createdAt)];
    const rows = await tx
      .select({ p: supplierProducts, supAr: organizations.nameAr, supEn: organizations.nameEn })
      .from(supplierProducts)
      .innerJoin(organizations, eq(organizations.id, supplierProducts.orgId))
      .where(where)
      .orderBy(...order, asc(supplierProducts.id))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(supplierProducts).where(where);
    const brands = await tx
      .selectDistinct({ b: supplierProducts.brandName })
      .from(supplierProducts)
      .where(and(eq(supplierProducts.isPublished, true), eq(supplierProducts.status, "active"), categoryIds ? inArray(supplierProducts.categoryId, categoryIds) : undefined, sql`${supplierProducts.brandName} is not null`))
      .orderBy(asc(supplierProducts.brandName))
      .limit(100);
    return { items: await cardsFor(tx, ctx, rows), total: c?.n ?? 0, page, pageSize, brands: brands.map((b) => b.b!).filter(Boolean) };
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
