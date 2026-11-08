CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pages_status_chk" CHECK ("content_pages"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_pages_uq" ON "content_pages" USING btree ("slug","locale","version");