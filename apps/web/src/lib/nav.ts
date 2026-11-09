import type { Ctx } from "@platform/modules/context";
import type { NavItem } from "@/components/shell/portal-shell";

const has = (ctx: Ctx, p: string) => ctx.permissions.has(p as never);

export function accountNav(): NavItem[] {
  return [
    { href: "/account", labelKey: "nav.dashboard", group: "ux.navGroups.overview", icon: "dashboard" },
    { href: "/account/organizations", labelKey: "nav.organizations", group: "ux.navGroups.account", icon: "orgs" },
    { href: "/account/orders", labelKey: "nav.orders", group: "ux.navGroups.commerce", icon: "orders" },
    { href: "/account/wishlist", labelKey: "nav.wishlist", group: "ux.navGroups.commerce", icon: "store" },
    { href: "/account/addresses", labelKey: "nav.addresses", group: "ux.navGroups.commerce", icon: "addresses" },
    { href: "/account/notifications", labelKey: "nav.notifications", group: "ux.navGroups.account", icon: "bell" },
    { href: "/account/security", labelKey: "nav.security", group: "ux.navGroups.account", icon: "security" },
    { href: "/account/privacy", labelKey: "nav.privacy", group: "ux.navGroups.account", icon: "privacy" },
  ];
}

export function orgNav(ctx: Ctx): NavItem[] {
  return [
    { href: "/org", labelKey: "nav.dashboard", group: "ux.navGroups.overview", icon: "dashboard" },
    { href: "/org/projects", labelKey: "nav.projects", group: "ux.navGroups.sourcing", icon: "projects", show: has(ctx, "project.view") },
    { href: "/org/boq", labelKey: "nav.boq", group: "ux.navGroups.sourcing", icon: "boq", show: has(ctx, "boq.view") },
    { href: "/org/rfqs", labelKey: "nav.rfqs", group: "ux.navGroups.sourcing", icon: "rfq", show: has(ctx, "rfq.view") },
    { href: "/org/approvals", labelKey: "nav.approvals", group: "ux.navGroups.sourcing", icon: "approvals" },
    { href: "/org/purchase-orders", labelKey: "nav.purchaseOrders", group: "ux.navGroups.sourcing", icon: "po", show: has(ctx, "po.view") },
    { href: "/org/analytics", labelKey: "nav.analytics", group: "ux.navGroups.insights", icon: "analytics", show: has(ctx, "analytics.view") },
    { href: "/org/price-index", labelKey: "nav.priceIndex", group: "ux.navGroups.insights", icon: "price", show: has(ctx, "price_index.view") },
    { href: "/org/members", labelKey: "nav.members", group: "ux.navGroups.organization", icon: "members", show: has(ctx, "members.view") },
    { href: "/org/roles", labelKey: "nav.roles", group: "ux.navGroups.organization", icon: "roles", show: has(ctx, "roles.manage") },
    { href: "/org/approval-policies", labelKey: "nav.approvalPolicies", group: "ux.navGroups.organization", icon: "approvals", show: has(ctx, "approvals.policies.manage") },
    { href: "/org/settings", labelKey: "nav.orgSettings", group: "ux.navGroups.organization", icon: "settings", show: has(ctx, "org.view") },
    { href: "/org/audit", labelKey: "nav.audit", group: "ux.navGroups.organization", icon: "audit", show: has(ctx, "audit.view") },
  ];
}

export function supplierNav(ctx: Ctx): NavItem[] {
  return [
    { href: "/supplier", labelKey: "nav.dashboard", group: "ux.navGroups.overview", icon: "dashboard" },
    { href: "/supplier/profile", labelKey: "nav.profile", group: "ux.navGroups.organization", icon: "profile", show: has(ctx, "org.view") },
    { href: "/supplier/documents", labelKey: "nav.documents", group: "ux.navGroups.organization", icon: "documents", show: has(ctx, "supplier.documents.manage") },
    { href: "/supplier/products", labelKey: "nav.products", group: "ux.navGroups.catalog", icon: "products", show: has(ctx, "products.view") },
    { href: "/supplier/pricing", labelKey: "nav.pricing", group: "ux.navGroups.catalog", icon: "pricing", show: has(ctx, "pricing.manage") },
    { href: "/supplier/imports", labelKey: "nav.imports", group: "ux.navGroups.catalog", icon: "upload", show: has(ctx, "products.manage") },
    { href: "/supplier/warehouses", labelKey: "nav.warehouses", group: "ux.navGroups.catalog", icon: "warehouses", show: has(ctx, "inventory.manage") },
    { href: "/supplier/rfqs", labelKey: "nav.rfqs", group: "ux.navGroups.sales", icon: "rfq", show: has(ctx, "supplier.rfq.view") },
    { href: "/supplier/purchase-orders", labelKey: "nav.purchaseOrders", group: "ux.navGroups.sales", icon: "po", show: has(ctx, "supplier.po.view") },
    { href: "/supplier/orders", labelKey: "nav.storeOrders", group: "ux.navGroups.sales", icon: "orders", show: has(ctx, "supplier.orders.view") },
    { href: "/supplier/returns", labelKey: "nav.returns", group: "ux.navGroups.sales", icon: "returns", show: has(ctx, "supplier.orders.view") },
    { href: "/supplier/shipping", labelKey: "nav.shipping", group: "ux.navGroups.sales", icon: "shipping", show: has(ctx, "supplier.orders.fulfil") },
    { href: "/supplier/analytics", labelKey: "nav.analytics", group: "ux.navGroups.insights", icon: "analytics", show: has(ctx, "supplier.analytics.view") },
    { href: "/supplier/members", labelKey: "nav.members", group: "ux.navGroups.organization", icon: "members", show: has(ctx, "members.view") },
    { href: "/supplier/roles", labelKey: "nav.roles", group: "ux.navGroups.organization", icon: "roles", show: has(ctx, "roles.manage") },
  ];
}

export function adminNav(): NavItem[] {
  return [
    { href: "/admin", labelKey: "nav.dashboard", group: "ux.navGroups.overview", icon: "dashboard" },
    { href: "/admin/users", labelKey: "nav.users", group: "ux.navGroups.governance", icon: "members" },
    { href: "/admin/organizations", labelKey: "ux.portal.organizations", group: "ux.navGroups.governance", icon: "orgs" },
    { href: "/admin/suppliers", labelKey: "nav.suppliers", group: "ux.navGroups.governance", icon: "profile" },
    { href: "/admin/catalog", labelKey: "nav.catalog", group: "ux.navGroups.commerce", icon: "products" },
    { href: "/admin/store-orders", labelKey: "nav.storeOrders", group: "ux.navGroups.commerce", icon: "orders" },
    { href: "/admin/finance", labelKey: "nav.finance", group: "ux.navGroups.commerce", icon: "finance" },
    { href: "/admin/shipping", labelKey: "nav.shipping", group: "ux.navGroups.commerce", icon: "shipping" },
    { href: "/admin/integrations", labelKey: "nav.integrations", group: "ux.navGroups.operations", icon: "settings" },
    { href: "/admin/flags", labelKey: "nav.flags", group: "ux.navGroups.operations", icon: "flags" },
    { href: "/admin/jobs", labelKey: "nav.jobs", group: "ux.navGroups.operations", icon: "jobs" },
    { href: "/admin/ai-usage", labelKey: "nav.aiUsage", group: "ux.navGroups.operations", icon: "ai" },
    { href: "/admin/audit", labelKey: "nav.audit", group: "ux.navGroups.governance", icon: "audit" },
    { href: "/admin/privacy", labelKey: "nav.privacy", group: "ux.navGroups.governance", icon: "privacy" },
    { href: "/admin/content", labelKey: "nav.content", group: "ux.navGroups.commerce", icon: "documents" },
    { href: "/admin/reports", labelKey: "nav.reports", group: "ux.navGroups.overview", icon: "analytics" },
  ];
}
