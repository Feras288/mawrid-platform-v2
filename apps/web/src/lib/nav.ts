import type { Ctx } from "@platform/modules/context";
import type { NavItem } from "@/components/shell/portal-shell";

const has = (ctx: Ctx, p: string) => ctx.permissions.has(p as never);

export function accountNav(): NavItem[] {
  return [
    { href: "/account", labelKey: "nav.dashboard", icon: "dashboard" },
    { href: "/account/organizations", labelKey: "nav.organizations", icon: "orgs" },
    { href: "/account/orders", labelKey: "nav.orders", icon: "orders" },
    { href: "/account/wishlist", labelKey: "nav.wishlist", icon: "store" },
    { href: "/account/addresses", labelKey: "nav.addresses", icon: "addresses" },
    { href: "/account/notifications", labelKey: "nav.notifications", icon: "bell" },
    { href: "/account/security", labelKey: "nav.security", icon: "security" },
    { href: "/account/privacy", labelKey: "nav.privacy", icon: "privacy" },
  ];
}

export function orgNav(ctx: Ctx): NavItem[] {
  return [
    { href: "/org", labelKey: "nav.dashboard", icon: "dashboard" },
    { href: "/org/projects", labelKey: "nav.projects", icon: "projects", show: has(ctx, "project.view") },
    { href: "/org/boq", labelKey: "nav.boq", icon: "boq", show: has(ctx, "boq.view") },
    { href: "/org/rfqs", labelKey: "nav.rfqs", icon: "rfq", show: has(ctx, "rfq.view") },
    { href: "/org/approvals", labelKey: "nav.approvals", icon: "approvals" },
    { href: "/org/purchase-orders", labelKey: "nav.purchaseOrders", icon: "po", show: has(ctx, "po.view") },
    { href: "/org/analytics", labelKey: "nav.analytics", icon: "analytics", show: has(ctx, "analytics.view") },
    { href: "/org/price-index", labelKey: "nav.priceIndex", icon: "price", show: has(ctx, "price_index.view") },
    { href: "/org/members", labelKey: "nav.members", icon: "members", show: has(ctx, "members.view") },
    { href: "/org/roles", labelKey: "nav.roles", icon: "roles", show: has(ctx, "roles.manage") },
    { href: "/org/approval-policies", labelKey: "nav.approvalPolicies", icon: "approvals", show: has(ctx, "approvals.policies.manage") },
    { href: "/org/settings", labelKey: "nav.orgSettings", icon: "settings", show: has(ctx, "org.view") },
    { href: "/org/audit", labelKey: "nav.audit", icon: "audit", show: has(ctx, "audit.view") },
  ];
}

export function supplierNav(ctx: Ctx): NavItem[] {
  return [
    { href: "/supplier", labelKey: "nav.dashboard", icon: "dashboard" },
    { href: "/supplier/profile", labelKey: "nav.profile", icon: "profile", show: has(ctx, "org.view") },
    { href: "/supplier/documents", labelKey: "nav.documents", icon: "documents", show: has(ctx, "supplier.documents.manage") },
    { href: "/supplier/products", labelKey: "nav.products", icon: "products", show: has(ctx, "products.view") },
    { href: "/supplier/pricing", labelKey: "nav.pricing", icon: "pricing", show: has(ctx, "pricing.manage") },
    { href: "/supplier/imports", labelKey: "nav.imports", icon: "upload", show: has(ctx, "products.manage") },
    { href: "/supplier/warehouses", labelKey: "nav.warehouses", icon: "warehouses", show: has(ctx, "inventory.manage") },
    { href: "/supplier/rfqs", labelKey: "nav.rfqs", icon: "rfq", show: has(ctx, "supplier.rfq.view") },
    { href: "/supplier/purchase-orders", labelKey: "nav.purchaseOrders", icon: "po", show: has(ctx, "supplier.po.view") },
    { href: "/supplier/orders", labelKey: "nav.storeOrders", icon: "orders", show: has(ctx, "supplier.orders.view") },
    { href: "/supplier/returns", labelKey: "nav.returns", icon: "returns", show: has(ctx, "supplier.orders.view") },
    { href: "/supplier/analytics", labelKey: "nav.analytics", icon: "analytics", show: has(ctx, "supplier.analytics.view") },
    { href: "/supplier/members", labelKey: "nav.members", icon: "members", show: has(ctx, "members.view") },
    { href: "/supplier/roles", labelKey: "nav.roles", icon: "roles", show: has(ctx, "roles.manage") },
  ];
}

export function adminNav(): NavItem[] {
  return [
    { href: "/admin", labelKey: "nav.dashboard", icon: "dashboard" },
    { href: "/admin/users", labelKey: "nav.users", icon: "members" },
    { href: "/admin/organizations", labelKey: "nav.organizations", icon: "orgs" },
    { href: "/admin/suppliers", labelKey: "nav.suppliers", icon: "profile" },
    { href: "/admin/catalog", labelKey: "nav.catalog", icon: "products" },
    { href: "/admin/store-orders", labelKey: "nav.storeOrders", icon: "orders" },
    { href: "/admin/finance", labelKey: "nav.finance", icon: "finance" },
    { href: "/admin/shipping", labelKey: "nav.shipping", icon: "shipping" },
    { href: "/admin/integrations", labelKey: "nav.integrations", icon: "settings" },
    { href: "/admin/flags", labelKey: "nav.flags", icon: "flags" },
    { href: "/admin/jobs", labelKey: "nav.jobs", icon: "jobs" },
    { href: "/admin/ai-usage", labelKey: "nav.aiUsage", icon: "ai" },
    { href: "/admin/audit", labelKey: "nav.audit", icon: "audit" },
    { href: "/admin/privacy", labelKey: "nav.privacy", icon: "privacy" },
    { href: "/admin/content", labelKey: "nav.content", icon: "documents" },
    { href: "/admin/reports", labelKey: "nav.reports", icon: "analytics" },
  ];
}
