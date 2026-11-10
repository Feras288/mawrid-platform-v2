# Requirements Traceability Matrix (RTM)

Each original requirement from the owner's brief → module → acceptance criterion → tests → status.
Status vocabulary: **Implemented**, **Tested**, **Integration Pending**, **Blocked**, **Known Limitation**,
**Not Implemented**. "Tested" implies Implemented + automated tests passing.
Updated at the end of every phase. Final review happens in Phase 10 (FINAL_AUDIT.md computes
completion from this table).

| ID | Requirement (brief §) | Module | Acceptance criterion | Tests | Status |
|---|---|---|---|---|---|
| REQ-GEN-01 | Arabic & English UIs (§0, §3.1) | web/i18n | All visible strings from messages; RTL/LTR switch | e2e foundation (RTL/LTR), messages.unit (catalog parity); all E2E specs run in ar and en | Tested |
| REQ-GEN-02 | Brand decoupled from code (§0) | all | No brand in tables/APIs; brand from env | brand.unit (no brand in code/SQL/tables/API paths outside the brand helper; neutral package scope) | Tested |
| REQ-ARC-01 | Modular monolith with module boundaries (§2.1, §2.3) | all | ESLint boundary rule passes | eslint no-restricted-imports boundary rule (pnpm lint clean) | Tested |
| REQ-ARC-02 | TS strict, Next, Tailwind, Postgres, Drizzle, Zod, Redis/BullMQ, Vitest, Playwright, Docker (§2.2) | infra | Stack in place, builds | pnpm typecheck/lint/test/test:integration/test:e2e | Tested |
| REQ-DAT-01 | Traceable migrations (§2.4) | db | Migrator applies from scratch, checksums | integration globalSetup migrates platform_test from scratch each run | Tested |
| REQ-DAT-02 | Non-guessable ids (§2.4) | core | UUIDv7 PKs | misc.unit ids | Tested |
| REQ-DAT-03 | FKs, indexes, constraints (§2.4) | db | Schema review + constraint tests | rls.int, suppliers.int (DB triggers), procurement.int (unique PO per award/supplier) | Tested |
| REQ-DAT-04 | Transactions for consistency (§2.4) | modules | Multi-row ops in tx | infra.int outbox rollback, procurement.int | Tested |
| REQ-DAT-05 | Idempotency keys for sensitive creates (§2.4) | core/db | Replayed request returns same result | infra.int idempotency (replay, mismatch, rollback, concurrency); procurement.int send/PO creation | Tested |
| REQ-DAT-06 | Exact money handling (§2.4) | core | Decimal only; rounding tests | money.unit, pricing.unit, procurement.int totals | Tested |
| REQ-DAT-07 | Historical change records (§2.4) | various | Revisions/events tables | boq.int item revisions & versions; procurement.int quotation versions, award history, po_events | Tested |
| REQ-DAT-08 | Job de-duplication (§2.4) | worker | Deterministic job ids | infra.int outbox dedupe; job_runs recording | Tested |
| REQ-DAT-09 | Outbox pattern (§2.4) | core/db | Event written in tx, dispatched once | infra.int outbox | Tested |
| REQ-UX-01 | Separate experiences: store, account, org, supplier, admin (§3.2) | web | 5 portal layouts | e2e portals.spec: store, account, org, supplier portals (+ admin in admin.spec) render in ar/en | Tested |
| REQ-UX-02 | Responsive, typography, Arabic fonts (§3.3) | web | Mobile/desktop screenshots | e2e portals.spec @mobile (Pixel 7): no horizontal overflow on 37 pages × 2 languages; IBM Plex Sans Arabic / Inter | Tested |
| REQ-UX-03 | Loading/empty/error/success states (§3.3) | web | Components used on all lists | empty/loading/error/success states on all lists; error boundary; portal sweep asserts no error page | Tested |
| REQ-UX-04 | Keyboard nav, ARIA, focus, reduced motion (§3.3) | web | axe: no serious violations | axe (wcag2a/aa, no serious/critical) on every portal page in ar and en (portals.spec), admin console, auth pages | Tested |
| REQ-UX-05 | No fake working buttons (§3.3) | web | Disabled + reason when unavailable | review: unavailable actions are disabled with reason (payments unconfigured, payouts locked, supplier-cannot-buy, break-glass read-only) | Implemented |
| REQ-UX-06 | Locale-aware dates/numbers/currency (§3.1) | i18n | Formatters per locale | next-intl formatters (dates, numbers, SAR currency) on all pages | Implemented |
| REQ-AUT-01 | Account types & roles (§4.1) | authz | Role templates for all 11 types | foundation.unit role templates cover every account type | Tested |
| REQ-AUT-02 | Multi-org membership w/ different roles (§4.1) | organizations | Switch org; perms differ | organizations.int; e2e procurement (supplier switches org) | Tested |
| REQ-AUT-03 | RBAC + fine permissions + ABAC, server-side (§4.2) | authz | Services deny without perm | organizations.int authorization denial; procurement.int SoD | Tested |
| REQ-AUT-04 | Org data isolation (§4.3) | db/RLS | Cross-org reads return 0 rows as app_user | rls.int (raw SQL as app_user), boq.int isolation, suppliers.int RLS; catalog-security.int (store_catalog view exposes only approved, active-org, published, priced products; read-only) | Tested |
| REQ-AUT-05 | Supplier can't see competitor quotes / non-addressed RFQs (§4.3) | rfq/quotations | Service + RLS tests | procurement.int: supplier B cannot read A's quotation (service + RLS) nor un-addressed RFQs | Tested |
| REQ-AUT-06 | IDOR & unauthorized file access prevented (§4.3) | files | Tests with foreign ids | rls.int foreign ids; file access via app_file_visible policies | Tested |
| REQ-AUT-07 | Secure sessions, password hashing, CSRF, CORS, XSS, rate limit, cookies (§4.4) | identity | Config + tests | Better Auth (scrypt hashes, HttpOnly cookies, rate limits), CSP/headers, inactive accounts blocked at sign-in, admin MFA gate; e2e foundation; CSP 'unsafe-inline' = Known Limitation | Tested |
| REQ-AUT-08 | Secure upload, signed short URLs (§4.4) | files | Magic-byte validation, 300s URLs | foundation.unit upload validation (magic bytes, size); presigned ≤300s | Tested |
| REQ-AUT-09 | Audit of sensitive operations (§4.4) | audit | Entries for role/financial/approval changes | rls.int audit append-only; audit rows asserted in organizations/suppliers/procurement int | Tested |
| REQ-AUT-10 | Account recovery, email verification, MFA (§4.4) | identity | Flows work | e2e foundation (register/verify/login); 2FA/reset pages implemented | Tested |
| REQ-ORG-01 | Org profile fields, members, roles, approval policies (§5.1) | organizations | CRUD + validation | organizations.int; procurement.int approval policies | Tested |
| REQ-PRJ-01 | Projects with all listed fields & linked artifacts, activity log (§5.2) | projects | CRUD, activity entries | boq.int projects | Tested |
| REQ-PRJ-02 | Procurement without project supported (§5.2) | rfq/po | project_id nullable | e2e procurement (manual RFQ without project); store orders have no project | Tested |
| REQ-SUP-01 | Supplier portal capabilities (§6.1) | suppliers | All listed actions | e2e supplier (critical path 2), e2e procurement (quote, PO fulfilment) | Tested |
| REQ-SUP-02 | Supplier verification states; upload ≠ verified (§6.2) | suppliers | State machine + admin review | suppliers.int lifecycle + DB triggers; catalog-security.int (suspended profile or organization hidden from store, cart, RFQ directory, recipients and delivery) | Tested |
| REQ-SUP-03 | Pricing types: retail, enterprise, special qty, MOQ, units, discounts, validity, region, stock, lead time (§6.3) | supplier-products | Price resolution tests | pricing.unit, suppliers.int | Tested |
| REQ-CAT-01 | Canonical vs supplier product (§7.1) | catalog | Separate entities + linking | suppliers.int | Tested |
| REQ-CAT-02 | 9 systems, extensible taxonomy (§7.2) | catalog | Seeded roots; admin CRUD | reference sync seeds 9 systems / 57 subcategories; admin category CRUD; store category tree | Tested |
| REQ-CAT-03 | Dynamic engineering attributes per category (§7.3) | catalog | Attribute defs per category | pricing.unit attribute normalization; e2e supplier dynamic attributes | Tested |
| REQ-CAT-04 | Data quality: dedupe, validation, provenance, bulk import, no auto-merge (§7.4) | catalog | Duplicate candidates; import report | suppliers.int duplicates never auto-merged, bulk import report | Tested |
| REQ-CAT-ADM-01 | Admin can view, create and edit supplier products on the supplier's behalf (owner request 2026-11-10) | supplier-products | Admin list/detail/create/edit/publish, reason required, audit on supplier org | admin-products.int (authz, ownership, SKU rules, publish rules, filters, audit visible to supplier under RLS); e2e admin-products.spec | Tested |
| REQ-BOQ-01 | Inputs XLSX, CSV, text PDF, scanned PDF, images, multi-page (§8.1) | boq | Each format processed or clearly routed | boq.int XLSX/PDF/images→manual; OCR via OCR_LANG_PATH (Known Limitation: Arabic OCR accuracy) | Tested |
| REQ-BOQ-02 | 14-step pipeline (§8.2) | boq | Stage states persisted, resumable | boq.int pipeline states | Tested |
| REQ-BOQ-03 | Line model fields incl. provenance, confidence, review, history (§8.3) | boq | Schema + UI | boq.int, e2e boq (review, revisions) | Tested |
| REQ-BOQ-04 | Multi-signal matching; no invented values; review when unsure (§8.4) | matching | Critical-attr mismatch never matches | boq.unit matching rules + golden set | Tested |
| REQ-BOQ-05 | AI abstraction: env keys, structured output, schema validation, retries, cost limits, model logging, injection-safe, data policy, works w/o AI (§8.5) | ai | Tests with fake provider | boq.int AI path with Fake provider, data policy, budget, kill-switch; real Anthropic key = Integration Pending | Tested |
| REQ-RFQ-01 | RFQ lifecycle 11 states with guarded transitions (§9.1) | rfq | Transition table tests | procurement.int lifecycle; e2e procurement | Tested |
| REQ-RFQ-02 | RFQ creation features (§9.2) | rfq | All listed actions | e2e procurement (manual lines, terms, recipients); procurement.int (from BOQ version) | Tested |
| REQ-RFQ-03 | Supplier suggestions (non-guaranteed) (§9.3) | rfq | Ranked list w/ reasons + disclaimer | procurement.int suggestions with reasons; UI disclaimer | Tested |
| REQ-RFQ-04 | Replaceable sending, SMTP, per-recipient status, attempts, idempotent jobs (§9.4) | rfq/notifications | No duplicate sends | procurement.int idempotent send + email failure retry; e2e procurement per-recipient status | Tested |
| REQ-RFQ-05 | Supplier response features (§9.5) | quotations | Draft/submit/revise etc. | procurement.int (draft/submit/revise/withdraw/decline); e2e procurement | Tested |
| REQ-EVA-01 | Comparison matrix columns (§10.1) | evaluation | Matrix data correct | procurement.int comparison math | Tested |
| REQ-EVA-02 | Filters, sort, highlights, alternatives, per-line award, reasons, history (§10.2) | evaluation | UI + history | e2e procurement (per-line award with reason, highlights); procurement.int award history/invalidation | Tested |
| REQ-APR-01 | Configurable approval engine; sequential/parallel; SoD; re-evaluation on change; AI can't approve (§10.3) | approvals | Engine tests | procurement.int sequential steps, SoD, invalidation on change; foundation.unit admin SoD | Tested |
| REQ-PO-01 | PO from approved awards only; split per supplier; terms; links; no duplicates (§11.1) | purchase-orders | Constraint + service tests | procurement.int split per supplier, idempotent + unique; e2e procurement | Tested |
| REQ-PO-02 | Separate approval & fulfilment statuses (§11.2) | purchase-orders | Two fields | procurement.int deriveFulfillment; e2e procurement | Tested |
| REQ-PO-03 | Bilingual professional PDF with verification ref (§11.3) | pdf | PDF generated ar/en | e2e procurement (AR/EN PDFs generated by worker); verification page | Tested |
| REQ-PO-04 | Fulfilment tracking: updates, timeline, shipments, partial receipt, delays, attachments (§11.4) | fulfillment | E2E delivery | procurement.int partial shipments/receipts; e2e procurement (partial shipment, receipt, close) | Tested |
| REQ-COM-01 | Store pages (§12.1) | commerce/web | All pages live | e2e store.spec (home, search, product page, cart, checkout, account orders/wishlist/addresses; mobile overflow check); catalog-security.int (no enterprise/contract/regional price via store_price) | Tested |
| REQ-COM-02 | Multi-vendor cart, revalidation, tax & shipping, addresses, orders, tracking, cancel, returns/refunds (§12.2) | commerce | E2E purchase | store.int (multi-vendor cart, revalidation, MOQ/increment/stock, VAT, shipping, addresses, orders, cancellation, returns/refunds); e2e store.spec | Tested |
| REQ-COM-03 | Payment abstraction, webhooks w/ signature, idempotency, states, refunds, reconciliation (§12.3) | payments | Webhook tests | store.int (signed webhooks, invalid signature, dedupe, re-fetch, amount mismatch, late payment refund, expiry); payments.unit (Moyasar contract w/ mocked HTTP, test provider prod refusal). Moyasar live = Integration Pending | Tested |
| REQ-COM-04 | Per-supplier fulfilment groups; separated amounts; no real settlements (§12.4) | commerce/settlements | Charges separation tests | store.int (per-supplier groups, typed charges, ledger balanced, supplier balances, payouts flag off); RLS hides commission/payable from customers | Tested |
| REQ-COM-05 | Configurable shipping (§12.5) | commerce | Zones/rates | store.int (supplier zones, free-over threshold, platform default fallback, missing zone → shipping_required) | Tested |
| REQ-NOT-01 | Notification service: email + in-app, safe-disabled SMTP, bilingual templates, logs, retry, dedupe, failures visible, settings & test (§13) | notifications | Tests + admin page | foundation.unit templates; procurement.int failure persisted & retried; admin jobs page (failed deliveries + retry); SMTP settings with test send (admin.int, e2e) | Tested |
| REQ-ANA-01 | Procurement KPIs (§14.1) | analytics | Computed from data | procurement.int (buyer KPIs = recorded PO totals, RFQ/response/cycle/savings/on-time); e2e analytics.spec | Tested |
| REQ-ANA-02 | Supplier KPIs (§14.2) | analytics | Computed from data | procurement.int (supplier PO value, win rate); analytics.int (store sales, monthly series) | Tested |
| REQ-ANA-03 | No mixing test data in KPIs (§14) | analytics | Test orgs excluded | analytics.int (platform GMV excludes test orgs; test observations excluded from index) | Tested |
| REQ-PIX-01 | Six price types separated (§15.1) | price-index | Typed observations | price-index stats + analytics.int (six kinds never mixed; snapshots per kind) | Tested |
| REQ-PIX-02 | Index stats incl. sample size & quality (§15.2) | price-index | Stats tests | analytics.int (median, IQR, n, org count, quality); e2e analytics.spec (series + table view) | Tested |
| REQ-PIX-03 | Data quality: units, tax basis, dupes, outliers, min sample, comparability, methodology (§15.3) | price-index | Tests + doc | analytics.int (base-unit normalization, ex-VAT, IQR outliers flagged, window, idempotent capture, superseded quotes removed); methodology shown in UI | Tested |
| REQ-PIX-04 | Privacy: no private prices / identities; k-anonymity (§15.4) | price-index | Threshold tests | price-index.unit + analytics.int (≥5 obs, ≥3 orgs incl. buyers for quotes/awards/POs, dominance ≤60%; suppressed rows store no prices; raw observations system-only under RLS) | Tested |
| REQ-PIX-05 | Price alerts (§15.5) | price-index | Alert generation | analytics.int (alert baseline, +20% move notifies once) | Tested |
| REQ-CMP-01 | VAT handling (§16) | commerce/po | 15% configurable, per-line | money.unit per-line VAT, procurement.int, store.int (goods + shipping VAT) | Tested |
| REQ-CMP-02 | ZATCA-ready invoicing layer (§16) | invoicing | Invoice data + QR TLV; Fatoora pending | payments.unit TLV encode/decode; store.int invoices + credit notes; Fatoora integration pending | Integration Pending |
| REQ-CMP-03 | PDPL: privacy notice, consents, retention, data rights (§16) | privacy | Export/deletion requests | admin.int privacy (consents, export visible only to owner, deletion reject/approve with anonymization & legal retention); e2e admin.spec (consent toggle, export download). Legal texts are drafts (DEC-10) | Tested |
| REQ-ADM-01 | Super admin features list (§17) | admin | Each page live | admin.int (users, orgs, settings, content, break-glass); e2e admin.spec (all 15 admin sections render, axe, settings secrecy, content publish, break-glass); catalog-security.int (admin organization suspension takes effect immediately) | Tested |
| REQ-ADM-02 | No unrestricted admin access to confidential docs; break-glass logged (§17) | admin/RLS | Tests | admin.int (no access without grant; reasoned, time-boxed, read-only, owners notified, audited, revocable, expiry); e2e admin.spec (read-only banner) | Tested |
| REQ-QA-01 | Test types (§18.1) | tests | Suites exist & pass | Vitest unit (72) + integration on real Postgres as app_user (61) + Playwright E2E (23, incl. axe portal sweep); CI workflow (typecheck, lint, unit, migration drift, integration, audit, build, images) | Tested |
| REQ-QA-02 | 17 critical scenarios (§18.2) | tests | Each mapped to a test | All 17 scenarios mapped below to passing tests (E2E for 1–13, integration for 14–17) | Tested |
| REQ-PRF-01 | Pagination, indexing, caching, jobs, retries, timeouts, error boundaries, logging, health, graceful shutdown (§19) | all | Present | pagination on all lists, indexes (trigram, partial, expression), caching (brand facet, settings), BullMQ jobs with retries/backoff, timeouts on provider calls, error boundaries, structured logs, /api/health + /api/ready + worker health, graceful shutdown | Tested |
| REQ-PRF-02 | Measured performance vs targets (§19) | — | Results in TEST_REPORT | scripts/perf/run.ts — all 5 targets met at 100k products (see TEST_REPORT Performance) | Tested |
| REQ-OPS-01 | Environments separation (§20.1) | config | APP_ENV + separate env files | APP_ENV guards (env.ts), seed/perf refuse non-dev, test providers refuse production, payouts locked in production | Tested |
| REQ-OPS-02 | Dockerfiles, compose, env example, health, deploy, migrations, backup/restore (§20.2) | infra | Build & run | Dockerfiles, Coolify compose, migrate one-shot, health checks, backup/restore (drill passed), DEPLOYMENT.md; native equivalents of every image step verified; local image build blocked by Docker VM network timeouts (CI builds images) | Implemented |
| REQ-OPS-03 | CI pipeline (§20.3) | .github | Workflow passes locally-equivalent | .github/workflows/ci.yml (checks + images jobs); not executed on GitHub (no remote push by policy) | Implemented |
| REQ-DOC-01 | Docs set + context protocol (§21) | docs | Files exist & current | review | Implemented |

## Critical scenario mapping (§18.2)
| # | Scenario | Test(s) |
|---|---|---|
| 1 | Org registration + members | e2e foundation.spec critical path 1; organizations.int |
| 2 | Supplier registration + products | e2e supplier.spec; suppliers.int |
| 3 | Project + BOQ upload | e2e boq.spec; boq.int |
| 4 | Extraction + review | e2e boq.spec; boq.int; boq.unit golden set |
| 5 | RFQ from approved lines | procurement.int (from approved BOQ version); e2e procurement.spec (manual lines) |
| 6 | Send RFQ to multiple suppliers | procurement.int (multiple suppliers, idempotent); e2e procurement.spec |
| 7 | Different quotations | procurement.int (two suppliers, partial/alternatives) |
| 8 | Compare quotations | procurement.int comparison; e2e procurement.spec |
| 9 | Supplier per line | procurement.int; e2e procurement.spec per-line award |
| 10 | Approvals | procurement.int sequential + SoD + invalidation; e2e auto-approval path |
| 11 | Issue PO | procurement.int; e2e procurement.spec (issue + bilingual PDFs) |
| 12 | Fulfilment & delivery | procurement.int partial shipments/receipts; e2e procurement.spec |
| 13 | Store purchase | e2e store.spec.ts (browse → cart → checkout → test payment → supplier fulfilment → tax invoice); store.int |
| 14 | Cross-org leak prevention | rls.int; boq.int isolation; suppliers.int RLS; procurement.int |
| 15 | Supplier can't access competitor quotes | procurement.int (service + RLS) |
| 16 | Duplicate prevention on resubmission | infra.int idempotency; procurement.int (send, PO creation, unique constraint); store.int (checkout replay, webhook dedupe, refund idempotency key) |
| 17 | Email/AI/payment failure without data corruption | procurement.int email failure; boq.int AI failure; store.int payment failure / amount mismatch / late payment / expiry (no data corruption) |
