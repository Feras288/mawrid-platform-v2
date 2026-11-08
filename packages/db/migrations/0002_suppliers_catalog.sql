CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"data_type" text NOT NULL,
	"unit" text,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_key_unique" UNIQUE("key"),
	CONSTRAINT "attribute_type_chk" CHECK ("attribute_definitions"."data_type" in ('number','text','enum','boolean'))
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "canonical_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"base_unit" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"standards" text[] DEFAULT '{}'::text[] NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"merged_into_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_status_chk" CHECK ("canonical_products"."status" in ('draft','active','archived'))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"system" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_system_chk" CHECK ("categories"."system" in ('electrical','plumbing','hvac','fire_fighting','fire_alarm','mechanical_equipment','building_materials','low_current','infrastructure'))
);
--> statement-breakpoint
CREATE TABLE "category_attributes" (
	"category_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_attributes_category_id_attribute_id_pk" PRIMARY KEY("category_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"code" text PRIMARY KEY NOT NULL,
	"region_code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text DEFAULT 'canonical_product' NOT NULL,
	"a_id" uuid NOT NULL,
	"b_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"dimension" text NOT NULL,
	"to_base" numeric(24, 10) DEFAULT '1' NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"org_id" uuid,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"status" text NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entity_id" uuid
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ok_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_levels" (
	"warehouse_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"on_hand" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reserved" numeric(18, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_warehouse_id_supplier_product_id_pk" PRIMARY KEY("warehouse_id","supplier_product_id"),
	CONSTRAINT "inventory_nonneg_chk" CHECK ("inventory_levels"."on_hand" >= 0 and "inventory_levels"."reserved" >= 0 and "inventory_levels"."reserved" <= "inventory_levels"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"reference" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_list_id" uuid NOT NULL,
	"supplier_product_id" uuid NOT NULL,
	"min_qty" numeric(18, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_items_price_chk" CHECK ("price_list_items"."unit_price" >= 0 and "price_list_items"."min_qty" > 0 and "price_list_items"."discount_pct" >= 0 and "price_list_items"."discount_pct" < 100)
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"buyer_org_id" uuid,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"prices_include_vat" boolean DEFAULT false NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_kind_chk" CHECK ("price_lists"."kind" in ('retail','enterprise','org_specific','regional')),
	CONSTRAINT "price_lists_buyer_chk" CHECK (("price_lists"."kind" = 'org_specific') = ("price_lists"."buyer_org_id" is not null)),
	CONSTRAINT "price_lists_validity_chk" CHECK ("price_lists"."valid_to" is null or "price_lists"."valid_from" is null or "price_lists"."valid_to" > "price_lists"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "supplier_categories" (
	"org_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "supplier_categories_org_id_category_id_pk" PRIMARY KEY("org_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"document_number" text,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"reviewer_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_doc_status_chk" CHECK ("supplier_documents"."status" in ('uploaded','verified','rejected','expired'))
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"canonical_product_id" uuid,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"match_source" text,
	"match_score" numeric(18, 2),
	"category_id" uuid NOT NULL,
	"brand_id" uuid,
	"brand_name" text,
	"model" text,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"country_of_origin" text,
	"certifications" text[] DEFAULT '{}'::text[] NOT NULL,
	"sale_unit" text NOT NULL,
	"pack_size" numeric(18, 4) DEFAULT '1' NOT NULL,
	"moq" numeric(18, 4) DEFAULT '1' NOT NULL,
	"order_increment" numeric(18, 4) DEFAULT '1' NOT NULL,
	"lead_time_days" integer,
	"vat_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"image_file_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_products_status_chk" CHECK ("supplier_products"."status" in ('draft','active','inactive')),
	CONSTRAINT "supplier_products_match_chk" CHECK ("supplier_products"."match_status" in ('unmatched','suggested','confirmed','rejected')),
	CONSTRAINT "supplier_products_qty_chk" CHECK ("supplier_products"."pack_size" > 0 and "supplier_products"."moq" > 0 and "supplier_products"."order_increment" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"status_reason" text,
	"description_ar" text,
	"description_en" text,
	"established_year" integer,
	"employees_range" text,
	"logo_file_id" uuid,
	"coverage_regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"coverage_cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"delivers_nationwide" boolean DEFAULT false NOT NULL,
	"min_order_value" numeric(18, 2),
	"default_lead_time_days" integer,
	"payment_terms" text,
	"accepts_store_orders" boolean DEFAULT true NOT NULL,
	"accepts_rfqs" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_status_chk" CHECK ("supplier_profiles"."status" in ('new','pending_verification','under_review','approved','suspended','rejected'))
);
--> statement-breakpoint
CREATE TABLE "supplier_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"region" text,
	"address_line" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canonical_products" ADD CONSTRAINT "canonical_products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_products" ADD CONSTRAINT "canonical_products_base_unit_units_code_fk" FOREIGN KEY ("base_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_id_attribute_definitions_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_rows" ADD CONSTRAINT "import_batch_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_sale_unit_units_code_fk" FOREIGN KEY ("sale_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_reviewed_by_auth_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_status_history" ADD CONSTRAINT "supplier_status_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_category_idx" ON "canonical_products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "canonical_name_trgm_idx" ON "canonical_products" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "canonical_attrs_idx" ON "canonical_products" USING gin ("attributes");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_system_idx" ON "categories" USING btree ("system");--> statement-breakpoint
CREATE INDEX "cities_region_idx" ON "cities" USING btree ("region_code");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_uq" ON "duplicate_candidates" USING btree ("entity_type","a_id","b_id");--> statement-breakpoint
CREATE INDEX "duplicate_status_idx" ON "duplicate_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_batch_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "import_batches_org_idx" ON "import_batches" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_product_idx" ON "inventory_levels" USING btree ("supplier_product_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("supplier_product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_uq" ON "price_list_items" USING btree ("price_list_id","supplier_product_id","min_qty");--> statement-breakpoint
CREATE INDEX "price_list_items_product_idx" ON "price_list_items" USING btree ("supplier_product_id");--> statement-breakpoint
CREATE INDEX "price_lists_org_idx" ON "price_lists" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "supplier_categories_cat_idx" ON "supplier_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "supplier_documents_org_idx" ON "supplier_documents" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_sku_uq" ON "supplier_products" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "supplier_products_canonical_idx" ON "supplier_products" USING btree ("canonical_product_id");--> statement-breakpoint
CREATE INDEX "supplier_products_category_idx" ON "supplier_products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "supplier_products_name_trgm_idx" ON "supplier_products" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "supplier_products_store_idx" ON "supplier_products" USING btree ("is_published","status");--> statement-breakpoint
CREATE INDEX "supplier_profiles_status_idx" ON "supplier_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "supplier_status_history_org_idx" ON "supplier_status_history" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "warehouses_org_idx" ON "warehouses" USING btree ("org_id");