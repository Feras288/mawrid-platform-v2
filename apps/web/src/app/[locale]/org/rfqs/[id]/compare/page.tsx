import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getAward, listEvaluations } from "@platform/modules/evaluation";
import { comparison } from "@platform/modules/quotations";
import { AwardLineForm, CreatePosButton, Flag, SubmitAwardDialog, TechnicalSelect } from "@/components/procurement/compare-client";
import { toneFor } from "@/components/procurement/status";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

const SORTS = ["total", "coverage", "leadTime"] as const;

export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const sort = SORTS.includes(sp.sort as never) ? (sp.sort as (typeof SORTS)[number]) : "total";
  const [cmp, evals, award] = await Promise.all([comparison(ctx, id).catch(() => notFound()), listEvaluations(ctx, id), getAward(ctx, id)]);
  const { rfq, rows } = cmp;
  const suppliers = [...cmp.suppliers].sort((a, b) => (sort === "coverage" ? b.coveredLines - a.coveredLines : sort === "leadTime" ? (a.leadTimeDays ?? 9999) - (b.leadTimeDays ?? 9999) : Number(a.total) - Number(b.total)));
  const money = (v: string | null | undefined) => (v == null ? "—" : f.number(Number(v), { style: "currency", currency: "SAR" }));
  const canEval = can(ctx, "rfq.evaluate");
  const awardEditable = canEval && can(ctx, "award.create") && ["under_evaluation", "revision_requested", "awarded"].includes(rfq.status) && (!award.award || award.award.status === "draft" || award.award.status === "rejected");
  const awardTotal = award.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const name = (orgId: string | null) => localized(suppliers.find((s) => s.supplierOrgId === orgId), ctx.locale);
  return (
    <>
      <PageHeader
        title={t("compare.title")}
        breadcrumbs={
          <>
            <Link href="/org/rfqs" className="hover:underline">
              {t("rfq.title")}
            </Link>{" "}
            /{" "}
            <Link href={`/org/rfqs/${id}`} className="hover:underline" dir="ltr">
              {rfq.code}
            </Link>
          </>
        }
        actions={
          <>
            <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "draft"}`)}</Badge>
            {award.award ? <Badge tone={toneFor(award.award.status)}>{t(`compare.awardStatus.${award.award.status as "draft"}`)}</Badge> : null}
            {awardEditable && award.lines.length ? <SubmitAwardDialog rfqId={id} total={money(String(awardTotal))} /> : null}
            {award.award?.status === "approved" && can(ctx, "po.create") ? <CreatePosButton rfqId={id} /> : null}
          </>
        }
      />
      <Alert tone="info" className="mb-4">
        {t("compare.lowestNotBest")}
      </Alert>
      {award.approval ? (
        <p className="mb-4 text-sm">
          {t("rfq.approval")}: <Badge tone={toneFor(award.approval.status)}>{t(`approvals.status.${award.approval.status as "pending"}`)}</Badge>{" "}
          <Link href={`/org/approvals/${award.approval.id}`} className="text-primary-700 underline">
            {t("approvals.open")}
          </Link>
        </p>
      ) : null}
      {suppliers.length === 0 ? (
        <Card>
          <EmptyState title={t("compare.noQuotes")} />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-500">{t("compare.sortBy")}:</span>
            {SORTS.map((s) => (
              <Link key={s} href={`/org/rfqs/${id}/compare?sort=${s}`} className={sort === s ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
                {t(`compare.sort.${s}`)}
              </Link>
            ))}
          </div>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {suppliers.map((s) => (
              <Card key={s.supplierOrgId} className="p-4">
                <h3 className="font-semibold">{localized(s, ctx.locale)}</h3>
                <p className="text-xs text-ink-500">{t("quote.version", { v: s.version })}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.lowestCompleteTotal ? <Flag tone="success">{t("compare.lowestComplete")}</Flag> : null}
                  {s.bestCoverage ? <Flag tone="info">{t("compare.bestCoverage")}</Flag> : null}
                  {s.expired ? <Flag tone="danger">{t("compare.expired")}</Flag> : null}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-ink-500">{t("quote.total")}</dt>
                  <dd className="font-semibold">{money(s.total)}</dd>
                  <dt className="text-ink-500">{t("quote.vatTotal")}</dt>
                  <dd>{money(s.vatTotal)}</dd>
                  <dt className="text-ink-500">{t("quote.shipping")}</dt>
                  <dd>{money(s.shippingAmount)}</dd>
                  <dt className="text-ink-500">{t("compare.coverage")}</dt>
                  <dd>
                    {s.coveredLines}/{rows.length} ({s.coveragePct}%)
                  </dd>
                  <dt className="text-ink-500">{t("compare.leadTime")}</dt>
                  <dd>{s.leadTimeDays ?? "—"}</dd>
                  <dt className="text-ink-500">{t("compare.validity")}</dt>
                  <dd>{s.validUntil ? f.dateTime(s.validUntil, "short") : "—"}</dd>
                </dl>
                {s.exceptions ? <p className="mt-2 rounded bg-warning-50 p-2 text-xs text-warning-600">{s.exceptions}</p> : null}
                {s.paymentTerms ? <p className="mt-1 text-xs text-ink-500">{s.paymentTerms}</p> : null}
              </Card>
            ))}
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <caption className="sr-only">{t("compare.title")}</caption>
                <thead className="bg-sand-50 text-xs text-ink-600">
                  <tr>
                    <th scope="col" className="sticky start-0 bg-sand-50 p-2 text-start">
                      {t("boq.description")}
                    </th>
                    {suppliers.map((s) => (
                      <th key={s.supplierOrgId} scope="col" className="p-2 text-start">
                        {localized(s, ctx.locale)}
                      </th>
                    ))}
                    <th scope="col" className="p-2 text-start">
                      {t("compare.award")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const current = award.lines.find((l) => l.rfqItemId === r.line.id);
                    return (
                      <tr key={r.line.id} className="border-t border-sand-200 align-top">
                        <th scope="row" className="sticky start-0 max-w-xs bg-white p-2 text-start font-normal">
                          <span className="text-xs text-ink-500" dir="ltr">
                            #{r.line.lineNo} · {Number(r.line.quantity)} {r.line.unit}
                          </span>
                          <span className="block">{r.line.description}</span>
                          {r.spreadPct !== null ? (
                            <span className="text-xs text-ink-500">
                              {t("compare.spread")}: {r.spreadPct}%
                            </span>
                          ) : null}
                        </th>
                        {suppliers.map((s) => {
                          const c = r.cells[s.supplierOrgId];
                          const ev = evals.find((e) => e.rfqItemId === r.line.id && e.supplierOrgId === s.supplierOrgId);
                          if (!c || !c.offered)
                            return (
                              <td key={s.supplierOrgId} className="p-2 text-xs text-ink-400">
                                {t("compare.notOffered")}
                              </td>
                            );
                          return (
                            <td key={s.supplierOrgId} className={`p-2 ${current?.supplierOrgId === s.supplierOrgId ? "bg-success-50" : ""}`}>
                              <div className="font-semibold" dir="ltr">
                                {money(c.unitPrice)}
                              </div>
                              <div className="text-xs text-ink-500">
                                {t("quote.total")}: {money(c.lineTotal)}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.lowestPrice ? <Flag tone="success">{t("compare.lowest")}</Flag> : null}
                                {!c.fullQuantity ? <Flag tone="warning">{t("compare.partial")}</Flag> : null}
                                {c.isAlternative ? <Flag tone="accent">{t("quote.alternative")}</Flag> : null}
                              </div>
                              {c.brand ? <div className="text-xs">{c.brand}</div> : null}
                              {c.alternativeDescription ? <div className="text-xs text-accent-700">{c.alternativeDescription}</div> : null}
                              {c.exceptionNote ? <div className="text-xs text-warning-600">{c.exceptionNote}</div> : null}
                              {c.leadTimeDays != null ? (
                                <div className="text-xs text-ink-500">
                                  {t("compare.leadTime")}: {c.leadTimeDays}
                                </div>
                              ) : null}
                              <div className="mt-1">
                                <TechnicalSelect rfqId={id} rfqItemId={r.line.id} supplierOrgId={s.supplierOrgId} value={ev?.technicalStatus ?? "not_evaluated"} disabled={!canEval} />
                              </div>
                            </td>
                          );
                        })}
                        <td className="min-w-44 p-2">
                          <AwardLineForm
                            rfqId={id}
                            rfqItemId={r.line.id}
                            disabled={!awardEditable}
                            current={current?.supplierOrgId ?? null}
                            reason={current?.reason ?? null}
                            options={suppliers.filter((s) => r.cells[s.supplierOrgId]?.offered && evals.find((e) => e.rfqItemId === r.line.id && e.supplierOrgId === s.supplierOrgId)?.technicalStatus !== "non_compliant").map((s) => ({ value: s.supplierOrgId, label: localized(s, ctx.locale) }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Stat label={t("compare.awardedTotal")} value={money(String(awardTotal))} hint={`${award.lines.length}/${rows.length}`} />
            <Card className="lg:col-span-2">
              <CardHeader title={t("compare.history")} />
              <CardBody>
                <ol className="space-y-1 text-sm">
                  {award.history.map(({ l, by }) => (
                    <li key={l.id} className={l.isCurrent ? "" : "text-ink-400 line-through"}>
                      <span className="text-ink-500">{f.dateTime(l.decidedAt, "short")}</span> · #{rows.find((r) => r.line.id === l.rfqItemId)?.line.lineNo} → {name(l.supplierOrgId)} · {money(l.lineTotal)} {l.reason ? `· ${l.reason}` : ""} {by ? `· ${by}` : ""}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
