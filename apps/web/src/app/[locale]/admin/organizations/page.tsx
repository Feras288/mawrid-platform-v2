import { getFormatter, getTranslations } from "next-intl/server";
import { listBreakglass, listOrganizations } from "@platform/modules/admin";
import { BreakglassRow, OrgActions } from "@/components/admin/console-client";
import { Pagination } from "@/components/ui/pagination";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminOrgs({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const [data, grants] = await Promise.all([listOrganizations(ctx, { q: sp.q, type: ["buyer", "supplier"].includes(sp.type ?? "") ? sp.type : undefined, page: Number(sp.page) || 1 }), listBreakglass(ctx)]);
  const now = Date.now();
  return (
    <>
      <PageHeader title={t("adm.organizations")} />
      <form method="get" className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} aria-label={t("adm.search")} placeholder={t("adm.search")} className="h-10 flex-1 rounded-lg border border-sand-300 px-3 text-sm" />
        <select name="type" defaultValue={sp.type ?? ""} aria-label={t("adm.type")} className="h-10 rounded-lg border border-sand-300 bg-white px-2 text-sm">
          <option value="">{t("adm.type")}</option>
          <option value="buyer">{t("account.orgType.buyer")}</option>
          <option value="supplier">{t("account.orgType.supplier")}</option>
        </select>
        <button className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">{t("adm.search")}</button>
      </form>
      <Card>
        <Table caption={t("adm.organizations")}>
          <thead>
            <tr>
              <Th>{t("adm.name")}</Th>
              <Th>{t("adm.type")}</Th>
              <Th>{t("adm.status")}</Th>
              <Th>{t("adm.members")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.items.map(({ o, members }) => (
              <Tr key={o.id}>
                <Td>
                  {ctx.locale === "ar" ? o.nameAr : o.nameEn} {o.isTestData ? <Badge>{t("adm.testData")}</Badge> : null}
                  <span className="block text-xs text-ink-500" dir="ltr">
                    {o.crNumber ?? ""} {o.vatNumber ?? ""}
                  </span>
                </Td>
                <Td>{t(`account.orgType.${o.type as "buyer"}`)}</Td>
                <Td>
                  <Badge tone={o.status === "active" ? "success" : "danger"}>{t(`adm.statuses.${o.status as "active"}`)}</Badge>
                </Td>
                <Td>{members}</Td>
                <Td>
                  <OrgActions orgId={o.id} status={o.status} isTest={o.isTestData} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      <Card className="mt-6">
        <CardHeader title={t("adm.breakglass")} />
        <CardBody>
          <Alert tone="warning" className="mb-3">
            {t("adm.breakglassHint")}
          </Alert>
          {grants.length === 0 ? (
            <p className="text-sm text-ink-500">{t("adm.noData")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {grants.map(({ g, adminEmail, orgAr, orgEn }) => {
                const active = !g.revokedAt && g.expiresAt.getTime() > now;
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-200 p-2">
                    <span>
                      <strong>{ctx.locale === "ar" ? orgAr : orgEn}</strong> · <span dir="ltr">{adminEmail}</span> · {g.reason}
                      <span className="block text-xs text-ink-500">
                        {t("adm.expires")}: {f.dateTime(g.expiresAt, "short")} {active ? <Badge tone="warning">{t("adm.active")}</Badge> : null}
                      </span>
                    </span>
                    <BreakglassRow id={g.id} orgId={g.orgId} active={active && g.adminUserId === ctx.userId} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
