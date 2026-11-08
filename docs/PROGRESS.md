# Progress

Last updated: 2026-11-08

## Current phase: 9 — Integration hardening (starting)

| Phase | Status |
|---|---|
| 0 Planning | Done (approved 2026-11-08) |
| 1 Foundation | Done (see Phase 1 notes) |
| 2 Suppliers & Catalog | Done |
| 3 Projects & BOQ | Done |
| 4 RFQ & Quotations | Done |
| 5 Approvals & PO | Done |
| 6 Store | Done |
| 7 Analytics & Price Index | Done |
| 8 Admin & Integrations | Done |
| 9 Integration hardening | In progress |
| 10 Final audit | Pending |

## Phase 1 — done
Monorepo, infra compose, core, db (migrator + roles + RLS + withContext), Better Auth (email/password,
verification, reset, TOTP 2FA, rate limits, consent capture), organizations/memberships/invitations/
custom roles with escalation & last-owner guards, authz, audit (append-only), files (magic-byte
validation, private S3, presigned downloads), outbox + idempotency, notifications (email via worker +
in-app, bilingual templates, secret scrubbing), feature flags & encrypted settings, worker (BullMQ,
outbox loop, health, graceful shutdown), web shell for account/org/supplier portals, i18n ar/en RTL,
design system, unit/integration/E2E harness, CI workflow.
Known gaps carried forward: admin portal pages (Phase 8), account orders/wishlist/addresses (Phase 6),
privacy page (Phase 8).

## Phase 2 — done
Supplier profile/documents/verification state machine with DB triggers preventing self-approval;
admin review UI with audited document access; reference data (13 regions, 30 cities, 16 units with
ar/en aliases, 9 systems / 57 subcategories, 74 engineering attributes incl. critical flags);
canonical catalog + duplicate detection (trigram + critical attributes, never auto-merged);
supplier products with dynamic attributes, price lists (retail/enterprise/org-specific/regional,
tiers, validity, VAT-inclusive), RLS-scoped price visibility, inventory with reservations; CSV/XLSX
import via worker with per-row results; supplier portal + admin catalog UI; dev seed script.

## Phase 3 — done
Projects (codes, visibility, members, activity), BOQ upload → worker pipeline (XLSX/CSV header
detection + inference, text-PDF grid rebuild, AI path for scanned/images with data policy & budget,
optional OCR), normalization (units, Arabic text, 70+ attribute rules, category classifier), matching
(hard filters, lexical+attribute+unit scoring, AI rerank budgeted), review UI (filters, edit with
revisions, candidate confirmation, bulk approve), approval into immutable versions, column-mapping
fallback, manual BOQs. AI usage logging. Golden-set accuracy tests.

## Phases 4–5 — done
RFQ lifecycle (11 states, guarded), creation from approved BOQ version or manual lines, supplier
suggestions with reasons, approval-to-send via policy engine, per-recipient send jobs with retries and
delivery log, cancellation/revision rounds/auto-close. Supplier inbox + quotation versions (draft,
submit, revise, withdraw, decline, alternatives, exceptions, attachments). Comparison matrix
(lowest price, coverage, spread, technical evaluation, sorting), per-line award with history and
invalidation on change. Approval engine (policies by operation/amount/project, sequential + parallel
steps, SoD, subject-hash invalidation). PO creation split per supplier (idempotent + unique), approval
→ issue, bilingual PDFs with verification QR, acknowledge/shipments/receipts (partial), delays,
completion, public verification page. UI for all buyer/supplier screens.
Known gaps: E2E runs the English UI only for paths 5–12 (Arabic/mobile in Phase 9).

## Phase 6 — done
Store catalog (search, category tree, brand/price/stock filters, sorting, product page with specs, tier
prices, viewer-specific prices, other suppliers' offers), wishlist, addresses (personal or buyer org),
multi-vendor cart with server-side revalidation, supplier delivery zones/rates + platform defaults,
idempotent checkout (orders → per-supplier groups → lines → typed charges, stock reservations),
payments (test provider non-prod with hosted-page simulator, Moyasar hosted-invoice adapter, bank
transfer with manual admin confirmation), signed & deduplicated webhooks with provider re-fetch,
expiry job, late-payment auto-refund, customer cancellations, supplier fulfilment (prepare/ship/deliver,
cancel with refund), returns with refunds, reconciliation ledger, per-supplier ZATCA phase-1 invoices
and credit notes, supplier balances (payouts locked off). Account: orders, wishlist, addresses.
Supplier: store orders, returns, delivery zones. Seed: platform default delivery zone (dev only).
Known gaps → Phase 8: admin finance UI (bank-transfer confirmation, refunds needing action, ledger
summary, webhook log) — services exist and are tested; store policy texts are drafts.

## Phase 7 — done
Price observations from six separated sources (catalog retail/enterprise daily, store sales, current
RFQ quotes, approved awards, issued POs) normalized to base units ex-VAT, idempotent capture, test data
flagged; daily snapshots (median, IQR, min/max/mean, n, org count, quality) with Tukey outlier removal and
privacy rules (≥5 obs, ≥3 independent orgs incl. buyers for buyer-side prices, single-supplier share
≤60%; suppressed rows keep no prices); raw observations system-only; price alerts with notifications;
buyer, supplier and platform KPIs from recorded data (platform excludes test orgs); dashboards with
accessible SVG charts (hover + data table), price index list/series/methodology/alerts; daily worker job.
Known gaps: index is national only (no per-region breakdown yet); dark mode not offered by the app.

## Phase 8 — done
Admin console (users suspend/reactivate with session revocation and guards; organizations suspend /
test-data flag; break-glass with reason, expiry, owner notification, read-only context and audit;
integrations & settings for SMTP, AI provider, bank transfer, commission, store policies and price-index
thresholds — secrets encrypted and never returned, connectivity tests; feature flags; jobs/outbox/
failed-email retry; AI usage & cost; audit viewer; privacy requests; versioned content pages with public
legal pages; platform reports & price-index health; finance (ledger, bank-transfer confirmation, manual
refunds, webhook log); store orders; default delivery rates). SMTP and AI read admin settings (60 s cache)
with env fallback. Inactive accounts cannot sign in. PDPL self-service: consents, data export (worker,
private file), deletion requests with admin review and anonymization (legal records retained).

## Phase 9 tasks
- [ ] Dockerfiles (web standalone, worker with Chromium + fonts), docker-compose.prod.yml for Coolify, migrate job, health checks
- [ ] Worker bundling of workspace packages (esbuild) and production build verification (`next build`)
- [ ] E2E: remaining critical paths in Arabic & English and mobile; axe sweep of main portal pages
- [ ] Performance measurements vs targets (list pages p95, BOQ 2,000 lines, comparison 500×8, PO PDF 200 lines) on generated data
- [ ] Security review pass (headers/CSP, authz on every action, file access, rate limits), backup/restore scripts, DEPLOYMENT.md

## Log
- 2026-11-08: Plan approved; repository initialized; documentation set created.
- 2026-11-08: Phase 1 complete — tests: unit 27, integration 20, E2E 6 (all passing).
- 2026-11-08: Phase 2 complete — tests: unit 37, integration 30, E2E 7 (all passing).
- 2026-11-08: Phase 3 complete — tests: unit 52, integration 39, E2E 8 (all passing).

- 2026-11-09: Phases 4–5 complete (RFQ, quotations, comparison/award, approvals, POs, fulfilment, verification page) — tests: unit 52, integration 42, E2E 9 (all passing).
- 2026-11-09: Phase 6 complete (store, payments, fulfilment, returns, ledger, invoices) — tests: unit 65, integration 45, E2E 12 (all passing).
- 2026-11-09: Phase 7 complete (price index, alerts, KPIs, dashboards) — tests: unit 70, integration 48, E2E 13 (all passing).
- 2026-11-09: Phase 8 complete (admin console, integrations/settings, break-glass, PDPL, content) — tests: unit 70, integration 54, E2E 15 (all passing).
