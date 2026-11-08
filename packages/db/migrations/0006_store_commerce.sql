CREATE SEQUENCE "public"."store_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"seen_unit_price" numeric(18, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_qty_chk" CHECK ("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_status_chk" CHECK ("carts"."status" in ('active','converted','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid NOT NULL,
	"seller_name" text NOT NULL,
	"seller_vat_number" text,
	"buyer_name" text,
	"buyer_vat_number" text,
	"issued_at" timestamp with time zone NOT NULL,
	"net_total" numeric(18, 2) NOT NULL,
	"vat_total" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"qr_tlv" text NOT NULL,
	"original_invoice_id" uuid,
	"zatca_status" text DEFAULT 'not_submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"journal_id" uuid NOT NULL,
	"order_id" uuid,
	"group_id" uuid,
	"supplier_org_id" uuid,
	"account" text NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"memo" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_chk" CHECK ("ledger_entries"."account" in ('platform_clearing','supplier_payable','commission_revenue','vat_payable')),
	CONSTRAINT "ledger_amount_chk" CHECK ("ledger_entries"."debit" >= 0 and "ledger_entries"."credit" >= 0 and ("ledger_entries"."debit" = 0) <> ("ledger_entries"."credit" = 0))
);
--> statement-breakpoint
CREATE TABLE "order_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid,
	"kind" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_charges_kind_chk" CHECK ("order_charges"."kind" in ('goods','discount','shipping','goods_vat','shipping_vat','commission','commission_vat','supplier_payable'))
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"shipping_method" text NOT NULL,
	"shipping_net" numeric(18, 2) NOT NULL,
	"shipping_vat" numeric(18, 2) NOT NULL,
	"goods_net" numeric(18, 2) NOT NULL,
	"goods_vat" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"commission_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"commission_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"supplier_payable" numeric(18, 2) NOT NULL,
	"refunded_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"delivery_address" jsonb NOT NULL,
	"eta_min_days" integer,
	"eta_max_days" integer,
	"carrier" text,
	"tracking_number" text,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_groups_status_chk" CHECK ("order_groups"."status" in ('awaiting_payment','confirmed','preparing','shipped','delivered','completed','cancelled')),
	CONSTRAINT "order_groups_refund_chk" CHECK ("order_groups"."refunded_total" >= 0 and "order_groups"."refunded_total" <= "order_groups"."total")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"price_list_id" uuid,
	"price_kind" text,
	"vat_rate" numeric(5, 4) NOT NULL,
	"line_net" numeric(18, 2) NOT NULL,
	"line_vat" numeric(18, 2) NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"returned_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "order_lines_qty_chk" CHECK ("order_lines"."quantity" > 0 and "order_lines"."returned_qty" >= 0 and "order_lines"."returned_qty" <= "order_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_method" text NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"goods_net" numeric(18, 2) NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"shipping_net" numeric(18, 2) NOT NULL,
	"vat_total" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"refunded_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"buyer_name" text,
	"buyer_vat_number" text,
	"idempotency_key" text NOT NULL,
	"terms_version" text,
	"expires_at" timestamp with time zone,
	"placed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"is_test_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_chk" CHECK ("orders"."status" in ('pending_payment','placed','in_progress','completed','cancelled','payment_failed','expired')),
	CONSTRAINT "orders_payment_chk" CHECK ("orders"."payment_status" in ('unpaid','pending','paid','partially_refunded','refunded','failed')),
	CONSTRAINT "orders_amounts_chk" CHECK ("orders"."total" >= 0 and "orders"."refunded_total" >= 0 and "orders"."refunded_total" <= "orders"."total")
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"provider" text NOT NULL,
	"provider_ref" text,
	"provider_payment_id" text,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"refunded_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"redirect_url" text,
	"instructions" jsonb,
	"failure_reason" text,
	"expires_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_status_chk" CHECK ("payment_intents"."status" in ('created','pending','succeeded','failed','expired','cancelled')),
	CONSTRAINT "payment_intents_refund_chk" CHECK ("payment_intents"."refunded_amount" >= 0 and "payment_intents"."refunded_amount" <= "payment_intents"."amount")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"signature_valid" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid,
	"intent_id" uuid,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "refunds_amount_chk" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_status_chk" CHECK ("refunds"."status" in ('pending','succeeded','failed','manual_required'))
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"order_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"supplier_org_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason" text NOT NULL,
	"lines" jsonb NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"decision_note" text,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_requests_status_chk" CHECK ("return_requests"."status" in ('requested','approved','rejected','received','refunded','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"supplier_org_id" uuid,
	"method" text NOT NULL,
	"fee" numeric(18, 2) NOT NULL,
	"free_over" numeric(18, 2),
	"vat_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"eta_min_days" integer DEFAULT 1 NOT NULL,
	"eta_max_days" integer DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_method_chk" CHECK ("shipping_rates"."method" in ('standard','express','pickup')),
	CONSTRAINT "shipping_rates_fee_chk" CHECK ("shipping_rates"."fee" >= 0 and "shipping_rates"."eta_min_days" >= 0 and "shipping_rates"."eta_max_days" >= "shipping_rates"."eta_min_days")
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_org_id" uuid,
	"name" text NOT NULL,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"nationwide" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"user_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_user_id_supplier_product_id_pk" PRIMARY KEY("user_id","supplier_product_id")
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_charges" ADD CONSTRAINT "order_charges_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_uq" ON "cart_items" USING btree ("cart_id","supplier_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_active_uq" ON "carts" USING btree ("user_id",coalesce("org_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "carts"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("supplier_org_id","number");--> statement-breakpoint
CREATE INDEX "invoices_group_idx" ON "invoices" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "ledger_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_supplier_idx" ON "ledger_entries" USING btree ("supplier_org_id","account");--> statement-breakpoint
CREATE INDEX "order_charges_order_idx" ON "order_charges" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_code_uq" ON "order_groups" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_order_supplier_uq" ON "order_groups" USING btree ("order_id","supplier_org_id");--> statement-breakpoint
CREATE INDEX "order_groups_supplier_idx" ON "order_groups" USING btree ("supplier_org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_group_idx" ON "order_lines" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("supplier_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_uq" ON "orders" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idem_uq" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_org_idx" ON "orders" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_intent_idx" ON "payment_attempts" USING btree ("intent_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_intents_order_idx" ON "payment_intents" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_ref_uq" ON "payment_intents" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idem_uq" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_code_uq" ON "return_requests" USING btree ("code");--> statement-breakpoint
CREATE INDEX "return_requests_supplier_idx" ON "return_requests" USING btree ("supplier_org_id","status");--> statement-breakpoint
CREATE INDEX "return_requests_order_idx" ON "return_requests" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_rates_uq" ON "shipping_rates" USING btree ("zone_id","method");--> statement-breakpoint
CREATE INDEX "shipping_zones_supplier_idx" ON "shipping_zones" USING btree ("supplier_org_id");