# Product Requirements (PRD)

Source: owner's executive brief (2026-11-08). Requirement IDs are tracked in `RTM.md`.

## Vision
A Saudi platform combining a specialized multi-vendor store for building materials & MEP, enterprise
procurement (projects → BOQ → RFQ → evaluation → approvals → PO → delivery), a supplier marketplace,
AI-assisted BOQ processing, and a privacy-preserving MEP price index.

## Users
Individual buyers; buyer organizations (owner, admin, procurement officer, technical reviewer,
financial reviewer, procurement manager, approver); supplier organizations (supplier admin, staff);
platform administrators. A user may belong to several organizations with different roles in each.

## Functional areas
1. Identity: sign-up, verification, login, password reset, 2FA, sessions, multi-org switching.
2. Organizations: bilingual profile, activity type, contact/address, city/region, VAT/CR, members,
   invitations, roles, approval policies.
3. Projects: name, description, type, location, owner, status, files, BOQs, RFQs, quotations, POs,
   activity log; procurement without a project is also supported.
4. Suppliers: registration, company profile, users, documents, verification lifecycle
   (new → pending_verification → under_review → approved | rejected; approved ↔ suspended),
   products, pricing, inventory/warehouses, RFQ responses, PO fulfilment, own analytics.
5. Catalog: canonical products vs supplier SKUs; 9 root systems (Electrical, Plumbing, HVAC, Fire
   Fighting, Fire Alarm, Mechanical Equipment, Building Materials, Low Current, Infrastructure);
   dynamic attributes per category; units & conversions; duplicate detection; bulk import; no auto-merge.
6. Pricing: retail, enterprise, org-specific, quantity tiers, MOQ, sale units, discounts, validity,
   region/city pricing, stock, lead times.
7. BOQ engine: XLSX, CSV, text PDF, scanned PDF, images; pipeline with review/approval; line model with
   provenance and confidence; multi-signal matching; AI abstraction with cost limits and data policy.
8. RFQ: lifecycle (Draft … Closed/Cancelled), creation from BOQ or manual lines, supplier suggestions,
   per-recipient delivery tracking, supplier response portal (prices, partial qty, lead time,
   alternatives, exceptions, validity, tax/shipping, attachments, drafts, revisions).
9. Evaluation: line×supplier comparison matrix, filters/sorting, highlights, alternatives, per-line
   award with reasons, decision history.
10. Approvals: configurable policies (org, operation, value, project, role, limits, SoD), sequential
    and parallel steps, invalidation on material change. AI cannot approve.
11. Purchase orders: from approved awards only; split per supplier; separate approval and fulfilment
    statuses; bilingual PDF; shipments, partial delivery, receipts, delays, event timeline;
    duplicate prevention.
12. Store (B2C): home, categories, search, filters, sort, product page, supplier offers, wishlist,
    multi-vendor cart, price/stock revalidation, tax & shipping, addresses, checkout, order tracking,
    cancellation/returns/refunds per policy.
13. Payments: provider abstraction, intents/attempts, signed webhooks, idempotency, refunds,
    reconciliation ledger. No real settlements without approved model.
14. Shipping: zones/cities, rates, supplier-fulfilled, partial shipments, tracking numbers.
15. Notifications: email (SMTP) + in-app; bilingual templates; delivery logs; retries; dedupe;
    settings & connection test.
16. Analytics: procurement KPIs and supplier KPIs from real data only (seed/test data excluded).
17. Price index: six price types kept distinct; stats (avg, median, min, max, trend, change);
    data quality (unit normalization, tax basis, dedupe, outliers, min sample); privacy (k-anonymity);
    alerts.
18. Compliance: VAT, ZATCA-ready invoice data, PDPL (consents, export, deletion, retention),
    e-commerce policies — no compliance claims without legal review.
19. Platform admin: users, orgs, suppliers review, categories, catalog, reference data, settings,
    jobs, errors, audit, content, integrations, AI usage/cost, feature flags, reports; break-glass access.

## Non-functional
Arabic RTL / English LTR everywhere (UI, emails, PDFs); WCAG 2.2 AA where verifiable; responsive;
security per `SECURITY.md`; performance targets per `IMPLEMENTATION_PLAN.md`; Docker/Coolify deploy.
