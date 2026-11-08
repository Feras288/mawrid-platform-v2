CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"document_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"file_id" uuid,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"status_detail" text,
	"column_mapping" jsonb,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"use_ai" boolean DEFAULT false NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_item_matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"canonical_product_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_item_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_code" text,
	"section" text,
	"system" text,
	"category_id" uuid,
	"raw_text" text NOT NULL,
	"description" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"quantity" numeric(18, 4),
	"unit_raw" text,
	"unit" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extraction_method" text DEFAULT 'rule' NOT NULL,
	"confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
	"matched_canonical_id" uuid,
	"match_confidence" numeric(5, 4),
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boq_items_qty_chk" CHECK ("boq_items"."quantity" is null or "boq_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "boq_processing_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"method" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "boq_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"line_count" integer NOT NULL,
	"notes" text,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"project_type" text DEFAULT 'other' NOT NULL,
	"city" text,
	"region" text,
	"site_address" text,
	"manager_user_id" uuid,
	"status" text DEFAULT 'planning' NOT NULL,
	"visibility" text DEFAULT 'org' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"budget" numeric(18, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_chk" CHECK ("projects"."status" in ('planning','active','on_hold','completed','cancelled')),
	CONSTRAINT "projects_visibility_chk" CHECK ("projects"."visibility" in ('org','members'))
);
--> statement-breakpoint
ALTER TABLE "boq_documents" ADD CONSTRAINT "boq_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_documents" ADD CONSTRAINT "boq_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_documents" ADD CONSTRAINT "boq_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_documents" ADD CONSTRAINT "boq_documents_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item_matches" ADD CONSTRAINT "boq_item_matches_item_id_boq_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."boq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item_matches" ADD CONSTRAINT "boq_item_matches_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item_revisions" ADD CONSTRAINT "boq_item_revisions_item_id_boq_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."boq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_document_id_boq_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."boq_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_matched_canonical_id_canonical_products_id_fk" FOREIGN KEY ("matched_canonical_id") REFERENCES "public"."canonical_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_processing_runs" ADD CONSTRAINT "boq_processing_runs_document_id_boq_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."boq_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_versions" ADD CONSTRAINT "boq_versions_document_id_boq_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."boq_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_user_id_auth_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_org_idx" ON "ai_usage" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "boq_documents_org_code_uq" ON "boq_documents" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "boq_documents_project_idx" ON "boq_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "boq_documents_org_idx" ON "boq_documents" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "boq_item_matches_item_idx" ON "boq_item_matches" USING btree ("item_id","rank");--> statement-breakpoint
CREATE INDEX "boq_item_revisions_item_idx" ON "boq_item_revisions" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "boq_items_document_idx" ON "boq_items" USING btree ("document_id","line_no");--> statement-breakpoint
CREATE INDEX "boq_items_review_idx" ON "boq_items" USING btree ("document_id","review_status");--> statement-breakpoint
CREATE INDEX "boq_runs_document_idx" ON "boq_processing_runs" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "boq_versions_doc_version_uq" ON "boq_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "project_activity_project_idx" ON "project_activity" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_code_uq" ON "projects" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "projects_org_status_idx" ON "projects" USING btree ("org_id","status","created_at");