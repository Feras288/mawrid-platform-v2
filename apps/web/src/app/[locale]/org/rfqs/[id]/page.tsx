import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { listCategories } from "@platform/modules/catalog";
import { listCities, listUnits } from "@platform/modules/reference";
import { getRfq, suggestSuppliers } from "@platform/modules/rfq";
import { listApprovedSuppliers } from "@platform/modules/suppliers";
import { AddRfqLineDialog, EditRfqDialog, RecipientsCard, RemoveLineButton, ResendButton, RfqActions, RfqAttachmentForm } from "@/components/procurement/rfq-client";
import { toneFor } from "@/components/procurement/status";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Dl, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function RfqDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getRfq(ctx, id).catch(() => notFound());
  const { rfq, items, recipients, events, attachments, approval } = data;
  const draft = rfq.status === "draft";
  const canEdit = draft && can(ctx, "rfq.create");
  const [cities, units, cats, suggestions, directory] = await Promise.all([
    listCities(),
    canEdit ? listUnits() : Promise.resolve([]),
    canEdit ? listCategories() : Promise.resolve([]),
    canEdit ? suggestSuppliers(ctx, id).catch(() => []) : Promise.resolve([]),
    canEdit ? listApprovedSuppliers() : Promise.resolve([]),
  ]);
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  const evaluating = ["open", "partially_responded", "under_evaluation", "revision_requested", "awarded", "closed"].includes(rfq.status);
  return (
    <>
      <PageHeader
        title={rfq.title}
        breadcrumbs={
          <>
            <Link href="/org/rfqs" className="hover:underline">
              {t("rfq.title")}
            </Link>{" "}
            / <span dir="ltr">{rfq.code}</span>
          </>
        }
        actions={
          <>
            <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "draft"}`)}</Badge>
            {canEdit ? <EditRfqDialog rfq={rfq} cities={cityOpts} /> : null}
            {evaluating && can(ctx, "quotation.view") ? (
              <Button asChild variant="accent">
                <Link href={`/org/rfqs/${id}/compare`}>{t("rfq.compare")}</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-6">
        <RfqActions
          rfqId={id}
          status={rfq.status}
          canSubmit={can(ctx, "rfq.submit")}
          canSend={can(ctx, "rfq.send")}
          canEvaluate={can(ctx, "rfq.evaluate")}
          canCancel={can(ctx, "rfq.cancel")}
          recipients={recipients.filter((r) => r.rc.status === "responded").map((r) => ({ value: r.rc.supplierOrgId, label: localized(r, ctx.locale) }))}
        />
      </div>
      {approval ? (
        <Alert tone={approval.status === "rejected" ? "danger" : approval.status === "pending" ? "warning" : "info"} className="mb-6">
          {t("rfq.approval")}: {t(`approvals.status.${approval.status as "pending"}`)} ·{" "}
          <Link href={`/org/approvals/${approval.id}`} className="underline">
            {t("approvals.open")}
          </Link>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("rfq.lines")} actions={canEdit ? <AddRfqLineDialog rfqId={id} units={units.map((u) => ({ value: u.code, label: `${localized(u, ctx.locale)} (${u.code})` }))} categories={cats.filter((c) => c.depth > 0).map((c) => ({ value: c.id, label: localized(c, ctx.locale) }))} /> : null} />
          <Table caption={t("rfq.lines")}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t("boq.description")}</Th>
                <Th>{t("boq.quantity")}</Th>
                <Th>{t("boq.unit")}</Th>
                {canEdit ? <Th>{t("common.actions")}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Tr key={i.id}>
                  <Td dir="ltr">{i.lineNo}</Td>
                  <Td className="max-w-md">
                    {i.section ? <span className="block text-xs text-ink-500">{i.section}</span> : null}
                    {i.description}
                  </Td>
                  <Td dir="ltr">{Number(i.quantity)}</Td>
                  <Td dir="ltr">{i.unit}</Td>
                  {canEdit ? (
                    <Td>
                      <RemoveLineButton id={i.id} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("common.details")} />
          <CardBody>
            <Dl
              items={[
                { label: t("rfq.closesAt"), value: rfq.closesAt ? f.dateTime(rfq.closesAt, "short") : "—" },
                { label: t("rfq.requiredBy"), value: rfq.requiredBy ? f.dateTime(rfq.requiredBy, "short") : "—" },
                { label: t("rfq.deliveryCity"), value: cityOpts.find((c) => c.value === rfq.deliveryCity)?.label ?? "—" },
                { label: t("rfq.deliveryAddress"), value: rfq.deliveryAddress ?? "—" },
                { label: t("rfq.paymentTerms"), value: rfq.paymentTerms ?? "—" },
                { label: t("rfq.deliveryTerms"), value: rfq.deliveryTerms ?? "—" },
                { label: t("rfq.round"), value: rfq.round },
                ...(rfq.revisionDeadline ? [{ label: t("rfq.revisionDeadline"), value: f.dateTime(rfq.revisionDeadline, "short") }] : []),
                ...(rfq.cancelReason ? [{ label: t("rfq.cancelReason"), value: rfq.cancelReason }] : []),
                ...(data.creatorName ? [{ label: t("common.createdBy"), value: data.creatorName }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t("rfq.recipients")} />
          {recipients.length === 0 ? (
            <CardBody>
              <p className="text-sm text-ink-500">{t("rfq.noRecipients")}</p>
            </CardBody>
          ) : (
            <Table caption={t("rfq.recipients")}>
              <thead>
                <tr>
                  <Th>{t("compare.supplier")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th>{t("rfq.round")}</Th>
                  <Th>{t("common.updatedAt")}</Th>
                  <Th>{t("common.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {recipients.map(({ rc, nameAr, nameEn }) => (
                  <Tr key={rc.id}>
                    <Td>{localized({ nameAr, nameEn }, ctx.locale)}</Td>
                    <Td>
                      <Badge tone={toneFor(rc.status)}>{t(`rfq.delivery.${rc.status as "pending"}`)}</Badge>
                      {rc.lastError ? <span className="mt-1 block text-xs text-danger-600">{rc.lastError}</span> : null}
                      {rc.declineReason ? <span className="mt-1 block text-xs text-ink-500">{rc.declineReason}</span> : null}
                    </Td>
                    <Td dir="ltr">{rc.round}</Td>
                    <Td>{f.dateTime(rc.updatedAt, "short")}</Td>
                    <Td>{rc.status === "failed" && can(ctx, "rfq.send") ? <ResendButton id={rc.id} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("rfq.attachments")} />
          <CardBody className="space-y-3">
            <ul className="space-y-1 text-sm">
              {attachments.map((a) => (
                <li key={a.id}>
                  <a className="text-primary-700 hover:underline" href={`/api/v1/files/${a.file_id}`}>
                    {a.original_name}
                  </a>
                </li>
              ))}
            </ul>
            {canEdit ? <RfqAttachmentForm rfqId={id} /> : null}
          </CardBody>
        </Card>
      </div>

      {canEdit ? (
        <div className="mt-6">
          <RecipientsCard
            rfqId={id}
            editable
            current={recipients.map((r) => r.rc.supplierOrgId)}
            suggestions={suggestions.map((s) => ({ orgId: s.orgId, label: localized(s, ctx.locale), score: s.score, reasons: s.reasons }))}
            all={directory.map((d) => ({ value: d.orgId, label: `${localized(d, ctx.locale)}${d.city ? ` · ${d.city}` : ""}` }))}
          />
        </div>
      ) : null}

      <Card className="mt-6">
        <CardHeader title={t("rfq.events")} />
        <CardBody>
          <ol className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2">
                <span className="text-ink-500">{f.dateTime(e.createdAt, "short")}</span>
                <span className="font-medium">{e.toStatus ? t(`rfq.status.${e.toStatus as "draft"}`) : e.kind}</span>
                {e.toStatus && e.kind !== "status" ? <span className="text-ink-500">({e.kind})</span> : null}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </>
  );
}
