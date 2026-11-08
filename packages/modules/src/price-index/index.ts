import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dec, invalidState, notFound } from "@platform/core";
import { pageParams, withContext, withSystem } from "@platform/db";
import { canonicalProducts, categories, priceAlerts, priceIndexSnapshots, priceObservations, units, PRICE_KINDS } from "@platform/db/schema";
import { authorize, authorizeAdmin, requireUser } from "../authz";
import { getSetting } from "../config";
import { dbCtx, type Ctx } from "../context";
import { notifyUsers } from "../notifications";
import { computeStats, METHOD_VERSION, privacyCheck, quality, type Obs, type PrivacyConfig } from "./stats";

export { computeStats, privacyCheck, quality, quantile, METHOD_VERSION } from "./stats";
export type PriceKind = (typeof PRICE_KINDS)[number];

export interface IndexConfig extends PrivacyConfig {
  windowDays: number;
}

export async function indexConfig(): Promise<IndexConfig> {
  const s = await getSetting<Partial<IndexConfig>>("price_index");
  const v = s.value ?? {};
  const clamp = (x: unknown, d: number, lo: number, hi: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  // floors cannot be configured below the approved privacy minimums (DEC-08)
  return { windowDays: clamp(v.windowDays, 90, 7, 365), minObs: clamp(v.minObs, 5, 5, 1000), minOrgs: clamp(v.minOrgs, 3, 3, 100), maxSharePct: clamp(v.maxSharePct, 60, 20, 60) };
}

// ------------------------------------------------------------------------------------------ collection

/**
 * Capture observations from real business records (idempotent: unique per kind × source).
 * Prices are normalized to the unit's base unit and expressed ex-VAT. Test organizations are flagged and
 * excluded from every index. Catalog prices are captured as one observation per item per day.
 */
export async function collectObservations(opts: { sinceDays?: number } = {}): Promise<Record<string, number>> {
  const since = opts.sinceDays ?? 120;
  const out: Record<string, number> = {};
  await withSystem(async (tx) => {
    const run = async (kind: string, q: ReturnType<typeof sql>) => {
      const r = await tx.execute(q);
      out[kind] = r.rowCount ?? 0;
    };
    await run(
      "store_sale",
      sql`insert into price_observations (id, kind, source_type, source_id, observed_at, canonical_product_id, category_id, supplier_org_id, buyer_org_id, base_unit, quantity_base, unit_price_base, city, region, is_test_data)
        select app_uuidv7(), 'store_sale', 'order_line', ol.id, coalesce(o.placed_at, o.created_at), sp.canonical_product_id, sp.category_id, ol.supplier_org_id, o.org_id,
               u.code, ol.quantity * u.to_base, ol.unit_price / u.to_base, o.shipping_address->>'city', o.shipping_address->>'region',
               (so.is_test_data or coalesce(bo.is_test_data, false) or o.is_test_data)
        from order_lines ol
        join orders o on o.id = ol.order_id
        join order_groups g on g.id = ol.group_id
        join supplier_products sp on sp.id = ol.supplier_product_id
        join units u on u.code = ol.unit
        join organizations so on so.id = ol.supplier_org_id
        left join organizations bo on bo.id = o.org_id
        where o.payment_status in ('paid','partially_refunded') and g.status <> 'cancelled' and ol.unit_price > 0 and u.to_base > 0
          and o.created_at > now() - make_interval(days => ${since})
        on conflict do nothing`,
    );
    // quotes: only the current submitted version counts; superseded/withdrawn versions are removed
    await tx.execute(sql`delete from price_observations po where po.kind = 'rfq_quote' and not exists (
      select 1 from quotation_items qi join quotations q on q.id = qi.quotation_id where qi.id = po.source_id and q.status = 'submitted' and q.is_current)`);
    await run(
      "rfq_quote",
      sql`insert into price_observations (id, kind, source_type, source_id, observed_at, canonical_product_id, category_id, supplier_org_id, buyer_org_id, base_unit, quantity_base, unit_price_base, city, region, is_test_data)
        select app_uuidv7(), 'rfq_quote', 'quotation_item', qi.id, coalesce(q.submitted_at, q.created_at), ri.canonical_product_id, ri.category_id, q.supplier_org_id, q.buyer_org_id,
               u.code, coalesce(qi.quantity, ri.quantity) * u.to_base, qi.unit_price * (1 - qi.discount_pct / 100) / u.to_base, r.delivery_city, c.region_code,
               (so.is_test_data or bo.is_test_data)
        from quotation_items qi
        join quotations q on q.id = qi.quotation_id
        join rfq_items ri on ri.id = qi.rfq_item_id
        join rfqs r on r.id = ri.rfq_id
        join units u on u.code = ri.unit
        join organizations so on so.id = q.supplier_org_id
        join organizations bo on bo.id = q.buyer_org_id
        left join cities c on c.code = r.delivery_city
        where q.status = 'submitted' and q.is_current and qi.offered and not qi.is_alternative and qi.unit_price > 0 and u.to_base > 0
          and (ri.canonical_product_id is not null or ri.category_id is not null)
          and q.created_at > now() - make_interval(days => ${since})
        on conflict do nothing`,
    );
    await tx.execute(sql`delete from price_observations po where po.kind = 'rfq_award' and not exists (
      select 1 from award_lines al join awards a on a.id = al.award_id where al.id = po.source_id and al.is_current and a.status = 'approved')`);
    await run(
      "rfq_award",
      sql`insert into price_observations (id, kind, source_type, source_id, observed_at, canonical_product_id, category_id, supplier_org_id, buyer_org_id, base_unit, quantity_base, unit_price_base, city, region, is_test_data)
        select app_uuidv7(), 'rfq_award', 'award_line', al.id, coalesce(a.decided_at, a.updated_at), ri.canonical_product_id, ri.category_id, al.supplier_org_id, al.org_id,
               u.code, al.quantity * u.to_base, al.unit_price / u.to_base, r.delivery_city, c.region_code, (so.is_test_data or bo.is_test_data)
        from award_lines al
        join awards a on a.id = al.award_id
        join rfq_items ri on ri.id = al.rfq_item_id
        join rfqs r on r.id = ri.rfq_id
        join units u on u.code = ri.unit
        join organizations so on so.id = al.supplier_org_id
        join organizations bo on bo.id = al.org_id
        left join cities c on c.code = r.delivery_city
        where al.is_current and a.status = 'approved' and al.supplier_org_id is not null and al.unit_price > 0 and u.to_base > 0
          and (ri.canonical_product_id is not null or ri.category_id is not null)
        on conflict do nothing`,
    );
    await run(
      "po",
      sql`insert into price_observations (id, kind, source_type, source_id, observed_at, canonical_product_id, category_id, supplier_org_id, buyer_org_id, base_unit, quantity_base, unit_price_base, city, region, is_test_data)
        select app_uuidv7(), 'po', 'po_item', pi.id, p.issued_at, ri.canonical_product_id, ri.category_id, p.supplier_org_id, p.org_id,
               u.code, pi.quantity * u.to_base, pi.unit_price / u.to_base, p.delivery_city, c.region_code, (so.is_test_data or bo.is_test_data)
        from po_items pi
        join purchase_orders p on p.id = pi.po_id
        join rfq_items ri on ri.id = pi.rfq_item_id
        join units u on u.code = pi.unit
        join organizations so on so.id = p.supplier_org_id
        join organizations bo on bo.id = p.org_id
        left join cities c on c.code = p.delivery_city
        where p.approval_status = 'approved' and p.fulfillment_status <> 'cancelled' and p.issued_at is not null and pi.unit_price > 0 and u.to_base > 0
          and (ri.canonical_product_id is not null or ri.category_id is not null)
        on conflict do nothing`,
    );
    for (const [kind, listKind] of [
      ["catalog_retail", "retail"],
      ["catalog_enterprise", "enterprise"],
    ] as const) {
      await run(
        kind,
        sql`insert into price_observations (id, kind, source_type, source_id, observed_at, canonical_product_id, category_id, supplier_org_id, buyer_org_id, base_unit, quantity_base, unit_price_base, is_test_data)
          select app_uuidv7(), ${kind}, 'price_list_item_day', md5(i.id::text || current_date::text)::uuid, date_trunc('day', now()), sp.canonical_product_id, sp.category_id, sp.org_id, null,
                 u.code, i.min_qty * u.to_base,
                 (i.unit_price * (1 - i.discount_pct / 100) / case when l.prices_include_vat then (1 + sp.vat_rate) else 1 end) / u.to_base,
                 so.is_test_data
          from price_list_items i
          join price_lists l on l.id = i.price_list_id
          join supplier_products sp on sp.id = i.supplier_product_id
          join units u on u.code = sp.sale_unit
          join organizations so on so.id = sp.org_id
          join supplier_profiles pr on pr.org_id = sp.org_id and pr.status = 'approved'
          where l.kind = ${listKind} and l.is_active and (l.valid_from is null or l.valid_from <= now()) and (l.valid_to is null or l.valid_to > now())
            and i.min_qty <= 1 and sp.status = 'active' and i.unit_price > 0 and u.to_base > 0
          on conflict do nothing`,
      );
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------ snapshots

/** Compute daily snapshots for every (product|category) × kind × base unit with data in the window. */
export async function computeSnapshots(asOf = new Date()): Promise<{ groups: number; published: number }> {
  const cfg = await indexConfig();
  const day = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const from = new Date(day.getTime() - cfg.windowDays * 86_400_000);
  const rows = await withSystem((tx) =>
    tx
      .select({ id: priceObservations.id, kind: priceObservations.kind, canonicalProductId: priceObservations.canonicalProductId, categoryId: priceObservations.categoryId, baseUnit: priceObservations.baseUnit, price: priceObservations.unitPriceBase, supplierOrgId: priceObservations.supplierOrgId, buyerOrgId: priceObservations.buyerOrgId })
      .from(priceObservations)
      .where(and(eq(priceObservations.isTestData, false), gte(priceObservations.observedAt, from), sql`${priceObservations.observedAt} <= ${new Date(day.getTime() + 86_400_000)}`)),
  );
  type Row = (typeof rows)[number];
  const groups = new Map<string, { subjectType: "canonical" | "category"; subjectId: string; kind: string; baseUnit: string; rows: Row[] }>();
  const add = (subjectType: "canonical" | "category", subjectId: string | null, r: Row) => {
    if (!subjectId) return;
    const key = `${subjectType}|${subjectId}|${r.kind}|${r.baseUnit}`;
    const g = groups.get(key) ?? { subjectType, subjectId, kind: r.kind, baseUnit: r.baseUnit, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  };
  for (const r of rows) {
    add("canonical", r.canonicalProductId, r);
    add("category", r.categoryId, r);
  }
  let published = 0;
  const outlierIds = new Set<string>();
  const values: (typeof priceIndexSnapshots.$inferInsert)[] = [];
  for (const g of groups.values()) {
    const st = computeStats(g.rows.map((r) => ({ price: r.price, supplierOrgId: r.supplierOrgId, buyerOrgId: r.buyerOrgId }) satisfies Obs));
    if (!st) continue;
    if (g.subjectType === "canonical") g.rows.forEach((r, i) => st.outlierFlags[i] && outlierIds.add(r.id));
    const pv = privacyCheck(g.kind, st.kept, cfg);
    if (pv.published) published++;
    const show = pv.published;
    values.push({
      asOf: day,
      windowDays: cfg.windowDays,
      subjectType: g.subjectType,
      subjectId: g.subjectId,
      kind: g.kind,
      baseUnit: g.baseUnit,
      region: null,
      n: st.n,
      orgCount: pv.orgCount,
      outliersExcluded: st.outliers,
      // suppressed snapshots keep counts (for operators) but never the price statistics
      median: show ? st.median.toFixed(6) : null,
      p25: show ? st.p25.toFixed(6) : null,
      p75: show ? st.p75.toFixed(6) : null,
      min: show ? st.min.toFixed(6) : null,
      max: show ? st.max.toFixed(6) : null,
      mean: show ? st.mean.toFixed(6) : null,
      quality: quality(st.n, st.cv),
      published: pv.published,
      suppressedReason: pv.reason,
      methodVersion: METHOD_VERSION,
    });
  }
  await withSystem(async (tx) => {
    await tx.delete(priceIndexSnapshots).where(eq(priceIndexSnapshots.asOf, day));
    for (let i = 0; i < values.length; i += 500) await tx.insert(priceIndexSnapshots).values(values.slice(i, i + 500));
    await tx.update(priceObservations).set({ isOutlier: false }).where(and(eq(priceObservations.isOutlier, true), gte(priceObservations.observedAt, from)));
    const ids = [...outlierIds];
    for (let i = 0; i < ids.length; i += 1000) await tx.update(priceObservations).set({ isOutlier: true }).where(inArray(priceObservations.id, ids.slice(i, i + 1000)));
  });
  return { groups: values.length, published };
}

/** Daily job: collect, snapshot, evaluate alerts. */
export async function runPriceIndex(): Promise<{ collected: Record<string, number>; groups: number; published: number; alerts: number }> {
  const collected = await collectObservations();
  const snap = await computeSnapshots();
  const alerts = await evaluateAlerts();
  return { collected, ...snap, alerts };
}

// ------------------------------------------------------------------------------------------ reads

function requireIndexAccess(ctx: Ctx) {
  requireUser(ctx);
  if (ctx.isPlatformAdmin) return;
  authorize(ctx, "price_index.view");
}

async function latestDay(): Promise<Date | null> {
  const [r] = await withSystem((tx) => tx.select({ d: sql<Date | null>`max(${priceIndexSnapshots.asOf})` }).from(priceIndexSnapshots));
  return r?.d ? new Date(r.d) : null;
}

export async function searchIndex(ctx: Ctx, opts: { q?: string; kind?: string; subjectType?: "canonical" | "category"; page?: number } = {}) {
  requireIndexAccess(ctx);
  const { limit, offset, page, pageSize } = pageParams(opts.page, 30);
  const day = await latestDay();
  if (!day) return { items: [], total: 0, page, pageSize, asOf: null as Date | null };
  return withContext(dbCtx(ctx), async (tx) => {
    const q = opts.q?.trim().toLowerCase();
    const where = and(
      eq(priceIndexSnapshots.asOf, day),
      eq(priceIndexSnapshots.published, true),
      opts.kind && (PRICE_KINDS as readonly string[]).includes(opts.kind) ? eq(priceIndexSnapshots.kind, opts.kind) : undefined,
      opts.subjectType ? eq(priceIndexSnapshots.subjectType, opts.subjectType) : undefined,
      q
        ? sql`(exists (select 1 from canonical_products cp where cp.id = ${priceIndexSnapshots.subjectId} and (lower(cp.name_en) like ${"%" + q + "%"} or cp.name_ar like ${"%" + q + "%"}))
               or exists (select 1 from categories c where c.id = ${priceIndexSnapshots.subjectId} and (lower(c.name_en) like ${"%" + q + "%"} or c.name_ar like ${"%" + q + "%"})))`
        : undefined,
    );
    const items = await tx
      .select({
        s: priceIndexSnapshots,
        nameAr: sql<string>`coalesce((select name_ar from canonical_products where id = ${priceIndexSnapshots.subjectId}), (select name_ar from categories where id = ${priceIndexSnapshots.subjectId}))`,
        nameEn: sql<string>`coalesce((select name_en from canonical_products where id = ${priceIndexSnapshots.subjectId}), (select name_en from categories where id = ${priceIndexSnapshots.subjectId}))`,
        change30: sql<string | null>`(select round((${priceIndexSnapshots.median} / nullif(p.median, 0) - 1) * 100, 1)::text from price_index_snapshots p
          where p.subject_type = ${priceIndexSnapshots.subjectType} and p.subject_id = ${priceIndexSnapshots.subjectId} and p.kind = ${priceIndexSnapshots.kind}
            and p.base_unit = ${priceIndexSnapshots.baseUnit} and p.published and p.as_of <= ${priceIndexSnapshots.asOf} - interval '28 days'
          order by p.as_of desc limit 1)`,
      })
      .from(priceIndexSnapshots)
      .where(where)
      .orderBy(desc(priceIndexSnapshots.n))
      .limit(limit)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(priceIndexSnapshots).where(where);
    return { items, total: c?.n ?? 0, page, pageSize, asOf: day };
  });
}

/** Time series of published snapshots for one subject (all kinds) plus the subject's names. */
export async function getIndexSeries(ctx: Ctx, subjectType: "canonical" | "category", subjectId: string) {
  requireIndexAccess(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const series = await tx
      .select()
      .from(priceIndexSnapshots)
      .where(and(eq(priceIndexSnapshots.subjectType, subjectType), eq(priceIndexSnapshots.subjectId, subjectId), eq(priceIndexSnapshots.published, true)))
      .orderBy(priceIndexSnapshots.asOf)
      .limit(2000);
    const [subject] =
      subjectType === "canonical"
        ? await tx.select({ nameAr: canonicalProducts.nameAr, nameEn: canonicalProducts.nameEn }).from(canonicalProducts).where(eq(canonicalProducts.id, subjectId)).limit(1)
        : await tx.select({ nameAr: categories.nameAr, nameEn: categories.nameEn }).from(categories).where(eq(categories.id, subjectId)).limit(1);
    if (!subject) throw notFound("Index subject");
    const unitCodes = [...new Set(series.map((s) => s.baseUnit))];
    const unitRows = unitCodes.length ? await tx.select().from(units).where(inArray(units.code, unitCodes)) : [];
    return { subject, series, units: unitRows, config: await indexConfig() };
  });
}

// ------------------------------------------------------------------------------------------ alerts

export const alertSchema = z.object({
  subjectType: z.enum(["canonical", "category"]),
  subjectId: z.string().uuid(),
  kind: z.enum(PRICE_KINDS),
  thresholdPct: z.coerce.number().min(1).max(100),
  direction: z.enum(["up", "down", "any"]).default("any"),
});

export async function createAlert(ctx: Ctx, input: z.input<typeof alertSchema>) {
  requireIndexAccess(ctx);
  const d = alertSchema.parse(input);
  return withContext(dbCtx(ctx), async (tx) => {
    const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(priceAlerts).where(eq(priceAlerts.userId, ctx.userId!));
    if ((n?.n ?? 0) >= 50) throw invalidState("Too many alerts", { key: "alerts_limit" });
    const [latest] = await tx
      .select({ median: priceIndexSnapshots.median })
      .from(priceIndexSnapshots)
      .where(and(eq(priceIndexSnapshots.subjectType, d.subjectType), eq(priceIndexSnapshots.subjectId, d.subjectId), eq(priceIndexSnapshots.kind, d.kind), eq(priceIndexSnapshots.published, true)))
      .orderBy(desc(priceIndexSnapshots.asOf))
      .limit(1);
    const [row] = await tx
      .insert(priceAlerts)
      .values({ userId: ctx.userId!, orgId: ctx.orgId, subjectType: d.subjectType, subjectId: d.subjectId, kind: d.kind, thresholdPct: String(d.thresholdPct), direction: d.direction, lastValue: latest?.median ?? null })
      .returning();
    return row!;
  });
}

export async function listMyAlerts(ctx: Ctx) {
  requireUser(ctx);
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .select({
        a: priceAlerts,
        nameAr: sql<string>`coalesce((select name_ar from canonical_products where id = ${priceAlerts.subjectId}), (select name_ar from categories where id = ${priceAlerts.subjectId}))`,
        nameEn: sql<string>`coalesce((select name_en from canonical_products where id = ${priceAlerts.subjectId}), (select name_en from categories where id = ${priceAlerts.subjectId}))`,
      })
      .from(priceAlerts)
      .where(eq(priceAlerts.userId, ctx.userId!))
      .orderBy(desc(priceAlerts.createdAt)),
  );
}

export async function deleteAlert(ctx: Ctx, id: string) {
  requireUser(ctx);
  await withContext(dbCtx(ctx), async (tx) => {
    const r = await tx.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, ctx.userId!))).returning();
    if (!r.length) throw notFound("Alert");
  });
}

/** Compare each alert's baseline with the latest published median; notify once per crossing. */
export async function evaluateAlerts(): Promise<number> {
  const alerts = await withSystem((tx) => tx.select().from(priceAlerts).where(eq(priceAlerts.isActive, true)));
  let fired = 0;
  for (const a of alerts) {
    const [latest] = await withSystem((tx) =>
      tx
        .select({ median: priceIndexSnapshots.median, asOf: priceIndexSnapshots.asOf })
        .from(priceIndexSnapshots)
        .where(and(eq(priceIndexSnapshots.subjectType, a.subjectType), eq(priceIndexSnapshots.subjectId, a.subjectId), eq(priceIndexSnapshots.kind, a.kind), eq(priceIndexSnapshots.published, true)))
        .orderBy(desc(priceIndexSnapshots.asOf))
        .limit(1),
    );
    if (!latest?.median) continue;
    if (!a.lastValue) {
      await withSystem((tx) => tx.update(priceAlerts).set({ lastValue: latest.median }).where(eq(priceAlerts.id, a.id)));
      continue;
    }
    const change = dec(latest.median).div(dec(a.lastValue)).minus(1).times(100);
    const hit = change.abs().gte(dec(a.thresholdPct)) && (a.direction === "any" || (a.direction === "up" ? change.gt(0) : change.lt(0)));
    if (!hit) continue;
    await withSystem(async (tx) => {
      const [subj] = await tx.execute(sql`select coalesce((select name_ar from canonical_products where id = ${a.subjectId}), (select name_ar from categories where id = ${a.subjectId})) as name`).then((r) => r.rows as { name: string }[]);
      await notifyUsers({ userIds: [a.userId], kind: "price.alert", params: { productName: subj?.name ?? "", change: `${change.toFixed(1)}%`, period: a.kind }, link: `/org/price-index/${a.subjectType}/${a.subjectId}`, orgId: a.orgId, dedupeKey: `price-alert:${a.id}:${latest.asOf.toISOString().slice(0, 10)}`, email: true }, tx);
      await tx.update(priceAlerts).set({ lastTriggeredAt: new Date(), lastValue: latest.median }).where(eq(priceAlerts.id, a.id));
    });
    fired++;
  }
  return fired;
}

/** Admin: suppressed vs published counts per kind (no prices). */
export async function indexHealth(ctx: Ctx) {
  authorizeAdmin(ctx, "admin.reports");
  const day = await latestDay();
  if (!day) return { asOf: null, rows: [] as { kind: string; published: number; suppressed: number; reasons: Record<string, number> }[], observations: 0, testExcluded: 0 };
  const rows = await withSystem((tx) =>
    tx
      .select({ kind: priceIndexSnapshots.kind, published: priceIndexSnapshots.published, reason: priceIndexSnapshots.suppressedReason, n: sql<number>`count(*)::int` })
      .from(priceIndexSnapshots)
      .where(eq(priceIndexSnapshots.asOf, day))
      .groupBy(priceIndexSnapshots.kind, priceIndexSnapshots.published, priceIndexSnapshots.suppressedReason),
  );
  const [obs] = await withSystem((tx) => tx.select({ all: sql<number>`count(*)::int`, test: sql<number>`count(*) filter (where ${priceObservations.isTestData})::int` }).from(priceObservations));
  const byKind = new Map<string, { kind: string; published: number; suppressed: number; reasons: Record<string, number> }>();
  for (const r of rows) {
    const k = byKind.get(r.kind) ?? { kind: r.kind, published: 0, suppressed: 0, reasons: {} };
    if (r.published) k.published += r.n;
    else {
      k.suppressed += r.n;
      k.reasons[r.reason ?? "unknown"] = (k.reasons[r.reason ?? "unknown"] ?? 0) + r.n;
    }
    byKind.set(r.kind, k);
  }
  return { asOf: day, rows: [...byKind.values()], observations: obs?.all ?? 0, testExcluded: obs?.test ?? 0 };
}

