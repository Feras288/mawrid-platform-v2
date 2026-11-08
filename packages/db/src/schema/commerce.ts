import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgSequence, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { amount, createdAt, id, qty, ts, updatedAt } from "./_common";
import { authUsers } from "./auth";
import { organizations } from "./organizations";
import { supplierProducts } from "./suppliers";

/**
 * B2C / B2B store. A customer is a user buying personally (org_id null) or on behalf of a buyer org.
 * Orders are split into one order_group per supplier (seller of record). Money amounts are separated
 * into typed order_charges (goods, shipping, VAT, commission, supplier payable). Payments never
 * trigger real settlements: the ledger only records balances; payouts are disabled by flag.
 */

export const storeOrderSeq = pgSequence("store_order_seq", { startWith: 1, increment: 1 });

export const carts = pgTable(
  "carts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active | converted | abandoned
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("carts_active_uq").on(t.userId, sql`coalesce(${t.orgId}, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`${t.status} = 'active'`),
    check("carts_status_chk", sql`${t.status} in ('active','converted','abandoned')`),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    supplierProductId: uuid("supplier_product_id")
      .notNull()
      .references(() => supplierProducts.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    quantity: qty("quantity").notNull(),
    /** unit price (ex-VAT) seen when added — used to tell the customer that a price changed */
    seenUnitPrice: qty("seen_unit_price"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("cart_items_uq").on(t.cartId, t.supplierProductId), check("cart_items_qty_chk", sql`${t.quantity} > 0`)],
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    supplierProductId: uuid("supplier_product_id")
      .notNull()
      .references(() => supplierProducts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.supplierProductId] })],
);

/** Delivery zones; supplier_org_id null = platform default zone used when a supplier has none. */
export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: id(),
    supplierOrgId: uuid("supplier_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    /** matches every city when true */
    nationwide: boolean("nationwide").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("shipping_zones_supplier_idx").on(t.supplierOrgId)],
);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: id(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id"),
    method: text("method").notNull(), // standard | express | pickup
    fee: amount("fee").notNull(), // ex-VAT
    freeOver: amount("free_over"), // goods subtotal (ex-VAT) at/above which shipping is free
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
    etaMinDays: integer("eta_min_days").notNull().default(1),
    etaMaxDays: integer("eta_max_days").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shipping_rates_uq").on(t.zoneId, t.method),
    check("shipping_rates_method_chk", sql`${t.method} in ('standard','express','pickup')`),
    check("shipping_rates_fee_chk", sql`${t.fee} >= 0 and ${t.etaMinDays} >= 0 and ${t.etaMaxDays} >= ${t.etaMinDays}`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    code: text("code").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    orgId: uuid("org_id").references(() => organizations.id),
    /** pending_payment | placed | in_progress | completed | cancelled | payment_failed | expired */
    status: text("status").notNull().default("pending_payment"),
    /** unpaid | pending | paid | partially_refunded | refunded | failed */
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    paymentMethod: text("payment_method").notNull(), // card | bank_transfer
    currency: text("currency").notNull().default("SAR"),
    goodsNet: amount("goods_net").notNull(),
    discountTotal: amount("discount_total").notNull().default("0"),
    shippingNet: amount("shipping_net").notNull(),
    vatTotal: amount("vat_total").notNull(),
    total: amount("total").notNull(),
    refundedTotal: amount("refunded_total").notNull().default("0"),
    shippingAddress: jsonb("shipping_address").$type<Record<string, string | null>>().notNull(),
    buyerName: text("buyer_name"),
    buyerVatNumber: text("buyer_vat_number"),
    idempotencyKey: text("idempotency_key").notNull(),
    termsVersion: text("terms_version"),
    expiresAt: ts("expires_at"),
    placedAt: ts("placed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    isTestData: boolean("is_test_data").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_code_uq").on(t.code),
    uniqueIndex("orders_idem_uq").on(t.userId, t.idempotencyKey),
    index("orders_user_idx").on(t.userId, t.createdAt),
    index("orders_org_idx").on(t.orgId, t.createdAt),
    index("orders_status_idx").on(t.status, t.expiresAt),
    check("orders_status_chk", sql`${t.status} in ('pending_payment','placed','in_progress','completed','cancelled','payment_failed','expired')`),
    check("orders_payment_chk", sql`${t.paymentStatus} in ('unpaid','pending','paid','partially_refunded','refunded','failed')`),
    check("orders_amounts_chk", sql`${t.total} >= 0 and ${t.refundedTotal} >= 0 and ${t.refundedTotal} <= ${t.total}`),
  ],
);

/** One fulfilment group per supplier inside an order, with its own status. */
export const orderGroups = pgTable(
  "order_groups",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id),
    /** awaiting_payment | confirmed | preparing | shipped | delivered | completed | cancelled */
    status: text("status").notNull().default("awaiting_payment"),
    shippingMethod: text("shipping_method").notNull(),
    shippingNet: amount("shipping_net").notNull(),
    shippingVat: amount("shipping_vat").notNull(),
    goodsNet: amount("goods_net").notNull(),
    goodsVat: amount("goods_vat").notNull(),
    total: amount("total").notNull(),
    commissionNet: amount("commission_net").notNull().default("0"),
    commissionVat: amount("commission_vat").notNull().default("0"),
    supplierPayable: amount("supplier_payable").notNull(),
    refundedTotal: amount("refunded_total").notNull().default("0"),
    /** delivery snapshot so the supplier never needs to read the parent order */
    deliveryAddress: jsonb("delivery_address").$type<Record<string, string | null>>().notNull(),
    etaMinDays: integer("eta_min_days"),
    etaMaxDays: integer("eta_max_days"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    confirmedAt: ts("confirmed_at"),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    cancelledBy: text("cancelled_by"), // customer | supplier | system
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("order_groups_code_uq").on(t.code),
    uniqueIndex("order_groups_order_supplier_uq").on(t.orderId, t.supplierOrgId),
    index("order_groups_supplier_idx").on(t.supplierOrgId, t.status, t.createdAt),
    check("order_groups_status_chk", sql`${t.status} in ('awaiting_payment','confirmed','preparing','shipped','delivered','completed','cancelled')`),
    check("order_groups_refund_chk", sql`${t.refundedTotal} >= 0 and ${t.refundedTotal} <= ${t.total}`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orderGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    supplierProductId: uuid("supplier_product_id")
      .notNull()
      .references(() => supplierProducts.id),
    sku: text("sku").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    unit: text("unit").notNull(),
    quantity: qty("quantity").notNull(),
    unitPrice: qty("unit_price").notNull(), // ex-VAT effective
    priceListId: uuid("price_list_id"),
    priceKind: text("price_kind"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull(),
    lineNet: amount("line_net").notNull(),
    lineVat: amount("line_vat").notNull(),
    lineTotal: amount("line_total").notNull(),
    returnedQty: qty("returned_qty").notNull().default("0"),
  },
  (t) => [
    index("order_lines_group_idx").on(t.groupId),
    index("order_lines_product_idx").on(t.supplierProductId),
    check("order_lines_qty_chk", sql`${t.quantity} > 0 and ${t.returnedQty} >= 0 and ${t.returnedQty} <= ${t.quantity}`),
  ],
);

/** Typed money components; customer-facing kinds vs platform/supplier-facing kinds are separated. */
export const orderCharges = pgTable(
  "order_charges",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => orderGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id"),
    /** goods | discount | shipping | goods_vat | shipping_vat | commission | commission_vat | supplier_payable */
    kind: text("kind").notNull(),
    amount: amount("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_charges_order_idx").on(t.orderId),
    check("order_charges_kind_chk", sql`${t.kind} in ('goods','discount','shipping','goods_vat','shipping_vat','commission','commission_vat','supplier_payable')`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    groupId: uuid("group_id"),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id"),
    kind: text("kind").notNull(),
    actorUserId: uuid("actor_user_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    provider: text("provider").notNull(), // test | moyasar | bank_transfer
    providerRef: text("provider_ref"),
    /** id of the captured payment at the provider (refunds target it) */
    providerPaymentId: text("provider_payment_id"),
    amount: amount("amount").notNull(),
    currency: text("currency").notNull().default("SAR"),
    /** created | pending | succeeded | failed | expired | cancelled */
    status: text("status").notNull().default("created"),
    refundedAmount: amount("refunded_amount").notNull().default("0"),
    redirectUrl: text("redirect_url"),
    instructions: jsonb("instructions").$type<Record<string, string>>(),
    failureReason: text("failure_reason"),
    expiresAt: ts("expires_at"),
    succeededAt: ts("succeeded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_intents_order_idx").on(t.orderId),
    uniqueIndex("payment_intents_ref_uq").on(t.provider, t.providerRef),
    check("payment_intents_status_chk", sql`${t.status} in ('created','pending','succeeded','failed','expired','cancelled')`),
    check("payment_intents_refund_chk", sql`${t.refundedAmount} >= 0 and ${t.refundedAmount} <= ${t.amount}`),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: id(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // create | sync | webhook | refund | manual
    status: text("status").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("payment_attempts_intent_idx").on(t.intentId, t.createdAt)],
);

/** Raw provider webhooks (deduplicated by provider event id); system-only. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("received"), // received | processed | ignored | failed
    error: text("error"),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payment_webhook_events_uq").on(t.provider, t.eventId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => orderGroups.id),
    intentId: uuid("intent_id").references(() => paymentIntents.id),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id"),
    amount: amount("amount").notNull(),
    reason: text("reason").notNull(), // cancellation | return | adjustment
    status: text("status").notNull().default("pending"), // pending | succeeded | failed | manual_required
    providerRef: text("provider_ref"),
    idempotencyKey: text("idempotency_key").notNull(),
    failureReason: text("failure_reason"),
    requestedBy: uuid("requested_by"),
    createdAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("refunds_idem_uq").on(t.idempotencyKey),
    index("refunds_order_idx").on(t.orderId),
    check("refunds_amount_chk", sql`${t.amount} > 0`),
    check("refunds_status_chk", sql`${t.status} in ('pending','succeeded','failed','manual_required')`),
  ],
);

export const returnRequests = pgTable(
  "return_requests",
  {
    id: id(),
    code: text("code").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orderGroups.id),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    /** requested | approved | rejected | received | refunded | cancelled */
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    lines: jsonb("lines").$type<{ orderLineId: string; quantity: string }[]>().notNull(),
    amount: amount("amount").notNull(),
    decisionNote: text("decision_note"),
    refundId: uuid("refund_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("return_requests_code_uq").on(t.code),
    index("return_requests_supplier_idx").on(t.supplierOrgId, t.status),
    index("return_requests_order_idx").on(t.orderId),
    check("return_requests_status_chk", sql`${t.status} in ('requested','approved','rejected','received','refunded','cancelled')`),
  ],
);

/**
 * Double-entry balances for reconciliation only (no money moves). Accounts:
 * platform_clearing, supplier_payable, commission_revenue, vat_payable.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    journalId: uuid("journal_id").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    groupId: uuid("group_id"),
    supplierOrgId: uuid("supplier_org_id"),
    account: text("account").notNull(),
    debit: amount("debit").notNull().default("0"),
    credit: amount("credit").notNull().default("0"),
    currency: text("currency").notNull().default("SAR"),
    memo: text("memo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_journal_idx").on(t.journalId),
    index("ledger_supplier_idx").on(t.supplierOrgId, t.account),
    check("ledger_account_chk", sql`${t.account} in ('platform_clearing','supplier_payable','commission_revenue','vat_payable')`),
    check("ledger_amount_chk", sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0) <> (${t.credit} = 0)`),
  ],
);

/** Tax invoices issued by the supplier (seller of record) per order group — ZATCA phase-1 data + QR. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    kind: text("kind").notNull(), // simplified | standard | credit_note
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orderGroups.id),
    userId: uuid("user_id").notNull(),
    orgId: uuid("org_id"),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    sellerName: text("seller_name").notNull(),
    sellerVatNumber: text("seller_vat_number"),
    buyerName: text("buyer_name"),
    buyerVatNumber: text("buyer_vat_number"),
    issuedAt: ts("issued_at").notNull(),
    netTotal: amount("net_total").notNull(),
    vatTotal: amount("vat_total").notNull(),
    total: amount("total").notNull(),
    qrTlv: text("qr_tlv").notNull(),
    originalInvoiceId: uuid("original_invoice_id"),
    /** not_submitted — e-invoicing clearance/reporting (Fatoora) is Integration Pending */
    zatcaStatus: text("zatca_status").notNull().default("not_submitted"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_number_uq").on(t.supplierOrgId, t.number), index("invoices_group_idx").on(t.groupId)],
);
