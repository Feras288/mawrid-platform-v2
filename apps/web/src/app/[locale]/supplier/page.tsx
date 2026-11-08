import { getTranslations } from "next-intl/server";
import { getOrganization } from "@platform/modules/organizations";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function SupplierDashboard() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const org = await getOrganization(ctx);
  return <PageHeader title={localized(org, ctx.locale)} description={t("nav.supplierPortal")} />;
}
