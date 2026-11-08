# Architecture

## Topology
```
 Browser ──► apps/web (Next.js 16, Node runtime)
               ├─ Server Components / Server Actions ─┐
               ├─ /api/v1/* REST (Zod)                ├─► @platform/modules (services)
               └─ /api/webhooks/* (payments)          ┘        │
                                                              ├─► @platform/db (Drizzle, pg as app_user, RLS)
                                                              ├─► outbox_events (same tx)
                                                              └─► @platform/integrations (S3, SMTP, AI, payments)
 apps/worker (BullMQ) ◄── Valkey ◄── outbox dispatcher (worker) ──► handlers: email, notifications,
                                                                    BOQ pipeline, PDF, price index
```

## Packages
| Package | Responsibility | May depend on |
|---|---|---|
| `@platform/core` | Decimal money, errors, ids, env schema, logger, state machine, Result | — |
| `@platform/db` | schema, migrator, RLS SQL, `withContext`, seed | core |
| `@platform/integrations` | adapters behind interfaces (storage, email, ai, payments, ocr, zatca) | core |
| `@platform/modules` | domain services (below) | core, db, integrations |
| `apps/web` | UI + HTTP adapters | all packages |
| `apps/worker` | job runners | all packages |

## Modules (`packages/modules/src/<name>`)
| # | Module | Folder |
|---|---|---|
| 1 | Identity & Authentication | `identity` (Better Auth instance in `apps/web/src/lib/auth.ts`, profile services here) |
| 2 | Organizations & Memberships | `organizations` |
| 3 | Authorization & Approval Policies | `authz`, `approvals` |
| 4 | Supplier Management | `suppliers` |
| 5 | Canonical Catalog | `catalog` |
| 6 | Supplier Products & Inventory | `supplier-products` |
| 7 | E-commerce & Checkout | `commerce` |
| 8 | Projects & BOQ | `projects`, `boq` |
| 9 | AI Document Processing | `ai` (+ `integrations/ai`) |
| 10 | Product Matching | `matching` |
| 11 | RFQ Management | `rfq` |
| 12 | Supplier Quotations | `quotations` |
| 13 | Technical & Financial Evaluation | `evaluation` |
| 14 | Purchase Orders | `purchase-orders` |
| 15 | Fulfillment & Delivery | `fulfillment` |
| 16 | Payments & Financial Integration | `payments`, `settlements`, `invoicing` |
| 17 | Notifications | `notifications` |
| 18 | Documents & File Storage | `files` |
| 19 | Analytics & Price Intelligence | `analytics`, `price-index` |
| 20 | Audit & Security | `audit` |
| 21 | Platform Administration | `admin` |
| 22 | System Configuration & Integrations | `config` (settings, feature flags, secrets) |

Module rules: public API only via `index.ts`; a module owns its tables (writes); other modules read
through its services or through documented read views; side effects to other modules via outbox events.

## Request context
`Ctx = { userId, orgId | null, orgType, membershipId, permissions:Set, isPlatformAdmin, mode, locale,
requestId, ip }`. Built per request from the Better Auth session + `active_org` cookie (validated
against memberships every request). Services call `authorize(ctx, perm, resource?)`, then run DB work
in `withContext(ctx, tx => …)`.

## Settlements separation (owner note 2)
`payments` handles intents/attempts/webhooks/refunds. `settlements` only computes supplier payables and
platform commission into `ledger_entries` (accounting view). Payout execution is not implemented as a
real transfer; it is guarded by feature flag `settlements.payouts` (default off) and refuses to run in
production until the business/regulatory model is approved.

## Background jobs
Queues: `outbox`, `email`, `boq`, `pdf`, `analytics`. Every job has a deterministic `jobId`
(idempotent enqueue), bounded retries with exponential backoff, and records in `job_runs`.
Graceful shutdown closes workers then DB pool.

## Integrations status vocabulary
Each adapter declares `status(): 'configured' | 'not_configured' | 'disabled'`. UI shows unavailable
features clearly (no fake success).
