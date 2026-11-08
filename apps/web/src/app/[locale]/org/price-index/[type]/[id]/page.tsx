import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getIndexSeries } from "@platform/modules/price-index";
import { AlertDialog } from "@/components/analytics/alert-client";
import { BandLineChart } from "@/components/charts/charts";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function IndexSeriesPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (!isUuid(id) || (type !== "canonical" && type !== "category")) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations("priceIndex");
  const f = await getFormatter();
  const data = await getIndexSeries(ctx, type, id).catch(() => notFound());
  const groups = new Map<string, typeof data.series>();
  for (const s of data.series) {
    const key = `${s.kind}|${s.baseUnit}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const price = (v: number) => f.number(v, { style: "currency", currency: "SAR", maximumFractionDigits: 2 });
  const dateFmt = (d: Date) => f.dateTime(d, { month: "short", day: "numeric" });
  return (
    <>
      <PageHeader
        title={localized(data.subject, ctx.locale)}
        breadcrumbs={
          <Link href="/org/price-index" className="hover:underline">
            {t("title")}
          </Link>
        }
        actions={<AlertDialog subjectType={type} subjectId={id} kinds={[...new Set(data.series.map((s) => s.kind))]} />}
      />
      {groups.size === 0 ? <p className="text-sm text-ink-500">{t("noData")}</p> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {[...groups.entries()].map(([key, series]) => {
          const last = series.at(-1)!;
          const unit = data.units.find((u) => u.code === last.baseUnit);
          const title = `${t(`kinds.${last.kind as "po"}`)} — ${t("perUnit", { unit: unit ? localized(unit, ctx.locale) : last.baseUnit })}`;
          return (
            <Card key={key}>
              <CardHeader
                title={title}
                description={t("series")}
                actions={<Badge tone={last.quality === "high" ? "success" : last.quality === "medium" ? "info" : "neutral"}>{t(`qualities.${last.quality as "high"}`)}</Badge>}
              />
              <CardBody>
                <p className="mb-2 text-2xl font-bold">
                  <bdi dir="ltr">{price(Number(last.median))}</bdi>
                </p>
                <p className="mb-3 text-xs text-ink-500">
                  {t("n")}: {last.n} · {t("orgs")}: {last.orgCount} · {t("asOf", { date: f.dateTime(last.asOf, { dateStyle: "medium" }) })}
                </p>
                <BandLineChart
                  title={title}
                  locale={ctx.locale}
                  tableLabel={t("series")}
                  headers={[t("date"), t("median"), t("p25"), t("p75"), t("n")]}
                  points={series.map((s) => ({
                    label: dateFmt(s.asOf),
                    median: Number(s.median),
                    p25: Number(s.p25),
                    p75: Number(s.p75),
                    n: s.n,
                    display: { median: price(Number(s.median)), p25: price(Number(s.p25)), p75: price(Number(s.p75)) },
                  }))}
                />
              </CardBody>
            </Card>
          );
        })}
      </div>
    </>
  );
}
