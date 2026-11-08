import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getSupplierOrder } from "@platform/modules/commerce";
import { toneFor } from "@/components/procurement/status";
import { ReturnDecision, SupplierGroupActions } from "@/components/store/store-client";
import { Badge, Card, CardBody, CardHeader, Dl, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const { group: g, lines, charges, events, returns, invoices } = await getSupplierOrder(ctx, id).catch(() => notFound());
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const a = g.deliveryAddress;
  return (
    <>
      <PageHeader
        title={<span dir="ltr">{g.code}</span>}
        breadcrumbs={
          <Link href="/supplier/orders" className="hover:underline">
            {t("orders.supplierTitle")}
          </Link>
        }
        actions={
          <>
            <Badge tone={toneFor(g.status)}>{t(`orders.groupStatus.${g.status as "confirmed"}`)}</Badge>
            {can(ctx, "supplier.orders.fulfil") ? <SupplierGroupActions groupId={g.id} status={g.status} /> : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("orders.items")} />
            <Table caption={t("orders.items")}>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>{t("boq.description")}</Th>
                  <Th>{t("store.quantity")}</Th>
                  <Th>{t("store.unitPrice")}</Th>
                  <Th>{t("store.lineTotal")}</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={l.id}>
                    <Td dir="ltr" className="font-mono text-xs">
                      {l.sku}
                    </Td>
                    <Td>{ctx.locale === "ar" ? l.nameAr : l.nameEn}</Td>
                    <Td dir="ltr">
                      {Number(l.quantity)} {l.unit}
                      {Number(l.returnedQty) > 0 ? <span className="ms-1 text-xs text-warning-600">↩ {Number(l.returnedQty)}</span> : null}
                    </Td>
                    <Td dir="ltr">{money(l.unitPrice)}</Td>
                    <Td dir="ltr">{money(l.lineTotal)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title={t("orders.returnsTitle")} />
            <CardBody>
              {returns.length === 0 ? (
                <p className="text-sm text-ink-500">{t("orders.noReturns")}</p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {returns.map((r) => (
                    <li key={r.id} className="space-y-1 rounded-lg border border-sand-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span dir="ltr" className="font-mono text-xs">
                          {r.code}
                        </span>
                        <Badge tone={toneFor(r.status === "requested" ? "pending" : r.status)}>{t(`orders.returnStatus.${r.status as "requested"}`)}</Badge>
                        <bdi dir="ltr">{money(r.amount)}</bdi>
                      </div>
                      <p className="text-ink-600">{r.reason}</p>
                      <ul className="text-xs text-ink-500">
                        {r.lines.map((rl) => (
                          <li key={rl.orderLineId}>
                            {lines.find((l) => l.id === rl.orderLineId)?.sku} × {Number(rl.quantity)}
                          </li>
                        ))}
                      </ul>
                      {can(ctx, "supplier.orders.fulfil") ? <ReturnDecision returnId={r.id} status={r.status} /> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("orders.deliveryAddress")} />
            <CardBody className="text-sm">
              <p className="font-medium">{a.recipientName}</p>
              <p>{a.line1}</p>
              {a.line2 ? <p>{a.line2}</p> : null}
              <p>
                {a.district ? `${a.district}, ` : ""}
                {a.city}
              </p>
              <p dir="ltr">{a.phone}</p>
              <p className="mt-2 text-xs text-ink-500">
                {t(`store.methods.${g.shippingMethod as "standard"}`)} · {t("store.eta", { min: g.etaMinDays ?? 0, max: g.etaMaxDays ?? 0 })}
              </p>
              {g.trackingNumber ? (
                <p className="text-xs">
                  {g.carrier} · <span dir="ltr">{g.trackingNumber}</span>
                </p>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("orders.breakdown")} />
            <CardBody>
              <Dl items={charges.map((c) => ({ label: t(`orders.charges.${c.kind as "goods"}`), value: <bdi dir="ltr">{money(c.amount)}</bdi> }))} />
            </CardBody>
          </Card>
          {invoices.length ? (
            <Card>
              <CardHeader title={t("orders.invoices")} />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {invoices.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span dir="ltr" className="font-mono text-xs">
                        {i.number}
                      </span>
                      <Link href={`/invoices/${i.id}`} className="text-primary-700 hover:underline">
                        {t("orders.viewInvoice")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("orders.timeline")} />
            <CardBody>
              <ol className="space-y-1 text-xs text-ink-600">
                {events.map((e) => (
                  <li key={e.id}>
                    {f.dateTime(e.createdAt, "short")} · {e.kind}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
