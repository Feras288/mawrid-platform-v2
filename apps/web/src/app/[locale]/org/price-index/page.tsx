import { TrendingUp } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PRICE_KINDS } from "@platform/db/schema";
import { indexConfig, listMyAlerts, searchIndex } from "@platform/modules/price-index";
import { DeleteAlertButton } from "@/components/analytics/alert-client";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function PriceIndexPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; page?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations("priceIndex");
  const f = await getFormatter();
  const sp = await searchParams;
  const [data, cfg, alerts] = await Promise.all([searchIndex(ctx, { q: sp.q, kind: sp.kind, page: Number(sp.page) || 1 }), indexConfig(), listMyAlerts(ctx)]);
  const price = (v: string | null) => (v ? f.number(Number(v), { style: "currency", currency: "SAR", maximumFractionDigits: 2 }) : "—");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="flex-1">
          <span className="sr-only">{t("search")}</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t("search")} className="h-10 w-full rounded-lg border border-sand-300 px-3 text-sm" />
        </label>
        <label>
          <span className="sr-only">{t("kind")}</span>
          <select name="kind" defaultValue={sp.kind ?? ""} className="h-10 rounded-lg border border-sand-300 bg-white px-2 text-sm" aria-label={t("kind")}>
            <option value="">{t("kind")}</option>
            {PRICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">
          {t("search")}
        </button>
      </form>
      {data.asOf ? <p className="mb-2 text-xs text-ink-500">{t("asOf", { date: f.dateTime(data.asOf, { dateStyle: "medium" }) })}</p> : null}
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<TrendingUp />} title={t("noData")} />
        ) : (
          <Table caption={t("title")}>
            <thead>
              <tr>
                <Th>{t("subject")}</Th>
                <Th>{t("kind")}</Th>
                <Th>{t("median")}</Th>
                <Th>{t("range")}</Th>
                <Th>{t("change30")}</Th>
                <Th>{t("n")}</Th>
                <Th>{t("quality")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ s, nameAr, nameEn, change30 }) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/org/price-index/${s.subjectType}/${s.subjectId}`} className="font-medium text-primary-700 hover:underline">
                      {ctx.locale === "ar" ? nameAr : nameEn}
                    </Link>
                    <span className="block text-xs text-ink-500">{t(`subjectTypes.${s.subjectType as "canonical"}`)}</span>
                  </Td>
                  <Td className="text-xs">{t(`kinds.${s.kind as "po"}`)}</Td>
                  <Td dir="ltr">
                    {price(s.median)} <span className="text-xs text-ink-500">/ {s.baseUnit}</span>
                  </Td>
                  <Td dir="ltr" className="text-xs">
                    {price(s.p25)} – {price(s.p75)}
                  </Td>
                  <Td dir="ltr">{change30 === null ? "—" : `${Number(change30) > 0 ? "+" : ""}${change30}%`}</Td>
                  <Td>
                    {s.n} · {s.orgCount}
                  </Td>
                  <Td>
                    <Badge tone={s.quality === "high" ? "success" : s.quality === "medium" ? "info" : "neutral"}>{t(`qualities.${s.quality as "high"}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("methodology")} />
          <CardBody>
            <p className="text-sm leading-7 text-ink-700">{t("methodBody", { days: cfg.windowDays, obs: cfg.minObs, orgs: cfg.minOrgs, share: cfg.maxSharePct })}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("alerts")} />
          <CardBody>
            {alerts.length === 0 ? (
              <p className="text-sm text-ink-500">{t("noAlerts")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {alerts.map(({ a, nameAr, nameEn }) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/org/price-index/${a.subjectType}/${a.subjectId}`} className="hover:underline">
                        {ctx.locale === "ar" ? nameAr : nameEn}
                      </Link>{" "}
                      · {t(`kinds.${a.kind as "po"}`)} · ±{Number(a.thresholdPct)}% · {t(`directions.${a.direction as "any"}`)}
                    </span>
                    <DeleteAlertButton id={a.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
