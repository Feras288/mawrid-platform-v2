import { FileSpreadsheet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listBoqs } from "@platform/modules/boq";
import { projectOptions } from "@platform/modules/projects";
import { BoqUploadDialog, ManualBoqDialog } from "@/components/procurement/project-forms";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function BoqListPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const [data, projects] = await Promise.all([listBoqs(ctx, { page: Number(sp.page) || 1 }), projectOptions(ctx)]);
  const projOpts = projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  return (
    <>
      <PageHeader
        title={t("boq.title")}
        actions={
          can(ctx, "boq.upload") ? (
            <>
              <ManualBoqDialog projects={projOpts} />
              <BoqUploadDialog projects={projOpts} />
            </>
          ) : null
        }
      />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet />} title={t("boq.noBoqs")} description={t("boq.uploadHint")} />
        ) : (
          <Table caption={t("boq.title")}>
            <thead>
              <tr>
                <Th>{t("projects.code")}</Th>
                <Th>{t("boq.titleField")}</Th>
                <Th>{t("boq.project")}</Th>
                <Th>{t("common.type")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("boq.lines")}</Th>
                <Th>{t("boq.needsReview")}</Th>
                <Th>{t("common.createdAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <Tr key={b.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {b.code}
                  </Td>
                  <Td>
                    <Link href={`/org/boq/${b.id}`} className="font-medium text-primary-700 hover:underline">
                      {b.title}
                    </Link>
                  </Td>
                  <Td className="text-xs">{projOpts.find((p) => p.value === b.projectId)?.label ?? "—"}</Td>
                  <Td>{t(`boq.source.${b.sourceType as "xlsx"}`)}</Td>
                  <Td>
                    <Badge tone={b.status === "approved" ? "success" : b.status === "failed" ? "danger" : b.status === "needs_review" ? "warning" : "info"}>{t(`boq.status.${b.status as "received"}`)}</Badge>
                  </Td>
                  <Td>{b.stats.lines ?? 0}</Td>
                  <Td>{b.stats.needsReview ?? 0}</Td>
                  <Td>{f.dateTime(b.createdAt, "short")}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
