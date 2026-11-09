# Test Report

Results are recorded from actual runs only (date, command, outcome). No result is recorded without a run.

| Date | Suite | Command | Result | Notes |
|---|---|---|---|---|
| 2026-11-08 | Unit | `pnpm test` | 27/27 passed | money, text, ids, crypto, state machine, uploads, templates, role templates |
| 2026-11-08 | Integration (real Postgres, app_user role) | `pnpm test:integration` | 20/20 passed | orgs/members/invitations, RLS raw-SQL isolation, idempotency (incl. concurrency), outbox |
| 2026-11-08 | E2E desktop + mobile | `pnpm --filter @platform/web exec playwright test` | 6/6 passed | RTL/LTR, axe (no serious/critical) on auth pages, critical path 1 (register→verify via Mailpit→create org→invite→accept) |
| 2026-11-08 | Typecheck | `pnpm typecheck` | 6/6 packages | |
| 2026-11-08 | Lint | `pnpm lint` | 0 errors / 0 warnings | |
| 2026-11-08 | Production build | `next build` | success | 40 routes |
| 2026-11-08 | Unit (Phase 2) | `pnpm test` | 37/37 passed | + price selection, MOQ/increments, attribute normalization, unit aliases |
| 2026-11-08 | Integration (Phase 2) | `pnpm test:integration` | 30/30 passed | + supplier lifecycle & DB guards, doc/warehouse RLS, price-list RLS (forged buyer id), stock reservations, import rows, duplicate detection |
| 2026-11-08 | E2E (Phase 2) | `playwright test` | 7/7 passed | + critical path 2 (supplier onboarding → admin verification → product priced, stocked, published) |

| 2026-11-08 | Unit (Phase 3) | `pnpm test` | 52/52 passed | + BOQ golden set (recall 1.0; attrs ≥0.95; categories ≥0.9), PDF grid, matching rules, message catalogs |
| 2026-11-08 | Integration (Phase 3) | `pnpm test:integration` | 39/39 passed | + projects visibility, XLSX/PDF/CSV pipeline, approval & versions, AI policy/budget/kill-switch with fake provider, BOQ RLS |
| 2026-11-08 | E2E (Phase 3) | `playwright test e2e/boq.spec.ts` | 1/1 passed | critical paths 3–4 (project → upload → worker extraction → edit → approve lines → approve BOQ) |

| 2026-11-09 | Unit (Phases 4–5) | `pnpm test` | 52/52 passed | unchanged unit scope |
| 2026-11-09 | Integration (Phases 4–5) | `pnpm test:integration` | 42/42 passed | + full B2B cycle (RFQ→quotes→comparison→award approval w/ SoD & sequential steps→PO split→partial shipments/receipts), email failure retry, award invalidation on change |
| 2026-11-09 | E2E (Phases 4–5) | `playwright test` | 9/9 passed | + critical paths 5–12 in English UI (manual RFQ → seed supplier quotation → close → compare → per-line award → auto-approval → PO issue + AR/EN PDFs → acknowledge → partial + full shipment → receipt → close; verify page) |

| 2026-11-09 | Unit (Phase 6) | `pnpm test` | 65/65 passed | + Moyasar contract (mocked HTTP), test-provider production refusal & HMAC, bank transfer, minor units, ZATCA TLV, allocation, order status |
| 2026-11-09 | Integration (Phase 6) | `pnpm test:integration` | 45/45 passed | + store: multi-vendor checkout (idempotent), typed charges, webhook signature/dedupe/re-fetch/amount mismatch, ledger balanced, invoices + credit notes, supplier/customer isolation (raw SQL as app_user), cancellation & return refunds, failed payment, expiry, late payment auto-refund, checkout flag |
| 2026-11-09 | E2E (Phase 6) | `playwright test e2e/store.spec.ts` | 3/3 passed (desktop + mobile) | critical path 13 in Arabic UI; store pages have no horizontal overflow on mobile |

| 2026-11-09 | Unit (Phase 7) | `pnpm test` | 70/70 passed | + quantiles, Tukey outliers, privacy thresholds (min obs/orgs, buyer-side orgs, dominance), quality grades |
| 2026-11-09 | Integration (Phase 7) | `pnpm test:integration` | 48/48 passed | + price index (publication rules, outliers, test-data/window exclusion, RLS on raw observations & suppressed snapshots, alerts), observation capture from store sales & catalog (idempotent, base units), KPIs vs recorded totals, platform KPIs exclude test orgs |
| 2026-11-09 | E2E (all) | `playwright test` | 13/13 passed | + analytics dashboard & price index (ar) with axe checks |

| 2026-11-09 | Integration (Phase 8) | `pnpm test:integration` | 54/54 passed | + admin: suspend/reactivate (sessions revoked, context refused, self/last-admin guards), org suspension, break-glass lifecycle, encrypted settings never returned, settings validation, content versioning & public visibility, PDPL consents/export/deletion |
| 2026-11-09 | E2E (all) | `playwright test` | 15/15 passed | + admin console sweep with axe, SMTP secret hidden, content publish → public page, break-glass read-only, privacy self-service export |

| 2026-11-09 | Unit (final) | `pnpm test` | 72/72 passed | + brand decoupling, price-index stats, payments contract |
| 2026-11-09 | Integration (final) | `pnpm test:integration` | 56/56 passed | + BOQ concurrent processing, unapproved suppliers hidden from search |
| 2026-11-09 | E2E (final) | `playwright test` | 22/23 then fixed → store spec 3/3 re-run passed | + portal sweep: 37 pages × ar/en, axe on desktop, overflow on mobile |

## Performance (Phase 9, 2026-11-09)
Machine: developer laptop (12 CPU, ~8 GB RAM shared with Docker and other projects), PostgreSQL 17 in Docker,
production `next build` standalone server, dataset generated by `scripts/perf/run.ts` (test-flagged):
100,000 supplier products / 8 suppliers, a 2,000-line Arabic/English XLSX BOQ, 500 lines × 8 quotations,
a 200-line PO. 30 samples for list pages (rotating query shapes), 5 for the matrix.

| Measurement | Target | First run | After fixes | Pass |
|---|---|---|---|---|
| Store search, service p95 (100k products) | < 400 ms | 4,913 ms | 251 ms (p50 124) | ✅ |
| Store listing page, HTTP p95 (SSR, production build) | < 400 ms | 5,445 ms | 328 ms (p50 167) | ✅ |
| BOQ 2,000 lines: extract + normalize + match, no AI (upload → review via worker) | < 60 s | 30.1 s* | 23.3 s | ✅ |
| Comparison matrix 500 × 8 (service) | < 2 s | 466 ms | 304 ms | ✅ |
| PO PDF 200 lines, Arabic + English (Chromium) | < 10 s | 2.8 s | 2.5 s | ✅ |

\* The first BOQ run produced 4,000 lines: worker and script processed the same document concurrently (defect, fixed).

Fixes behind the search numbers: set-based RLS check for product visibility (InitPlan instead of a
SECURITY DEFINER call per row); trigger-maintained, indexed `store_price`; token-AND trigram matching;
SKU trigram, brand expression and "newest" partial indexes; owner-privileged `store_catalog` view for
id/count (Postgres cannot push non-leakproof `ILIKE` below RLS quals) with rows re-read under the viewer's
RLS; brand facet cached 5 min; batched stock lookups. Not measured: 20k-line BOQ listing (paginated at 100).

## Defects found by tests and fixed
- Portal sweep (axe): white text on the accent button 3.1:1, warning/success badges below 4.5:1, undefined `accent-600` token → tokens corrected.
- Portal sweep (mobile): portal header wider than 375 px in RTL, account organization rows not wrapping, grid items expanding to content width → compact header, wrapping rows, `min-w-0` on cards.
- Exact SKU searches drowned in token matches at 100k products → exact SKU match wins.
- BOQ processing was not guarded against concurrent runs (worker + manual reprocess) → duplicate lines; atomic claim added (boq.int concurrency test).
- Store search did not meet the 400 ms target at 100k products (RLS per-row function, per-row price subquery, OR-ed fuzzy match) → see Performance section.
- Admin numeric settings: an empty field was coerced to 0 instead of using the default (e.g. SMTP port) → blank values now fall back to defaults (found by E2E).
- Buyer on-time KPI referenced a non-existent `goods_receipts.received_at` column (the column is `created_at`) → found by E2E, fixed; covered by procurement.int KPI assertions.
- Set-based SQL inserts did not receive the application-side UUIDv7 default → `app_uuidv7()` SQL function added.
- axe: `aria-label` on SVG groups inside a `role=img` chart, and muted text tokens (`ink-400` 3.2:1) below AA → chart groups made presentational (table view carries values); `ink-400`/`ink-500` darkened to ≥ 4.5:1 on white/sand surfaces.
- `allocate()` could give a rounding cent to a zero-weight part (e.g. commission when commission is 0) → cents now go only to positive weights (unit test).
- Store search normalized `UPVC-110` to `upvc 110` before matching SKUs → SKUs now match the raw query (found by E2E).
- Store server actions read `key[]` names although the form helper strips `[]` → shipping choices were dropped (found by E2E).
- Empty `<select>` value failed optional enum validation (org creation) → blank→undefined preprocessing.
- Post-action navigation used non-locale router → 404; switched to next-intl router.
- Better Auth 1.7 2FA table required new columns → migration `0001_auth_two_factor_fields`.
- Zod messages were shown in English in Arabic UI → localized validation messages.
- `useSearchParams` without Suspense broke static prerendering → Suspense boundaries.
- Error helper keys: `validation(msg, {key})` lost the key → helpers now honour `key`.
- SeaweedFS could not grow volumes with `-volume.max=5` → raised limit, smaller volumes.
- Modals stayed open after successful submit (page aria-hidden) → forms close their modal on success.
- Arabic unit words not matched (JS `` ASCII-only) → attribute accuracy 91.9% → normalized to Latin tokens → ≥95%.
- Dotted next-intl message keys crashed rendering → keys renamed; catalog parity test added.
- `sendDelivery` rethrew inside the transaction so attempt/failure records were rolled back → persisted, then rethrown after commit (procurement.int).
- Dual-button forms (save vs submit quotation, approve vs reject) set intent via state in onClick, racing the submit → submitter `name`/`value` used instead.
- E2E located POs by number; numbers are per buyer org so a supplier sees duplicates from different buyers → navigate by id (list shows buyer name).
