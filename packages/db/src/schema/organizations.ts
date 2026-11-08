import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";

export type OrgSettings = {
  allowExternalAI?: boolean;
  aiMonthlyBudgetUsd?: string;
  requireMfaForApprovers?: boolean;
  defaultLocale?: "ar" | "en";
  rfqAllowRevisionsUntilClose?: boolean;
  preferredSupplierIds?: string[];
  blockedSupplierIds?: string[];
};

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    type: text("type").notNull(), // buyer | supplier | platform
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    slug: text("slug").notNull().unique(),
    activityType: text("activity_type"), // contractor | developer | om | consultant | factory | trading | other
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    vatNumber: text("vat_number"),
    crNumber: text("cr_number"),
    addressLine: text("address_line"),
    district: text("district"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("SA"),
    status: text("status").notNull().default("active"), // active | suspended
    settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
    isTestData: boolean("is_test_data").notNull().default(false),
    createdBy: uuid("created_by").references(() => authUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("organizations_type_chk", sql`${t.type} in ('buyer','supplier','platform')`),
    check("organizations_status_chk", sql`${t.status} in ('active','suspended')`),
    check("organizations_vat_chk", sql`${t.vatNumber} is null or ${t.vatNumber} ~ '^3[0-9]{13}3$'`),
    index("organizations_type_idx").on(t.type),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active | suspended | removed
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId),
    index("memberships_user_idx").on(t.userId),
    check("memberships_status_chk", sql`${t.status} in ('active','suspended','removed')`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }), // null = system template
    orgType: text("org_type").notNull(),
    key: text("key").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("roles_org_key_uq").on(t.orgId, t.key),
    uniqueIndex("roles_system_key_uq").on(t.orgType, t.key).where(sql`${t.orgId} is null`),
  ],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.roleId] }), index("membership_roles_role_idx").on(t.roleId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleIds: uuid("role_ids").array().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => authUsers.id),
    acceptedBy: uuid("accepted_by").references(() => authUsers.id),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invitations_org_idx").on(t.orgId, t.status),
    uniqueIndex("invitations_pending_uq").on(t.orgId, sql`lower(${t.email})`).where(sql`${t.status} = 'pending'`),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    userId: uuid("user_id").references(() => authUsers.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    district: text("district"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code"),
    nationalAddressCode: text("national_address_code"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("addresses_user_idx").on(t.userId),
    index("addresses_org_idx").on(t.orgId),
    check("addresses_owner_chk", sql`(${t.userId} is not null) <> (${t.orgId} is not null)`),
  ],
);

export const orgCounters = pgTable(
  "org_counters",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.kind, t.year] })],
);
