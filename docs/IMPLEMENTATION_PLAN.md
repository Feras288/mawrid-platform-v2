# Implementation Plan

Approved 2026-11-08 (ADR-000). Phases run sequentially; each ends with: tests green → docs updated →
RTM updated → commit → next phase automatically.

## Phase 1 — Foundation
Tasks: monorepo (pnpm, turbo, tsconfig, eslint, prettier); infra compose (postgres/valkey/s3/mailpit);
core package (Decimal money, errors, ids, env, logger, state machine); db package (schema, migrator,
roles, RLS helpers, `withContext`); Better Auth (email/password, verification, reset, TOTP 2FA, rate
limit); organizations, memberships, invitations, roles/permissions, active-org switching; authz service;
audit log; files + S3 presigned; outbox + idempotency + worker skeleton; notifications (email+in-app)
base; design system + RTL + i18n; web shell for 5 portals; Vitest + integration harness + Playwright
setup; CI workflow.
Acceptance: sign-up/verify/login/2FA/reset work; create org, invite & accept member, assign roles;
RLS isolation tests (raw SQL as app_user) pass; CI config validates locally (typecheck, lint, tests).

## Phase 2 — Suppliers & Catalog
Supplier registration → profile → documents → verification lifecycle (admin review); supplier users;
categories tree (9 systems) + dynamic attributes + units/conversions + brands; canonical products
(admin CRUD, duplicate candidates); supplier products (link to canonical), price lists (retail,
enterprise, org-specific, region), tiers, MOQ, validity, warehouses, inventory, lead times; CSV/XLSX
bulk import with row-level error report.
Acceptance: approved supplier manages priced, stocked products; unapproved supplier cannot publish;
import reports errors per row; duplicates flagged, never auto-merged.

## Phase 3 — Projects & BOQ
Projects (members, activity, files); BOQ upload + pipeline (XLSX, CSV, text PDF, OCR/AI path);
normalization; matching; review UI; approval & versions; AI provider layer with budgets & data policy;
golden-set accuracy tests.
Acceptance: golden set extraction recall ≥ 0.95 for structured XLSX/CSV; no low-confidence line
auto-approved; system fully usable with AI disabled.

## Phase 4 — RFQ & Quotations
RFQ creation from approved BOQ version/manual lines; supplier suggestions; approval-to-send;
per-recipient sending jobs (email + in-app) with delivery log & retry; supplier portal response
(lines, partial qty, lead times, alternatives, exceptions, validity, tax/shipping/discount, attachments,
draft/submit/revise); comparison matrix (filters, sort, highlights).
Acceptance: re-sending doesn't duplicate; supplier A cannot read supplier B's quotation (service + RLS);
matrix totals verified by tests.

## Phase 5 — Approvals & Purchase Orders
Policy engine + admin UI; award per line with reasons/history; approval requests (sequential/parallel,
SoD, invalidation on change); PO split per supplier; bilingual PDF; supplier fulfilment; shipments;
partial receipts; delays; timeline.
Acceptance: end-to-end BOQ→RFQ→evaluation→approval→PO→delivery passes; duplicate PO impossible.

## Phase 6 — Store
Home, categories, search (FTS + trigram, ar/en), filters, sort, product page with supplier offers,
wishlist, multi-vendor cart with revalidation, addresses, shipping zones/rates, VAT, checkout with
idempotency, payment providers (test provider in non-prod, Moyasar adapter, bank transfer), webhooks,
order tracking, cancellation, returns/refunds, settlements ledger (no payouts).
Acceptance: full purchase E2E incl. signed webhook; charges separated correctly (tests).

## Phase 7 — Analytics & Price Index
Procurement/supplier/store KPIs from live data excluding test orgs; price observations (6 types) captured
by events; normalization (unit, tax basis); outlier filter (IQR); k-anonymity thresholds; index
snapshots; charts; alerts.
Acceptance: KPI and index computations unit-tested; privacy thresholds enforced.

## Phase 8 — Admin & Integrations
Super admin: users, orgs, suppliers review, catalog, reference data, settings (SMTP/AI/payments with
encrypted secrets + connection tests), feature flags, jobs monitor, error log, audit viewer, AI usage,
content pages, break-glass, PDPL tools (consents, export, deletion requests), operational reports.

## Phase 9 — Integration hardening
All 17 critical paths E2E (ar/en, desktop/mobile); authz & isolation audit; financial audit; performance
measurements vs targets; index tuning; staging compose; accessibility checks.

## Phase 10 — Final audit & delivery
Independent-style review; RTM review; FINAL_AUDIT.md; runbook.

## Performance targets (measured in Phase 9)
- p95 server time for list pages < 400 ms with 100k supplier products / 20k BOQ lines.
- 2,000-line XLSX BOQ: extract+normalize+rule match < 60 s.
- Comparison matrix 500 lines × 8 suppliers < 2 s.
- PO PDF 200 lines < 10 s.
