import { Inbox } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { supplierInbox } from "@platform/modules/rfq";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function SupplierRfqInbox({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const data = await supplierInbox(ctx, { page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("quote.inbox")} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState icon={<Inbox />} title={t("quote.noInbox")} />
        ) : (
          <Table caption={t("quote.inbox")}>
            <thead>
              <tr>
                <Th>{t("rfq.code")}</Th>
                <Th>{t("rfq.name")}</Th>
                <Th>{t("quote.buyer")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("quote.myQuote")}</Th>
                <Th>{t("quote.deadline")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ rc, rfq, buyerAr, buyerEn, quotationStatus }) => (
                <Tr key={rc.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {rfq.code}
                  </Td>
                  <Td>
                    <Link href={`/supplier/rfqs/${rfq.id}`} className="font-medium text-primary-700 hover:underline">
                      {rfq.title}
                    </Link>
                  </Td>
                  <Td>{localized({ nameAr: buyerAr, nameEn: buyerEn }, ctx.locale)}</Td>
                  <Td>
                    <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "open"}`)}</Badge>
                  </Td>
                  <Td>{quotationStatus ? <Badge tone={toneFor(quotationStatus)}>{t(`quote.status.${quotationStatus as "draft"}`)}</Badge> : rc.status === "declined" ? <Badge>{t("rfq.delivery.declined")}</Badge> : "—"}</Td>
                  <Td>{rfq.status === "revision_requested" && rfq.revisionDeadline ? f.dateTime(rfq.revisionDeadline, "short") : rfq.closesAt ? f.dateTime(rfq.closesAt, "short") : "—"}</Td>
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
