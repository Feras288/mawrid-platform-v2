CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"threshold_pct" numeric(6, 2) NOT NULL,
	"direction" text DEFAULT 'any' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"last_value" numeric(20, 6),
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_alerts_dir_chk" CHECK ("price_alerts"."direction" in ('up','down','any')),
	CONSTRAINT "price_alerts_threshold_chk" CHECK ("price_alerts"."threshold_pct" > 0 and "price_alerts"."threshold_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "price_index_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"window_days" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"base_unit" text NOT NULL,
	"region" text,
	"n" integer NOT NULL,
	"org_count" integer NOT NULL,
	"outliers_excluded" integer DEFAULT 0 NOT NULL,
	"median" numeric(20, 6),
	"p25" numeric(20, 6),
	"p75" numeric(20, 6),
	"min" numeric(20, 6),
	"max" numeric(20, 6),
	"mean" numeric(20, 6),
	"quality" text NOT NULL,
	"published" boolean NOT NULL,
	"suppressed_reason" text,
	"method_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"canonical_product_id" uuid,
	"category_id" uuid,
	"supplier_org_id" uuid,
	"buyer_org_id" uuid,
	"base_unit" text NOT NULL,
	"quantity_base" numeric(18, 4) NOT NULL,
	"unit_price_base" numeric(20, 6) NOT NULL,
	"city" text,
	"region" text,
	"is_test_data" boolean DEFAULT false NOT NULL,
	"is_outlier" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_obs_kind_chk" CHECK ("price_observations"."kind" in ('catalog_retail','catalog_enterprise','store_sale','rfq_quote','rfq_award','po')),
	CONSTRAINT "price_obs_price_chk" CHECK ("price_observations"."unit_price_base" > 0 and "price_observations"."quantity_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_user_idx" ON "price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_snap_uq" ON "price_index_snapshots" USING btree ("as_of","subject_type","subject_id","kind","base_unit",coalesce("region", ''));--> statement-breakpoint
CREATE INDEX "price_snap_subject_idx" ON "price_index_snapshots" USING btree ("subject_type","subject_id","kind","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "price_obs_source_uq" ON "price_observations" USING btree ("kind","source_type","source_id");--> statement-breakpoint
CREATE INDEX "price_obs_canonical_idx" ON "price_observations" USING btree ("canonical_product_id","kind","observed_at");--> statement-breakpoint
CREATE INDEX "price_obs_category_idx" ON "price_observations" USING btree ("category_id","kind","observed_at");