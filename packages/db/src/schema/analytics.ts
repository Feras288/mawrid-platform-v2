import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "./auth";
import { categories, canonicalProducts } from "./catalog";
import { createdAt, id, qty, ts, updatedAt } from "./_common";
import { organizations } from "./organizations";

/**
 * Price observations: one row per priced line from a real business event, normalized to the unit's base
 * unit, ex-VAT, SAR. Six price types are kept separate and never mixed in one index:
 *   catalog_retail · catalog_enterprise · store_sale · rfq_quote · rfq_award · po
 * Raw observations contain confidential prices and identities → system-only (RLS). Only aggregated,
 * k-anonymous snapshots are ever shown.
 */
export const PRICE_KINDS = ["catalog_retail", "catalog_enterprise", "store_sale", "rfq_quote", "rfq_award", "po"] as const;

export const priceObservations = pgTable(
  "price_observations",
  {
    id: id(),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    observedAt: ts("observed_at").notNull(),
    canonicalProductId: uuid("canonical_product_id").references(() => canonicalProducts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    supplierOrgId: uuid("supplier_org_id"),
    buyerOrgId: uuid("buyer_org_id"),
    baseUnit: text("base_unit").notNull(),
    quantityBase: qty("quantity_base").notNull(),
    unitPriceBase: numeric("unit_price_base", { precision: 20, scale: 6 }).notNull(), // SAR ex-VAT per base unit
    city: text("city"),
    region: text("region"),
    isTestData: boolean("is_test_data").notNull().default(false),
    isOutlier: boolean("is_outlier").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_obs_source_uq").on(t.kind, t.sourceType, t.sourceId),
    index("price_obs_canonical_idx").on(t.canonicalProductId, t.kind, t.observedAt),
    index("price_obs_category_idx").on(t.categoryId, t.kind, t.observedAt),
    check("price_obs_kind_chk", sql`${t.kind} in ('catalog_retail','catalog_enterprise','store_sale','rfq_quote','rfq_award','po')`),
    check("price_obs_price_chk", sql`${t.unitPriceBase} > 0 and ${t.quantityBase} > 0`),
  ],
);

/** Aggregated, privacy-checked statistics per subject × kind × unit × window. */
export const priceIndexSnapshots = pgTable(
  "price_index_snapshots",
  {
    id: id(),
    asOf: ts("as_of").notNull(),
    windowDays: integer("window_days").notNull(),
    subjectType: text("subject_type").notNull(), // canonical | category
    subjectId: uuid("subject_id").notNull(),
    kind: text("kind").notNull(),
    baseUnit: text("base_unit").notNull(),
    region: text("region"), // null = national
    n: integer("n").notNull(),
    orgCount: integer("org_count").notNull(),
    outliersExcluded: integer("outliers_excluded").notNull().default(0),
    median: numeric("median", { precision: 20, scale: 6 }),
    p25: numeric("p25", { precision: 20, scale: 6 }),
    p75: numeric("p75", { precision: 20, scale: 6 }),
    min: numeric("min", { precision: 20, scale: 6 }),
    max: numeric("max", { precision: 20, scale: 6 }),
    mean: numeric("mean", { precision: 20, scale: 6 }),
    /** quality: high / medium / low based on sample size and dispersion */
    quality: text("quality").notNull(),
    published: boolean("published").notNull(),
    suppressedReason: text("suppressed_reason"),
    methodVersion: text("method_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_snap_uq").on(t.asOf, t.subjectType, t.subjectId, t.kind, t.baseUnit, sql`coalesce(${t.region}, '')`),
    index("price_snap_subject_idx").on(t.subjectType, t.subjectId, t.kind, t.asOf),
  ],
);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    kind: text("kind").notNull(),
    thresholdPct: numeric("threshold_pct", { precision: 6, scale: 2 }).notNull(),
    direction: text("direction").notNull().default("any"), // up | down | any
    isActive: boolean("is_active").notNull().default(true),
    lastTriggeredAt: ts("last_triggered_at"),
    lastValue: numeric("last_value", { precision: 20, scale: 6 }),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("price_alerts_user_idx").on(t.userId),
    check("price_alerts_dir_chk", sql`${t.direction} in ('up','down','any')`),
    check("price_alerts_threshold_chk", sql`${t.thresholdPct} > 0 and ${t.thresholdPct} <= 100`),
  ],
);
