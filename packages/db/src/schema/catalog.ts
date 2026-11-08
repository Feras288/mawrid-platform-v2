import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";

export const SYSTEMS = [
  "electrical",
  "plumbing",
  "hvac",
  "fire_fighting",
  "fire_alarm",
  "mechanical_equipment",
  "building_materials",
  "low_current",
  "infrastructure",
] as const;
export type SystemKey = (typeof SYSTEMS)[number];

export const regions = pgTable("regions", {
  code: text("code").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const cities = pgTable(
  "cities",
  {
    code: text("code").primaryKey(),
    regionCode: text("region_code")
      .notNull()
      .references(() => regions.code),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("cities_region_idx").on(t.regionCode)],
);

export const units = pgTable("units", {
  code: text("code").primaryKey(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  dimension: text("dimension").notNull(), // length | area | volume | count | mass | time | other
  toBase: numeric("to_base", { precision: 24, scale: 10 }).notNull().default("1"),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
});

export const categories = pgTable(
  "categories",
  {
    id: id(),
    parentId: uuid("parent_id"),
    system: text("system").notNull(),
    slug: text("slug").notNull().unique(),
    path: text("path").notNull(), // e.g. electrical/cables/power-cables
    depth: integer("depth").notNull().default(0),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("categories_parent_idx").on(t.parentId),
    index("categories_system_idx").on(t.system),
    check("categories_system_chk", sql`${t.system} in ('electrical','plumbing','hvac','fire_fighting','fire_alarm','mechanical_equipment','building_materials','low_current','infrastructure')`),
  ],
);

export type AttributeOption = { value: string; nameAr: string; nameEn: string };

export const attributeDefinitions = pgTable(
  "attribute_definitions",
  {
    id: id(),
    key: text("key").notNull().unique(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    dataType: text("data_type").notNull(), // number | text | enum | boolean
    unit: text("unit"), // measurement unit for numbers (mm, bar, V, kW…)
    options: jsonb("options").$type<AttributeOption[]>().notNull().default([]),
    isCritical: boolean("is_critical").notNull().default(false), // must match exactly for product equivalence
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("attribute_type_chk", sql`${t.dataType} in ('number','text','enum','boolean')`)],
);

export const categoryAttributes = pgTable(
  "category_attributes",
  {
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeDefinitions.id, { onDelete: "cascade" }),
    required: boolean("required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.attributeId] })],
);

export const brands = pgTable("brands", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  country: text("country"),
  createdAt: createdAt(),
});

export type AttrValues = Record<string, string | number | boolean>;

export const canonicalProducts = pgTable(
  "canonical_products",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    baseUnit: text("base_unit")
      .notNull()
      .references(() => units.code),
    attributes: jsonb("attributes").$type<AttrValues>().notNull().default({}),
    standards: text("standards").array().notNull().default(sql`'{}'::text[]`),
    keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
    normalizedName: text("normalized_name").notNull(),
    status: text("status").notNull().default("active"), // draft | active | archived
    source: text("source").notNull().default("manual"), // manual | import | boq
    mergedIntoId: uuid("merged_into_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("canonical_category_idx").on(t.categoryId, t.status),
    index("canonical_name_trgm_idx").using("gin", sql`${t.normalizedName} gin_trgm_ops`),
    index("canonical_attrs_idx").using("gin", t.attributes),
    check("canonical_status_chk", sql`${t.status} in ('draft','active','archived')`),
  ],
);

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: id(),
    entityType: text("entity_type").notNull().default("canonical_product"),
    aId: uuid("a_id").notNull(),
    bId: uuid("b_id").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("open"), // open | dismissed | merged
    resolvedBy: uuid("resolved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("duplicate_pair_uq").on(t.entityType, t.aId, t.bId), index("duplicate_status_idx").on(t.status)],
);
