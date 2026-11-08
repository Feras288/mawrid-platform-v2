import { getTranslations } from "next-intl/server";
import { getOrganization } from "@platform/modules/organizations";
import { Card, CardBody, CardHeader, Dl, PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function OrgDashboard() {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const org = await getOrganization(ctx);
  return (
    <>
      <PageHeader title={localized(org, ctx.locale)} description={t("nav.procurement")} />
      <Card>
        <CardHeader title={t("org.profile")} />
        <CardBody>
          <Dl
            items={[
              { label: t("org.vatNumber"), value: org.vatNumber },
              { label: t("org.crNumber"), value: org.crNumber },
              { label: t("common.city"), value: org.city },
              { label: t("common.email"), value: org.email },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}
