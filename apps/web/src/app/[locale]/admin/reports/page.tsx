import { getFormatter, getTranslations } from "next-intl/server";
import { platformKpis } from "@platform/modules/analytics";
import { indexHealth } from "@platform/modules/price-index";
import { monthPoints } from "@/components/analytics/month-points";
import { ColumnChart } from "@/components/charts/charts";
import { Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function ReportsPage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const [k, h] = await Promise.all([platformKpis(ctx), indexHealth(ctx)]);
  const money = (v: string | null) => (v === null ? "—" : f.number(Number(v), { style: "currency", currency: "SAR" }));
  return (
    <>
      <PageHeader title={t("adm.reports")} description={t("analytics.dataNote")} />
      <h2 className="mb-3 font-semibold">{t("adm.platform")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("adm.buyers")} value={k.buyerOrgs} />
        <Stat label={t("adm.suppliers")} value={k.supplierOrgs} hint={`${t("adm.approvedSuppliers")}: ${k.approvedSuppliers}`} />
        <Stat label={t("adm.users")} value={k.users} />
        <Stat label={t("adm.testExcluded")} value={k.testOrgsExcluded} />
        <Stat label={t("adm.rfqs")} value={k.rfqsSent} />
        <Stat label={t("adm.poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("adm.pos")}: ${k.poCount}`} />
        <Stat label={t("adm.gmv")} value={<bdi dir="ltr">{money(k.storeGmv)}</bdi>} hint={`${t("adm.aov")}: ${money(k.averageOrderValue)}`} />
        <Stat label={t("adm.refunds")} value={<bdi dir="ltr">{money(k.storeRefunds)}</bdi>} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("adm.gmvByMonth")} />
          <CardBody>
            <ColumnChart title={t("adm.gmvByMonth")} points={monthPoints(k.gmvByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("analytics.tableView")} valueHeader={t("analytics.value")} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("adm.poByMonth")} />
          <CardBody>
            <ColumnChart title={t("adm.poByMonth")} points={monthPoints(k.poByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("analytics.tableView")} valueHeader={t("analytics.value")} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title={t("adm.indexHealth")} description={`${t("adm.observations")}: ${h.observations} · ${t("adm.testExcluded")}: ${h.testExcluded}`} />
        <Table caption={t("adm.indexHealth")}>
          <thead>
            <tr>
              <Th>{t("priceIndex.kind")}</Th>
              <Th>{t("adm.published")}</Th>
              <Th>{t("adm.suppressed")}</Th>
              <Th>{t("adm.reasons")}</Th>
            </tr>
          </thead>
          <tbody>
            {h.rows.map((r) => (
              <Tr key={r.kind}>
                <Td>{t(`priceIndex.kinds.${r.kind as "po"}`)}</Td>
                <Td>{r.published}</Td>
                <Td>{r.suppressed}</Td>
                <Td dir="ltr" className="text-xs">
                  {Object.entries(r.reasons)
                    .map(([k2, v]) => `${k2}: ${v}`)
                    .join(" · ")}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
