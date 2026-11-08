import { getFormatter, getTranslations } from "next-intl/server";
import { listAllOrders } from "@platform/modules/admin";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminStoreOrders({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const data = await listAllOrders(ctx, { q: sp.q, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("adm.storeOrders")} />
      <form method="get" className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} aria-label={t("adm.search")} placeholder="ORD-2026-…" className="h-10 flex-1 rounded-lg border border-sand-300 px-3 text-sm" dir="ltr" />
        <button className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">{t("adm.search")}</button>
      </form>
      <Card>
        <Table caption={t("adm.storeOrders")}>
          <thead>
            <tr>
              <Th>{t("adm.code")}</Th>
              <Th>{t("adm.customer")}</Th>
              <Th>{t("adm.status")}</Th>
              <Th>{t("adm.payment")}</Th>
              <Th>{t("adm.total")}</Th>
              <Th>{t("adm.time")}</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map(({ o, email }) => (
              <Tr key={o.id}>
                <Td dir="ltr" className="font-mono text-xs">
                  {o.code}
                </Td>
                <Td dir="ltr" className="text-xs">
                  {email}
                </Td>
                <Td>
                  <Badge>{t(`orders.orderStatus.${o.status as "placed"}`)}</Badge>
                </Td>
                <Td>{t(`orders.paymentStatus.${o.paymentStatus as "paid"}`)}</Td>
                <Td dir="ltr">{f.number(Number(o.total), { style: "currency", currency: o.currency })}</Td>
                <Td className="text-xs">{f.dateTime(o.createdAt, "short")}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
