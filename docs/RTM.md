# Requirements Traceability Matrix (RTM)

Each original requirement from the owner's brief → module → acceptance criterion → tests → status.
Status vocabulary: **Implemented**, **Tested**, **Integration Pending**, **Blocked**, **Known Limitation**,
**Not Implemented**. "Tested" implies Implemented + automated tests passing.
Updated at the end of every phase. Final review happens in Phase 10 (FINAL_AUDIT.md computes
completion from this table).

| ID | Requirement (brief §) | Module | Acceptance criterion | Tests | Status |
|---|---|---|---|---|---|
| REQ-GEN-01 | Arabic & English UIs (§0, §3.1) | web/i18n | All visible strings from messages; RTL/LTR switch | e2e foundation (RTL/LTR), messages.unit (catalog parity); all E2E specs run in ar and en | Tested |
| REQ-GEN-02 | Brand decoupled from code (§0) | all | No brand in tables/APIs; brand from env | review: package scope @platform/*, brand from BRAND_NAME_* env | Implemented |
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
| REQ-UX-01 | Separate experiences: store, account, org, supplier, admin (§3.2) | web | 5 portal layouts | e2e nav | Not Implemented |
| REQ-UX-02 | Responsive, typography, Arabic fonts (§3.3) | web | Mobile/desktop screenshots | e2e mobile | Not Implemented |
| REQ-UX-03 | Loading/empty/error/success states (§3.3) | web | Components used on all lists | review: EmptyState/Spinner/Alert/toasts on implemented pages (store/admin pending) | Implemented |
| REQ-UX-04 | Keyboard nav, ARIA, focus, reduced motion (§3.3) | web | axe: no serious violations | e2e foundation axe on auth pages (portal pages: Phase 9) | Implemented |
| REQ-UX-05 | No fake working buttons (§3.3) | web | Disabled + reason when unavailable | review | Not Implemented |
| REQ-UX-06 | Locale-aware dates/numbers/currency (§3.1) | i18n | Formatters per locale | next-intl formatters (dates, numbers, SAR currency) on all pages | Implemented |
| REQ-AUT-01 | Account types & roles (§4.1) | authz | Role templates for all 11 types | foundation.unit role templates cover every account type | Tested |
| REQ-AUT-02 | Multi-org membership w/ different roles (§4.1) | organizations | Switch org; perms differ | organizations.int; e2e procurement (supplier switches org) | Tested |
| REQ-AUT-03 | RBAC + fine permissions + ABAC, server-side (§4.2) | authz | Services deny without perm | organizations.int authorization denial; procurement.int SoD | Tested |
| REQ-AUT-04 | Org data isolation (§4.3) | db/RLS | Cross-org reads return 0 rows as app_user | rls.int (raw SQL as app_user), boq.int isolation, suppliers.int RLS | Tested |
| REQ-AUT-05 | Supplier can't see competitor quotes / non-addressed RFQs (§4.3) | rfq/quotations | Service + RLS tests | procurement.int: supplier B cannot read A's quotation (service + RLS) nor un-addressed RFQs | Tested |
| REQ-AUT-06 | IDOR & unauthorized file access prevented (§4.3) | files | Tests with foreign ids | rls.int foreign ids; file access via app_file_visible policies | Tested |
| REQ-AUT-07 | Secure sessions, password hashing, CSRF, CORS, XSS, rate limit, cookies (§4.4) | identity | Config + tests | integration/e2e | Not Implemented |
| REQ-AUT-08 | Secure upload, signed short URLs (§4.4) | files | Magic-byte validation, 300s URLs | foundation.unit upload validation (magic bytes, size); presigned ≤300s | Tested |
| REQ-AUT-09 | Audit of sensitive operations (§4.4) | audit | Entries for role/financial/approval changes | rls.int audit append-only; audit rows asserted in organizations/suppliers/procurement int | Tested |
| REQ-AUT-10 | Account recovery, email verification, MFA (§4.4) | identity | Flows work | e2e foundation (register/verify/login); 2FA/reset pages implemented | Tested |
| REQ-ORG-01 | Org profile fields, members, roles, approval policies (§5.1) | organizations | CRUD + validation | organizations.int; procurement.int approval policies | Tested |
| REQ-PRJ-01 | Projects with all listed fields & linked artifacts, activity log (§5.2) | projects | CRUD, activity entries | boq.int projects | Tested |
| REQ-PRJ-02 | Procurement without project supported (§5.2) | rfq/po | project_id nullable | e2e procurement (manual RFQ without project) | Tested |
| REQ-SUP-01 | Supplier portal capabilities (§6.1) | suppliers | All listed actions | e2e supplier (critical path 2), e2e procurement (quote, PO fulfilment) | Tested |
| REQ-SUP-02 | Supplier verification states; upload ≠ verified (§6.2) | suppliers | State machine + admin review | suppliers.int lifecycle + DB triggers | Tested |
| REQ-SUP-03 | Pricing types: retail, enterprise, special qty, MOQ, units, discounts, validity, region, stock, lead time (§6.3) | supplier-products | Price resolution tests | pricing.unit, suppliers.int | Tested |
| REQ-CAT-01 | Canonical vs supplier product (§7.1) | catalog | Separate entities + linking | suppliers.int | Tested |
| REQ-CAT-02 | 9 systems, extensible taxonomy (§7.2) | catalog | Seeded roots; admin CRUD | reference sync seeds 9 roots; admin catalog page | Implemented |
| REQ-CAT-03 | Dynamic engineering attributes per category (§7.3) | catalog | Attribute defs per category | pricing.unit attribute normalization; e2e supplier dynamic attributes | Tested |
| REQ-CAT-04 | Data quality: dedupe, validation, provenance, bulk import, no auto-merge (§7.4) | catalog | Duplicate candidates; import report | suppliers.int duplicates never auto-merged, bulk import report | Tested |
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
| REQ-COM-01 | Store pages (§12.1) | commerce/web | All pages live | e2e store | Not Implemented |
| REQ-COM-02 | Multi-vendor cart, revalidation, tax & shipping, addresses, orders, tracking, cancel, returns/refunds (§12.2) | commerce | E2E purchase | e2e/integration | Not Implemented |
| REQ-COM-03 | Payment abstraction, webhooks w/ signature, idempotency, states, refunds, reconciliation (§12.3) | payments | Webhook tests | integration | Not Implemented |
| REQ-COM-04 | Per-supplier fulfilment groups; separated amounts; no real settlements (§12.4) | commerce/settlements | Charges separation tests | unit | Not Implemented |
| REQ-COM-05 | Configurable shipping (§12.5) | commerce | Zones/rates | integration | Not Implemented |
| REQ-NOT-01 | Notification service: email + in-app, safe-disabled SMTP, bilingual templates, logs, retry, dedupe, failures visible, settings & test (§13) | notifications | Tests + admin page | foundation.unit templates; procurement.int email failure persisted & retried (admin settings page: Phase 8) | Implemented |
| REQ-ANA-01 | Procurement KPIs (§14.1) | analytics | Computed from data | integration | Not Implemented |
| REQ-ANA-02 | Supplier KPIs (§14.2) | analytics | Computed from data | integration | Not Implemented |
| REQ-ANA-03 | No mixing test data in KPIs (§14) | analytics | Test orgs excluded | integration | Not Implemented |
| REQ-PIX-01 | Six price types separated (§15.1) | price-index | Typed observations | unit | Not Implemented |
| REQ-PIX-02 | Index stats incl. sample size & quality (§15.2) | price-index | Stats tests | unit | Not Implemented |
| REQ-PIX-03 | Data quality: units, tax basis, dupes, outliers, min sample, comparability, methodology (§15.3) | price-index | Tests + doc | unit | Not Implemented |
| REQ-PIX-04 | Privacy: no private prices / identities; k-anonymity (§15.4) | price-index | Threshold tests | unit | Not Implemented |
| REQ-PIX-05 | Price alerts (§15.5) | price-index | Alert generation | integration | Not Implemented |
| REQ-CMP-01 | VAT handling (§16) | commerce/po | 15% configurable, per-line | money.unit per-line VAT, procurement.int | Tested |
| REQ-CMP-02 | ZATCA-ready invoicing layer (§16) | invoicing | Invoice data + QR TLV; Fatoora pending | unit | Not Implemented |
| REQ-CMP-03 | PDPL: privacy notice, consents, retention, data rights (§16) | privacy | Export/deletion requests | integration | Not Implemented |
| REQ-ADM-01 | Super admin features list (§17) | admin | Each page live | e2e admin | Not Implemented |
| REQ-ADM-02 | No unrestricted admin access to confidential docs; break-glass logged (§17) | admin/RLS | Tests | break-glass read-only context + audited supplier document access (admin UI: Phase 8) | Implemented |
| REQ-QA-01 | Test types (§18.1) | tests | Suites exist & pass | CI | Not Implemented |
| REQ-QA-02 | 17 critical scenarios (§18.2) | tests | Each mapped to a test | e2e/integration | Not Implemented |
| REQ-PRF-01 | Pagination, indexing, caching, jobs, retries, timeouts, error boundaries, logging, health, graceful shutdown (§19) | all | Present | review | Not Implemented |
| REQ-PRF-02 | Measured performance vs targets (§19) | — | Results in TEST_REPORT | perf scripts | Not Implemented |
| REQ-OPS-01 | Environments separation (§20.1) | config | APP_ENV + separate env files | env.ts APP_ENV guards; mock adapters refuse production | Implemented |
| REQ-OPS-02 | Dockerfiles, compose, env example, health, deploy, migrations, backup/restore (§20.2) | infra | Build & run | docker build | Not Implemented |
| REQ-OPS-03 | CI pipeline (§20.3) | .github | Workflow passes locally-equivalent | .github/workflows/ci.yml | Implemented |
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
| 13 | Store purchase | — |
| 14 | Cross-org leak prevention | rls.int; boq.int isolation; suppliers.int RLS; procurement.int |
| 15 | Supplier can't access competitor quotes | procurement.int (service + RLS) |
| 16 | Duplicate prevention on resubmission | infra.int idempotency; procurement.int (send, PO creation, unique constraint) |
| 17 | Email/AI/payment failure without data corruption | procurement.int email failure; boq.int AI failure (payment: Phase 6) |
