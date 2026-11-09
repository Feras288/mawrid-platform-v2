# Final Audit — Building Materials & MEP Procurement Platform

Audit date: 2026-11-09 · Working brand «مَوْرِد | Mawrid» (configuration only) · Repository: local `main`,
not pushed anywhere · No production deployment, no real payments or settlements were performed.

This report is computed from `docs/RTM.md` (requirements traceability matrix), the test runs recorded in
`docs/TEST_REPORT.md`, and a review of the open items in `docs/BLOCKERS.md`. Status vocabulary:
**Tested** (implemented and covered by passing automated tests) · **Implemented** (done, verified by review or
manual run, not fully automatable here) · **Integration Pending** (needs external accounts/keys/approval) ·
**Known Limitation** · **Blocked** · **Not Implemented**.

## 1. Completion against the RTM

83 original requirements traced (RTM rows `REQ-*`), plus the 17 critical scenarios of §18.2.

| Status | Requirements | Share |
|---|---|---|
| Tested | 77 | 92.8% |
| Implemented (verified by review / manual run) | 5 | 6.0% |
| Integration Pending | 1 | 1.2% |
| Blocked / Known Limitation / Not Implemented (as requirement status) | 0 | 0% |

Implemented-but-not-automated rows: REQ-UX-05 (no fake working buttons — review), REQ-UX-06 (locale-aware
formatting — used on every page, not unit-asserted), REQ-OPS-02 (Docker/Coolify — every image step verified
natively; images not built locally, see §6), REQ-OPS-03 (CI workflow written, not executed on GitHub),
REQ-DOC-01 (documentation set). Integration Pending: REQ-CMP-02 (ZATCA phase 2 / Fatoora).

All 17 critical scenarios are mapped to passing tests: 1–13 end-to-end (Playwright), 14–17 by integration tests
against real PostgreSQL connections as the runtime role (cross-org isolation, competitor-quote secrecy,
duplicate prevention, failure handling without data corruption).

## 2. What was built

| Area | Scope delivered |
|---|---|
| Foundation | pnpm/Turborepo modular monolith; Next.js 16 App Router (Arabic RTL default, English); BullMQ worker; PostgreSQL 17 with migrations, roles and **RLS on every tenant table** (runtime role without BYPASSRLS); Better Auth (verification, reset, TOTP 2FA, rate limits); RBAC with 11 role templates + custom roles; audit log (append-only); outbox + idempotency; private S3 storage with presigned URLs; bilingual email + in-app notifications |
| Suppliers & catalog | Supplier onboarding and verification state machine (DB-guarded), documents, warehouses; 9 systems / 57 categories with 74 engineering attributes; canonical vs supplier products; price lists (retail / enterprise / contract / regional, tiers, validity, VAT-inclusive); inventory with reservations; CSV/XLSX import with per-row report; duplicate detection without auto-merge |
| Projects & BOQ | Projects with visibility and members; BOQ pipeline (XLSX/CSV header detection and inference, text-PDF grid rebuild, scanned/images via opt-in AI or optional OCR, manual fallback); Arabic/English normalization, attribute extraction, classification; multi-signal matching that never auto-matches with missing or conflicting critical attributes; review UI, revisions, approved immutable versions; AI usage and budget per organization |
| RFQ → PO | RFQ lifecycle (11 states), supplier suggestions with reasons, approval-to-send, idempotent per-recipient delivery with retries and log; supplier inbox and versioned quotations (partial, alternatives, exceptions, attachments); comparison matrix; per-line award with history; approval engine (sequential/parallel steps, amount/project scoping, SoD, invalidation on change); PO split per supplier, bilingual PDFs with verification QR, acknowledgement, partial shipments and receipts, delays, completion, public verification page |
| Store | Search/filters/sorting, product pages with viewer-specific prices and other offers, wishlist, addresses, multi-vendor cart with server-side revalidation, supplier delivery zones + platform defaults, idempotent checkout, test payment provider (non-prod) / Moyasar adapter / bank transfer, signed and deduplicated webhooks with provider re-fetch, order groups per supplier, cancellations, returns and refunds, reconciliation ledger, per-supplier ZATCA phase-1 invoices and credit notes |
| Analytics & price index | Six separated price types captured from real records, base-unit normalization, outliers, k-anonymity (≥ 5 obs, ≥ 3 orgs incl. buyers, ≤ 60% single-supplier share), daily snapshots, alerts; buyer, supplier and platform KPIs excluding test data; accessible SVG charts with data tables |
| Admin & compliance | Users, organizations, supplier review, catalog, store orders, finance (ledger, bank-transfer confirmation, refunds, webhook log), default shipping, integrations (SMTP, AI, bank transfer, commission, policies, index thresholds — secrets encrypted, never returned), feature flags, jobs/outbox/email retry, AI usage, audit viewer, privacy requests, versioned legal pages, reports; break-glass (reasoned, time-boxed, read-only, owners notified, audited); PDPL self-service (consents, export, deletion with anonymization and legal retention) |
| Operations | Production build, worker bundle, bundled migrate, Dockerfiles, Coolify compose, backup/restore scripts (restore drill passed), CI workflow, deployment guide, security review |

## 3. Test evidence (final runs, 2026-11-09)

| Suite | Command | Result |
|---|---|---|
| Typecheck (6 packages) | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | 0 errors, 0 warnings |
| Unit | `pnpm test` | 72 / 72 passed (10 files) |
| Integration (real PostgreSQL, `app_user` + RLS) | `pnpm test:integration` | 61 / 61 passed (10 files) |
| End-to-end (Playwright, desktop + mobile, axe) | `playwright test` | 23 / 23 passed in one run (17 desktop + 6 mobile) |
| Production build | `next build` + worker bundle | pass; standalone server and bundled worker smoke-tested |
| Backup → restore drill | `infra/backup/*.sh` | pass |
| Performance (100k products) | `scripts/perf/run.ts` | 5 / 5 targets met |

The portal sweep covers 37 pages × Arabic/English on desktop (axe) and mobile (no horizontal overflow). Counts above are from the release-verification run (TEST_REPORT); see RELEASE_READINESS.md.

Performance (production build, 100,000 supplier products): store search p95 251 ms (service) / 328 ms
(HTTP) vs < 400 ms; BOQ 2,000 lines 23.3 s vs < 60 s; comparison 500 × 8 in 304 ms vs < 2 s; bilingual PO PDF
(200 lines) 2.5 s vs < 10 s. Details in TEST_REPORT.

Defects found by the tests and fixed during the build are listed in TEST_REPORT ("Defects found by tests and
fixed"). Examples: email-failure records rolled back with their transaction, a BOQ double-processing race,
rounding cents allocated to zero-weight ledger parts, SKU search normalization, a wrong column in a KPI query,
dual-button forms racing their submit, blank numeric settings coerced to 0, colour-contrast failures found by
axe, and the store-search performance issues.

## 4. Integration Pending (needs external accounts, keys or approvals)

| Integration | What is ready | What is needed |
|---|---|---|
| Card payments (Moyasar live) | Adapter (hosted invoice, secret-token webhook check, re-fetch, refunds) contract-tested with mocked HTTP; full flow tested end-to-end with the test provider | Merchant account, keys, webhook secret; business-model decision (DEC-01/02) |
| ZATCA e-invoicing phase 2 (Fatoora) | Phase-1 data, simplified/standard invoices, credit notes, QR TLV | CSID onboarding, certificates, UBL XML signing; decision on who issues invoices (DEC-06) |
| Production SMTP | SMTP transport, admin settings with test send, retries, failure visibility | SMTP account / domain authentication |
| AI provider | Anthropic adapter (structured outputs), data policy, budget, kill-switch, fake-provider tests | API key; organizations must opt in; data-residency decision (DEC-04/05) |
| Object storage (production) | S3 adapter, presigned URLs, private bucket | Bucket and credentials (KSA region recommended) |
| Error tracking, antivirus, carriers, official supplier verification | Hooks / manual flows in place | Sentry/GlitchTip DSN, ClamAV service, carrier contracts, Wathq or similar API access |

## 5. Blocked by owner decisions (deliberately not enabled)
- **Supplier payouts / settlements**: ledger balances only; `settlements.payouts` is locked off in production
  until DEC-01/02/03 are decided (possible SAMA licensing implications). No real money movement exists in code.
- **Commission and subscriptions**: implemented, configurable, off by default (DEC-03).
- **Legal texts** (terms, privacy, returns, seller terms): versioned and publishable, but drafts pending legal
  review (DEC-10). No compliance claim is made.

## 6. Known limitations
- Docker images were not built locally: the Docker VM repeatedly timed out downloading large npm tarballs.
  Every Dockerfile step was rehearsed in clean git clones (filtered frozen install, `next build` without env vars,
  worker bundle, hoisted deploy, bundled migrate, worker boot); only Chromium's Linux packages could not be
  reproduced on Windows. The CI `images` job builds both images.
- CI workflow is written but has not run on GitHub (no remote push without approval).
- CSP allows `'unsafe-inline'` (Next.js bootstrap without nonces). Two moderate `pnpm audit` advisories in
  tooling/transitive paths not reachable at runtime (see SECURITY.md).
- Scanned-PDF Arabic OCR without an AI provider has limited accuracy (optional Tesseract); manual entry is
  always available.
- Price index is national only (no per-region breakdown); dark mode is not offered.
- Deep E2E flows run in one language each (procurement in English, store and BOQ in Arabic); every portal
  page is swept in both languages and on mobile for rendering, overflow and accessibility.
- Staging and production environments have not been provisioned.

## 7. Owner actions before go-live
1. Decide DEC-01 (seller of record), DEC-02 (payment provider/contract), DEC-03 (revenue model), DEC-06 (e-invoice issuer), DEC-05 (hosting region).
2. Provide production accounts: S3, SMTP, payment provider, (optional) AI and error tracking.
3. Legal review of policy texts; publish them from Admin → Content.
4. Approve a staging deployment (Coolify), run the E2E suite against staging, then approve production.
5. Push the repository to a private remote so the CI workflow runs (including the Docker image job).

## 8. RTM review
The RTM was reviewed row by row at the end of Phase 10 (this document): each original requirement maps to a
module, an acceptance criterion and named tests; statuses above reflect actual results only.
