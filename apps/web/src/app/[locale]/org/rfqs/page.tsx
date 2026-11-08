import { Send } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { approvedVersions } from "@platform/modules/boq";
import { projectOptions } from "@platform/modules/projects";
import { listCities } from "@platform/modules/reference";
import { listRfqs } from "@platform/modules/rfq";
import { NewRfqDialog } from "@/components/procurement/rfq-client";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

const STATUSES = ["draft", "pending_review", "approved_for_sending", "open", "partially_responded", "under_evaluation", "revision_requested", "awarded", "closed", "cancelled"] as const;

export default async function RfqListPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as never) ? sp.status : undefined;
  const canCreate = can(ctx, "rfq.create");
  const [data, projects, versions, cities] = await Promise.all([
    listRfqs(ctx, { page: Number(sp.page) || 1, status }),
    canCreate ? projectOptions(ctx) : Promise.resolve([]),
    canCreate && can(ctx, "boq.view") ? approvedVersions(ctx) : Promise.resolve([]),
    canCreate ? listCities() : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title={t("rfq.title")}
        actions={
          canCreate ? (
            <NewRfqDialog
              projects={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
              versions={versions.map((v) => ({ value: v.id, label: `${v.code} v${v.version} — ${v.title} (${v.lineCount})`, projectId: v.projectId }))}
              cities={cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }))}
            />
          ) : null
        }
      />
      <nav aria-label={t("common.filter")} className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/org/rfqs" className={!status ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
          {t("common.all")}
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/org/rfqs?status=${s}`} className={status === s ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
            {t(`rfq.status.${s}`)}
          </Link>
        ))}
      </nav>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<Send />} title={t("rfq.noRfqs")} />
        ) : (
          <Table caption={t("rfq.title")}>
            <thead>
              <tr>
                <Th>{t("rfq.code")}</Th>
                <Th>{t("rfq.name")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("rfq.lines")}</Th>
                <Th>{t("rfq.recipients")}</Th>
                <Th>{t("rfq.responses")}</Th>
                <Th>{t("rfq.closesAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ rfq, lines, recipients, responses }) => (
                <Tr key={rfq.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {rfq.code}
                  </Td>
                  <Td>
                    <Link href={`/org/rfqs/${rfq.id}`} className="font-medium text-primary-700 hover:underline">
                      {rfq.title}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "draft"}`)}</Badge>
                  </Td>
                  <Td>{lines}</Td>
                  <Td>{recipients}</Td>
                  <Td>{responses}</Td>
                  <Td>{rfq.closesAt ? f.dateTime(rfq.closesAt, "short") : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
