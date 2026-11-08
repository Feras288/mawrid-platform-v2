import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listCategories } from "@platform/modules/catalog";
import { getOrganization } from "@platform/modules/organizations";
import { listRegions } from "@platform/modules/reference";
import { getMyProfile } from "@platform/modules/suppliers";
import { SupplierStatusCard } from "@/components/supplier/status-card";
import { SupplierProfileForm } from "@/components/supplier/supplier-forms";
import { OrgProfileForm } from "@/components/team/org-settings";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierProfilePage() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const [org, prof, cats, regions] = await Promise.all([getOrganization(ctx), getMyProfile(ctx), listCategories(), listRegions()]);
  return (
    <>
      <PageHeader title={t("supplier.profileTitle")} />
      <div className="grid gap-6">
        <SupplierStatusCard status={prof.profile.status} reason={prof.profile.statusReason} canSubmit={can(ctx, "supplier.profile.manage")} />
        <OrgProfileForm org={org} canEdit={can(ctx, "org.update")} />
        <SupplierProfileForm profile={prof.profile} categoryIds={prof.categoryIds} categories={cats} regions={regions} canEdit={can(ctx, "supplier.profile.manage")} />
      </div>
    </>
  );
}
