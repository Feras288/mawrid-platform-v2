import { getFormatter, getTranslations } from "next-intl/server";
import { listAllAudit } from "@platform/modules/audit";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const sp = await searchParams;
  const action = sp.action && /^[a-z_.]{2,60}$/.test(sp.action) ? sp.action : undefined;
  const data = await listAllAudit(ctx, { action, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("audit")} />
      <form method="get" className="mb-4 flex gap-2" role="search">
        <input name="action" defaultValue={action ?? ""} aria-label={t("filterAction")} placeholder={`${t("filterAction")} (breakglass, payment, user.)`} className="h-10 flex-1 rounded-lg border border-sand-300 px-3 text-sm" dir="ltr" />
        <button className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">{t("search")}</button>
      </form>
      <Card>
        <Table caption={t("audit")}>
          <thead>
            <tr>
              <Th>{t("time")}</Th>
              <Th>{t("action")}</Th>
              <Th>{t("entity")}</Th>
              <Th>{t("actor")}</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">{f.dateTime(a.createdAt, { dateStyle: "short", timeStyle: "medium" })}</Td>
                <Td dir="ltr">
                  <span className="font-mono text-xs">{a.action}</span>
                  {(a.data as { breakglass?: boolean } | null)?.breakglass ? <Badge tone="warning">break-glass</Badge> : null}
                </Td>
                <Td dir="ltr" className="text-xs">
                  {a.entityType}:{String(a.entityId ?? "").slice(0, 8)}
                </Td>
                <Td dir="ltr" className="text-xs">
                  {a.actorUserId ? a.actorUserId.slice(0, 8) : "system"}
                </Td>
                <Td dir="ltr" className="text-xs">
                  {a.ip ?? ""}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
