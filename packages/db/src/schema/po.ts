import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { amount, createdAt, id, qty, ts, updatedAt } from "./_common";
import { organizations } from "./organizations";
import { files } from "./platform";
import { projects } from "./projects";
import { awards, quotationItems, rfqItems, rfqs } from "./rfq";

export const PO_APPROVAL = ["draft", "pending_approval", "approved", "rejected", "cancelled"] as const;
export const PO_FULFILLMENT = ["not_started", "preparing", "partially_fulfilled", "shipped", "partially_delivered", "delivered", "completed", "cancelled"] as const;

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    rfqId: uuid("rfq_id").references(() => rfqs.id),
    awardId: uuid("award_id").references(() => awards.id),
    code: text("code").notNull(),
    approvalStatus: text("approval_status").notNull().default("draft"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("not_started"),
    isDelayed: boolean("is_delayed").notNull().default(false),
    delayReason: text("delay_reason"),
    expectedDeliveryAt: ts("expected_delivery_at"),
    currency: text("currency").notNull().default("SAR"),
    subtotal: amount("subtotal").notNull().default("0"),
    discountTotal: amount("discount_total").notNull().default("0"),
    shippingAmount: amount("shipping_amount").notNull().default("0"),
    vatTotal: amount("vat_total").notNull().default("0"),
    total: amount("total").notNull().default("0"),
    paymentTerms: text("payment_terms"),
    deliveryTerms: text("delivery_terms"),
    deliveryCity: text("delivery_city"),
    deliveryAddress: text("delivery_address"),
    notes: text("notes"),
    verificationCode: text("verification_code").notNull(),
    pdfFileIdAr: uuid("pdf_file_id_ar").references(() => files.id),
    pdfFileIdEn: uuid("pdf_file_id_en").references(() => files.id),
    issuedAt: ts("issued_at"),
    acknowledgedAt: ts("acknowledged_at"),
    completedAt: ts("completed_at"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchase_orders_org_code_uq").on(t.orgId, t.code),
    uniqueIndex("purchase_orders_award_supplier_uq").on(t.awardId, t.supplierOrgId).where(sql`${t.awardId} is not null and ${t.approvalStatus} <> 'cancelled'`),
    uniqueIndex("purchase_orders_verification_uq").on(t.verificationCode),
    index("purchase_orders_org_idx").on(t.orgId, t.approvalStatus, t.createdAt),
    index("purchase_orders_supplier_idx").on(t.supplierOrgId, t.approvalStatus, t.createdAt),
    check("po_approval_chk", sql`${t.approvalStatus} in ('draft','pending_approval','approved','rejected','cancelled')`),
    check("po_fulfillment_chk", sql`${t.fulfillmentStatus} in ('not_started','preparing','partially_fulfilled','shipped','partially_delivered','delivered','completed','cancelled')`),
  ],
);

export const poItems = pgTable(
  "po_items",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    lineNo: integer("line_no").notNull(),
    rfqItemId: uuid("rfq_item_id").references(() => rfqItems.id),
    quotationItemId: uuid("quotation_item_id").references(() => quotationItems.id),
    description: text("description").notNull(),
    brand: text("brand"),
    model: text("model"),
    quantity: qty("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: qty("unit_price").notNull(),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
    lineNet: amount("line_net").notNull(),
    lineVat: amount("line_vat").notNull(),
    lineTotal: amount("line_total").notNull(),
    shippedQty: qty("shipped_qty").notNull().default("0"),
    receivedQty: qty("received_qty").notNull().default("0"),
    rejectedQty: qty("rejected_qty").notNull().default("0"),
  },
  (t) => [
    index("po_items_po_idx").on(t.poId, t.lineNo),
    check("po_items_qty_chk", sql`${t.quantity} > 0 and ${t.shippedQty} >= 0 and ${t.receivedQty} >= 0 and ${t.shippedQty} <= ${t.quantity} and ${t.receivedQty} + ${t.rejectedQty} <= ${t.shippedQty}`),
  ],
);

export const poEvents = pgTable(
  "po_events",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorOrgId: uuid("actor_org_id"),
    kind: text("kind").notNull(),
    visibleToSupplier: boolean("visible_to_supplier").notNull().default(true),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("po_events_po_idx").on(t.poId, t.createdAt)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    reference: text("reference").notNull(),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    shippedAt: ts("shipped_at").notNull().defaultNow(),
    expectedAt: ts("expected_at"),
    status: text("status").notNull().default("in_transit"), // in_transit | delivered | partially_received
    notes: text("notes"),
    attachmentFileIds: uuid("attachment_file_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("shipments_po_idx").on(t.poId)],
);

export const shipmentItems = pgTable(
  "shipment_items",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    poItemId: uuid("po_item_id")
      .notNull()
      .references(() => poItems.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    quantity: qty("quantity").notNull(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.poItemId] }), check("shipment_items_qty_chk", sql`${t.quantity} > 0`)],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: id(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAt: createdAt(),
    notes: text("notes"),
    attachmentFileIds: uuid("attachment_file_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [index("goods_receipts_po_idx").on(t.poId)],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    poItemId: uuid("po_item_id")
      .notNull()
      .references(() => poItems.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    quantityReceived: qty("quantity_received").notNull().default("0"),
    quantityRejected: qty("quantity_rejected").notNull().default("0"),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.receiptId, t.poItemId] }), check("gri_qty_chk", sql`${t.quantityReceived} >= 0 and ${t.quantityRejected} >= 0 and ${t.quantityReceived} + ${t.quantityRejected} > 0`)],
);
