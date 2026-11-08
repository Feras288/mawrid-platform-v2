import { getFormatter, getTranslations } from "next-intl/server";
import { buyerKpis } from "@platform/modules/analytics";
import { monthPoints } from "@/components/analytics/month-points";
import { ColumnChart } from "@/components/charts/charts";
import { Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function BuyerAnalytics() {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations("analytics");
  const f = await getFormatter();
  const k = await buyerKpis(ctx);
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <>
      <PageHeader title={t("title")} description={t("dataNote")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("poCount")}: ${k.poCount}`} />
        <Stat label={t("savings")} value={<bdi dir="ltr">{money(k.savings)}</bdi>} hint={k.savingsPct === null ? t("noData") : `${k.savingsPct}%`} />
        <Stat label={t("responseRate")} value={pct(k.responseRatePct)} hint={`${t("rfqsSent")}: ${k.rfqsSent} · ${t("quotesPerRfq")}: ${k.quotesPerRfq ?? "—"}`} />
        <Stat label={t("onTime")} value={pct(k.onTimePct)} hint={`${k.deliveredPos}`} />
        <Stat label={t("cycle")} value={k.medianCycleDays === null ? "—" : t("days", { n: k.medianCycleDays })} />
        <Stat label={t("openRfqs")} value={k.openRfqs} />
        <Stat label={t("pendingApprovals")} value={k.pendingApprovals} hint={k.medianApprovalHours === null ? undefined : `${t("approvalTime")}: ${t("hours", { n: k.medianApprovalHours })}`} />
        <Stat label={t("storeSpend")} value={<bdi dir="ltr">{money(k.storeSpend)}</bdi>} hint={`${k.storeOrders}`} />
      </div>
      <p className="mt-2 text-xs text-ink-500">{t("savingsHint")}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title={t("spendByMonth")} />
          <CardBody>
            <ColumnChart title={t("spendByMonth")} points={monthPoints(k.spendByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("tableView")} valueHeader={t("value")} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("topSuppliers")} />
          {k.topSuppliers.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-500">{t("noData")}</p>
            </CardBody>
          ) : (
            <Table caption={t("topSuppliers")}>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{t("poValue")}</Th>
                  <Th>{t("poCount")}</Th>
                </tr>
              </thead>
              <tbody>
                {k.topSuppliers.map((s) => (
                  <Tr key={s.nameEn}>
                    <Td>{ctx.locale === "ar" ? s.nameAr : s.nameEn}</Td>
                    <Td dir="ltr">{money(s.value)}</Td>
                    <Td>{s.pos}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
