import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { getOrganization } from "@platform/modules/organizations";
import { OrgProfileForm, OrgSettingsForm } from "@/components/team/org-settings";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function Page() {
  const ctx = await requireOrgCtx(["buyer", "supplier"]);
  const t = await getTranslations();
  const org = await getOrganization(ctx);
  return (
    <>
      <PageHeader title={t("org.settings")} />
      <div className="grid gap-6">
        <OrgProfileForm org={org} canEdit={can(ctx, "org.update")} />
        {ctx.orgType === "buyer" ? <OrgSettingsForm settings={org.settings} canEdit={can(ctx, "settings.manage")} /> : null}
      </div>
    </>
  );
}
