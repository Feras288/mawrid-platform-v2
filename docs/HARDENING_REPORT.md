# Engineering Hardening Report — P0 finance & procurement

Baseline: commit `88b6b37` · Branch: `hardening/p0-finance-procurement` · Date: 2026-11-09
Scope: five high-severity findings from an independent engineering audit (AUD-001, 004, 005, 006, 007).
No features, no UI/UX changes, no deployment, no production keys or gateways.

Method: every finding was re-verified against the code by writing a reproduction test **first** and running it
against the unmodified baseline; only then was the fix written. "Fails on baseline" below means the test
failed on `88b6b37` for the stated reason; all of them pass after the fix.

## Verdicts

| ID | Audit claim | Verdict | Severity (re-assessed) |
|---|---|---|---|
| AUD-001 | Re-delivery of a webhook whose processing failed is not reprocessed | **Confirmed** | High |
| AUD-004 | More than one successful capture for an order goes undetected / unsettled | **Confirmed** | High |
| AUD-005 | Repeating `poItemId` in a shipment / receipt can exceed allowed quantity | **Partly confirmed** — the quantity cap *cannot* be exceeded (DB constraints), but the request fails with a raw constraint error and validation is not cumulative | Medium |
| AUD-006 | PO cancellation races with registering a shipment | **Confirmed** | High |
| AUD-007 | A refund can stay `pending` forever after provider outage | **Confirmed** (five related defects) | High |

---

## AUD-001 — Failed webhook events are never re-processed

**Root cause.** `processWebhook` de-duplicated with `INSERT … ON CONFLICT DO NOTHING` on
`(provider, event_id)` and answered `200 duplicate` whenever the row existed — regardless of its status.
When processing failed (e.g. provider re-fetch down) the row was marked `failed` and `500` returned so the
provider would retry; the retry carried the same event id, hit the conflict, got `200 duplicate`, and the
payment was never applied. A worker crash mid-processing left the row in `received` with the same effect.

**Evidence (fails on baseline).** `hardening-finance.int.test.ts` › *AUD-001*:
- "reprocesses the same event id after a transient failure" — got `{200,"duplicate"}`, expected `succeeded`.
- "concurrent redeliveries of a FAILED event: a single worker wins the retry" — nobody reprocessed (0 winners).
- "recovers an event stranded in 'received' …" (needs the new column; fails on baseline).

**Fix.** `claimWebhookEvent` (`packages/modules/src/payments/index.ts`): first delivery inserts; a redelivery
re-claims the row with **one conditional `UPDATE`** only if its status is `failed`, or `received` with a
last attempt older than the 5-minute lease. Concurrent redeliveries cannot both win (the loser re-evaluates the
predicate after the winner commits and gets `duplicate`). `processed`, `ignored` and in-flight events stay
`duplicate`. New columns `attempts`, `last_attempt_at` record the attempts. State application
(`applyProviderStatus`) was already idempotent, so a late finish by a stale worker is harmless.

**Tests that now pass.** reprocess after failure (+ attempts = 2, then plain duplicate); 6 concurrent
deliveries → exactly one `succeeded`, one `paid` event, one journal, one invoice; 5 concurrent redeliveries of
a failed event → one winner; stranded `received` is recovered only after its lease; invalid signature still 401.

**Residual / not changed.** An event whose reference matches no intent is stored `ignored` (`unknown_reference`)
and is not re-claimable. Only possible if a webhook outruns the `providerRef` write in `startPayment`
(seconds-scale window; customers pay on a hosted page afterwards). `syncOrderPayment` on return covers it.

---

## AUD-004 — Several successful captures for one order

**Root cause.** `startPayment` supersedes the previous live intent *only in our database* (`cancelled`); the
hosted payment page at the provider stays payable and the adapter contract has no cancel call. If the customer
pays both, `applyProviderStatus` (a) happily accepted success for a `cancelled` intent, (b) never asked whether
the order was already paid, so the second capture was marked `succeeded`, re-ran `markOrderPaid` (second `paid`
event) and **nothing refunded the extra money**; (c) `refundPayment` later picked an arbitrary `succeeded`
intent (`LIMIT 1`), possibly the wrong one. It also locked intent → order while refunds locked order → intent.

**Evidence (fails on baseline).** `hardening-finance.int.test.ts` › *AUD-004*: second webhook returns
`succeeded` (expected `refund_duplicate_payment`); concurrent webhooks return `["succeeded","succeeded"]`;
the business refund targets the wrong intent; DB accepts a second primary success.

**Fix.**
1. `applyProviderStatus` takes the **order row lock first** (order → intent → refund → group, the same order
   everywhere), so notifications for different intents of one order are serialised.
2. Under that lock, a verified-amount success for an order that already has a primary capture is recorded as a
   **duplicate**: `payment_intents.duplicate_of → primary`, order event `duplicate_payment`, audit
   `payment.duplicate_capture`, and a full refund of that intent (reason `duplicate_payment`, key `dup:<intent>`).
3. The books are untouched for duplicates: `completeRefund` skips order/group refunded totals, the ledger and
   credit notes for `duplicate_payment` (the extra money was never booked); it updates only the intent's
   `refunded_amount`, records the event and notifies the customer.
4. DB guarantee: partial unique index `payment_intents_one_primary_uq (order_id) WHERE status='succeeded' AND
   duplicate_of IS NULL`. Migration `0013` first repairs legacy rows (earliest capture stays primary, the rest
   are flagged duplicates) so the index can be created on existing data.
5. Business refunds select the primary capture (`duplicate_of IS NULL`), or an explicit `intentId`.
6. Related: a *superseded* intent that expires/fails no longer flips an order to `payment_failed` while another
   intent can still pay it.
7. The refund request is written **in the same transaction** as the classification; the provider call follows
   the commit and is recoverable (see AUD-007), so a crash cannot lose the refund (this also fixes the same gap
   for late payments after expiry).

**Tests.** first capture booked once + second refunded in full with unchanged ledger/credit notes/order refunded
total, audit + event written, redelivery is a no-op; both captures reported concurrently → one primary, one
duplicate (either order); later cancellation refund goes to the primary; DB refuses a second primary; a
duplicate with a wrong amount is still `amount_mismatch`; superseded-intent expiry keeps the order payable.

**Limitation (documented, not a regression).** We detect and refund the extra capture; we cannot *prevent* the
customer from paying an abandoned hosted page because the provider adapter has no cancel operation. Adding one
is a provider-contract change and was left out of scope.

---

## AUD-005 — Repeated `poItemId` in shipments / receipts

**What was verified.** `createShipment` / `recordReceipt` validated each line against the *same* stale
quantities, so `[60, 60]` against 100 ordered passes line-by-line. However the second `INSERT` into
`shipment_items` / `goods_receipt_items` violates the composite primary key, the transaction rolls back, and
`po_items` also has `CHECK shipped ≤ quantity` / `received + rejected ≤ shipped`. **The cap cannot be exceeded**
— the audit's stated impact is not reproducible. The real defect: the caller gets an unhandled
`DrizzleQueryError` (HTTP 500) and correctness relies solely on constraints.

**Evidence (fails on baseline).** *AUD-005* tests receive `DrizzleQueryError … shipment_items_shipment_id_po_item_id_pk`
/ `goods_receipt_items_…_pk` instead of a validation error.

**Fix.** `assertUniqueLines` rejects a repeated line with `VALIDATION / duplicate_line` before any write
(zero-quantity repeats are dropped first, as before). Rejecting is deliberate: a repeated line is ambiguous input
and silently merging would change what the user asked for.

**Additional defect found while verifying (confirmed, fixed).** `recordReceipt` accepted any `shipmentId` — a
receipt could reference another PO's shipment (the FK has no ownership check) and then flag it `delivered` via
an `AND po_id` guard that silently matched nothing. Now `shipment_not_in_po` is raised.

**Tests.** duplicate line in shipment (sum over and under the cap) and receipt → `duplicate_line`, no shipment /
receipt / quantity change; normal multi-line and zero-quantity-repeat shipments still work; two simultaneous
shipments of 60 against 100 → exactly one succeeds (`shipment_qty_exceeds` for the other); foreign shipment id
rejected.

---

## AUD-006 — Cancel PO vs. register shipment

**Root cause.** `createShipment` read the PO and checked its status *outside* the transaction and then locked
only `po_items`; `cancelPo` read the shipment count without any lock and then updated the PO. Two interleavings
produced a cancelled PO with shipments: (1) shipment passes its status check → cancel commits → shipment
commits; (2) cancel counts 0 shipments → shipment commits → cancel commits. `acknowledgePo` / `reportDelay`
wrote from a stale read (an acknowledge landing after a cancel set `fulfillmentStatus` back to `preparing` on a
cancelled PO).

**Evidence (fails on baseline).** deterministic interleaving (a second connection freezes `createShipment` on
the item locks while the cancel runs): cancelled PO **with** a shipment; 12-round randomised race; acknowledge
vs. cancel resurrecting `preparing`.

**Fix.** The PO row is the serialisation point. `cancelPo`, `createShipment`, `recordReceipt`, `completePo`,
`acknowledgePo`, `reportDelay` all take `SELECT … FOR UPDATE` on the PO first (then item rows — one lock order)
and **re-validate the state under the lock** (`lockSupplierPo` / `loadBuyerPo({lock:true})`). The loser of a
race now fails cleanly with `po_has_shipments` (cancel) or `po_closed` (shipment).

**Tests.** deterministic interleaving (exactly one side wins, never cancelled + shipment, clean error keys);
shipment after committed cancel refused; 12 randomised rounds; acknowledge against a concurrent cancel keeps the
PO cancelled; ship → cannot cancel → receive → complete regression.

---

## AUD-007 — Refund stuck after provider outage

**Root causes (all confirmed).**
1. `refundPayment` committed a `pending` refund, then called the provider **without handling exceptions**. A
   network failure left the row `pending` with no reference; the customer-facing cancel call threw *after* the
   cancellation had been committed.
2. A retry with the same idempotency key returned the existing row and never called the provider again.
3. `MoyasarProvider.refund` turned **every** error — timeout, 502, 429 — into a terminal `failed`, although the
   outcome is unknown (the refund may have been executed). A terminal `failed` is never retried.
4. Concurrent calls with one key both passed the "exists?" check before the order lock → unique-violation 500.
5. Lock-order inversion (`refundPayment`: order → intent; `completeRefund`: intent → order). Observed on the
   baseline: of four concurrent 10.00 refunds on a 23.00 order only 1 succeeded and 2 failed with a database
   error on `SELECT … FROM orders … FOR UPDATE` (deadlock-type failure; the error text only carries the query).
   Also, per-group capacity ignored refunds still in flight.
6. A return whose refund completed later stayed `received` forever.

**Fix.**
- Refund = **request** (`requestRefund`, one transaction, idempotent per key, key checked *under* the order
  lock, capacity per intent and per group including in-flight refunds) + **execution** (`executeRefund`).
- `executeRefund` claims an attempt with a conditional `UPDATE` lease (`attempts`, `last_attempt_at`;
  `REFUND_RETRY_AFTER_MS` = 60 s): callers, retries and the job never hit the provider simultaneously; a refund
  the provider acknowledged (`provider_ref` set) is never re-sent. A thrown error = unknown outcome → stays
  `pending` (`failure_reason = provider_unreachable`), attempt recorded in `payment_attempts`. After
  `REFUND_MAX_ATTEMPTS` (6) it becomes `manual_required` with an audit entry (`refund.escalated`), the amount
  stays reserved, and it appears in the admin "refunds needing action" list.
- The provider is always called with the refund's idempotency key, so retrying an executed-but-unanswered
  refund returns the original result instead of refunding twice.
- `MoyasarProvider.refund`: 4xx (except 408/429) → terminal `failed`; everything else is thrown (unknown).
- New job `store.recover_refunds` (worker, every 5 min) → `recoverPendingRefunds()`.
- `completeRefund` locks order → intent → refund, and closes the return request (`return:<id>` key).
- `TestPaymentProvider.refund` is now idempotent per key and bounded by the captured amount (as real providers
  are), plus a `refundedMinor()` test probe.

**Tests (fail on baseline).** outage during supplier cancellation does not fail the cancel and the job
completes the refund once (single credit note, balanced ledger, idempotent re-run); explicit same-key retry
resumes it (and respects the lease); "lost response" — provider executed the refund but the reply never came —
recovered with the provider total unchanged (7.50 once); attempt budget → `manual_required`; terminal provider
rejection is not retried and releases its amount; 5 concurrent same-key calls → one refund, one provider
refund; 4 concurrent refunds never exceed the captured amount; return request closes after a recovered
refund. Unit: Moyasar 5xx/408/429/network/non-JSON are thrown, 4xx stays `failed`, idempotency key sent on every
attempt; test-provider replay and over-refund guard.

---

## Behaviour changes reviewers should know about
1. `refundPayment` no longer throws when the provider is unreachable; it returns `status: "pending"`
   (existing status value) and the job completes it. DB errors still throw.
2. `PaymentProvider.refund` may now **throw** when the outcome is unknown (Moyasar). Documented on the interface.
3. New order event kinds `duplicate_payment`, `duplicate_payment_refunded`; new audit actions
   `payment.duplicate_capture`, `refund.escalated`; new refund reason `duplicate_payment`; new job `store.recover_refunds`.
4. Migration `0013_hardening_p0` (additive columns, one partial unique index, legacy repair). Reversible by
   dropping the index and columns; no data is deleted.
5. Lock order convention (documented in code): **order → payment intent → refund → group**, and
   **PO → PO items** for procurement.

## Public contracts
Service signatures, REST/server-action shapes, RLS policies and roles are unchanged. `RefundInput` gained an
optional `intentId`; `RefundInput.reason` and webhook/refund status vocabularies gained values (above). No UI,
no new features.

## Observations outside this scope (not changed)
- **OBS-1 — late payment after expiry leaves a negative supplier balance (verified, pre-existing).** An order
  that expires unpaid and is then paid is refunded automatically (correct), but `markOrderPaid` is skipped so the
  payment journal is never posted while `completeRefund` posts the reversal. Verified with a scratch test:
  `supplierBalance` = **-23.00** for a 23.00 order (trial balance stays balanced because each journal is
  balanced). Not one of the five findings and it touches ledger semantics, so it is left for a decision; the fix
  is small (skip the reversal when no payment journal exists for the group, or post both legs).
- **OBS-2 — no provider-side cancel for superseded intents** (limitation under AUD-004).
- **OBS-3 — `unknown_reference` webhooks are `ignored` and not re-claimable** (residual under AUD-001).

## Results (actual runs, 2026-11-09, sequential, local Postgres/Valkey/SeaweedFS)

| Check | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | 0 errors / 0 warnings |
| Typecheck | `pnpm typecheck` | 6/6 packages |
| Unit | `pnpm test` | **75/75** (72 + 3 new adapter tests) |
| Integration | `pnpm test:integration` | **90/90** (61 + 29 new: 19 finance, 10 procurement) |
| E2E | `pnpm test:e2e` | **23/23** (dev DB migrated with 0013 first) |
| Migration: schema drift | `drizzle-kit generate` | "No schema changes" |
| Migration: fresh apply | integration global setup (drop schema → all migrations + RLS) | applied |
| Migration: upgrade of dev DB | `pnpm db:migrate` | applied, columns present |
| Migration: legacy data | rolled-back transaction: 3 captures for one order → repair → unique index | 1 primary, 2 duplicates pointing at it, index created |

Reproduction run on the unmodified baseline: 6 of 10 procurement tests and 14 of 17 finance tests failed for
the reasons stated above; after the fixes all pass.

Test-isolation note: the hardening suites share one supplier/buyer per file. Approved suppliers are global
state that `suggestSuppliers` (top-20) ranks against, and creating ~40 of them made the existing procurement
cycle test fail when it ran afterwards. That test was not modified.

## Files
`packages/modules/src/payments/index.ts`, `packages/modules/src/purchase-orders/index.ts`,
`packages/integrations/src/payments/index.ts`, `packages/db/src/schema/commerce.ts`,
`packages/db/migrations/0013_hardening_p0.sql` (+ meta), `packages/modules/src/wiring/index.ts`,
`apps/worker/src/schedules.ts`; tests `packages/modules/test/hardening-{finance,procurement}.int.test.ts`,
`payments.unit.test.ts`.
