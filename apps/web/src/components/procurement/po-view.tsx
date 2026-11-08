import { getFormatter, getTranslations } from "next-intl/server";
import type { getPo, listPos } from "@platform/modules/purchase-orders";
import { toneFor } from "@/components/procurement/status";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, CardBody, CardHeader, Dl, EmptyState, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { localized } from "@/lib/utils";

type PoList = Awaited<ReturnType<typeof listPos>>;
type PoData = Awaited<ReturnType<typeof getPo>>;

export async function PoTable({ data, side, locale }: { data: PoList; side: "buyer" | "supplier"; locale: string }) {
  const t = await getTranslations();
  const f = await getFormatter();
  const base = side === "buyer" ? "/org/purchase-orders" : "/supplier/purchase-orders";
  return (
    <>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title={t("po.noPos")} />
        ) : (
          <Table caption={t("po.title")}>
            <thead>
              <tr>
                <Th>{t("po.code")}</Th>
                <Th>{side === "buyer" ? t("po.supplier") : t("po.buyer")}</Th>
                <Th>{t("po.approvalStatus")}</Th>
                <Th>{t("po.fulfillment")}</Th>
                <Th>{t("po.total")}</Th>
                <Th>{t("po.expected")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(({ po, partyAr, partyEn }) => (
                <Tr key={po.id}>
                  <Td dir="ltr">
                    <Link href={`${base}/${po.id}`} className="font-mono text-xs font-medium text-primary-700 hover:underline">
                      {po.code}
                    </Link>
                  </Td>
                  <Td>{localized({ nameAr: partyAr, nameEn: partyEn }, locale)}</Td>
                  <Td>
                    <Badge tone={toneFor(po.approvalStatus)}>{t(`po.approval.${po.approvalStatus as "draft"}`)}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={toneFor(po.fulfillmentStatus)}>{t(`po.status.${po.fulfillmentStatus as "not_started"}`)}</Badge>
                    {po.isDelayed ? (
                      <Badge tone="danger" className="ms-1">
                        {t("po.delayed")}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td dir="ltr">{f.number(Number(po.total), { style: "currency", currency: po.currency })}</Td>
                  <Td>{po.expectedDeliveryAt ? f.dateTime(po.expectedDeliveryAt, "short") : "—"}</Td>
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

export async function PoDetails({ data, side, locale }: { data: PoData; side: "buyer" | "supplier"; locale: string }) {
  const t = await getTranslations();
  const f = await getFormatter();
  const { po, items, shipments, receipts, events } = data;
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: po.currency });
  const visibleEvents = side === "buyer" ? events : events.filter((e) => e.visibleToSupplier);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={toneFor(po.approvalStatus)}>{t(`po.approval.${po.approvalStatus as "draft"}`)}</Badge>
        <Badge tone={toneFor(po.fulfillmentStatus)}>{t(`po.status.${po.fulfillmentStatus as "not_started"}`)}</Badge>
        {po.isDelayed ? <Badge tone="danger">{t("po.delayed")}</Badge> : null}
        {po.pdfFileIdAr ? (
          <a className="text-sm text-primary-700 hover:underline" href={`/api/v1/files/${po.pdfFileIdAr}`}>
            {t("po.pdfAr")}
          </a>
        ) : null}
        {po.pdfFileIdEn ? (
          <a className="text-sm text-primary-700 hover:underline" href={`/api/v1/files/${po.pdfFileIdEn}`}>
            {t("po.pdfEn")}
          </a>
        ) : null}
        {po.approvalStatus === "approved" && !po.pdfFileIdAr ? <span className="text-xs text-ink-500">{t("po.pdfPending")}</span> : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("po.lines")} />
          <div className="overflow-x-auto">
            <Table caption={t("po.lines")}>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{t("boq.description")}</Th>
                  <Th>{t("po.ordered")}</Th>
                  <Th>{t("quote.unitPrice")}</Th>
                  <Th>{t("quote.total")}</Th>
                  <Th>{t("po.shipped")}</Th>
                  <Th>{t("po.received")}</Th>
                  <Th>{t("po.rejectedQty")}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <Tr key={i.id}>
                    <Td dir="ltr">{i.lineNo}</Td>
                    <Td className="max-w-sm">
                      {i.description}
                      {i.brand ? <span className="block text-xs text-ink-500">{i.brand}</span> : null}
                    </Td>
                    <Td dir="ltr" className="whitespace-nowrap">
                      {Number(i.quantity)} {i.unit}
                    </Td>
                    <Td dir="ltr">{money(i.unitPrice)}</Td>
                    <Td dir="ltr">{money(i.lineTotal)}</Td>
                    <Td dir="ltr">{Number(i.shippedQty)}</Td>
                    <Td dir="ltr">{Number(i.receivedQty)}</Td>
                    <Td dir="ltr">{Number(i.rejectedQty)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("po.terms")} />
          <CardBody>
            <Dl
              items={[
                { label: t("po.buyer"), value: localized(data.buyer, locale) },
                { label: t("po.supplier"), value: localized(data.supplier, locale) },
                { label: t("quote.subtotal"), value: money(po.subtotal) },
                { label: t("quote.shipping"), value: money(po.shippingAmount) },
                { label: t("quote.vatTotal"), value: money(po.vatTotal) },
                { label: t("po.total"), value: <strong>{money(po.total)}</strong> },
                { label: t("po.issuedAt"), value: po.issuedAt ? f.dateTime(po.issuedAt, "short") : "—" },
                { label: t("po.expected"), value: po.expectedDeliveryAt ? f.dateTime(po.expectedDeliveryAt, "short") : "—" },
                { label: t("rfq.paymentTerms"), value: po.paymentTerms ?? "—" },
                { label: t("rfq.deliveryTerms"), value: po.deliveryTerms ?? "—" },
                { label: t("rfq.deliveryAddress"), value: po.deliveryAddress ?? "—" },
                ...(po.delayReason ? [{ label: t("po.delayReason"), value: po.delayReason }] : []),
                ...(po.cancelReason ? [{ label: t("common.reason"), value: po.cancelReason }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("po.shipments")} />
          <CardBody>
            <ul className="space-y-2 text-sm">
              {shipments.map((s) => (
                <li key={s.id} className="rounded border border-sand-200 p-2">
                  <span className="font-mono text-xs" dir="ltr">
                    {s.reference}
                  </span>{" "}
                  · {f.dateTime(s.shippedAt, "short")}
                  {s.carrier ? ` · ${s.carrier}` : ""} {s.trackingNumber ? <bdi dir="ltr">{s.trackingNumber}</bdi> : null}
                  <ul className="text-xs text-ink-500">
                    {s.lines.map((l) => (
                      <li key={l.poItemId}>
                        #{items.find((i) => i.id === l.poItemId)?.lineNo} × {Number(l.quantity)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("po.receipts")} />
          <CardBody>
            <ul className="space-y-1 text-sm">
              {receipts.map((r) => (
                <li key={r.id}>
                  {f.dateTime(r.receivedAt, "short")}
                  {r.notes ? ` · ${r.notes}` : ""}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("po.timeline")} />
          <CardBody>
            <ol className="space-y-1 text-sm">
              {visibleEvents.map((e) => (
                <li key={e.id}>
                  <span className="text-ink-500">{f.dateTime(e.createdAt, "short")}</span> · {t.has(`po.events.${e.kind}`) ? t(`po.events.${e.kind as "created"}`) : e.kind}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
