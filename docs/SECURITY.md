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
