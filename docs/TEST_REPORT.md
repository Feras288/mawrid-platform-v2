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

## Defects found by tests and fixed
- Empty `<select>` value failed optional enum validation (org creation) → blank→undefined preprocessing.
- Post-action navigation used non-locale router → 404; switched to next-intl router.
- Better Auth 1.7 2FA table required new columns → migration `0001_auth_two_factor_fields`.
- Zod messages were shown in English in Arabic UI → localized validation messages.
- `useSearchParams` without Suspense broke static prerendering → Suspense boundaries.
