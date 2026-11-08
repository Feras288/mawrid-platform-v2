# Requirements Traceability Matrix (RTM)

Each original requirement from the owner's brief → module → acceptance criterion → tests → status.
Status vocabulary: **Implemented**, **Tested**, **Integration Pending**, **Blocked**, **Known Limitation**,
**Not Implemented**. "Tested" implies Implemented + automated tests passing.
Updated at the end of every phase. Final review happens in Phase 10 (FINAL_AUDIT.md computes
completion from this table).

| ID | Requirement (brief §) | Module | Acceptance criterion | Tests | Status |
|---|---|---|---|---|---|
| REQ-GEN-01 | Arabic & English UIs (§0, §3.1) | web/i18n | All visible strings from messages; RTL/LTR switch | e2e i18n | Not Implemented |
| REQ-GEN-02 | Brand decoupled from code (§0) | all | No brand in tables/APIs; brand from env | lint grep test | Not Implemented |
| REQ-ARC-01 | Modular monolith with module boundaries (§2.1, §2.3) | all | ESLint boundary rule passes | lint | Not Implemented |
| REQ-ARC-02 | TS strict, Next, Tailwind, Postgres, Drizzle, Zod, Redis/BullMQ, Vitest, Playwright, Docker (§2.2) | infra | Stack in place, builds | CI | Not Implemented |
| REQ-DAT-01 | Traceable migrations (§2.4) | db | Migrator applies from scratch, checksums | integration migrate | Not Implemented |
| REQ-DAT-02 | Non-guessable ids (§2.4) | core | UUIDv7 PKs | unit ids | Not Implemented |
| REQ-DAT-03 | FKs, indexes, constraints (§2.4) | db | Schema review + constraint tests | integration | Not Implemented |
| REQ-DAT-04 | Transactions for consistency (§2.4) | modules | Multi-row ops in tx | integration | Not Implemented |
| REQ-DAT-05 | Idempotency keys for sensitive creates (§2.4) | core/db | Replayed request returns same result | integration idempotency | Not Implemented |
| REQ-DAT-06 | Exact money handling (§2.4) | core | Decimal only; rounding tests | unit money | Not Implemented |
| REQ-DAT-07 | Historical change records (§2.4) | various | Revisions/events tables | integration | Not Implemented |
| REQ-DAT-08 | Job de-duplication (§2.4) | worker | Deterministic job ids | integration jobs | Not Implemented |
| REQ-DAT-09 | Outbox pattern (§2.4) | core/db | Event written in tx, dispatched once | integration outbox | Not Implemented |
| REQ-UX-01 | Separate experiences: store, account, org, supplier, admin (§3.2) | web | 5 portal layouts | e2e nav | Not Implemented |
| REQ-UX-02 | Responsive, typography, Arabic fonts (§3.3) | web | Mobile/desktop screenshots | e2e mobile | Not Implemented |
| REQ-UX-03 | Loading/empty/error/success states (§3.3) | web | Components used on all lists | review | Not Implemented |
| REQ-UX-04 | Keyboard nav, ARIA, focus, reduced motion (§3.3) | web | axe: no serious violations | e2e a11y | Not Implemented |
| REQ-UX-05 | No fake working buttons (§3.3) | web | Disabled + reason when unavailable | review | Not Implemented |
| REQ-UX-06 | Locale-aware dates/numbers/currency (§3.1) | i18n | Formatters per locale | unit format | Not Implemented |
| REQ-AUT-01 | Account types & roles (§4.1) | authz | Role templates for all 11 types | unit authz | Not Implemented |
| REQ-AUT-02 | Multi-org membership w/ different roles (§4.1) | organizations | Switch org; perms differ | integration | Not Implemented |
| REQ-AUT-03 | RBAC + fine permissions + ABAC, server-side (§4.2) | authz | Services deny without perm | integration authz | Not Implemented |
| REQ-AUT-04 | Org data isolation (§4.3) | db/RLS | Cross-org reads return 0 rows as app_user | integration isolation | Not Implemented |
| REQ-AUT-05 | Supplier can't see competitor quotes / non-addressed RFQs (§4.3) | rfq/quotations | Service + RLS tests | integration isolation | Not Implemented |
| REQ-AUT-06 | IDOR & unauthorized file access prevented (§4.3) | files | Tests with foreign ids | integration | Not Implemented |
| REQ-AUT-07 | Secure sessions, password hashing, CSRF, CORS, XSS, rate limit, cookies (§4.4) | identity | Config + tests | integration/e2e | Not Implemented |
| REQ-AUT-08 | Secure upload, signed short URLs (§4.4) | files | Magic-byte validation, 300s URLs | unit/integration | Not Implemented |
| REQ-AUT-09 | Audit of sensitive operations (§4.4) | audit | Entries for role/financial/approval changes | integration | Not Implemented |
| REQ-AUT-10 | Account recovery, email verification, MFA (§4.4) | identity | Flows work | e2e auth | Not Implemented |
| REQ-ORG-01 | Org profile fields, members, roles, approval policies (§5.1) | organizations | CRUD + validation | integration | Not Implemented |
| REQ-PRJ-01 | Projects with all listed fields & linked artifacts, activity log (§5.2) | projects | CRUD, activity entries | integration | Not Implemented |
| REQ-PRJ-02 | Procurement without project supported (§5.2) | rfq/po | project_id nullable | integration | Not Implemented |
| REQ-SUP-01 | Supplier portal capabilities (§6.1) | suppliers | All listed actions | e2e supplier | Not Implemented |
| REQ-SUP-02 | Supplier verification states; upload ≠ verified (§6.2) | suppliers | State machine + admin review | unit/integration | Not Implemented |
| REQ-SUP-03 | Pricing types: retail, enterprise, special qty, MOQ, units, discounts, validity, region, stock, lead time (§6.3) | supplier-products | Price resolution tests | unit pricing | Not Implemented |
| REQ-CAT-01 | Canonical vs supplier product (§7.1) | catalog | Separate entities + linking | integration | Not Implemented |
| REQ-CAT-02 | 9 systems, extensible taxonomy (§7.2) | catalog | Seeded roots; admin CRUD | integration | Not Implemented |
| REQ-CAT-03 | Dynamic engineering attributes per category (§7.3) | catalog | Attribute defs per category | integration | Not Implemented |
| REQ-CAT-04 | Data quality: dedupe, validation, provenance, bulk import, no auto-merge (§7.4) | catalog | Duplicate candidates; import report | integration | Not Implemented |
| REQ-BOQ-01 | Inputs XLSX, CSV, text PDF, scanned PDF, images, multi-page (§8.1) | boq | Each format processed or clearly routed | integration boq | Not Implemented |
| REQ-BOQ-02 | 14-step pipeline (§8.2) | boq | Stage states persisted, resumable | integration | Not Implemented |
| REQ-BOQ-03 | Line model fields incl. provenance, confidence, review, history (§8.3) | boq | Schema + UI | integration | Not Implemented |
| REQ-BOQ-04 | Multi-signal matching; no invented values; review when unsure (§8.4) | matching | Critical-attr mismatch never matches | unit matching | Not Implemented |
| REQ-BOQ-05 | AI abstraction: env keys, structured output, schema validation, retries, cost limits, model logging, injection-safe, data policy, works w/o AI (§8.5) | ai | Tests with fake provider | unit/integration ai | Not Implemented |
| REQ-RFQ-01 | RFQ lifecycle 11 states with guarded transitions (§9.1) | rfq | Transition table tests | unit rfq | Not Implemented |
| REQ-RFQ-02 | RFQ creation features (§9.2) | rfq | All listed actions | e2e rfq | Not Implemented |
| REQ-RFQ-03 | Supplier suggestions (non-guaranteed) (§9.3) | rfq | Ranked list w/ reasons + disclaimer | integration | Not Implemented |
| REQ-RFQ-04 | Replaceable sending, SMTP, per-recipient status, attempts, idempotent jobs (§9.4) | rfq/notifications | No duplicate sends | integration jobs | Not Implemented |
| REQ-RFQ-05 | Supplier response features (§9.5) | quotations | Draft/submit/revise etc. | e2e supplier | Not Implemented |
| REQ-EVA-01 | Comparison matrix columns (§10.1) | evaluation | Matrix data correct | unit/integration | Not Implemented |
| REQ-EVA-02 | Filters, sort, highlights, alternatives, per-line award, reasons, history (§10.2) | evaluation | UI + history | e2e | Not Implemented |
| REQ-APR-01 | Configurable approval engine; sequential/parallel; SoD; re-evaluation on change; AI can't approve (§10.3) | approvals | Engine tests | unit/integration | Not Implemented |
| REQ-PO-01 | PO from approved awards only; split per supplier; terms; links; no duplicates (§11.1) | purchase-orders | Constraint + service tests | integration | Not Implemented |
| REQ-PO-02 | Separate approval & fulfilment statuses (§11.2) | purchase-orders | Two fields | unit | Not Implemented |
| REQ-PO-03 | Bilingual professional PDF with verification ref (§11.3) | pdf | PDF generated ar/en | integration pdf | Not Implemented |
| REQ-PO-04 | Fulfilment tracking: updates, timeline, shipments, partial receipt, delays, attachments (§11.4) | fulfillment | E2E delivery | e2e | Not Implemented |
| REQ-COM-01 | Store pages (§12.1) | commerce/web | All pages live | e2e store | Not Implemented |
| REQ-COM-02 | Multi-vendor cart, revalidation, tax & shipping, addresses, orders, tracking, cancel, returns/refunds (§12.2) | commerce | E2E purchase | e2e/integration | Not Implemented |
| REQ-COM-03 | Payment abstraction, webhooks w/ signature, idempotency, states, refunds, reconciliation (§12.3) | payments | Webhook tests | integration | Not Implemented |
| REQ-COM-04 | Per-supplier fulfilment groups; separated amounts; no real settlements (§12.4) | commerce/settlements | Charges separation tests | unit | Not Implemented |
| REQ-COM-05 | Configurable shipping (§12.5) | commerce | Zones/rates | integration | Not Implemented |
| REQ-NOT-01 | Notification service: email + in-app, safe-disabled SMTP, bilingual templates, logs, retry, dedupe, failures visible, settings & test (§13) | notifications | Tests + admin page | integration | Not Implemented |
| REQ-ANA-01 | Procurement KPIs (§14.1) | analytics | Computed from data | integration | Not Implemented |
| REQ-ANA-02 | Supplier KPIs (§14.2) | analytics | Computed from data | integration | Not Implemented |
| REQ-ANA-03 | No mixing test data in KPIs (§14) | analytics | Test orgs excluded | integration | Not Implemented |
| REQ-PIX-01 | Six price types separated (§15.1) | price-index | Typed observations | unit | Not Implemented |
| REQ-PIX-02 | Index stats incl. sample size & quality (§15.2) | price-index | Stats tests | unit | Not Implemented |
| REQ-PIX-03 | Data quality: units, tax basis, dupes, outliers, min sample, comparability, methodology (§15.3) | price-index | Tests + doc | unit | Not Implemented |
| REQ-PIX-04 | Privacy: no private prices / identities; k-anonymity (§15.4) | price-index | Threshold tests | unit | Not Implemented |
| REQ-PIX-05 | Price alerts (§15.5) | price-index | Alert generation | integration | Not Implemented |
| REQ-CMP-01 | VAT handling (§16) | commerce/po | 15% configurable, per-line | unit | Not Implemented |
| REQ-CMP-02 | ZATCA-ready invoicing layer (§16) | invoicing | Invoice data + QR TLV; Fatoora pending | unit | Not Implemented |
| REQ-CMP-03 | PDPL: privacy notice, consents, retention, data rights (§16) | privacy | Export/deletion requests | integration | Not Implemented |
| REQ-ADM-01 | Super admin features list (§17) | admin | Each page live | e2e admin | Not Implemented |
| REQ-ADM-02 | No unrestricted admin access to confidential docs; break-glass logged (§17) | admin/RLS | Tests | integration | Not Implemented |
| REQ-QA-01 | Test types (§18.1) | tests | Suites exist & pass | CI | Not Implemented |
| REQ-QA-02 | 17 critical scenarios (§18.2) | tests | Each mapped to a test | e2e/integration | Not Implemented |
| REQ-PRF-01 | Pagination, indexing, caching, jobs, retries, timeouts, error boundaries, logging, health, graceful shutdown (§19) | all | Present | review | Not Implemented |
| REQ-PRF-02 | Measured performance vs targets (§19) | — | Results in TEST_REPORT | perf scripts | Not Implemented |
| REQ-OPS-01 | Environments separation (§20.1) | config | APP_ENV + separate env files | review | Not Implemented |
| REQ-OPS-02 | Dockerfiles, compose, env example, health, deploy, migrations, backup/restore (§20.2) | infra | Build & run | docker build | Not Implemented |
| REQ-OPS-03 | CI pipeline (§20.3) | .github | Workflow passes locally-equivalent | CI | Not Implemented |
| REQ-DOC-01 | Docs set + context protocol (§21) | docs | Files exist & current | review | Implemented |

## Critical scenario mapping (§18.2)
| # | Scenario | Test(s) |
|---|---|---|
| 1 | Org registration + members | — |
| 2 | Supplier registration + products | — |
| 3 | Project + BOQ upload | — |
| 4 | Extraction + review | — |
| 5 | RFQ from approved lines | — |
| 6 | Send RFQ to multiple suppliers | — |
| 7 | Different quotations | — |
| 8 | Compare quotations | — |
| 9 | Supplier per line | — |
| 10 | Approvals | — |
| 11 | Issue PO | — |
| 12 | Fulfilment & delivery | — |
| 13 | Store purchase | — |
| 14 | Cross-org leak prevention | — |
| 15 | Supplier can't access competitor quotes | — |
| 16 | Duplicate prevention on resubmission | — |
| 17 | Email/AI/payment failure without data corruption | — |
