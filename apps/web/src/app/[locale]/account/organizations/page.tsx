import { Building2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { listUserOrganizations, rolesOf } from "@platform/modules/context";
import { CreateOrgDialog, OpenOrgButton } from "@/components/account/org-forms";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const { need } = await searchParams;
  const orgs = await listUserOrganizations(ctx.userId);
  const roles = await rolesOf(orgs.map((o) => o.membershipId));
  return (
    <>
      <PageHeader
        title={t("account.organizations")}
        actions={
          <>
            <CreateOrgDialog type="buyer" />
            <CreateOrgDialog type="supplier" />
          </>
        }
      />
      {need ? <Alert tone="info" className="mb-4">{t("account.needOrg")}</Alert> : null}
      <Card>
        {orgs.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t("account.noOrgs")} description={t("account.noOrgsHint")} />
        ) : (
          <Table caption={t("account.organizations")}>
            <thead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("common.type")}</Th>
                <Th>{t("members.roles")}</Th>
                <Th>{t("common.status")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <Tr key={o.orgId}>
                  <Td className="font-medium text-ink-900">{ctx.locale === "ar" ? o.nameAr : o.nameEn}</Td>
                  <Td>
                    <Badge tone={o.type === "supplier" ? "accent" : "primary"}>{t(`account.orgType.${o.type as "buyer" | "supplier" | "platform"}`)}</Badge>
                  </Td>
                  <Td>{roles.filter((r) => r.membershipId === o.membershipId).map((r) => (ctx.locale === "ar" ? r.nameAr : r.nameEn)).join("، ")}</Td>
                  <Td>{o.orgId === ctx.orgId ? <Badge tone="success">{t("account.active")}</Badge> : null}</Td>
                  <Td className="text-end">
                    <OpenOrgButton orgId={o.orgId} type={o.type} label={t("account.openOrg")} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
