# Workflows & State Machines

All machines are declared in code (`packages/modules/src/*/states.ts`) as transition tables with guards;
every transition writes an event row and an outbox event in the same transaction.

## RFQ
| From | To | Guard / actor |
|---|---|---|
| draft | pending_review | `rfq.submit`; ≥1 line, ≥1 recipient, closing date in future |
| pending_review | draft | `rfq.submit` (withdraw) or reviewer returns |
| pending_review | approved_for_sending | approval request approved (policy `rfq_send`) or no policy matched |
| approved_for_sending | sending | `rfq.send` (idempotent) — enqueues per-recipient jobs |
| sending | open | all recipients prepared (sent or failed) |
| open | partially_responded | first submitted quotation |
| open, partially_responded | under_evaluation | `rfq.evaluate` or closing date passed |
| under_evaluation | revision_requested | `rfq.evaluate`; selected recipients reopened with new deadline |
| revision_requested | under_evaluation | revision deadline passed / buyer closes revision round |
| under_evaluation | awarded | award decision approved (policy `award`) |
| awarded | closed | all POs created or buyer closes |
| any except awarded/closed | cancelled | `rfq.cancel` with reason; suppliers notified |

Recipient delivery: `pending → prepared → sent | failed → (retry) sent → responded`; attempts, last error,
provider message id, history in `rfq_recipient_events`. Idempotency: job id `rfq-send:<rfq>:<recipient>:<round>`.

## Quotation (supplier side)
`draft → submitted → (revised: new version row, previous kept as superseded) → withdrawn | expired`.
Edits after submit allowed only if RFQ policy `allowRevisionsUntilClose` and RFQ not under evaluation,
or during a revision round.

## Evaluation & award
Comparison matrix built from submitted quotation versions only. Buyer records per line: technical
status (compliant / non_compliant / clarification), financial notes, selected supplier (or none), reason.
Each save appends to `award_decisions` history. Submitting award → approval request (operation `award`,
amount = awarded total). A material change (quotation revision, changed selection or amount) after
approval invalidates the approval (snapshot hash mismatch) and requires re-approval.

## Approvals engine
Policy selection: most specific active policy for (org, operation, project?) whose amount range contains
the amount. Steps have `mode` (sequential | parallel), `required_role` or `required_permission`, `min_approvals`.
Rules: requester cannot approve own request (SoD); same user cannot approve two steps of one request
when `distinctApprovers`; rejection at any step rejects the request; requests carry `subject_hash`.
Operations: `rfq_send`, `award`, `po_issue`, `po_change`.

## Purchase order
Created from an approved award: one PO per selected supplier (unique (award_id, supplier_org_id)).
Approval status: `draft → pending_approval → approved | rejected`; `cancelled`.
Fulfilment status (independent): `not_started → preparing → shipped/partially_delivered → delivered →
completed`; `delayed` flag/state; `cancelled`. Issuing (approved) makes it visible to the supplier and
generates the PDF. Supplier acknowledges, updates preparation, creates shipments (partial allowed);
buyer records goods receipts (partial quantities, notes, attachments). Fulfilment status derived from
shipped/received quantities, never edited freely.

## Store order
Checkout (idempotency key) → `orders` + `order_groups` per supplier + `order_lines` + `order_charges`
→ payment intent (`created → pending → succeeded | failed | expired`, `refunded/partially_refunded`).
Order group status: `pending_payment → confirmed → preparing → shipped → delivered → completed`;
`cancelled` (allowed before shipped per policy); returns: `requested → approved | rejected → received →
refunded`. Stock reserved at order creation, released on cancel/expiry.

## Settlements (owner note 2)
On payment success the `settlements` module records ledger entries: buyer payment, platform commission
(per configurable policy, default 0%), supplier payable, VAT components, refunds. Payout execution:
not implemented as a real transfer; flag `settlements.payouts` off; hard refusal in production.
