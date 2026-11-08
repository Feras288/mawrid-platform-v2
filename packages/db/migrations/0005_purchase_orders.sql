CREATE TABLE "goods_receipt_items" (
	"receipt_id" uuid NOT NULL,
	"po_item_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"quantity_received" numeric(18, 4) DEFAULT '0' NOT NULL,
	"quantity_rejected" numeric(18, 4) DEFAULT '0' NOT NULL,
	"note" text,
	CONSTRAINT "goods_receipt_items_receipt_id_po_item_id_pk" PRIMARY KEY("receipt_id","po_item_id"),
	CONSTRAINT "gri_qty_chk" CHECK ("goods_receipt_items"."quantity_received" >= 0 and "goods_receipt_items"."quantity_rejected" >= 0 and "goods_receipt_items"."quantity_received" + "goods_receipt_items"."quantity_rejected" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"shipment_id" uuid,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"received_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"attachment_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_org_id" uuid,
	"kind" text NOT NULL,
	"visible_to_supplier" boolean DEFAULT true NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"rfq_item_id" uuid,
	"quotation_item_id" uuid,
	"description" text NOT NULL,
	"brand" text,
	"model" text,
	"quantity" numeric(18, 4) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"line_net" numeric(18, 2) NOT NULL,
	"line_vat" numeric(18, 2) NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"shipped_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"received_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"rejected_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "po_items_qty_chk" CHECK ("po_items"."quantity" > 0 and "po_items"."shipped_qty" >= 0 and "po_items"."received_qty" >= 0 and "po_items"."shipped_qty" <= "po_items"."quantity" and "po_items"."received_qty" + "po_items"."rejected_qty" <= "po_items"."shipped_qty")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"project_id" uuid,
	"rfq_id" uuid,
	"award_id" uuid,
	"code" text NOT NULL,
	"approval_status" text DEFAULT 'draft' NOT NULL,
	"fulfillment_status" text DEFAULT 'not_started' NOT NULL,
	"is_delayed" boolean DEFAULT false NOT NULL,
	"delay_reason" text,
	"expected_delivery_at" timestamp with time zone,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"payment_terms" text,
	"delivery_terms" text,
	"delivery_city" text,
	"delivery_address" text,
	"notes" text,
	"verification_code" text NOT NULL,
	"pdf_file_id_ar" uuid,
	"pdf_file_id_en" uuid,
	"issued_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "po_approval_chk" CHECK ("purchase_orders"."approval_status" in ('draft','pending_approval','approved','rejected','cancelled')),
	CONSTRAINT "po_fulfillment_chk" CHECK ("purchase_orders"."fulfillment_status" in ('not_started','preparing','partially_fulfilled','shipped','partially_delivered','delivered','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"shipment_id" uuid NOT NULL,
	"po_item_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	CONSTRAINT "shipment_items_shipment_id_po_item_id_pk" PRIMARY KEY("shipment_id","po_item_id"),
	CONSTRAINT "shipment_items_qty_chk" CHECK ("shipment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_at" timestamp with time zone,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"notes" text,
	"attachment_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_po_item_id_po_items_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_rfq_item_id_rfq_items_id_fk" FOREIGN KEY ("rfq_item_id") REFERENCES "public"."rfq_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_quotation_item_id_quotation_items_id_fk" FOREIGN KEY ("quotation_item_id") REFERENCES "public"."quotation_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pdf_file_id_ar_files_id_fk" FOREIGN KEY ("pdf_file_id_ar") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_pdf_file_id_en_files_id_fk" FOREIGN KEY ("pdf_file_id_en") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_po_item_id_po_items_id_fk" FOREIGN KEY ("po_item_id") REFERENCES "public"."po_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "po_events_po_idx" ON "po_events" USING btree ("po_id","created_at");--> statement-breakpoint
CREATE INDEX "po_items_po_idx" ON "po_items" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_code_uq" ON "purchase_orders" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_award_supplier_uq" ON "purchase_orders" USING btree ("award_id","supplier_org_id") WHERE "purchase_orders"."award_id" is not null and "purchase_orders"."approval_status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_verification_uq" ON "purchase_orders" USING btree ("verification_code");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_idx" ON "purchase_orders" USING btree ("org_id","approval_status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_org_id","approval_status","created_at");--> statement-breakpoint
CREATE INDEX "shipments_po_idx" ON "shipments" USING btree ("po_id");