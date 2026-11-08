import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { amount, createdAt, id, qty, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";
import { canonicalProducts, type AttrValues } from "./catalog";
import { organizations } from "./organizations";
import { files } from "./platform";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    projectType: text("project_type").notNull().default("other"), // residential | commercial | industrial | infrastructure | healthcare | education | hospitality | government | other
    city: text("city"),
    region: text("region"),
    siteAddress: text("site_address"),
    managerUserId: uuid("manager_user_id").references(() => authUsers.id),
    status: text("status").notNull().default("planning"), // planning | active | on_hold | completed | cancelled
    visibility: text("visibility").notNull().default("org"), // org | members
    startDate: ts("start_date"),
    endDate: ts("end_date"),
    budget: amount("budget"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("projects_org_code_uq").on(t.orgId, t.code),
    index("projects_org_status_idx").on(t.orgId, t.status, t.createdAt),
    check("projects_status_chk", sql`${t.status} in ('planning','active','on_hold','completed','cancelled')`),
    check("projects_visibility_chk", sql`${t.visibility} in ('org','members')`),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    role: text("role").notNull().default("member"), // manager | member | viewer
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_members_user_idx").on(t.userId)],
);

export const projectActivity = pgTable(
  "project_activity",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("project_activity_project_idx").on(t.projectId, t.createdAt)],
);

export const BOQ_STATUSES = ["received", "extracting", "parsed", "normalizing", "matching", "needs_review", "needs_column_mapping", "needs_manual_entry", "approved", "failed"] as const;

export type ColumnMapping = { sheet?: string; headerRow?: number; description?: number; quantity?: number; unit?: number; itemCode?: number; rate?: number; descriptionExtra?: number[] };

export const boqDocuments = pgTable(
  "boq_documents",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    fileId: uuid("file_id").references(() => files.id),
    sourceType: text("source_type").notNull(), // xlsx | csv | pdf_text | pdf_scanned | image | manual
    status: text("status").notNull().default("received"),
    statusDetail: text("status_detail"),
    columnMapping: jsonb("column_mapping").$type<ColumnMapping>(),
    stats: jsonb("stats").$type<{ lines?: number; needsReview?: number; matched?: number; approved?: number; excluded?: number; aiCostUsd?: number }>().notNull().default({}),
    useAi: boolean("use_ai").notNull().default(false),
    currentVersion: integer("current_version").notNull().default(0),
    error: text("error"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("boq_documents_org_code_uq").on(t.orgId, t.code),
    index("boq_documents_project_idx").on(t.projectId),
    index("boq_documents_org_idx").on(t.orgId, t.createdAt),
  ],
);

export const boqProcessingRuns = pgTable(
  "boq_processing_runs",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => boqDocuments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(), // started | completed | failed
    method: text("method"), // rule | ai | ocr | manual
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("boq_runs_document_idx").on(t.documentId, t.startedAt)],
);

export const boqItems = pgTable(
  "boq_items",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => boqDocuments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    lineNo: integer("line_no").notNull(),
    itemCode: text("item_code"),
    section: text("section"),
    system: text("system"),
    categoryId: uuid("category_id"),
    rawText: text("raw_text").notNull(),
    description: text("description").notNull(),
    descriptionAr: text("description_ar"),
    descriptionEn: text("description_en"),
    quantity: qty("quantity"),
    unitRaw: text("unit_raw"),
    unit: text("unit"),
    attributes: jsonb("attributes").$type<AttrValues>().notNull().default({}),
    source: jsonb("source").$type<{ sheet?: string; row?: number; page?: number; column?: number }>().notNull().default({}),
    extractionMethod: text("extraction_method").notNull().default("rule"), // rule | ai | ocr | manual
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default("0"),
    matchedCanonicalId: uuid("matched_canonical_id").references(() => canonicalProducts.id),
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 4 }),
    matchStatus: text("match_status").notNull().default("unmatched"), // unmatched | auto_suggested | needs_review | confirmed | rejected | no_match
    reviewStatus: text("review_status").notNull().default("pending"), // pending | needs_review | approved | excluded
    issues: jsonb("issues").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    isEdited: boolean("is_edited").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("boq_items_document_idx").on(t.documentId, t.lineNo),
    index("boq_items_review_idx").on(t.documentId, t.reviewStatus),
    check("boq_items_qty_chk", sql`${t.quantity} is null or ${t.quantity} >= 0`),
  ],
);

export const boqItemMatches = pgTable(
  "boq_item_matches",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => boqItems.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    canonicalProductId: uuid("canonical_product_id")
      .notNull()
      .references(() => canonicalProducts.id),
    rank: integer("rank").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    signals: jsonb("signals").$type<Record<string, number>>().notNull().default({}),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("boq_item_matches_item_idx").on(t.itemId, t.rank)],
);

export const boqItemRevisions = pgTable(
  "boq_item_revisions",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => boqItems.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id"),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("boq_item_revisions_item_idx").on(t.itemId, t.createdAt)],
);

export type BoqVersionLine = {
  itemId: string;
  lineNo: number;
  itemCode: string | null;
  section: string | null;
  system: string | null;
  categoryId: string | null;
  description: string;
  quantity: string;
  unit: string;
  attributes: AttrValues;
  canonicalProductId: string | null;
};

export const boqVersions = pgTable(
  "boq_versions",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => boqDocuments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    version: integer("version").notNull(),
    lines: jsonb("lines").$type<BoqVersionLine[]>().notNull(),
    lineCount: integer("line_count").notNull(),
    notes: text("notes"),
    approvedBy: uuid("approved_by").notNull(),
    approvedAt: createdAt(),
  },
  (t) => [uniqueIndex("boq_versions_doc_version_uq").on(t.documentId, t.version)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    orgId: uuid("org_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(), // boq_extraction | match_rerank
    documentId: uuid("document_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    status: text("status").notNull(), // ok | error
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_org_idx").on(t.orgId, t.createdAt)],
);
