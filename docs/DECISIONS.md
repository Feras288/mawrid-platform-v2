# Architecture & Decision Log

## ADR-000 — Plan approval and autonomy scope (2026-11-08)
The project owner approved the full architectural and execution plan (phases 1–10) on 2026-11-08,
authorizing autonomous execution and automatic phase-to-phase progression without further approvals,
except for sensitive operations and genuine blockers requiring owner input.

Owner's binding notes attached to the approval (verbatim intent):
1. RLS + TenantContext must support buyer↔supplier relationships without exposing other organizations'
   data, with real security tests that exercise actual database connections (non-owner role).
2. Ordering/payment flows are separated from real financial settlements. Production collection or
   settlements must not be enabled before the business model and regulatory requirements are decided.
3. Implement every feature/integration that can be implemented and tested. "Integration Pending" is
   reserved for parts that truly require external accounts, keys or approvals.
4. Manage machine resources: run heavy builds/tests sequentially when needed, never disable tests or
   ignore results.
5. Maintain a Requirements Traceability Matrix (`docs/RTM.md`) linking each original requirement →
   module → acceptance criterion → tests → final result. The project is not complete until it is reviewed.

Out of scope without explicit approval: production deployment, real financial operations, destructive
operations (DB drops on real data, history rewrites), pushing to remote repositories.

## ADR-001 — Modular monolith in a pnpm/Turborepo monorepo
Clear module boundaries with low operational cost. Heavy work isolated in a worker process.
**Refinement (2026-11-08):** domain modules live in one workspace package `@platform/modules` with one
folder per module (public API via `src/<module>/index.ts`) instead of ~24 separate packages. Boundaries
are enforced by ESLint `no-restricted-imports` (no deep imports into another module). Rationale: far
less build/config overhead with the same logical isolation; splitting a folder into a package later is
mechanical.

## ADR-002 — Single Next.js app with portal route groups
Next.js 16 (App Router), React 19. Portals: store, account, org (procurement), supplier, admin under
`/[locale]`. Shared design system in `apps/web/src/components/ui`.

## ADR-003 — Services independent of Next.js
Business logic in `@platform/modules`, invoked by Server Actions (UI) and REST route handlers
(`/api/v1`, Zod-validated). Services receive an explicit `Ctx` (actor, active org, permissions).

## ADR-004 — Worker process with BullMQ on Valkey/Redis
Outbox dispatcher, BOQ pipeline, email, PDF, price-index aggregation, scheduled jobs.

## ADR-005 — PostgreSQL 17 + Drizzle ORM (node-postgres driver)
Extensions: pg_trgm, unaccent, pgcrypto, vector (pgvector, optional usage). Image `pgvector/pgvector:pg17`.
Migrations: drizzle-kit generated SQL + hand-written SQL for roles/RLS/functions, applied in order by
our migrator (tracks applied files and checksums).

## ADR-006 — Identifiers
UUIDv7 primary keys (time-ordered, not guessable enough to replace authorization — they never do).
Human document numbers (`RFQ-2026-000012`, `PO-…`, `ORD-…`) from per-organization counters with
row-level locking.

## ADR-007 — Money
`numeric(18,2)` amounts, `numeric(18,4)` unit prices and quantities, `decimal.js` in code.
Rounding: ROUND_HALF_UP to 2 dp per line; VAT computed per line then summed. Currency column (SAR default).

## ADR-008 — Authentication: Better Auth
Email+password (scrypt hashing by Better Auth), email verification, password reset, TOTP 2FA plugin,
DB sessions with secure cookies, built-in rate limiting. Own tables for memberships/roles/permissions.

## ADR-009 — Isolation: TenantContext + RBAC/ABAC + Postgres RLS
Runtime connects as `app_user` (NOSUPERUSER, NOBYPASSRLS). Each unit of work runs in a transaction
that sets `app.user_id`, `app.org_id`, `app.mode` (`user` | `system`) via `set_config(..., true)`.
Cross-party access (buyer↔supplier) is resolved through SECURITY DEFINER helper functions over bridge
tables (`rfq_recipients`, `purchase_orders.supplier_org_id`, `order_groups.supplier_org_id`) to avoid
recursive policies. `system` mode is only set by worker/system code paths.

## ADR-010 — Outbox + idempotency
`outbox_events` written in-transaction; dispatcher uses `FOR UPDATE SKIP LOCKED`. `idempotency_keys`
table keyed by (scope, key) storing request hash + response.

## ADR-011 — UI stack
Tailwind CSS v4, Radix primitives (shadcn-style components owned in repo), logical CSS properties for
RTL, next-intl (ar default, en), fonts IBM Plex Sans Arabic + Inter via next/font.

## ADR-012 — PDF generation
HTML templates rendered by Chromium (Playwright) in the worker; deterministic templates in ar/en.

## ADR-013 — Object storage
S3 API via AWS SDK v3; local SeaweedFS S3 gateway (image already available on host; MinIO community
images are no longer reliably published). Private buckets only, presigned URLs (≤5 min).

## ADR-014 — Email
Nodemailer SMTP adapter; disabled-safe when SMTP_* unset (deliveries recorded as `skipped_no_config`).
Mailpit in local dev.

## ADR-015 — Observability
pino JSON logs with redaction, `/api/health` (liveness) and `/api/ready` (DB/Redis), optional
Sentry-compatible DSN.

## ADR-016 — Testing
Vitest unit + integration against real Postgres (separate test database, real `app_user` role),
Playwright E2E + axe-core. GitHub Actions CI.

## ADR-017 — Brand decoupling
Package scope `@platform/*`; brand strings only from env/config and i18n messages.

## ADR-018 — TypeScript 6.0 (not 7.0)
TypeScript 7.0 (native Go port) is the npm `latest`, but Next.js, typescript-eslint and drizzle-kit
rely on the JS compiler API. TS 6.0.x is used for ecosystem compatibility. Revisit when tooling supports 7.

## ADR-019 — Business defaults (owner may change; see BLOCKERS.md)
Supplier = seller of record; platform = intermediary. Commission/subscriptions configurable, default off.
Payments via provider abstraction (Moyasar adapter, bank transfer, test provider in non-prod).
Settlements module computes payables but executes nothing real (feature flag off + prod guard).
Price index publication: ≥5 observations from ≥3 independent orgs, 90-day window (configurable).

## ADR-020 — AI provider: Anthropic SDK with structured outputs (2026-11-08)
Claude via the official TypeScript SDK; JSON-schema structured outputs (forced tool choice is rejected
by current models); refusal fallback enabled (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
Documents are sent only when the org opted in (`allowExternalAI`), the `boq.ai_extraction` flag is on,
a key is configured, and the monthly budget is not exhausted. The planned OpenAI-compatible adapter is
dropped from scope for now (Not Implemented) — no verified need; the interface supports adding it.

## ADR-021 — Projects visibility
Org-wide by default; `visibility = members` restricts to project members/manager and holders of
`project.manage_members`. Enforced in services (RLS stays org-level); inaccessible projects return 404.

## ADR-022 — Store orders, payments and reconciliation ledger (2026-11-09)
- One `order` per checkout, one `order_group` per supplier (seller of record, own status, own tax
  invoice). Money is split into typed `order_charges` (goods, shipping, VAT on each, commission,
  commission VAT, supplier payable). Customers never see commission/payable rows (RLS).
- Checkout is idempotent per (user, key), revalidates price/stock/MOQ/shipping server-side and reserves
  stock in the same transaction. Provider calls happen after commit. Unpaid orders expire (card 30 min,
  bank transfer 72 h) and release stock.
- Webhooks: verified per provider (HMAC for the test provider; Moyasar `secret_token` compared in
  constant time), stored once per provider event id, then the payment is **re-fetched from the provider**;
  amount and currency must match the intent exactly or the payment is flagged and never marked paid.
  A payment confirmed after the order expired is refunded automatically.
- Ledger (`ledger_entries`, append-only, system-only): payment journal Dr platform_clearing /
  Cr supplier_payable, commission_revenue, vat_payable; refunds reverse pro rata (`allocate`, cents only
  to non-zero weights). Payouts are not implemented: `settlements.payouts` is locked off (prod guard)
  pending DEC-01/02/03.
- Invoices: per group on payment, simplified (B2C) or standard (valid buyer VAT), credit notes on
  refunds; ZATCA phase-1 QR TLV. Fatoora (phase 2) is Integration Pending (DEC-06).
- Suppliers deliver via their own zones/rates; if a supplier has none, platform default zones apply.

## ADR-023 — Price index method v1 (2026-11-09)
Six price types are captured separately and never mixed. Prices are normalized to the unit's base unit,
ex-VAT, SAR. Statistics: type-7 quantiles, Tukey fences (1.5×IQR, n ≥ 5). Publication requires
n ≥ 5, ≥ 3 independent organizations (for quotes, awards and POs the smaller of distinct suppliers and
distinct buyers) and no supplier above 60% of observations; floors cannot be configured lower. Suppressed
snapshots store counts and the reason but no prices. Raw observations are system-only. Snapshots are
daily over a rolling 90-day window. Quotes count only while current and submitted; awards only while
current and approved. National scope only in v1.

## ADR-024 — Storefront search path (2026-11-09)
Under RLS, PostgreSQL does not evaluate non-leakproof operators (ILIKE, similarity) before policy quals, so
trigram indexes are unusable for searches run as `app_user`. Storefront search therefore selects ids and
counts through `store_catalog`, an owner-privileged view that encodes the public visibility rule
(published, active, priced, supplier approved), and then reads the rows under the viewer's RLS context.
Listing price for filter/sort is a trigger-maintained `store_price` (refreshed daily for validity windows);
the price shown is always resolved per viewer (enterprise / contract / regional). Measured p95 251 ms
(service) / 328 ms (HTTP) at 100k products.

## ADR-025 — Payment & PO concurrency model (2026-11-09)
Lock order is fixed: **order → payment intent → refund → group** for payments and **PO → PO items** for
procurement; state is re-validated under the lock. An order has at most one primary captured intent (partial
unique index); further captures are flagged `duplicate_of` and refunded in full without touching the ledger.
Refunds are requested durably (same transaction as the decision) and executed with a leased attempt and the
refund's idempotency key; unknown provider outcomes stay `pending`, are retried by the `store.recover_refunds`
job and escalate to `manual_required` after 6 attempts. Webhook events are re-claimed atomically when `failed`
or when a `received` lease (5 min) expired.
Amendment (round 3): refund idempotency is a per-provider capability (`refundIdempotency`). Moyasar documents idempotency
for payment creation (`given_id`) only, so it is "unproven": after the first POST a refund with an unknown outcome is never
re-POSTed; it is reconciled by reading the payment (positive evidence only) and escalated to `manual_required`
(`outcome_unknown`) after 30 minutes. Re-sending with the same key remains for providers that prove it.

## ADR-026 — Admin management of supplier products (2026-11-10)
Requested by the owner. Platform admins with `admin.catalog` can list all supplier products, create a product
for a chosen supplier and edit / (un)publish any supplier product. The product stays owned by the supplier
(`org_id` = supplier); the same validation, SKU uniqueness and publishing rules apply (shared internal functions,
not a parallel code path). Every write requires a reason (3–500 chars) and is audited with the admin as actor and
`org_id` = the supplier, so the supplier sees it in its own audit log; edits record the fields that actually
changed. Prices and stock remain the supplier's responsibility and are shown read-only in the admin page.
Data access runs in system context after `authorizeAdmin`; supplier RLS is unchanged. (ADR-025 is used by the
hardening branch.)

