# Progress

Last updated: 2026-11-08

## Current phase: 6 — Store & payments (starting)

| Phase | Status |
|---|---|
| 0 Planning | Done (approved 2026-11-08) |
| 1 Foundation | Done (see Phase 1 notes) |
| 2 Suppliers & Catalog | Done |
| 3 Projects & BOQ | Done |
| 4 RFQ & Quotations | Done |
| 5 Approvals & PO | Done |
| 6 Store | In progress |
| 7 Analytics & Price Index | Pending |
| 8 Admin & Integrations | Pending |
| 9 Integration hardening | Pending |
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

## Phase 6 tasks
- [ ] Schema: addresses, carts/cart_items, wishlists, shipping zones/rates, orders/order_groups/order_lines/order_charges,
      payment_intents/attempts/webhook_events, refunds, returns, ledger_entries (no payouts) + RLS
- [ ] Store pages: home, category, search/filter, product page with supplier offers, wishlist
- [ ] Multi-vendor cart with revalidation (price/stock/MOQ), shipping per supplier group, VAT
- [ ] Checkout (idempotent), stock reservation, payment provider abstraction: test provider (non-prod only),
      Moyasar adapter (sandbox; live = Integration Pending), bank transfer; signed webhooks
- [ ] Order lifecycle per supplier group; supplier order handling; cancellations, returns, refunds
- [ ] Settlement ledger entries (commission/supplier payable separated); payouts flag locked
- [ ] Account pages: orders, wishlist, addresses; tests (unit charges, integration webhooks/idempotency, E2E path 13)

## Log
- 2026-11-08: Plan approved; repository initialized; documentation set created.
- 2026-11-08: Phase 1 complete — tests: unit 27, integration 20, E2E 6 (all passing).
- 2026-11-08: Phase 2 complete — tests: unit 37, integration 30, E2E 7 (all passing).
- 2026-11-08: Phase 3 complete — tests: unit 52, integration 39, E2E 8 (all passing).

- 2026-11-09: Phases 4–5 complete (RFQ, quotations, comparison/award, approvals, POs, fulfilment, verification page) — tests: unit 52, integration 42, E2E 9 (all passing).
