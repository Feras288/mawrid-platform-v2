# Database Design

PostgreSQL 17 (`pgvector/pgvector:pg17`). Schema source of truth: `packages/db/src/schema/*.ts`
(Drizzle) + `packages/db/sql/*.sql` (roles, functions, RLS, triggers). Migrations in
`packages/db/migrations` are applied by `packages/db/src/migrate.ts` as `platform_owner`.

## Conventions
- PK `id uuid` (UUIDv7 generated in app). `created_at`, `updated_at timestamptz`.
- Tenant tables carry `org_id uuid not null` (owning org) and are RLS-protected.
- Money `numeric(18,2)`, unit prices/quantities `numeric(18,4)`, currency `char(3)` default `SAR`.
- Enums as `text` + CHECK constraints (simpler migrations than PG enums).
- Soft delete only where business requires (`archived_at`); audit is append-only.
- Every FK indexed; list queries backed by composite indexes `(org_id, status, created_at desc)`.
- `is_test_data boolean` on organizations; analytics exclude test orgs.

## Table groups (owner module)
| Group | Tables |
|---|---|
| auth (Better Auth) | `user`, `session`, `account`, `verification`, `two_factor` |
| organizations | `organizations`, `memberships`, `roles`, `role_permissions`, `membership_roles`, `invitations`, `addresses`, `org_counters` |
| audit/config | `audit_logs`, `feature_flags`, `system_settings`, `breakglass_grants` |
| infra | `outbox_events`, `idempotency_keys`, `job_runs`, `files` |
| suppliers | `supplier_profiles`, `supplier_documents`, `supplier_categories`, `supplier_regions`, `warehouses`, `supplier_reviews_log` |
| catalog | `categories`, `attribute_definitions`, `category_attributes`, `units`, `unit_conversions`, `brands`, `canonical_products`, `canonical_product_attributes`, `duplicate_candidates`, `regions`, `cities` |
| supplier products | `supplier_products`, `supplier_product_attributes`, `price_lists`, `price_list_items`, `price_tiers`, `inventory_levels`, `import_batches`, `import_batch_rows` |
| projects/BOQ | `projects`, `project_members`, `project_activity`, `boq_documents`, `boq_processing_runs`, `boq_items`, `boq_item_matches`, `boq_item_revisions`, `boq_versions` |
| AI | `ai_usage` |
| RFQ | `rfqs`, `rfq_items`, `rfq_recipients`, `rfq_recipient_events`, `rfq_attachments`, `rfq_events` |
| quotations | `quotations`, `quotation_items`, `quotation_charges`, `quotation_attachments` |
| evaluation | `evaluations`, `award_decisions`, `award_lines` |
| approvals | `approval_policies`, `approval_policy_steps`, `approval_requests`, `approval_request_steps`, `approval_decisions` |
| purchase orders | `purchase_orders`, `po_items`, `po_events`, `shipments`, `shipment_items`, `goods_receipts`, `goods_receipt_items` |
| commerce | `carts`, `cart_items`, `wishlist_items`, `orders`, `order_groups`, `order_lines`, `order_charges`, `order_events`, `returns`, `return_items`, `shipping_zones`, `shipping_zone_cities`, `shipping_rates` |
| payments/settlements | `payment_intents`, `payment_attempts`, `payment_webhook_events`, `refunds`, `ledger_entries`, `invoices`, `invoice_lines`, `commission_policies` |
| notifications | `notifications`, `notification_deliveries`, `notification_templates`, `notification_preferences` |
| analytics/price | `price_observations`, `price_index_snapshots`, `price_alerts`, `price_alert_events` |
| privacy | `consents`, `data_requests` |

Detailed column lists are kept next to the code (Drizzle schema files are self-documenting); this
document records the non-obvious constraints:

## Key constraints
- `memberships (user_id, org_id)` unique. Org owner cannot be removed while sole owner.
- `supplier_products (supplier_org_id, sku)` unique.
- `rfq_recipients (rfq_id, supplier_org_id)` unique.
- `quotations (rfq_id, supplier_org_id, version)` unique; only one `is_current` per (rfq, supplier) (partial unique index).
- `purchase_orders (award_id, supplier_org_id)` unique where status ≠ cancelled → no duplicate POs.
- `orders (buyer_user_id, idempotency_key)` unique.
- `payment_webhook_events (provider, provider_event_id)` unique.
- `idempotency_keys (scope, key)` primary key.
- Document numbers: `org_counters (org_id, kind, year)` with `SELECT … FOR UPDATE`.
- `audit_logs`: no UPDATE/DELETE for `app_user`.

## RLS coverage
All tables with `org_id` or a party relationship have `ENABLE` + `FORCE ROW LEVEL SECURITY`.
Party-shared tables:
- `rfqs`, `rfq_items`, `rfq_attachments`: buyer org OR recipient supplier with status ≥ sent.
- `rfq_recipients`: buyer org OR the supplier itself.
- `quotations*`: supplier org (all own versions) OR buyer org when status ∈ (submitted, superseded, withdrawn).
- `purchase_orders`, `po_items`, `shipments*`, `goods_receipts*`, `po_events`: buyer org OR supplier org
  when PO approval status = approved (issued).
- `orders`: buyer user; `order_groups/lines/charges`: buyer user OR supplier org of the group.
See `packages/db/sql/030_rls.sql`.

## Backups
See `DEPLOYMENT.md` (pg_dump custom format daily + WAL archiving recommendation; restore drill script).
