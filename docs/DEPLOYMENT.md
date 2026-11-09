# Deployment

> No production deployment has been performed. Everything below was built and verified locally
> (see "Verification status"). Production go-live needs the owner's explicit approval and the external
> accounts listed in `BLOCKERS.md`.

## Components

| Service | Image / source | Purpose |
|---|---|---|
| `web` | `infra/docker/web.Dockerfile` (Next.js standalone, port 3000) | Store, portals, REST `/api/v1`, payment webhooks `/api/webhooks/payments/{provider}` |
| `worker` | `infra/docker/worker.Dockerfile` (esbuild bundle + hoisted prod deps + Chromium) | Outbox dispatch, email, BOQ pipeline, PDFs, RFQ delivery, price index, schedules |
| `migrate` | worker image, `node dist/migrate.js` (one-shot) | Extensions → `app_user` role → schema migrations → functions/grants/RLS (idempotent) |
| `postgres` | `pgvector/pgvector:pg17` | Primary database (owner role for migrations only; app connects as `app_user`, no BYPASSRLS) |
| `valkey` | `valkey/valkey:8-alpine` (AOF) | BullMQ queues, rate limits |
| S3 | external (any S3-compatible) | Private files; presigned URLs ≤ 300 s |

## Environments
`APP_ENV` = `development` | `test` | `staging` | `production`. Separate databases, buckets, secrets and
domains per environment. Guards in `packages/core/src/env.ts` refuse unsafe production configs (test payment
provider, fake AI provider, missing secrets); the seed script refuses anything but development/test;
`settings.payouts` is locked off in production unless `SETTLEMENTS_APPROVED=yes` (DEC-01/02/03).

## Required configuration (production)

| Variable | Notes |
|---|---|
| `APP_URL` | Public HTTPS origin (used in emails, payment return URLs, PO verification QR) |
| `AUTH_SECRET` | ≥ 32 random bytes |
| `APP_ENCRYPTION_KEY` | ≥ 32 chars; encrypts secrets stored in `system_settings` — rotating requires re-saving secrets |
| `POSTGRES_OWNER_PASSWORD`, `APP_DB_PASSWORD` | Owner (migrations) and runtime role passwords |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | Private bucket; enable versioning |
| `SMTP_*` | Or configure in Admin → Integrations (encrypted) |
| `PAYMENT_PROVIDER=moyasar`, `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET` | Only after merchant onboarding; webhook URL `https://<domain>/api/webhooks/payments/moyasar` |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` | Optional; or Admin → Integrations; organizations must still opt in |
| `BRAND_NAME_AR`, `BRAND_NAME_EN` | Brand is configuration, not code |
| `SENTRY_DSN` | Optional error tracking |

## Coolify
1. Create a **Docker Compose** resource pointing at this repository, compose file `infra/docker-compose.prod.yml`.
2. Add the variables above as Coolify secrets (never commit `.env.production`).
3. Assign the domain to service `web`, port `3000`; Coolify's proxy terminates TLS (HSTS is sent by the app).
4. Deploy: `postgres` → `valkey` → `migrate` (must exit 0) → `web` + `worker`. Health checks: web
   `GET /api/health` (liveness), `GET /api/ready` (DB); worker `GET :3101/`.
5. First admin: create the user via sign-up, then promote it in SQL as the owner role
   (`update auth_users set is_platform_admin = true where email = ...`) and enable 2FA before using the
   admin console (MFA is enforced for admin actions outside development).
6. Scheduled task (Coolify) for backups: run `infra/backup/backup.sh` in a container with `pg_dump`
   (e.g. the `postgres` service) with `DATABASE_OWNER_URL`, `BACKUP_DIR` on a mounted volume, `KEEP_DAYS`.

Resource limits in the compose file: web 1 GB, worker 1 GB (Chromium), postgres 1 GB, valkey 256 MB —
adjust to the host.

## Local / plain Docker
```
docker build -f infra/docker/worker.Dockerfile -t platform-worker:latest .
docker build -f infra/docker/web.Dockerfile    -t platform-web:latest .
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d
```

## Migrations
`node dist/migrate.js` (worker image; `DB_ASSETS_DIR=/app/db` holds `migrations/` and `sql/`). Order:
`sql/pre` → `app_user` role (password from `APP_DB_PASSWORD`) → Drizzle migrations (journaled) →
repeatable `sql/post/*.sql` tracked by checksum in `_repeatable_sql` (functions, grants, RLS). Safe to run
on every deploy. New schema changes: `pnpm db:generate --name <change>` and review the SQL before committing.

## Backups & restore
- `infra/backup/backup.sh`: `pg_dump` custom format, integrity check (`pg_restore --list`), SHA-256 file,
  retention (`KEEP_DAYS`, default 14).
- `infra/backup/restore.sh <dump>`: verifies the checksum, **refuses non-empty targets**, restores into a
  new database; then run `migrate` against it to re-create `app_user`, grants and RLS.
- Object storage: rely on bucket versioning / provider replication.
- Restore drill performed locally on 2026-11-09 (see TEST_REPORT): counts identical after restore, migrate
  re-applied 125 RLS policies, non-empty target refused.

## Operations
- Logs: JSON (pino) with secret redaction; `LOG_LEVEL`.
- Admin → Jobs: queue status (24 h), failed jobs, outbox pending/failed, failed emails with retry.
- Admin → Finance: ledger trial balance, pending bank transfers, refunds needing manual action, webhook log.
- Graceful shutdown: worker drains on SIGTERM (`stop_grace_period: 30s`).

## Verification status (local, 2026-11-09)
| Item | Status |
|---|---|
| `next build` (production) | Passed; standalone server served `/api/health`, `/api/ready` (db up), `/ar`, `/ar/products` |
| Worker bundle (`node build.mjs`) + hoisted `pnpm deploy` | Passed; bundled worker started, health `{"ok":true}` |
| Bundled `migrate` | Passed (idempotent on dev DB; re-applied RLS on a restored DB) |
| Backup → restore drill | Passed |
| Docker images | **Not verified locally**: three build attempts failed inside the Docker VM on npm registry download timeouts for large binaries (`next`, `@next/swc-linux-x64-gnu`, `@turbo/linux-64`) — network, not Dockerfile errors. Every step the images run (filtered install, `next build` standalone, worker bundle, hoisted `pnpm deploy`, bundled migrate) was verified natively. The CI `images` job builds both images. |
| Docker step rehearsal (clean clones) | Passed: filtered frozen install, `next build` **without any env vars** (after the lazy-DB fix), worker bundle, hoisted deploy, bundled migrate, worker boot. Not reproducible on Windows: Chromium Linux packages |
| Staging / production deploy | Not performed (requires owner approval and infrastructure) |
