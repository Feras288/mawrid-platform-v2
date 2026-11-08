import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { amount, createdAt, id, qty, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";
import { boqItems, boqVersions, projects } from "./projects";
import { canonicalProducts, categories, type AttrValues } from "./catalog";
import { organizations } from "./organizations";
import { files } from "./platform";
import { supplierProducts } from "./suppliers";

export const RFQ_STATUSES = ["draft", "pending_review", "approved_for_sending", "sending", "open", "partially_responded", "under_evaluation", "revision_requested", "awarded", "closed", "cancelled"] as const;

export const rfqs = pgTable(
  "rfqs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    boqVersionId: uuid("boq_version_id").references(() => boqVersions.id),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    round: integer("round").notNull().default(1),
    closesAt: ts("closes_at"),
    revisionDeadline: ts("revision_deadline"),
    deliveryCity: text("delivery_city"),
    deliveryAddress: text("delivery_address"),
    requiredBy: ts("required_by"),
    deliveryTerms: text("delivery_terms"),
    paymentTerms: text("payment_terms"),
    currency: text("currency").notNull().default("SAR"),
    allowRevisions: boolean("allow_revisions").notNull().default(true),
    allowPartialQuotes: boolean("allow_partial_quotes").notNull().default(true),
    allowAlternatives: boolean("allow_alternatives").notNull().default(true),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by").references(() => authUsers.id),
    submittedAt: ts("submitted_at"),
    sentAt: ts("sent_at"),
    awardedAt: ts("awarded_at"),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rfqs_org_code_uq").on(t.orgId, t.code),
    index("rfqs_org_status_idx").on(t.orgId, t.status, t.createdAt),
    index("rfqs_closes_idx").on(t.status, t.closesAt),
    check("rfqs_status_chk", sql`${t.status} in ('draft','pending_review','approved_for_sending','sending','open','partially_responded','under_evaluation','revision_requested','awarded','closed','cancelled')`),
  ],
);

export const rfqItems = pgTable(
  "rfq_items",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    lineNo: integer("line_no").notNull(),
    boqItemId: uuid("boq_item_id").references(() => boqItems.id, { onDelete: "set null" }),
    canonicalProductId: uuid("canonical_product_id").references(() => canonicalProducts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    section: text("section"),
    description: text("description").notNull(),
    quantity: qty("quantity").notNull(),
    unit: text("unit").notNull(),
    attributes: jsonb("attributes").$type<AttrValues>().notNull().default({}),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("rfq_items_rfq_idx").on(t.rfqId, t.lineNo), check("rfq_items_qty_chk", sql`${t.quantity} > 0`)],
);

export const rfqRecipients = pgTable(
  "rfq_recipients",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(), // buyer
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    status: text("status").notNull().default("pending"), // pending | prepared | sent | failed | responded | declined
    round: integer("round").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: ts("last_attempt_at"),
    sentAt: ts("sent_at"),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    declineReason: text("decline_reason"),
    suggestedBy: text("suggested_by"), // manual | suggestion
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rfq_recipients_uq").on(t.rfqId, t.supplierOrgId),
    index("rfq_recipients_supplier_idx").on(t.supplierOrgId, t.status),
    check("rfq_recipients_status_chk", sql`${t.status} in ('pending','prepared','sent','failed','responded','declined')`),
  ],
);

export const rfqRecipientEvents = pgTable(
  "rfq_recipient_events",
  {
    id: id(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => rfqRecipients.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    kind: text("kind").notNull(), // prepared | sent | failed | resend | responded | declined | viewed
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("rfq_recipient_events_idx").on(t.recipientId, t.createdAt)],
);

export const rfqEvents = pgTable(
  "rfq_events",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("rfq_events_rfq_idx").on(t.rfqId, t.createdAt)],
);

export const rfqAttachments = pgTable(
  "rfq_attachments",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [index("rfq_attachments_rfq_idx").on(t.rfqId)],
);

export const quotations = pgTable(
  "quotations",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    buyerOrgId: uuid("buyer_org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    version: integer("version").notNull(),
    round: integer("round").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    status: text("status").notNull().default("draft"), // draft | submitted | superseded | withdrawn
    validUntil: ts("valid_until"),
    currency: text("currency").notNull().default("SAR"),
    leadTimeDays: integer("lead_time_days"),
    paymentTerms: text("payment_terms"),
    deliveryTerms: text("delivery_terms"),
    notes: text("notes"),
    exceptions: text("exceptions"),
    shippingAmount: amount("shipping_amount").notNull().default("0"),
    subtotal: amount("subtotal").notNull().default("0"),
    discountTotal: amount("discount_total").notNull().default("0"),
    vatTotal: amount("vat_total").notNull().default("0"),
    total: amount("total").notNull().default("0"),
    coveredLines: integer("covered_lines").notNull().default(0),
    submittedAt: ts("submitted_at"),
    submittedBy: uuid("submitted_by"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("quotations_version_uq").on(t.rfqId, t.supplierOrgId, t.version),
    uniqueIndex("quotations_current_uq").on(t.rfqId, t.supplierOrgId).where(sql`${t.isCurrent}`),
    index("quotations_buyer_idx").on(t.buyerOrgId, t.rfqId),
    check("quotations_status_chk", sql`${t.status} in ('draft','submitted','superseded','withdrawn')`),
  ],
);

export const quotationItems = pgTable(
  "quotation_items",
  {
    id: id(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    rfqItemId: uuid("rfq_item_id")
      .notNull()
      .references(() => rfqItems.id, { onDelete: "cascade" }),
    buyerOrgId: uuid("buyer_org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    offered: boolean("offered").notNull().default(true),
    quantity: qty("quantity"),
    unitPrice: qty("unit_price"),
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
    leadTimeDays: integer("lead_time_days"),
    supplierProductId: uuid("supplier_product_id").references(() => supplierProducts.id),
    isAlternative: boolean("is_alternative").notNull().default(false),
    alternativeDescription: text("alternative_description"),
    brand: text("brand"),
    model: text("model"),
    origin: text("origin"),
    exceptionNote: text("exception_note"),
    lineNet: amount("line_net").notNull().default("0"),
    lineVat: amount("line_vat").notNull().default("0"),
    lineTotal: amount("line_total").notNull().default("0"),
  },
  (t) => [
    uniqueIndex("quotation_items_uq").on(t.quotationId, t.rfqItemId),
    check("quotation_items_values_chk", sql`(not ${t.offered}) or (${t.unitPrice} >= 0 and ${t.quantity} > 0)`),
  ],
);

export const quotationAttachments = pgTable(
  "quotation_attachments",
  {
    id: id(),
    quotationId: uuid("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    buyerOrgId: uuid("buyer_org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    createdAt: createdAt(),
  },
  (t) => [index("quotation_attachments_q_idx").on(t.quotationId)],
);

export const evaluationScores = pgTable(
  "evaluation_scores",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    rfqItemId: uuid("rfq_item_id")
      .notNull()
      .references(() => rfqItems.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    technicalStatus: text("technical_status").notNull().default("not_evaluated"), // compliant | non_compliant | clarification | not_evaluated
    technicalNote: text("technical_note"),
    financialNote: text("financial_note"),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("evaluation_scores_uq").on(t.rfqId, t.rfqItemId, t.supplierOrgId)],
);

export const awards = pgTable(
  "awards",
  {
    id: id(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    status: text("status").notNull().default("draft"), // draft | pending_approval | approved | rejected | invalidated
    subjectHash: text("subject_hash"),
    total: amount("total").notNull().default("0"),
    notes: text("notes"),
    approvalRequestId: uuid("approval_request_id"),
    submittedBy: uuid("submitted_by"),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("awards_rfq_idx").on(t.rfqId, t.createdAt)],
);

/** Award decision per RFQ line. History kept: previous decisions get is_current = false. */
export const awardLines = pgTable(
  "award_lines",
  {
    id: id(),
    awardId: uuid("award_id")
      .notNull()
      .references(() => awards.id, { onDelete: "cascade" }),
    rfqId: uuid("rfq_id").notNull(),
    orgId: uuid("org_id").notNull(),
    rfqItemId: uuid("rfq_item_id")
      .notNull()
      .references(() => rfqItems.id),
    supplierOrgId: uuid("supplier_org_id"),
    quotationId: uuid("quotation_id").references(() => quotations.id),
    quotationItemId: uuid("quotation_item_id").references(() => quotationItems.id),
    quantity: qty("quantity"),
    unitPrice: qty("unit_price"),
    lineTotal: amount("line_total"),
    reason: text("reason"),
    isCurrent: boolean("is_current").notNull().default(true),
    decidedBy: uuid("decided_by"),
    decidedAt: createdAt(),
  },
  (t) => [index("award_lines_award_idx").on(t.awardId, t.isCurrent), uniqueIndex("award_lines_current_uq").on(t.awardId, t.rfqItemId).where(sql`${t.isCurrent}`)],
);

// ------------------------------------------------------------------------------------------ approvals

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    operation: text("operation").notNull(), // rfq_send | award | po_issue
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    minAmount: amount("min_amount"),
    maxAmount: amount("max_amount"),
    priority: integer("priority").notNull().default(0),
    distinctApprovers: boolean("distinct_approvers").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approval_policies_org_idx").on(t.orgId, t.operation, t.isActive),
    check("approval_policies_op_chk", sql`${t.operation} in ('rfq_send','award','po_issue')`),
    check("approval_policies_range_chk", sql`${t.minAmount} is null or ${t.maxAmount} is null or ${t.maxAmount} >= ${t.minAmount}`),
  ],
);

export const approvalPolicySteps = pgTable(
  "approval_policy_steps",
  {
    id: id(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => approvalPolicies.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    stepOrder: integer("step_order").notNull(), // steps sharing an order run in parallel
    name: text("name").notNull(),
    requiredRoleKey: text("required_role_key"),
    requiredPermission: text("required_permission").notNull().default("approval.decide"),
    minApprovals: integer("min_approvals").notNull().default(1),
  },
  (t) => [index("approval_policy_steps_idx").on(t.policyId, t.stepOrder), check("approval_steps_min_chk", sql`${t.minApprovals} >= 1`)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    subjectType: text("subject_type").notNull(), // rfq | award | purchase_order
    subjectId: uuid("subject_id").notNull(),
    subjectHash: text("subject_hash").notNull(),
    subjectLabel: text("subject_label"),
    amount: amount("amount"),
    currency: text("currency").notNull().default("SAR"),
    policyId: uuid("policy_id").references(() => approvalPolicies.id),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | cancelled | invalidated
    requestedBy: uuid("requested_by").notNull(),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approval_requests_org_idx").on(t.orgId, t.status, t.createdAt), index("approval_requests_subject_idx").on(t.subjectType, t.subjectId)],
);

export const approvalRequestSteps = pgTable(
  "approval_request_steps",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    stepOrder: integer("step_order").notNull(),
    name: text("name").notNull(),
    requiredRoleKey: text("required_role_key"),
    requiredPermission: text("required_permission").notNull(),
    minApprovals: integer("min_approvals").notNull(),
    status: text("status").notNull().default("waiting"), // waiting | active | approved | rejected | cancelled
    decidedAt: ts("decided_at"),
  },
  (t) => [index("approval_request_steps_idx").on(t.requestId, t.stepOrder)],
);

export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => approvalRequestSteps.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    decision: text("decision").notNull(), // approve | reject
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approval_decisions_uq").on(t.stepId, t.userId), check("approval_decisions_chk", sql`${t.decision} in ('approve','reject')`)],
);
