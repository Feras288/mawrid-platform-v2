import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { getOrganization } from "@platform/modules/organizations";
import { listMyProducts } from "@platform/modules/supplier-products";
import { getMyProfile } from "@platform/modules/suppliers";
import { SupplierStatusCard } from "@/components/supplier/status-card";
import { PageHeader, Stat } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function SupplierDashboard() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const [org, prof, all, published] = await Promise.all([
    getOrganization(ctx),
    getMyProfile(ctx),
    can(ctx, "products.view") ? listMyProducts(ctx, { pageSize: 1 }) : Promise.resolve({ total: 0 }),
    can(ctx, "products.view") ? listMyProducts(ctx, { pageSize: 1, status: "active" }) : Promise.resolve({ total: 0 }),
  ]);
  return (
    <>
      <PageHeader title={localized(org, ctx.locale)} description={t("nav.supplierPortal")} />
      <div className="grid gap-4">
        <SupplierStatusCard status={prof.profile.status} reason={prof.profile.statusReason} canSubmit={can(ctx, "supplier.profile.manage")} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={t("supplier.dashboard.products")} value={all.total} />
          <Stat label={t("products.status.active")} value={published.total} />
        </div>
      </div>
    </>
  );
}
