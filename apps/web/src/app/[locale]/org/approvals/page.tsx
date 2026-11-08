import { CheckCircle2 } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { listRequests } from "@platform/modules/approvals";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ scope?: string; page?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const data = await listRequests(ctx, { scope, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("approvals.title")} description={t("approvals.aiNote")} />
      <nav className="mb-4 flex gap-4 text-sm" aria-label={t("common.filter")}>
        <Link href="/org/approvals" className={scope === "mine" ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
          {t("approvals.mine")}
        </Link>
        <Link href="/org/approvals?scope=all" className={scope === "all" ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
          {t("approvals.all")}
        </Link>
      </nav>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} title={t("approvals.noRequests")} />
        ) : (
          <Table caption={t("approvals.title")}>
            <thead>
              <tr>
                <Th>{t("approvals.subject")}</Th>
                <Th>{t("approvals.operation")}</Th>
                <Th>{t("approvals.amount")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("common.createdAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/org/approvals/${r.id}`} className="font-medium text-primary-700 hover:underline">
                      {r.subjectLabel ?? r.subjectId}
                    </Link>
                    {r.canDecide ? (
                      <Badge tone="warning" className="ms-2">
                        {t("approvals.mine")}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>{t(`approvals.ops.${r.operation as "award"}`)}</Td>
                  <Td dir="ltr">{r.amount ? f.number(Number(r.amount), { style: "currency", currency: r.currency }) : "—"}</Td>
                  <Td>
                    <Badge tone={toneFor(r.status)}>{t(`approvals.status.${r.status as "pending"}`)}</Badge>
                  </Td>
                  <Td>{f.dateTime(r.createdAt, "short")}</Td>
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
