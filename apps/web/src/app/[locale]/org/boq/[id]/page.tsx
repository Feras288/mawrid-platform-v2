import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getBoq, listItems } from "@platform/modules/boq";
import { listCategories } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { AddLineDialog, ApproveBoqDialog, AutoRefresh, ColumnMappingForm, ItemsTable, ReprocessButton } from "@/components/procurement/boq-review";
import { Pagination } from "@/components/ui/pagination";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Spinner, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { cn, localized } from "@/lib/utils";

const FILTERS = ["all", "needs_review", "unmatched", "approved", "excluded"] as const;
const PROCESSING = new Set(["received", "extracting", "parsed", "normalizing", "matching"]);

export default async function BoqDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filter?: string; page?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const filter = FILTERS.includes(sp.filter as never) ? (sp.filter as (typeof FILTERS)[number]) : "all";
  const { doc, runs, versions } = await getBoq(ctx, id).catch(() => notFound());
  const [items, unitsRows, cats] = await Promise.all([listItems(ctx, id, { filter, page: Number(sp.page) || 1, pageSize: 100 }), listUnits(), listCategories()]);
  const unitOpts = unitsRows.map((u) => ({ value: u.code, label: `${localized(u, ctx.locale)} (${u.code})` }));
  const catOpts = cats.filter((c) => c.depth > 0).map((c) => ({ value: c.id, label: `${localized(cats.find((r) => r.id === c.parentId), ctx.locale)} / ${localized(c, ctx.locale)}` }));
  const editable = can(ctx, "boq.edit") && !PROCESSING.has(doc.status);
  const extractRun = runs.find((r) => r.stage === "extract");
  const preview = (extractRun?.details as { preview?: { sheet: string; rows: string[][] }[] } | undefined)?.preview ?? [];
  const rows = items.items.map((i) => ({
    ...i,
    categoryLabel: catOpts.find((c) => c.value === i.categoryId)?.label ?? "",
    candidates: i.candidates.map((c) => ({ canonicalProductId: c.canonicalProductId, score: c.score, reasons: c.reasons, label: ctx.locale === "ar" ? c.nameAr || c.nameEn : c.nameEn || c.nameAr })),
  }));
  return (
    <>
      <AutoRefresh status={doc.status} />
      <PageHeader
        title={doc.title}
        breadcrumbs={
          <>
            <Link href="/org/boq" className="hover:underline">
              {t("boq.title")}
            </Link>{" "}
            / <span dir="ltr">{doc.code}</span>
          </>
        }
        actions={
          <>
            <Badge tone={doc.status === "approved" ? "success" : doc.status === "failed" ? "danger" : "warning"}>{t(`boq.status.${doc.status as "received"}`)}</Badge>
            {editable ? <AddLineDialog documentId={id} units={unitOpts} /> : null}
            {can(ctx, "boq.upload") && doc.sourceType !== "manual" && doc.status !== "approved" && !PROCESSING.has(doc.status) ? <ReprocessButton documentId={id} /> : null}
            {can(ctx, "boq.approve") && doc.status === "needs_review" ? <ApproveBoqDialog documentId={id} /> : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <Badge>{t(`boq.source.${doc.sourceType as "xlsx"}`)}</Badge>
        <span>{doc.useAi ? t("boq.aiUsed") : t("boq.aiNotUsed")}</span>
        {doc.fileId ? (
          <a className="text-primary-700 hover:underline" href={`/api/v1/files/${doc.fileId}`}>
            {t("common.download")}
          </a>
        ) : null}
      </div>
      {PROCESSING.has(doc.status) ? (
        <Card className="mb-6 p-6">
          <Spinner label={t("boq.processing")} />
        </Card>
      ) : null}
      {doc.status === "needs_column_mapping" ? (
        <div className="mb-6 space-y-3">
          <Alert tone="warning">{t("boq.mappingHint")}</Alert>
          {preview.length ? <ColumnMappingForm documentId={id} preview={preview} /> : null}
        </div>
      ) : null}
      {doc.status === "needs_manual_entry" ? (
        <Alert tone="warning" className="mb-6">
          {t("boq.manualEntryHint")} {!doc.useAi ? t("boq.aiDisabledHint") : null}
        </Alert>
      ) : null}
      {doc.status === "failed" ? (
        <Alert tone="danger" className="mb-6" title={t("boq.failedHint")}>
          {doc.error && t.has(`errors.${doc.error}`) ? t(`errors.${doc.error}` as "errors.internal") : doc.error}
        </Alert>
      ) : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        <Stat label={t("boq.lines")} value={doc.stats.lines ?? 0} />
        <Stat label={t("boq.needsReview")} value={doc.stats.needsReview ?? 0} tone={doc.stats.needsReview ? "primary" : "default"} />
        <Stat label={t("boq.matched")} value={doc.stats.matched ?? 0} />
        <Stat label={t("boq.approvedLines")} value={doc.stats.approved ?? 0} />
        <Stat label={t("boq.excludedLines")} value={doc.stats.excluded ?? 0} />
      </div>
      <nav aria-label={t("common.filter")} className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((x) => (
          <Link key={x} href={`/org/boq/${id}?filter=${x}`} className={cn("rounded-full px-3 py-1 text-sm", filter === x ? "bg-primary-700 text-white" : "bg-sand-100 text-ink-600 hover:bg-sand-200")} aria-current={filter === x ? "true" : undefined}>
            {t(`boq.filters.${x}`)}
          </Link>
        ))}
      </nav>
      <ItemsTable documentId={id} items={rows} units={unitOpts} categories={catOpts} editable={editable} />
      <div className="mt-2">
        <Card>
          <Pagination page={items.page} pageSize={items.pageSize} total={items.total} />
        </Card>
      </div>
      {versions.length ? (
        <Card className="mt-6">
          <CardHeader title={t("boq.versions")} />
          <CardBody>
            <ul className="space-y-1 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  {t("boq.version", { v: v.version })} — {v.lineCount} {t("boq.lines")} — {f.dateTime(v.approvedAt, "long")}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
