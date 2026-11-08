# Security Model

## Threat model (main threats → controls)
| Threat | Control |
|---|---|
| Cross-tenant read/write (IDOR by changing ids) | Service authz + RLS on all tenant tables as `app_user`; tests with raw SQL as `app_user` |
| Supplier sees competitor quotes | quotations RLS: supplier sees own only; buyer sees submitted only; comparison queries scoped |
| Supplier sees RFQs not sent to it | rfq RLS via `app_rfq_visible_to_supplier()` (recipient row with status ≥ sent) |
| Privilege escalation via role edits | `members.manage` permission; cannot grant permissions you don't hold; owner protected; audited |
| Admin over-reach into confidential docs | Platform admin has no implicit tenant access; break-glass grant (reason, TTL, audit) |
| Session theft / CSRF | HttpOnly Secure SameSite=Lax cookies; Better Auth origin checks; Server Actions origin check |
| XSS | React escaping; no `dangerouslySetInnerHTML` with user data; strict CSP headers |
| Brute force | Better Auth rate limit + app rate limiter (Redis) on sensitive endpoints |
| Malicious uploads | size limits, magic-byte sniffing, extension allowlist, random keys, private bucket, presigned ≤5 min, AV hook |
| Prompt injection via BOQ documents | document text is passed only as data in a delimited field; outputs schema-validated; AI cannot act |
| Secrets leakage | pino redaction; settings secrets encrypted (AES-256-GCM, `APP_ENCRYPTION_KEY`); never returned to clients |
| Duplicate financial ops | idempotency keys; unique constraints; webhook event dedupe |
| Webhook forgery | HMAC/secret verification per provider; raw body stored; replay-safe |

## RBAC
Permission catalog in `packages/modules/src/authz/permissions.ts`. System role templates per org type:
- Buyer org: owner, admin, procurement_officer, technical_reviewer, financial_reviewer,
  procurement_manager, approver, viewer.
- Supplier org: supplier_admin, supplier_staff.
- Platform: platform_admin (separate flag on user + platform org membership; MFA required).
Organizations may create custom roles from the catalog (cannot exceed the creator's permissions).

## RLS design
- Roles: `platform_owner` (owns schema, runs migrations), `app_user` (runtime; NOBYPASSRLS).
- GUCs set per transaction: `app.user_id`, `app.org_id`, `app.mode` (`user`/`system`),
  `app.breakglass_org` (optional).
- Helper functions (SECURITY DEFINER, `search_path` pinned): `app_org()`, `app_is_system()`,
  `app_rfq_visible_to_supplier(rfq_id)`, `app_project_visible(project_id)`.
- Policy pattern: `USING (app_is_system() OR org_id = app_org() OR <relationship predicate>)`.
- Public catalog data (categories, canonical products, approved supplier listings, public prices) is
  readable by everyone; writes restricted.

## Audit
`audit_logs` is append-only (UPDATE/DELETE revoked from `app_user`). Recorded: auth events, membership &
role changes, approval decisions, PO/award/financial changes, settings changes, break-glass use,
supplier verification decisions.

## MFA
Required for platform admins (enforced at admin layout + admin actions). Org setting can require MFA
for members holding approval permissions.

## Files
`files` rows carry `org_id`, `owner_type/owner_id`, `classification` (public | org_private | confidential).
Download goes through `/api/v1/files/:id/url` → authz → presigned URL (300 s).

## Phase 9 security review (2026-11-09)
| Area | Control | Evidence |
|---|---|---|
| Tenant isolation | RLS on every tenant table; runtime role `app_user` without BYPASSRLS; GUCs per transaction | rls.int, boq.int, suppliers.int, procurement.int, store.int, analytics.int (raw SQL as app_user) |
| Buyer ↔ supplier sharing | Bridge functions (`app_rfq_visible_to_supplier`, `app_po_issued_to_me`, `app_group_visible_to_supplier`); suppliers never see competitors, unpaid groups, parent orders or commission rows of others | procurement.int, store.int |
| Authorization | Every service calls `authorize`/`authorizeAdmin`; server actions only call services | admin.int, organizations.int, e2e |
| Admin | MFA required outside development; no implicit tenant access; break-glass read-only, time-boxed, audited, owners notified | admin.int, e2e admin.spec |
| Secrets | AES-256-GCM in `system_settings`; never returned to UI; logs redacted; integration tests show ciphertext ≠ plaintext | admin.int, e2e admin.spec |
| Payments | Webhook signature/secret check, dedupe by provider event id, provider re-fetch, exact amount/currency match, idempotent checkout & refunds, test provider refused in production | store.int, payments.unit |
| Files | Magic-byte validation, size limits, private bucket, presigned URLs ≤ 300 s, RLS-gated metadata, confidential downloads audited | foundation.unit, rls.int, admin.int (export privacy) |
| Accounts | Rate-limited auth endpoints, email verification, TOTP 2FA, suspended/deleted accounts blocked at sign-in and in context resolution | e2e foundation, admin.int |
| Headers | CSP (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), HSTS (prod), nosniff, Referrer-Policy, Permissions-Policy, no `x-powered-by` | next.config.ts |
| Privacy | Consents, export (owner-only file), deletion with anonymization and legal retention | admin.int, e2e admin.spec |

Known limitations:
- CSP allows `'unsafe-inline'` scripts/styles (Next.js bootstrap without nonces). Mitigated by React
  escaping and no `dangerouslySetInnerHTML` on user content; a nonce-based CSP is a follow-up.
- `pnpm audit --prod`: 2 moderate advisories — `esbuild` (dev-server CORS issue; reachable only through
  `drizzle-kit` tooling, not at runtime) and `uuid < 11.1.1` inside `exceljs` (bounds check in v3/v5/v6 with
  a caller buffer; exceljs does not use that path). Tracked for upgrade when upstream releases allow.
- Antivirus scanning of uploads is a disabled hook (Integration Pending: ClamAV service).
