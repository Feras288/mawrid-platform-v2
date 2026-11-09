-- Review follow-up to 0013. Data-only: no automatic refunds and no destructive change.
--
-- 1) Historical late payments (order expired unpaid, then paid, then refunded) were refunded by reversing a
--    payment journal that was never posted, leaving negative supplier_payable / platform_clearing balances.
--    Append a compensating journal (debit/credit swapped, one per affected refund journal) so the balances return to
--    what was actually booked. The ledger is append-only, so history is corrected by adding entries, not by editing.
--    Deterministic ids and the NOT EXISTS guards make this idempotent. Groups that have a payment journal are untouched.
INSERT INTO "ledger_entries" ("id", "journal_id", "order_id", "group_id", "supplier_org_id", "account", "debit", "credit", "currency", "memo", "created_at")
SELECT gen_random_uuid(), md5(l."journal_id"::text || ':unposted_payment_correction')::uuid, l."order_id", l."group_id", l."supplier_org_id", l."account",
       l."credit", l."debit", l."currency", 'correction:unposted_payment', now()
FROM "ledger_entries" l
WHERE l."memo" LIKE 'refund:%'
  AND l."group_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ledger_entries" p WHERE p."group_id" = l."group_id" AND p."memo" = 'payment')
  AND NOT EXISTS (SELECT 1 FROM "ledger_entries" c WHERE c."journal_id" = md5(l."journal_id"::text || ':unposted_payment_correction')::uuid);--> statement-breakpoint

-- 2) Historical duplicate captures flagged `duplicate_of` by 0013 have NO refund request and are never refunded
--    automatically. Record each one for finance review (listDuplicateCaptures / settleDuplicateCapture verify the capture
--    at the provider and settle it with an audited note). One audit row per intent, idempotent.
INSERT INTO "audit_logs" ("id", "org_id", "actor_type", "action", "entity_type", "entity_id", "data")
SELECT gen_random_uuid(), o."org_id", 'system', 'payment.duplicate_capture_legacy', 'payment_intent', pi."id"::text,
       jsonb_build_object('orderId', pi."order_id", 'primaryIntentId', pi."duplicate_of", 'amount', pi."amount", 'currency', pi."currency", 'provider', pi."provider", 'state', 'needs_review')
FROM "payment_intents" pi
JOIN "orders" o ON o."id" = pi."order_id"
WHERE pi."duplicate_of" IS NOT NULL
  AND pi."status" = 'succeeded'
  AND NOT EXISTS (SELECT 1 FROM "refunds" r WHERE r."idempotency_key" = 'dup:' || pi."id"::text)
  AND NOT EXISTS (SELECT 1 FROM "audit_logs" a WHERE a."entity_type" = 'payment_intent' AND a."entity_id" = pi."id"::text AND a."action" IN ('payment.duplicate_capture', 'payment.duplicate_capture_legacy'));
