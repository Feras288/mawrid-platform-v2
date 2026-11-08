import { getFormatter, getTranslations } from "next-intl/server";
import { supplierKpis } from "@platform/modules/analytics";
import { monthPoints } from "@/components/analytics/month-points";
import { ColumnChart } from "@/components/charts/charts";
import { Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierAnalytics() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations("analytics");
  const f = await getFormatter();
  const k = await supplierKpis(ctx);
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <>
      <PageHeader title={t("title")} description={t("dataNote")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("rfqsReceived")} value={k.rfqsReceived} hint={`${t("responseRate")}: ${pct(k.responseRatePct)}`} />
        <Stat label={t("winRate")} value={pct(k.winRatePct)} hint={`${k.quotedLines}`} />
        <Stat label={t("quotedValue")} value={<bdi dir="ltr">{money(k.quotedValue)}</bdi>} />
        <Stat label={t("poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("poCount")}: ${k.poCount}`} />
        <Stat label={t("onTimeShip")} value={pct(k.onTimeShipPct)} />
        <Stat label={t("storeSales")} value={<bdi dir="ltr">{money(k.storeSales)}</bdi>} hint={`${t("storeOrders")}: ${k.storeOrders}`} />
        <Stat label={t("returnRate")} value={pct(k.returnRatePct)} />
      </div>
      <Card className="mt-6">
        <CardHeader title={t("salesByMonth")} />
        <CardBody>
          <ColumnChart title={t("salesByMonth")} points={monthPoints(k.salesByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("tableView")} valueHeader={t("value")} />
        </CardBody>
      </Card>
    </>
  );
}
