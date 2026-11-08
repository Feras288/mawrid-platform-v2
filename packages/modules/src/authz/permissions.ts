/**
 * Permission catalog. Permissions are scoped to the active organization (except admin.*).
 */
export const BUYER_PERMISSIONS = [
  "org.view",
  "org.update",
  "members.view",
  "members.manage",
  "roles.manage",
  "settings.manage",
  "audit.view",
  "approvals.policies.manage",
  "approval.decide",
  "project.view",
  "project.create",
  "project.update",
  "project.manage_members",
  "boq.view",
  "boq.upload",
  "boq.edit",
  "boq.approve",
  "rfq.view",
  "rfq.create",
  "rfq.submit",
  "rfq.send",
  "rfq.evaluate",
  "rfq.cancel",
  "quotation.view",
  "evaluation.technical",
  "evaluation.financial",
  "award.create",
  "po.view",
  "po.create",
  "po.cancel",
  "po.receive",
  "store.purchase",
  "store.orders.view",
  "analytics.view",
  "price_index.view",
  "files.upload",
] as const;

export const SUPPLIER_PERMISSIONS = [
  "org.view",
  "org.update",
  "members.view",
  "members.manage",
  "roles.manage",
  "audit.view",
  "supplier.profile.manage",
  "supplier.documents.manage",
  "products.view",
  "products.manage",
  "pricing.manage",
  "inventory.manage",
  "supplier.rfq.view",
  "supplier.quotation.submit",
  "supplier.po.view",
  "supplier.po.fulfil",
  "supplier.orders.view",
  "supplier.orders.fulfil",
  "supplier.analytics.view",
  "files.upload",
] as const;

export const ADMIN_PERMISSIONS = [
  "admin.access",
  "admin.users",
  "admin.orgs",
  "admin.suppliers.review",
  "admin.catalog",
  "admin.settings",
  "admin.integrations",
  "admin.jobs",
  "admin.audit",
  "admin.flags",
  "admin.content",
  "admin.reports",
  "admin.breakglass",
  "admin.finance",
  "admin.privacy",
] as const;

export type BuyerPermission = (typeof BUYER_PERMISSIONS)[number];
export type SupplierPermission = (typeof SUPPLIER_PERMISSIONS)[number];
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type Permission = BuyerPermission | SupplierPermission | AdminPermission;

export const ALL_PERMISSIONS: readonly Permission[] = Array.from(
  new Set<Permission>([...BUYER_PERMISSIONS, ...SUPPLIER_PERMISSIONS, ...ADMIN_PERMISSIONS]),
);

export const permissionsForOrgType = (t: "buyer" | "supplier" | "platform"): readonly Permission[] =>
  t === "buyer" ? BUYER_PERMISSIONS : t === "supplier" ? SUPPLIER_PERMISSIONS : ADMIN_PERMISSIONS;

export interface RoleTemplate {
  key: string;
  orgType: "buyer" | "supplier" | "platform";
  nameAr: string;
  nameEn: string;
  permissions: readonly Permission[];
}

const B = (p: BuyerPermission[]) => p;
const S = (p: SupplierPermission[]) => p;

const BUYER_READ = B(["org.view", "members.view", "project.view", "boq.view", "rfq.view", "quotation.view", "po.view", "store.orders.view"]);

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { key: "owner", orgType: "buyer", nameAr: "مالك المؤسسة", nameEn: "Organization owner", permissions: BUYER_PERMISSIONS },
  {
    key: "admin",
    orgType: "buyer",
    nameAr: "مدير المؤسسة",
    nameEn: "Organization admin",
    permissions: BUYER_PERMISSIONS.filter((p) => p !== "approval.decide"),
  },
  {
    key: "procurement_officer",
    orgType: "buyer",
    nameAr: "موظف مشتريات",
    nameEn: "Procurement officer",
    permissions: B([
      ...BUYER_READ,
      "project.create",
      "project.update",
      "boq.upload",
      "boq.edit",
      "rfq.create",
      "rfq.submit",
      "rfq.evaluate",
      "evaluation.financial",
      "award.create",
      "po.create",
      "po.receive",
      "store.purchase",
      "store.orders.view",
      "files.upload",
      "price_index.view",
    ]),
  },
  {
    key: "technical_reviewer",
    orgType: "buyer",
    nameAr: "مراجع فني",
    nameEn: "Technical reviewer",
    permissions: B([...BUYER_READ, "boq.edit", "boq.approve", "evaluation.technical", "files.upload"]),
  },
  {
    key: "financial_reviewer",
    orgType: "buyer",
    nameAr: "مراجع مالي",
    nameEn: "Financial reviewer",
    permissions: B([...BUYER_READ, "evaluation.financial", "analytics.view", "price_index.view"]),
  },
  {
    key: "procurement_manager",
    orgType: "buyer",
    nameAr: "مدير مشتريات",
    nameEn: "Procurement manager",
    permissions: B([
      ...BUYER_READ,
      "project.create",
      "project.update",
      "project.manage_members",
      "boq.upload",
      "boq.edit",
      "boq.approve",
      "rfq.create",
      "rfq.submit",
      "rfq.send",
      "rfq.evaluate",
      "rfq.cancel",
      "evaluation.technical",
      "evaluation.financial",
      "award.create",
      "approval.decide",
      "po.create",
      "po.cancel",
      "po.receive",
      "store.purchase",
      "analytics.view",
      "price_index.view",
      "files.upload",
      "audit.view",
    ]),
  },
  {
    key: "approver",
    orgType: "buyer",
    nameAr: "صاحب صلاحية اعتماد",
    nameEn: "Approver",
    permissions: B([...BUYER_READ, "approval.decide", "analytics.view"]),
  },
  { key: "viewer", orgType: "buyer", nameAr: "مطلع", nameEn: "Viewer", permissions: BUYER_READ },
  { key: "supplier_admin", orgType: "supplier", nameAr: "مسؤول المورد", nameEn: "Supplier admin", permissions: SUPPLIER_PERMISSIONS },
  {
    key: "supplier_staff",
    orgType: "supplier",
    nameAr: "موظف مورد",
    nameEn: "Supplier staff",
    permissions: S([
      "org.view",
      "members.view",
      "products.view",
      "products.manage",
      "pricing.manage",
      "inventory.manage",
      "supplier.rfq.view",
      "supplier.quotation.submit",
      "supplier.po.view",
      "supplier.po.fulfil",
      "supplier.orders.view",
      "supplier.orders.fulfil",
      "files.upload",
    ]),
  },
  { key: "platform_admin", orgType: "platform", nameAr: "مسؤول المنصة", nameEn: "Platform admin", permissions: ADMIN_PERMISSIONS },
];

export const OWNER_ROLE_KEY: Record<"buyer" | "supplier" | "platform", string> = {
  buyer: "owner",
  supplier: "supplier_admin",
  platform: "platform_admin",
};
