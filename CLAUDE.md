# Platform (working brand: «مَوْرِد | Mawrid»)

Saudi B2B procurement + multi-vendor B2C marketplace for building materials & MEP.
The brand name is temporary: never put it in table names, API paths, package names or logic.
Brand comes from `BRAND_NAME_AR` / `BRAND_NAME_EN` env.

## Resume protocol (every new session)
1. Read this file → `docs/PROGRESS.md` → current phase in `docs/IMPLEMENTATION_PLAN.md`.
2. Skim latest entries of `docs/DECISIONS.md` and `docs/BLOCKERS.md`.
3. `git status` + `git log --oneline -15`.
4. Re-run the checks relevant to the current phase before continuing.
5. Continue from the first unfinished task in PROGRESS.md. Do NOT re-plan; the plan was approved
   on 2026-11-08 (see DECISIONS.md ADR-000) with autonomous phase-to-phase execution.

## Architecture (short)
Modular monolith, pnpm + Turborepo monorepo.
- `apps/web` – Next.js App Router. Portals as route groups under `/[locale]`:
  `(store)`, `account`, `org`, `supplier`, `admin`. REST under `/api/v1`, webhooks under `/api/webhooks`.
- `apps/worker` – BullMQ workers: outbox dispatcher, BOQ pipeline, email, PDF, price index.
- `packages/core` – Money (decimal.js), errors, ids (UUIDv7), env config, logger, state-machine helper.
- `packages/db` – Drizzle schema per module, SQL migrations, RLS policies, seed (dev/test only).
- `packages/modules` – domain services, one folder per module, public API = `src/<module>/index.ts`.
  Cross-module imports only through another module's `index.ts`.
- `packages/integrations` – adapters: ai, payments, email, storage, ocr, zatca.
- `docs/` – all design + status docs (see list below).

## Non-negotiable rules
- Authorization is server-side in services: `authorize(ctx, permission, resource)`. UI hides, server decides.
- Every tenant DB access runs inside `withContext(ctx, fn)` which sets `app.*` GUCs for RLS.
  Runtime DB role `app_user` has no BYPASSRLS. Never connect the app as the owner role.
- Money/quantities: `Decimal` from `@platform/core/money` only; DB `numeric`. Never JS floats.
- Sensitive creates (orders, POs, RFQ sends, webhooks) require idempotency keys.
- Domain events go through `outbox_events` written in the same transaction.
- AI never approves anything. AI providers are optional; features degrade clearly without them.
- Mock/test adapters refuse to run when `APP_ENV=production`.
- Do not disable or delete failing tests. Record limitations in `docs/BLOCKERS.md`/`TEST_REPORT.md`.
- Status vocabulary: Implemented / Tested / Integration Pending / Blocked / Known Limitation / Not Implemented.
- No production deploys, real payments/settlements, or destructive ops without explicit owner approval.
- Machine has limited RAM: run builds, integration and E2E suites sequentially, not in parallel.
- Other projects' containers run on this host (ports 5438, 6379, 9000…). Ours use 5442/6390/9010/8026.

## Commands
```
pnpm install
pnpm infra:up            # postgres(5442) valkey(6390) seaweedfs-s3(9010) mailpit(8026 UI)
pnpm db:migrate          # applies SQL migrations as owner role + roles/RLS
pnpm db:seed             # dev/test data only
pnpm dev                 # web on :3100, worker
pnpm typecheck | pnpm lint | pnpm test | pnpm test:integration | pnpm test:e2e
```

## Docs
PRD · ARCHITECTURE · DATABASE · SECURITY · BOQ_ENGINE · WORKFLOWS · IMPLEMENTATION_PLAN ·
DECISIONS · PROGRESS · BLOCKERS · TEST_REPORT · DEPLOYMENT · RTM (traceability) · FINAL_AUDIT
