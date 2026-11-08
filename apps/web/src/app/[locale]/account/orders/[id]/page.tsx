import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getMyOrder } from "@platform/modules/commerce";
import { toneFor } from "@/components/procurement/status";
import { CancelOrderDialog, PayNowButton, ReturnDialog } from "@/components/store/store-client";
import { Alert, Badge, Card, CardBody, CardHeader, Dl, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";

export default async function MyOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getMyOrder(ctx, id).catch(() => notFound());
  const { order: o, groups, intent, invoices, returns, refunds, events } = data;
  const money = (v: string | number) => f.number(Number(v), { style: "currency", currency: o.currency });
  const addr = o.shippingAddress;
  return (
    <>
      <PageHeader
        title={<span dir="ltr">{o.code}</span>}
        breadcrumbs={
          <Link href="/account/orders" className="hover:underline">
            {t("orders.title")}
          </Link>
        }
        actions={
          <>
            <Badge tone={toneFor(o.status === "placed" ? "approved" : o.status === "payment_failed" ? "failed" : o.status === "pending_payment" ? "pending" : o.status)}>{t(`orders.orderStatus.${o.status as "placed"}`)}</Badge>
            <Badge>{t(`orders.paymentStatus.${o.paymentStatus as "paid"}`)}</Badge>
            {data.canPay && o.paymentMethod === "card" ? <PayNowButton orderId={o.id} /> : null}
            {["pending_payment", "payment_failed"].includes(o.status) && o.paymentStatus !== "paid" ? <CancelOrderDialog orderId={o.id} label={t("orders.cancelOrder")} /> : null}
          </>
        }
      />
      {data.canPay && o.expiresAt ? <Alert tone="warning" className="mb-4">{t("orders.payBefore", { time: f.dateTime(o.expiresAt, { dateStyle: "medium", timeStyle: "short" }) })}</Alert> : null}
      {intent?.provider === "bank_transfer" && intent.status === "pending" && intent.instructions ? (
        <Card className="mb-6">
          <CardHeader title={t("orders.bankInstructions")} />
          <CardBody>
            <Dl
              items={[
                { label: t("orders.bank"), value: intent.instructions.bankName || "—" },
                { label: t("orders.beneficiary"), value: intent.instructions.beneficiary },
                { label: t("orders.iban"), value: <span dir="ltr">{intent.instructions.iban}</span> },
                { label: t("orders.reference"), value: <span dir="ltr" className="font-mono">{intent.instructions.reference}</span> },
                { label: t("orders.amount"), value: <bdi dir="ltr">{money(intent.instructions.amount ?? o.total)}</bdi> },
              ]}
            />
          </CardBody>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader
                title={t("store.shipmentFrom", { supplier: ctx.locale === "ar" ? g.supplierNameAr : g.supplierNameEn })}
                description={<span dir="ltr">{g.code}</span>}
                actions={
                  <>
                    <Badge tone={toneFor(g.status)}>{t(`orders.groupStatus.${g.status as "confirmed"}`)}</Badge>
                    {g.canCancel ? <CancelOrderDialog orderId={o.id} groupId={g.id} label={t("orders.cancelShipment")} /> : null}
                    {g.canReturn ? <ReturnDialog groupId={g.id} lines={g.lines.map((l) => ({ id: l.id, name: ctx.locale === "ar" ? l.nameAr : l.nameEn, max: String(Number(l.quantity) - Number(l.returnedQty)) }))} /> : null}
                  </>
                }
              />
              <ul className="divide-y divide-sand-200 text-sm">
                {g.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                    <span>
                      {ctx.locale === "ar" ? l.nameAr : l.nameEn} <span className="text-ink-500" dir="ltr">× {Number(l.quantity)}</span>
                      {Number(l.returnedQty) > 0 ? <span className="ms-2 text-xs text-warning-600">↩ {Number(l.returnedQty)}</span> : null}
                    </span>
                    <bdi dir="ltr">{money(l.lineTotal)}</bdi>
                  </li>
                ))}
              </ul>
              <CardBody className="space-y-1 border-t border-sand-200 text-sm">
                <div className="flex justify-between">
                  <span>{t("store.shipping")} · {t(`store.methods.${g.shippingMethod as "standard"}`)}</span>
                  <bdi dir="ltr">{money(Number(g.shippingNet) + Number(g.shippingVat))}</bdi>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t("store.total")}</span>
                  <bdi dir="ltr">{money(g.total)}</bdi>
                </div>
                {g.trackingNumber ? (
                  <p className="text-xs text-ink-500">
                    {t("orders.carrier")}: {g.carrier} · {t("orders.tracking")}: <span dir="ltr">{g.trackingNumber}</span>
                  </p>
                ) : null}
                {g.cancelReason ? <p className="text-xs text-ink-500">{g.cancelReason}</p> : null}
              </CardBody>
            </Card>
          ))}
          {returns.length ? (
            <Card>
              <CardHeader title={t("orders.returns")} />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {returns.map((r) => (
                    <li key={r.id}>
                      <span dir="ltr" className="font-mono text-xs">
                        {r.code}
                      </span>{" "}
                      · <Badge tone={toneFor(r.status === "requested" ? "pending" : r.status)}>{t(`orders.returnStatus.${r.status as "requested"}`)}</Badge> · <bdi dir="ltr">{money(r.amount)}</bdi>
                      {r.decisionNote ? <span className="text-ink-500"> · {r.decisionNote}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>{t("store.goods")}</span>
                <bdi dir="ltr">{money(o.goodsNet)}</bdi>
              </div>
              <div className="flex justify-between">
                <span>{t("store.shipping")}</span>
                <bdi dir="ltr">{money(o.shippingNet)}</bdi>
              </div>
              <div className="flex justify-between">
                <span>{t("store.vat")}</span>
                <bdi dir="ltr">{money(o.vatTotal)}</bdi>
              </div>
              <div className="flex justify-between border-t border-sand-200 pt-1 text-base font-bold">
                <span>{t("store.total")}</span>
                <bdi dir="ltr">{money(o.total)}</bdi>
              </div>
              {Number(o.refundedTotal) > 0 ? (
                <div className="flex justify-between text-success-600">
                  <span>{t("orders.refunded")}</span>
                  <bdi dir="ltr">{money(o.refundedTotal)}</bdi>
                </div>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("orders.deliveryAddress")} />
            <CardBody className="text-sm">
              <p>{addr.recipientName}</p>
              <p>{addr.line1}</p>
              {addr.line2 ? <p>{addr.line2}</p> : null}
              <p>
                {addr.district ? `${addr.district}, ` : ""}
                {addr.city}
              </p>
              <p dir="ltr">{addr.phone}</p>
            </CardBody>
          </Card>
          {invoices.length ? (
            <Card>
              <CardHeader title={t("orders.invoices")} />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {invoices.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span>
                        {t(`invoice.kinds.${i.kind as "simplified"}`)} <span dir="ltr" className="font-mono text-xs">{i.number}</span>
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
          {refunds.length ? (
            <Card>
              <CardHeader title={t("orders.refunds")} />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {refunds.map((r) => (
                    <li key={r.id}>
                      <bdi dir="ltr">{money(r.amount)}</bdi> · {t(`orders.refundStatus.${r.status as "pending"}`)}
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
