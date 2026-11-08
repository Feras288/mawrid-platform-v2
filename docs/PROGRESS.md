# Progress

Last updated: 2026-11-08

## Current phase: 4 — RFQ & Quotations (in progress)

| Phase | Status |
|---|---|
| 0 Planning | Done (approved 2026-11-08) |
| 1 Foundation | Done (see Phase 1 notes) |
| 2 Suppliers & Catalog | Done |
| 3 Projects & BOQ | Done |
| 4 RFQ & Quotations | In progress |
| 5 Approvals & PO | Pending |
| 6 Store | Pending |
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

## Phase 4 tasks
- [ ] RFQ schema (rfqs, items, recipients + events, attachments, events) + RLS bridge for suppliers
- [ ] RFQ creation from approved BOQ version / manual lines; supplier suggestions
- [ ] Submit → approval-to-send (policy hook, Phase 5 engine) → send jobs (email + in-app), retries, delivery log
- [ ] Supplier portal: inbox, response (prices, partial qty, lead time, alternatives, exceptions, validity, charges, attachments), drafts, revisions
- [ ] Comparison matrix (filters, sort, highlights) + evaluation records
- [ ] Tests: isolation (competitor quotes), idempotent sending, matrix math; E2E paths 5–8

## Log
- 2026-11-08: Plan approved; repository initialized; documentation set created.
- 2026-11-08: Phase 1 complete — tests: unit 27, integration 20, E2E 6 (all passing).
- 2026-11-08: Phase 2 complete — tests: unit 37, integration 30, E2E 7 (all passing).
- 2026-11-08: Phase 3 complete — tests: unit 52, integration 39, E2E 8 (all passing).
