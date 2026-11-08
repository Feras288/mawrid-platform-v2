CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_chk" CHECK ("approval_decisions"."decision" in ('approve','reject'))
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"operation" text NOT NULL,
	"project_id" uuid,
	"min_amount" numeric(18, 2),
	"max_amount" numeric(18, 2),
	"priority" integer DEFAULT 0 NOT NULL,
	"distinct_approvers" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policies_op_chk" CHECK ("approval_policies"."operation" in ('rfq_send','award','po_issue')),
	CONSTRAINT "approval_policies_range_chk" CHECK ("approval_policies"."min_amount" is null or "approval_policies"."max_amount" is null or "approval_policies"."max_amount" >= "approval_policies"."min_amount")
);
--> statement-breakpoint
CREATE TABLE "approval_policy_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"name" text NOT NULL,
	"required_role_key" text,
	"required_permission" text DEFAULT 'approval.decide' NOT NULL,
	"min_approvals" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "approval_steps_min_chk" CHECK ("approval_policy_steps"."min_approvals" >= 1)
);
--> statement-breakpoint
CREATE TABLE "approval_request_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"name" text NOT NULL,
	"required_role_key" text,
	"required_permission" text NOT NULL,
	"min_approvals" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_hash" text NOT NULL,
	"subject_label" text,
	"amount" numeric(18, 2),
	"currency" text DEFAULT 'SAR' NOT NULL,
	"policy_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"award_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"rfq_item_id" uuid NOT NULL,
	"supplier_org_id" uuid,
	"quotation_id" uuid,
	"quotation_item_id" uuid,
	"quantity" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"line_total" numeric(18, 2),
	"reason" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subject_hash" text,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"approval_request_id" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"rfq_item_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"technical_status" text DEFAULT 'not_evaluated' NOT NULL,
	"technical_note" text,
	"financial_note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"rfq_item_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"offered" boolean DEFAULT true NOT NULL,
	"quantity" numeric(18, 4),
	"unit_price" numeric(18, 4),
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"lead_time_days" integer,
	"supplier_product_id" uuid,
	"is_alternative" boolean DEFAULT false NOT NULL,
	"alternative_description" text,
	"brand" text,
	"model" text,
	"origin" text,
	"exception_note" text,
	"line_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_vat" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "quotation_items_values_chk" CHECK ((not "quotation_items"."offered") or ("quotation_items"."unit_price" >= 0 and "quotation_items"."quantity" > 0))
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp with time zone,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"lead_time_days" integer,
	"payment_terms" text,
	"delivery_terms" text,
	"notes" text,
	"exceptions" text,
	"shipping_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"vat_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"covered_lines" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_status_chk" CHECK ("quotations"."status" in ('draft','submitted','superseded','withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "rfq_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"from_status" text,
	"to_status" text,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"boq_item_id" uuid,
	"canonical_product_id" uuid,
	"category_id" uuid,
	"section" text,
	"description" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"unit" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_items_qty_chk" CHECK ("rfq_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "rfq_recipient_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rfq_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_org_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"decline_reason" text,
	"suggested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_recipients_status_chk" CHECK ("rfq_recipients"."status" in ('pending','prepared','sent','failed','responded','declined'))
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"boq_version_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"closes_at" timestamp with time zone,
	"revision_deadline" timestamp with time zone,
	"delivery_city" text,
	"delivery_address" text,
	"required_by" timestamp with time zone,
	"delivery_terms" text,
	"payment_terms" text,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"allow_revisions" boolean DEFAULT true NOT NULL,
	"allow_partial_quotes" boolean DEFAULT true NOT NULL,
	"allow_alternatives" boolean DEFAULT true NOT NULL,
	"cancel_reason" text,
	"created_by" uuid,
	"submitted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"awarded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_status_chk" CHECK ("rfqs"."status" in ('draft','pending_review','approved_for_sending','sending','open','partially_responded','under_evaluation','revision_requested','awarded','closed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_step_id_approval_request_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_request_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_policy_id_approval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."approval_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_policy_id_approval_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."approval_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_lines" ADD CONSTRAINT "award_lines_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_lines" ADD CONSTRAINT "award_lines_rfq_item_id_rfq_items_id_fk" FOREIGN KEY ("rfq_item_id") REFERENCES "public"."rfq_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_lines" ADD CONSTRAINT "award_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_lines" ADD CONSTRAINT "award_lines_quotation_item_id_quotation_items_id_fk" FOREIGN KEY ("quotation_item_id") REFERENCES "public"."quotation_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_rfq_item_id_rfq_items_id_fk" FOREIGN KEY ("rfq_item_id") REFERENCES "public"."rfq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD CONSTRAINT "quotation_attachments_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD CONSTRAINT "quotation_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_rfq_item_id_rfq_items_id_fk" FOREIGN KEY ("rfq_item_id") REFERENCES "public"."rfq_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_supplier_product_id_supplier_products_id_fk" FOREIGN KEY ("supplier_product_id") REFERENCES "public"."supplier_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_events" ADD CONSTRAINT "rfq_events_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_boq_item_id_boq_items_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_canonical_product_id_canonical_products_id_fk" FOREIGN KEY ("canonical_product_id") REFERENCES "public"."canonical_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_recipient_events" ADD CONSTRAINT "rfq_recipient_events_recipient_id_rfq_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."rfq_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_recipients" ADD CONSTRAINT "rfq_recipients_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_boq_version_id_boq_versions_id_fk" FOREIGN KEY ("boq_version_id") REFERENCES "public"."boq_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_uq" ON "approval_decisions" USING btree ("step_id","user_id");--> statement-breakpoint
CREATE INDEX "approval_policies_org_idx" ON "approval_policies" USING btree ("org_id","operation","is_active");--> statement-breakpoint
CREATE INDEX "approval_policy_steps_idx" ON "approval_policy_steps" USING btree ("policy_id","step_order");--> statement-breakpoint
CREATE INDEX "approval_request_steps_idx" ON "approval_request_steps" USING btree ("request_id","step_order");--> statement-breakpoint
CREATE INDEX "approval_requests_org_idx" ON "approval_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_subject_idx" ON "approval_requests" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "award_lines_award_idx" ON "award_lines" USING btree ("award_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "award_lines_current_uq" ON "award_lines" USING btree ("award_id","rfq_item_id") WHERE "award_lines"."is_current";--> statement-breakpoint
CREATE INDEX "awards_rfq_idx" ON "awards" USING btree ("rfq_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_scores_uq" ON "evaluation_scores" USING btree ("rfq_id","rfq_item_id","supplier_org_id");--> statement-breakpoint
CREATE INDEX "quotation_attachments_q_idx" ON "quotation_attachments" USING btree ("quotation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_items_uq" ON "quotation_items" USING btree ("quotation_id","rfq_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_version_uq" ON "quotations" USING btree ("rfq_id","supplier_org_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_current_uq" ON "quotations" USING btree ("rfq_id","supplier_org_id") WHERE "quotations"."is_current";--> statement-breakpoint
CREATE INDEX "quotations_buyer_idx" ON "quotations" USING btree ("buyer_org_id","rfq_id");--> statement-breakpoint
CREATE INDEX "rfq_attachments_rfq_idx" ON "rfq_attachments" USING btree ("rfq_id");--> statement-breakpoint
CREATE INDEX "rfq_events_rfq_idx" ON "rfq_events" USING btree ("rfq_id","created_at");--> statement-breakpoint
CREATE INDEX "rfq_items_rfq_idx" ON "rfq_items" USING btree ("rfq_id","line_no");--> statement-breakpoint
CREATE INDEX "rfq_recipient_events_idx" ON "rfq_recipient_events" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_recipients_uq" ON "rfq_recipients" USING btree ("rfq_id","supplier_org_id");--> statement-breakpoint
CREATE INDEX "rfq_recipients_supplier_idx" ON "rfq_recipients" USING btree ("supplier_org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rfqs_org_code_uq" ON "rfqs" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "rfqs_org_status_idx" ON "rfqs" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "rfqs_closes_idx" ON "rfqs" USING btree ("status","closes_at");