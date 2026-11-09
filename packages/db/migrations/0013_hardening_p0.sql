ALTER TABLE "payment_intents" ADD COLUMN "duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD COLUMN "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_duplicate_of_payment_intents_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Repair legacy data before the invariant is enforced: when an order already has several captured intents
-- (the defect fixed here), keep the earliest as primary and flag the rest as duplicates for refund follow-up.
UPDATE "payment_intents" pi SET "duplicate_of" = prim."id"
FROM (
  SELECT DISTINCT ON ("order_id") "order_id", "id" FROM "payment_intents" WHERE "status" = 'succeeded'
  ORDER BY "order_id", "succeeded_at" NULLS LAST, "created_at", "id"
) prim
WHERE pi."status" = 'succeeded' AND pi."order_id" = prim."order_id" AND pi."id" <> prim."id";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_one_primary_uq" ON "payment_intents" USING btree ("order_id") WHERE "payment_intents"."status" = 'succeeded' and "payment_intents"."duplicate_of" is null;