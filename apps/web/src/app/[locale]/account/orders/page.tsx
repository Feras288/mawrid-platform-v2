import { ShoppingBag } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { listMyOrders } from "@platform/modules/commerce";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Alert, Badge, buttonVariants, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";

export default async function MyOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  if (ctx.orgId && ctx.orgType !== "buyer") return <Alert tone="info">{t("store.supplierCannotBuy")}</Alert>;
  const sp = await searchParams;
  const data = await listMyOrders(ctx, { page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("orders.title")} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag />}
            title={t("orders.noOrders")}
            action={
              <Link href="/products" className={buttonVariants()}>
                {t("store.continueShopping")}
              </Link>
            }
          />
        ) : (
          <Table caption={t("orders.title")}>
            <thead>
              <tr>
                <Th>{t("orders.code")}</Th>
                <Th>{t("orders.date")}</Th>
                <Th>{t("orders.status")}</Th>
                <Th>{t("orders.payment")}</Th>
                <Th>{t("orders.total")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ o }) => (
                <Tr key={o.id}>
                  <Td dir="ltr">
                    <Link href={`/account/orders/${o.id}`} className="font-mono text-xs font-medium text-primary-700 hover:underline">
                      {o.code}
                    </Link>
                  </Td>
                  <Td>{f.dateTime(o.createdAt, "short")}</Td>
                  <Td>
                    <Badge tone={toneFor(o.status === "placed" ? "approved" : o.status === "payment_failed" ? "failed" : o.status === "pending_payment" ? "pending" : o.status)}>{t(`orders.orderStatus.${o.status as "placed"}`)}</Badge>
                  </Td>
                  <Td>{t(`orders.paymentStatus.${o.paymentStatus as "paid"}`)}</Td>
                  <Td dir="ltr">{f.number(Number(o.total), { style: "currency", currency: o.currency })}</Td>
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
