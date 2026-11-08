import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getMyQuotation } from "@platform/modules/quotations";
import { acceptingQuotes, getRfqForSupplier } from "@platform/modules/rfq";
import { toneFor } from "@/components/procurement/status";
import { QuotationForm, QuoteAttachments, QuoteSecondaryActions } from "@/components/supplier/quote-form";
import { Alert, Badge, Card, CardBody, CardHeader, Dl, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function SupplierRfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getRfqForSupplier(ctx, id).catch(() => notFound());
  const mine = await getMyQuotation(ctx, id);
  const { rfq, recipient, items, buyer, attachments } = data;
  const accepting = acceptingQuotes(rfq, recipient.round, rfq.round) && recipient.status !== "declined";
  const canSubmit = can(ctx, "supplier.quotation.submit");
  const qStatus = mine?.quotation.status ?? null;
  const editable = accepting && canSubmit && (!mine || qStatus === "draft");
  return (
    <>
      <PageHeader
        title={rfq.title}
        breadcrumbs={
          <>
            <Link href="/supplier/rfqs" className="hover:underline">
              {t("quote.inbox")}
            </Link>{" "}
            / <span dir="ltr">{rfq.code}</span>
          </>
        }
        actions={
          <>
            <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "open"}`)}</Badge>
            {qStatus ? <Badge tone={toneFor(qStatus)}>{t(`quote.status.${qStatus as "draft"}`)}</Badge> : null}
            {mine ? <Badge>{t("quote.version", { v: mine.quotation.version })}</Badge> : null}
          </>
        }
      />
      {!accepting ? (
        <Alert tone="warning" className="mb-4">
          {t("quote.notAccepting")}
        </Alert>
      ) : null}
      {canSubmit && accepting ? (
        <div className="mb-4">
          <QuoteSecondaryActions rfqId={id} status={qStatus} canRevise={rfq.allowRevisions || rfq.status === "revision_requested"} canDecline={!mine && recipient.status === "sent"} />
        </div>
      ) : null}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("common.details")} />
          <CardBody>
            <Dl
              items={[
                { label: t("quote.buyer"), value: buyer ? localized(buyer, ctx.locale) : "—" },
                { label: t("rfq.closesAt"), value: rfq.closesAt ? f.dateTime(rfq.closesAt, "short") : "—" },
                ...(rfq.revisionDeadline && rfq.status === "revision_requested" ? [{ label: t("rfq.revisionDeadline"), value: f.dateTime(rfq.revisionDeadline, "short") }] : []),
                { label: t("rfq.requiredBy"), value: rfq.requiredBy ? f.dateTime(rfq.requiredBy, "short") : "—" },
                { label: t("rfq.deliveryCity"), value: rfq.deliveryCity ?? "—" },
                { label: t("rfq.deliveryAddress"), value: rfq.deliveryAddress ?? "—" },
                { label: t("rfq.paymentTerms"), value: rfq.paymentTerms ?? "—" },
                { label: t("rfq.deliveryTerms"), value: rfq.deliveryTerms ?? "—" },
              ]}
            />
            {rfq.description ? <p className="mt-3 text-sm text-ink-600">{rfq.description}</p> : null}
            {attachments.length ? (
              <ul className="mt-3 space-y-1 text-sm">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <a className="text-primary-700 hover:underline" href={`/api/v1/files/${a.file_id}`}>
                      {a.original_name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
        {mine ? (
          <Card>
            <CardHeader title={t("quote.history")} />
            <CardBody>
              <ul className="space-y-1 text-sm">
                {mine.history.map((h) => (
                  <li key={h.id}>
                    {t("quote.version", { v: h.version })} · <Badge tone={toneFor(h.status)}>{t(`quote.status.${h.status as "draft"}`)}</Badge> · <bdi dir="ltr">{f.number(Number(h.total), { style: "currency", currency: "SAR" })}</bdi>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
      {recipient.status !== "declined" ? (
        <Card>
          <CardHeader title={t("quote.myQuote")} />
          <CardBody>
            <QuotationForm
              rfqId={id}
              editable={editable}
              allowAlternatives={rfq.allowAlternatives}
              lines={items.map((i) => ({ id: i.id, lineNo: i.lineNo, description: i.description, quantity: i.quantity, unit: i.unit, attributes: (i.attributes ?? {}) as Record<string, unknown> }))}
              quote={mine?.quotation ?? null}
              items={mine?.items ?? []}
            />
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">{recipient.declineReason}</Alert>
      )}
      {mine ? (
        <div className="mt-6">
          <QuoteAttachments rfqId={id} files={mine.attachments} editable={editable} />
        </div>
      ) : null}
    </>
  );
}
