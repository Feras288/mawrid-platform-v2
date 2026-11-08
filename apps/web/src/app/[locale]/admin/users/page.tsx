import { getFormatter, getTranslations } from "next-intl/server";
import { listUsers } from "@platform/modules/admin";
import { UserStatusButton } from "@/components/admin/console-client";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const sp = await searchParams;
  const data = await listUsers(ctx, { q: sp.q, status: ["active", "suspended", "deleted"].includes(sp.status ?? "") ? sp.status : undefined, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("users")} />
      <form method="get" className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} aria-label={t("search")} placeholder={t("search")} className="h-10 flex-1 rounded-lg border border-sand-300 px-3 text-sm" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("status")} className="h-10 rounded-lg border border-sand-300 bg-white px-2 text-sm">
          <option value="">{t("status")}</option>
          {(["active", "suspended", "deleted"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
        <button className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">{t("search")}</button>
      </form>
      <Card>
        <Table caption={t("users")}>
          <thead>
            <tr>
              <Th>{t("name")}</Th>
              <Th>{t("email")}</Th>
              <Th>{t("status")}</Th>
              <Th>{t("orgs")}</Th>
              <Th>{t("mfa")}</Th>
              <Th>{t("lastSeen")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.items.map(({ u, orgs, lastSeen }) => (
              <Tr key={u.id}>
                <Td>
                  {u.name} {u.isPlatformAdmin ? <Badge tone="accent">{t("admin")}</Badge> : null}
                </Td>
                <Td dir="ltr" className="text-xs">
                  {u.email}
                </Td>
                <Td>
                  <Badge tone={u.status === "active" ? "success" : u.status === "suspended" ? "danger" : "neutral"}>{t(`statuses.${u.status as "active"}`)}</Badge>
                </Td>
                <Td>{orgs}</Td>
                <Td>{u.twoFactorEnabled ? "✓" : "—"}</Td>
                <Td>{lastSeen ? f.dateTime(new Date(lastSeen), "short") : "—"}</Td>
                <Td>{u.id !== ctx.userId ? <UserStatusButton userId={u.id} status={u.status} /> : null}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
