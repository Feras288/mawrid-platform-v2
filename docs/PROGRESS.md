# Progress

Last updated: 2026-11-08

## Current phase: 3 — Projects & BOQ (in progress)

| Phase | Status |
|---|---|
| 0 Planning | Done (approved 2026-11-08) |
| 1 Foundation | Done (see Phase 1 notes) |
| 2 Suppliers & Catalog | Done |
| 3 Projects & BOQ | In progress |
| 4 RFQ & Quotations | Pending |
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

## Phase 3 tasks
- [ ] Projects (CRUD, members, activity, files) + org dashboard counts
- [ ] BOQ schema: documents, processing runs, items, matches, revisions, versions (+ RLS)
- [ ] Extraction: XLSX/CSV header detection, text PDF (unpdf), scanned/images via AI or OCR fallback
- [ ] Normalization: units, Arabic text, attribute extraction rules
- [ ] Matching engine (hard filters + trigram + attributes + optional AI rerank)
- [ ] AI provider layer (anthropic, openai-compatible, disabled) with budgets/data policy/usage log
- [ ] Review UI, approval, versions; golden-set accuracy tests

## Log
- 2026-11-08: Plan approved; repository initialized; documentation set created.
- 2026-11-08: Phase 1 complete — tests: unit 27, integration 20, E2E 6 (all passing).
- 2026-11-08: Phase 2 complete — tests: unit 37, integration 30, E2E 7 (all passing).
