import { ShoppingBag } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { listSupplierOrders } from "@platform/modules/commerce";
import { supplierBalance } from "@platform/modules/payments";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Alert, Badge, Card, EmptyState, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

const STATUSES = ["confirmed", "preparing", "shipped", "delivered", "completed", "cancelled"] as const;

export default async function SupplierOrders({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as never) ? sp.status : undefined;
  const [data, balance] = await Promise.all([listSupplierOrders(ctx, { page: Number(sp.page) || 1, status }), supplierBalance(ctx)]);
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  return (
    <>
      <PageHeader title={t("orders.supplierTitle")} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Stat label={t("orders.balance")} value={<bdi dir="ltr">{money(balance.payable)}</bdi>} />
        {!balance.payoutsEnabled ? <Alert tone="info">{t("orders.payoutsDisabled")}</Alert> : null}
      </div>
      <nav className="mb-4 flex flex-wrap gap-3 text-sm" aria-label={t("common.filter")}>
        <Link href="/supplier/orders" className={!status ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
          {t("common.all")}
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/supplier/orders?status=${s}`} className={status === s ? "font-semibold text-primary-700" : "text-ink-600 hover:underline"}>
            {t(`orders.groupStatus.${s}`)}
          </Link>
        ))}
      </nav>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<ShoppingBag />} title={t("orders.noSupplierOrders")} />
        ) : (
          <Table caption={t("orders.supplierTitle")}>
            <thead>
              <tr>
                <Th>{t("orders.code")}</Th>
                <Th>{t("orders.date")}</Th>
                <Th>{t("orders.status")}</Th>
                <Th>{t("orders.deliveryAddress")}</Th>
                <Th>{t("orders.total")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((g) => (
                <Tr key={g.id}>
                  <Td dir="ltr">
                    <Link href={`/supplier/orders/${g.id}`} className="font-mono text-xs font-medium text-primary-700 hover:underline">
                      {g.code}
                    </Link>
                  </Td>
                  <Td>{f.dateTime(g.createdAt, "short")}</Td>
                  <Td>
                    <Badge tone={toneFor(g.status)}>{t(`orders.groupStatus.${g.status as "confirmed"}`)}</Badge>
                  </Td>
                  <Td className="text-xs">{g.deliveryAddress.city}</Td>
                  <Td dir="ltr">{money(g.total)}</Td>
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
