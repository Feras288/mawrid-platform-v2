import { getFormatter, getTranslations } from "next-intl/server";
import { listSupplierReturns } from "@platform/modules/commerce";
import { toneFor } from "@/components/procurement/status";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierReturns() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const items = await listSupplierReturns(ctx);
  return (
    <>
      <PageHeader title={t("orders.returnsTitle")} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title={t("orders.noReturns")} />
        ) : (
          <Table caption={t("orders.returnsTitle")}>
            <thead>
              <tr>
                <Th>{t("orders.code")}</Th>
                <Th>{t("orders.date")}</Th>
                <Th>{t("orders.status")}</Th>
                <Th>{t("orders.returnReason")}</Th>
                <Th>{t("orders.amount")}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <Tr key={r.id}>
                  <Td dir="ltr">
                    <Link href={`/supplier/orders/${r.groupId}`} className="font-mono text-xs text-primary-700 hover:underline">
                      {r.code}
                    </Link>
                  </Td>
                  <Td>{f.dateTime(r.createdAt, "short")}</Td>
                  <Td>
                    <Badge tone={toneFor(r.status === "requested" ? "pending" : r.status)}>{t(`orders.returnStatus.${r.status as "requested"}`)}</Badge>
                  </Td>
                  <Td className="max-w-xs text-xs">{r.reason}</Td>
                  <Td dir="ltr">{f.number(Number(r.amount), { style: "currency", currency: "SAR" })}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
