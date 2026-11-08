import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";
import { organizations } from "./organizations";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id"),
    actorUserId: uuid("actor_user_id"),
    actorType: text("actor_type").notNull().default("user"), // user | system | admin
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.orgId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
  ],
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  rules: jsonb("rules").$type<{ orgIds?: string[]; envs?: string[] }>().notNull().default({}),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  secretEnc: text("secret_enc"),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

export const breakglassGrants = pgTable(
  "breakglass_grants",
  {
    id: id(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => authUsers.id),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    reason: text("reason").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("breakglass_admin_idx").on(t.adminUserId, t.expiresAt)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    topic: text("topic").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    orgId: uuid("org_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // pending | dispatched | failed
    attempts: integer("attempts").notNull().default(0),
    availableAt: ts("available_at").notNull().defaultNow(),
    dispatchedAt: ts("dispatched_at"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_pending_idx").on(t.status, t.availableAt).where(sql`${t.status} = 'pending'`),
    uniqueIndex("outbox_dedupe_uq").on(t.dedupeKey),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("in_progress"), // in_progress | completed
    response: jsonb("response"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    queue: text("queue").notNull(),
    jobName: text("job_name").notNull(),
    jobId: text("job_id").notNull(),
    status: text("status").notNull(), // active | completed | failed
    attempt: integer("attempt").notNull().default(1),
    orgId: uuid("org_id"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("job_runs_queue_idx").on(t.queue, t.startedAt), index("job_runs_status_idx").on(t.status, t.startedAt)],
);

export const files = pgTable(
  "files",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id),
    uploadedBy: uuid("uploaded_by").references(() => authUsers.id),
    ownerType: text("owner_type").notNull(), // boq_document | supplier_document | rfq | quotation | po | shipment | product_image | org_logo | receipt | generic
    ownerId: uuid("owner_id"),
    classification: text("classification").notNull().default("org_private"), // public | org_private | confidential
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    scanStatus: text("scan_status").notNull().default("not_scanned"),
    status: text("status").notNull().default("pending"), // pending (upload url issued) | ready | deleted
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("files_owner_idx").on(t.ownerType, t.ownerId),
    index("files_org_idx").on(t.orgId, t.createdAt),
    check("files_class_chk", sql`${t.classification} in ('public','org_private','confidential')`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    orgId: uuid("org_id"),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, string | number>>().notNull().default({}),
    link: text("link"),
    readAt: ts("read_at"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: id(),
    channel: text("channel").notNull(), // email
    recipient: text("recipient").notNull(),
    userId: uuid("user_id"),
    orgId: uuid("org_id"),
    template: text("template").notNull(),
    locale: text("locale").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | sent | failed | skipped_no_config
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [index("notification_deliveries_status_idx").on(t.status, t.createdAt)],
);

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    key: text("key").notNull(),
    locale: text("locale").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.key, t.locale] })],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // privacy_policy | terms | marketing | external_ai_processing
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("consents_user_idx").on(t.userId, t.kind)],
);

export const dataRequests = pgTable(
  "data_requests",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    kind: text("kind").notNull(), // export | deletion | correction
    status: text("status").notNull().default("pending"), // pending | processing | completed | rejected
    notes: text("notes"),
    resultFileId: uuid("result_file_id"),
    handledBy: uuid("handled_by"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [check("data_requests_kind_chk", sql`${t.kind} in ('export','deletion','correction')`)],
);

/** Versioned legal/content pages (terms, privacy, returns…). Drafts until legal review. */
export const contentPages = pgTable(
  "content_pages",
  {
    id: id(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishedAt: ts("published_at"),
    updatedBy: uuid("updated_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_pages_uq").on(t.slug, t.locale, t.version), check("content_pages_status_chk", sql`${t.status} in ('draft','published','archived')`)],
);
