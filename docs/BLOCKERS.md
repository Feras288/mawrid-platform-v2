# Blockers, External Dependencies & Deferred Decisions

## Owner decisions (defaults applied; change anytime)
| ID | Decision | Default applied | Impact |
|---|---|---|---|
| DEC-01 | Marketplace legal model (seller of record) | Supplier is seller; platform intermediary | Invoicing, VAT, collection |
| DEC-02 | Payment provider for production | Moyasar adapter + bank transfer; test provider non-prod | Needs contract/keys; SAMA licensing depends on DEC-01 |
| DEC-03 | Revenue model (subscriptions/commission) | Configurable, all 0/off | Settlements ledger amounts |
| DEC-04 | AI provider & external data policy | Anthropic adapter; off w/o key; per-org opt-in | BOQ OCR/AI quality |
| DEC-05 | Hosting region / data residency (PDPL) | Any Coolify host; KSA recommended | Cross-border transfer |
| DEC-06 | Who issues e-invoices (ZATCA) | Data ready; Fatoora integration pending | Compliance |
| DEC-07 | Supplier verification documents | Configurable checklist; manual review | Onboarding |
| DEC-08 | Price index publication thresholds | ≥5 obs, ≥3 orgs, 90 days | Index availability |
| DEC-09 | Shipping carriers | Supplier-fulfilled, zone rates | Logistics |
| DEC-10 | Cancellation/return policy texts | Configurable defaults, draft texts | Legal review needed |

## External integrations requiring accounts/keys (Integration Pending candidates)
| Integration | Needed | Implemented locally/tested with |
|---|---|---|
| SMTP production | Host/user/pass/from | Mailpit (local) |
| AI provider | API key, data policy approval | Fake provider in tests |
| Payment provider (Moyasar live) | Merchant account, secret key, webhook secret (`MOYASAR_*`) | Test provider end-to-end; Moyasar adapter contract-tested with mocked HTTP (not yet exercised against the Moyasar sandbox). Refund idempotency at Moyasar is undocumented → treated as unproven (no automatic re-POST after an unknown outcome); confirm with Moyasar/sandbox before relying on it |
| Bank transfer collection | Platform/supplier bank account details (`payments.bank_transfer` setting) and reconciliation owner | Provider + manual admin confirmation implemented & tested |
| Supplier payouts / settlements | DEC-01/02/03 decisions, possibly SAMA licensing | Ledger balances only; payouts Blocked by decision (flag locked in production) |
| ZATCA Fatoora | CSID onboarding, certificates | Phase-1 QR TLV, invoices & credit notes per supplier; no UBL XML/stamping |
| Production S3 | Bucket + credentials | SeaweedFS (local) |
| Error tracking | Sentry/GlitchTip DSN | Disabled when unset |
| Shipping carriers | Contracts/APIs | Manual tracking numbers |
| Official supplier verification (Wathq etc.) | API access | Manual admin review |
| Antivirus scanning | ClamAV service | Hook present, disabled |

## Active blockers
None.
