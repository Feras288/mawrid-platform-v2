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
- The provider is called with the refund's idempotency key. **Superseded by review round 3:** the platform only re-sends
  after an unknown outcome to providers that PROVE refund idempotency; Moyasar does not (see round 3).
- Refunds the provider **accepted as pending** (`provider_ref` set) are not re-sent but reconciled — see Review round 2, R2-1.
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
- **OBS-1 — resolved in review round 2 (R2-2).**
- **OBS-2 — no provider-side cancel for superseded intents** (limitation under AUD-004).
- **OBS-3 — `unknown_reference` webhooks are `ignored` and not re-claimable** (residual under AUD-001).

## Review round 2 (PR #1 independent review)

Three financial points were raised on the same branch. As before, reproduction tests were written first and run
against the round-1 code (`480e22e`): 16 of 18 new tests failed for the reasons below (the other two are
regression guards for booked payments and supplier cancellation, which already behaved correctly).

### R2-1 — refunds the provider accepted as `pending` were never followed up

**Cause.** `recoverPendingRefunds` selected only `provider_ref IS NULL` (so it would not re-send an accepted
refund — correct) but nothing else ever looked at refunds that *had* a `provider_ref`. They stayed `pending`
forever, holding their amount in the refundable capacity and never reaching the ledger / credit note.
**Evidence (round-1 code).** pending+ref refunds were never examined (`completed` = 0, lookup never called).

**Fix.**
- Optional provider capability `PaymentProvider.fetchRefund(...)`: a read-only status lookup (never a second
  refund call). Moyasar: `GET /payments/{id}`; refunds apply to the payment, so the refund is confirmed when the
  payment's cumulative `refunded` total (or status `refunded`) covers *confirmed-so-far + this refund*. Test
  provider: replays the recorded result for the refund's idempotency key.
- `reconcileAcknowledgedRefund`, run by the same job (`recoverPendingRefunds`, every 5 min):
  - claimed with the lease (`last_attempt_at`), so concurrent sweeps and workers do not double-process;
  - **oldest first and only when no older refund of the same payment is `pending`/`manual_required`**, so a
    cumulative provider total can never be credited to the wrong refund;
  - `succeeded` → `completeRefund` (idempotent; order → intent → refund locks; ledger, credit note, return closed);
  - `failed` → only when the provider *reports* a rejection: status `failed`, reserved amount released,
    attempt recorded; no ledger effect;
  - lookup error or `pending` → unchanged, retried next sweep;
  - still unconfirmed after `REFUND_CONFIRM_MAX_AGE_MS` (48 h) → `manual_required`
    (`provider_unconfirmed`, audit `refund.escalated`); providers without `fetchRefund` take the same path.
- Idempotency guarantees: the reconcile path performs no provider write at all. (Round 3 restricts the resend path
  to providers with proven refund idempotency.)

**Tests.** confirm → completed once, refund call count stays 1, credit note once, repeated sweep no-op; pending →
stays pending and the lease prevents re-polling; provider failure → `failed`, amount released, order still `paid`,
new refund possible; lookup error → retried; 48 h → `manual_required` + audit; two refunds of one payment are
examined in order with the correct `refundedBeforeMinor`; 5 concurrent sweeps → one completion. Unit: Moyasar
`fetchRefund` is a GET and applies the cumulative rule (incl. 503 → thrown, not a verdict).

**Limitations.** (a) A refund made *outside* the platform on the same payment (e.g. in the provider dashboard)
counts toward Moyasar's cumulative total and could confirm one of ours early; finance should refund through the
platform. (b) `manual_required` older refunds block reconciliation of newer ones of the same payment until
finance resolves them (deliberate: wrong money attribution is worse than a delay; the newer one escalates after 48 h).
(c) Moyasar exposes no explicit refund-failure state, so Moyasar refunds end as confirmed or escalated, never auto-`failed`.

### R2-2 — OBS-1: late payment then refund drove supplier_payable negative

**Accounting decision.** A payment that arrives after the order expired is never *recognised*: the order is
cancelled, `markOrderPaid` is skipped, no supplier payable / commission / VAT is booked, and the money goes
straight back. The correct entry is therefore **none** — not a reversal of legs that were never posted. The
platform ledger only models recognised, supplier-attributable amounts; the cash in/out of a refunded late payment
is tracked by `payment_intents` / `refunds`, not by `ledger_entries` (the four-account chart has no suspense
account and adding one would change the model). `completeRefund` now reverses a group's legs **only if that group
has a `payment` journal**; customer-facing state (order `refunded`, refunded totals, event, notification) is unchanged.
**Evidence (round-1 code).** after a late payment + refund: platform_clearing −23.00, supplier_payable +23.00 debit
(supplier balance −23.00), i.e. the books showed a refund of money that was never booked.

**Tests.** late payment + refund (webhook): zero ledger rows for the order, per-account net all `0.00`, supplier
balance and *every platform account's debit and credit totals* identical to before (not merely balanced);
same with a provider outage + recovery; booked payments unchanged with exact per-account figures after payment
(clearing 23.00 / payable −23.00 / commission 0 / VAT 0), partial refund 5.00 (18.00 / −18.00), full refund
(all 0.00) and supplier balance deltas; supplier cancellation still reverses exactly what was booked.

**Historical data — migration 0014 (data only).** Refund journals on groups that have no payment journal get an
idempotent compensating journal (debit/credit swapped, memo `correction:unposted_payment`, deterministic ids). The
ledger stays append-only. Verified in a rolled-back transaction: net −23.00/+23.00 → 0.00/0.00, second run adds
nothing, a booked group is untouched, all journals balanced.

### R2-3 — historical duplicates flagged `duplicate_of` by migration 0013

0013 only classifies; it never refunds. Live-flow duplicates get their refund request in the same transaction
as the classification and are executed automatically (that is the intended behaviour for new payments).
**Historical** duplicates have no refund request, are not touched by the sweeper or by webhooks, and now have an
explicit reconciliation path (service layer; no UI added):
- migration 0014 writes one audit row per flagged intent (`payment.duplicate_capture_legacy`, state
  `needs_review`);
- `listDuplicateCaptures(ctx)` (`admin.finance`): every flagged capture with its primary, amount and state
  `needs_review | refund_in_progress | refunded | dismissed`;
- `settleDuplicateCapture(ctx, intentId, { action, note })` (`admin.finance`, note ≥ 3 chars):
  - `refund`: **re-reads the payment from the provider** and refuses (`duplicate_not_verified`) unless it is still
    captured for exactly the intent's amount and currency (bank transfers cannot be re-read — the note is the
    evidence and the refund ends in the existing manual-confirmation flow); then requests the refund through the
    normal idempotent, recoverable pipeline (`dup:<intent>`, `requestedBy` = the admin), audited
    (`payment.duplicate_capture_settled`). Books, ledger, credit notes and order refunded totals are not touched;
  - `dismiss`: for captures already handled outside the system; audited, recorded as an order event;
  - repeating the same action is idempotent (4 concurrent calls → one refund); the two actions exclude each other
    (`duplicate_already_settled`); non-duplicates are refused (`not_a_duplicate`).

**Tests.** no automatic refund by sweeper or webhook; finance permission and note enforced; provider verification
(wrong amount / not captured → nothing refunded); verified refund once under concurrency with audit, unchanged
platform totals and no credit note; dismiss/refund exclusivity; outage during a settled refund recovers via the job.

**Not done (needs a decision).** Wiring these two functions into the admin finance screen. It was left out
because the request excluded UI changes; the service API is complete and tested.

## Review round 3 — is Moyasar refund idempotency proven? (decision record)

**Question.** `MoyasarProvider.refund` sends an `idempotency-key` header and the recovery strategy re-POSTed a refund
with an unknown outcome on the assumption that Moyasar would replay the original result instead of refunding again.

**Evidence reviewed (official Moyasar documentation, read 2026-11-09).**
1. [Idempotency](https://docs.moyasar.com/api/idempotency): describes "payment creation idempotency" only. The
   mechanism is a client-generated `given_id` (UUID) in the request **body** of the create-payment call; reusing it for a
   different payment returns 400. No HTTP header is mentioned. Refunds, voids and captures are not mentioned at all.
2. [Refund Payment reference](https://docs.moyasar.com/api/payments/05-refund-payment): path `id`, optional body
   `amount`; **no headers listed**, no `Idempotency-Key`, no `given_id`; nothing about retries or about what happens if
   the same refund request is sent twice. Whether several partial refunds accumulate is not stated either.
3. [Payment operations guide](https://docs.moyasar.com/guides/payment-operations): for a failed refund it advises
   checking the payment with `GET /v1/payments/{id}`, **retrying the refund once**, then contacting support; it does not
   mention idempotency or duplicate-refund protection.
4. [Fetch payment](https://docs.moyasar.com/api/payments/02-fetch-payment) / [status reference](https://docs.moyasar.com/api/payments/payment-status-reference):
   the payment object has `refunded` (integer, "refunded amount, ≤ payment amount") and `refunded_at`; the docs do not say
   whether a partial refund changes `status`.

**Decision.** Refund idempotency at Moyasar is **not documented and therefore not proven**; I did not contact Moyasar or
call the API (no production keys, no live gateway). We therefore treat it as absent:
- New adapter capability `PaymentProvider.refundIdempotency?: "proven" | "unproven"`. Moyasar = `unproven`
  (with the evidence above in the code comment); the simulator = `proven` (it models a provider that replays by key);
  unset is treated as unproven. The `idempotency-key` header is still sent, as a best-effort hint that is **not relied upon**.
- For a provider that is not `proven`, **only the first POST is ever sent automatically** (`attempts = 0` claim). Any
  later situation — the call threw or timed out, 5xx, the process died after the claim — is an *unknown outcome* and is
  **never re-POSTed**, neither by the recovery job nor by an explicit same-key retry. (This matches the vendor's own
  guidance only in spirit: their "retry once" is a manual step after checking the payment, which is what the reconciliation does.)
- Unknown outcomes are **reconciled by reading the payment** (`fetchRefund`, a GET): confirmed only on *positive*
  evidence — the payment's cumulative `refunded` total covers (confirmed so far + this refund). A bare `status` is not
  accepted as evidence. Then `completeRefund` runs (idempotent, ledger, credit note, return closed).
- When the read cannot establish the outcome (lookup failing, or no refund visible) the refund stays `pending` and is
  re-read each sweep for `REFUND_UNKNOWN_OUTCOME_MAX_AGE_MS` (30 min, to let an in-flight request settle), then goes to
  **`manual_required`** (`failureReason = outcome_unknown`, audit `refund.escalated`) with its amount still reserved. We
  accept that a request which genuinely never reached Moyasar also ends in manual follow-up: with no proof of
  idempotency, finance (who can check the Moyasar dashboard) decides, instead of the platform risking a second refund.
- Providers that *do* prove refund idempotency keep the earlier behaviour (same-key retry, attempt budget of 6).
- Unchanged: accepted-as-pending refunds are reconciled, never re-sent; reconciliation is oldest-first per payment.

**Required test — "the provider executed the refund but the response was lost, then a recovery attempt arrives".**
`hardening-finance3.int.test.ts` simulates a Moyasar-like provider (no replay: every POST is a new refund at the
provider; only the cumulative total is visible): the first POST executes then throws `ETIMEDOUT`; the recovery sweep
reconciles it from the payment total — refund `succeeded`, credit note once, provider total **exactly 5.00**, POST count **1**.
On the round-2 code the same scenario sent a **second POST** (POST count 2 = double refund) — reproduced first.

Other round-3 tests: request never reached the provider → no re-POST across sweeps, escalates to `manual_required` after
the window with audit and the amount still reserved; explicit same-key retry after the lease does not POST; failing
lookup is not a verdict (waits, later confirmed without any POST); a refund never attempted (crash before the first
send) still gets its first POST; accepted-as-pending refunds still only reconciled; the proven-idempotent simulator keeps
the replay behaviour. Unit: Moyasar declares `unproven`, `fetchRefund` does not trust a bare status.

**Residual risk.** (1) The cumulative `refunded` field is documented as a total ≤ the payment amount; that repeated
partial refunds *accumulate* in it is an inference, not a documented guarantee, and out-of-band refunds on the same payment
also count. Because confirmation needs positive evidence and an inconclusive read ends in `manual_required`, the failure
mode of a wrong inference is a manual review, not an automatic second refund. (2) Before enabling Moyasar live, ask Moyasar
(or run their sandbox) whether `POST /payments/{id}/refund` honours an idempotency key; if confirmed, set
`refundIdempotency = "proven"` for that adapter and the earlier same-key retry applies. Tracked as Integration Pending.

## Results (actual runs, 2026-11-09, sequential, local Postgres/Valkey/SeaweedFS)

| Check | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | 0 errors / 0 warnings |
| Typecheck | `pnpm typecheck` | 6/6 packages |
| Unit | `pnpm test` | **78/78** |
| Integration | `pnpm test:integration` | **115/115** (14 files; 61 baseline + 54 hardening) |
| E2E | `pnpm test:e2e` | **23/23** |
| Migrations | no schema change in round 3 (`0013`, `0014` unchanged) | n/a |
| CI | GitHub Actions on the PR branch | see PR #1 |

## Results of round 2 (actual runs; superseded by the table above for the final state)

| Check | Command | Result |
|---|---|---|
| Lint | `pnpm lint` | 0 errors / 0 warnings |
| Typecheck | `pnpm typecheck` | 6/6 packages |
| Unit | `pnpm test` | **76/76** (72 baseline + 4 new adapter tests) |
| Integration | `pnpm test:integration` | **108/108** (61 baseline + 47 new: 19 + 10 round 1, 18 round 2) |
| E2E | `pnpm test:e2e` | **23/23** |
| Migration: schema drift | `drizzle-kit check` + `generate` | "Everything's fine" / "No schema changes" |
| Migration: fresh apply | integration global setup (drop schema → 0000–0014 + RLS) | applied |
| Migration: upgrade of dev DB | `pnpm db:migrate` | applied |
| Migration 0013 legacy data | rolled-back transaction: 3 captures for one order → repair → unique index | 1 primary, 2 duplicates pointing at it, index created |
| Migration 0014 legacy data | rolled-back transaction, run twice | ledger corrected once, idempotent, booked group untouched, journals balanced, 1 audit row per duplicate |
| CI | GitHub Actions on the PR branch | see PR #1 |

Round-1 reproduction on the unmodified baseline `88b6b37`: 6 of 10 procurement tests and 14 of 17 finance tests failed;
round-2 reproduction on `480e22e`: 16 of 18 failed. All pass after the fixes.

Test-isolation note: the hardening suites share one supplier/buyer per file. Approved suppliers are global
state that `suggestSuppliers` (top-20) ranks against, and creating ~40 of them made the existing procurement
cycle test fail when it ran afterwards. That test was not modified.

## Files
Round 1: `packages/modules/src/payments/index.ts`, `packages/modules/src/purchase-orders/index.ts`,
`packages/integrations/src/payments/index.ts`, `packages/db/src/schema/commerce.ts`,
`packages/db/migrations/0013_hardening_p0.sql`, `packages/modules/src/wiring/index.ts`, `apps/worker/src/schedules.ts`.
Round 2: `packages/modules/src/payments/index.ts`, `packages/integrations/src/payments/index.ts`,
`packages/db/migrations/0014_hardening_p0_legacy_review.sql`.
Tests: `packages/modules/test/hardening-{finance,finance2,procurement}.int.test.ts`, `hardening-helpers.ts`,
`payments.unit.test.ts`.
