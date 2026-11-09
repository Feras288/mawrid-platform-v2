import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, pgView, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { amount, createdAt, id, qty, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";
import { brands, categories, canonicalProducts, units, type AttrValues } from "./catalog";
import { organizations } from "./organizations";
import { files } from "./platform";

export const SUPPLIER_STATUSES = ["new", "pending_verification", "under_review", "approved", "suspended", "rejected"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const supplierProfiles = pgTable(
  "supplier_profiles",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("new"),
    statusReason: text("status_reason"),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    establishedYear: integer("established_year"),
    employeesRange: text("employees_range"),
    logoFileId: uuid("logo_file_id").references(() => files.id),
    coverageRegions: text("coverage_regions").array().notNull().default(sql`'{}'::text[]`),
    coverageCities: text("coverage_cities").array().notNull().default(sql`'{}'::text[]`),
    deliversNationwide: boolean("delivers_nationwide").notNull().default(false),
    minOrderValue: amount("min_order_value"),
    defaultLeadTimeDays: integer("default_lead_time_days"),
    paymentTerms: text("payment_terms"),
    acceptsStoreOrders: boolean("accepts_store_orders").notNull().default(true),
    acceptsRfqs: boolean("accepts_rfqs").notNull().default(true),
    submittedAt: ts("submitted_at"),
    reviewedBy: uuid("reviewed_by").references(() => authUsers.id),
    reviewedAt: ts("reviewed_at"),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_profiles_status_idx").on(t.status),
    check("supplier_status_chk", sql`${t.status} in ('new','pending_verification','under_review','approved','suspended','rejected')`),
  ],
);

export const supplierStatusHistory = pgTable(
  "supplier_status_history",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("supplier_status_history_org_idx").on(t.orgId, t.createdAt)],
);

export const SUPPLIER_DOC_KINDS = ["commercial_registration", "vat_certificate", "chamber_membership", "municipality_license", "iso_certificate", "brand_authorization", "bank_letter", "national_address", "other"] as const;

export const supplierDocuments = pgTable(
  "supplier_documents",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    documentNumber: text("document_number"),
    issuedAt: ts("issued_at"),
    expiresAt: ts("expires_at"),
    status: text("status").notNull().default("uploaded"), // uploaded | verified | rejected | expired
    reviewerNote: text("reviewer_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("supplier_documents_org_idx").on(t.orgId),
    check("supplier_doc_status_chk", sql`${t.status} in ('uploaded','verified','rejected','expired')`),
  ],
);

export const supplierCategories = pgTable(
  "supplier_categories",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.categoryId] }), index("supplier_categories_cat_idx").on(t.categoryId)],
);

export const warehouses = pgTable(
  "warehouses",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city").notNull(),
    region: text("region"),
    addressLine: text("address_line"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("warehouses_org_idx").on(t.orgId)],
);

export const supplierProducts = pgTable(
  "supplier_products",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    canonicalProductId: uuid("canonical_product_id").references(() => canonicalProducts.id),
    matchStatus: text("match_status").notNull().default("unmatched"), // unmatched | suggested | confirmed | rejected
    matchSource: text("match_source"), // manual | rule | ai | import | admin
    matchScore: amount("match_score"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    brandId: uuid("brand_id").references(() => brands.id),
    brandName: text("brand_name"),
    model: text("model"),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    attributes: jsonb("attributes").$type<AttrValues>().notNull().default({}),
    countryOfOrigin: text("country_of_origin"),
    certifications: text("certifications").array().notNull().default(sql`'{}'::text[]`),
    saleUnit: text("sale_unit")
      .notNull()
      .references(() => units.code),
    packSize: qty("pack_size").notNull().default("1"),
    moq: qty("moq").notNull().default("1"),
    orderIncrement: qty("order_increment").notNull().default("1"),
    leadTimeDays: integer("lead_time_days"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
    imageFileIds: uuid("image_file_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: text("status").notNull().default("draft"), // draft | active | inactive
    isPublished: boolean("is_published").notNull().default(false), // visible in store
    normalizedName: text("normalized_name").notNull(),
    /** lowest current retail price ex-VAT (tier ≤ 1), trigger-maintained — store filtering/sorting only */
    storePrice: qty("store_price"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("supplier_products_sku_uq").on(t.orgId, t.sku),
    index("supplier_products_store_price_idx").on(t.storePrice).where(sql`${t.isPublished} and ${t.status} = 'active' and ${t.storePrice} is not null`),
    index("supplier_products_canonical_idx").on(t.canonicalProductId),
    index("supplier_products_category_idx").on(t.categoryId, t.status),
    index("supplier_products_name_trgm_idx").using("gin", sql`${t.normalizedName} gin_trgm_ops`),
    index("supplier_products_sku_trgm_idx").using("gin", sql`${t.sku} gin_trgm_ops`),
    index("supplier_products_brand_lower_idx").on(sql`lower(coalesce(${t.brandName}, ''))`),
    index("supplier_products_store_newest_idx").on(t.createdAt.desc(), t.id).where(sql`${t.isPublished} and ${t.status} = 'active' and ${t.storePrice} is not null`),
    index("supplier_products_store_idx").on(t.isPublished, t.status),
    check("supplier_products_status_chk", sql`${t.status} in ('draft','active','inactive')`),
    check("supplier_products_match_chk", sql`${t.matchStatus} in ('unmatched','suggested','confirmed','rejected')`),
    check("supplier_products_qty_chk", sql`${t.packSize} > 0 and ${t.moq} > 0 and ${t.orderIncrement} > 0`),
  ],
);

export const priceLists = pgTable(
  "price_lists",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // retail | enterprise | org_specific | regional
    buyerOrgId: uuid("buyer_org_id").references(() => organizations.id),
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    currency: text("currency").notNull().default("SAR"),
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(false),
    validFrom: ts("valid_from"),
    validTo: ts("valid_to"),
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("price_lists_org_idx").on(t.orgId, t.kind),
    check("price_lists_kind_chk", sql`${t.kind} in ('retail','enterprise','org_specific','regional')`),
    check("price_lists_buyer_chk", sql`(${t.kind} = 'org_specific') = (${t.buyerOrgId} is not null)`),
    check("price_lists_validity_chk", sql`${t.validTo} is null or ${t.validFrom} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: id(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    supplierProductId: uuid("supplier_product_id")
      .notNull()
      .references(() => supplierProducts.id, { onDelete: "cascade" }),
    minQty: qty("min_qty").notNull().default("1"),
    unitPrice: qty("unit_price").notNull(),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("price_list_items_uq").on(t.priceListId, t.supplierProductId, t.minQty),
    index("price_list_items_product_idx").on(t.supplierProductId),
    check("price_list_items_price_chk", sql`${t.unitPrice} >= 0 and ${t.minQty} > 0 and ${t.discountPct} >= 0 and ${t.discountPct} < 100`),
  ],
);

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    supplierProductId: uuid("supplier_product_id")
      .notNull()
      .references(() => supplierProducts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    onHand: qty("on_hand").notNull().default("0"),
    reserved: qty("reserved").notNull().default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.warehouseId, t.supplierProductId] }),
    index("inventory_product_idx").on(t.supplierProductId),
    check("inventory_nonneg_chk", sql`${t.onHand} >= 0 and ${t.reserved} >= 0 and ${t.reserved} <= ${t.onHand}`),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    orgId: uuid("org_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    supplierProductId: uuid("supplier_product_id").notNull(),
    kind: text("kind").notNull(), // adjust | reserve | release | fulfil | import
    quantity: qty("quantity").notNull(),
    reference: text("reference"),
    actorUserId: uuid("actor_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("inventory_movements_product_idx").on(t.supplierProductId, t.createdAt)],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // supplier_products | canonical_products
    fileId: uuid("file_id").references(() => files.id),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    totalRows: integer("total_rows").notNull().default(0),
    okRows: integer("ok_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("import_batches_org_idx").on(t.orgId, t.createdAt)],
);

export const importBatchRows = pgTable(
  "import_batch_rows",
  {
    id: id(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    orgId: uuid("org_id"),
    rowNumber: integer("row_number").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(), // created | updated | error | skipped
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    entityId: uuid("entity_id"),
  },
  (t) => [index("import_rows_batch_idx").on(t.batchId, t.rowNumber)],
);

/** Owner-privileged public catalog view (see sql/post/095_store_price.sql). Read-only. */
export const storeCatalog = pgView("store_catalog", {
  id: uuid("id").notNull(),
  orgId: uuid("org_id").notNull(),
  sku: text("sku").notNull(),
  categoryId: uuid("category_id").notNull(),
  brandName: text("brand_name"),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  normalizedName: text("normalized_name").notNull(),
  storePrice: qty("store_price"),
  createdAt: ts("created_at").notNull(),
}).existing();
