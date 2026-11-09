# Progress

Last updated: 2026-11-08

## Current phase: complete — awaiting owner decisions and approval for staging (see FINAL_AUDIT.md §7)

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
| 9 Integration hardening | Done |
| 10 Final audit | Done |

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

## Phase 9 — done
Production build verified (standalone server), worker esbuild bundle + hoisted deploy + bundled migrate
verified, Dockerfiles and Coolify compose written (local image build blocked by Docker VM network), CI images
job, backup/restore scripts with a passing drill, DEPLOYMENT.md, security review, brand-decoupling test,
performance work (all 5 targets met at 100k products: set-based RLS check, `store_price`, `store_catalog` view,
indexes, exact-SKU search), BOQ concurrency guard, portal sweep E2E (ar/en, axe, mobile) with fixes.

## Phase 10 — done
RTM reviewed row by row: 77 Tested, 5 Implemented, 1 Integration Pending, 0 Not Implemented (83).
FINAL_AUDIT.md written. Next steps belong to the owner (decisions, accounts, staging approval).

## Resume notes (if work continues)
- Dev DB contains ~100k generated perf products from 8 test-flagged suppliers (`Perf Supplier%`); harmless for
  tests, delete with SQL if desired (dev data only).
- Start services: `pnpm infra:up`, then preview servers `web` (3100) and `worker` (3101). Clear
  `auth_rate_limits` before E2E runs.

## Log
- 2026-11-08: Plan approved; repository initialized; documentation set created.
- 2026-11-08: Phase 1 complete — tests: unit 27, integration 20, E2E 6 (all passing).
- 2026-11-08: Phase 2 complete — tests: unit 37, integration 30, E2E 7 (all passing).
- 2026-11-08: Phase 3 complete — tests: unit 52, integration 39, E2E 8 (all passing).

- 2026-11-09: Phases 4–5 complete (RFQ, quotations, comparison/award, approvals, POs, fulfilment, verification page) — tests: unit 52, integration 42, E2E 9 (all passing).
- 2026-11-09: Phase 6 complete (store, payments, fulfilment, returns, ledger, invoices) — tests: unit 65, integration 45, E2E 12 (all passing).
- 2026-11-09: Phase 7 complete (price index, alerts, KPIs, dashboards) — tests: unit 70, integration 48, E2E 13 (all passing).
- 2026-11-09: Phase 8 complete (admin console, integrations/settings, break-glass, PDPL, content) — tests: unit 70, integration 54, E2E 15 (all passing).
- 2026-11-09: Phase 9 complete (build/deploy artifacts, performance targets met, hardening, portal sweep).
- 2026-11-09: Phase 10 complete — FINAL_AUDIT.md; tests: unit 72, integration 56, E2E 23 (store spec re-run after final fix).
- 2026-11-09: Release verification — unit 72, integration 61, E2E 23/23 (clean run); fixed suspended-organization visibility, build-time DATABASE_URL dependency, web TypeScript dependency; RELEASE_READINESS.md.
- 2026-11-09: UI/UX redesign (design system, store, portals, dashboards, RFQ comparison) — no API/business-logic changes; VISUAL_AUDIT.md, DESIGN_SYSTEM.md, UI_UX_FINAL_REPORT.md; tests: unit 72, integration 61, E2E 23/23 (clean run).
- 2026-11-09: Engineering hardening P0 (branch `hardening/p0-finance-procurement`, PR pending review, not merged) — AUD-001/004/005/006/007 verified and fixed; migration 0013; tests: unit 75, integration 90, E2E 23/23. HARDENING_REPORT.md.
- 2026-11-09: Hardening P0 review round 2 (PR #1, not merged) — refund reconciliation for provider-accepted refunds, OBS-1 fixed (no reversal of unposted payments), manual settlement path for historical duplicate captures; migration 0014; tests: unit 76, integration 108, E2E 23/23.
