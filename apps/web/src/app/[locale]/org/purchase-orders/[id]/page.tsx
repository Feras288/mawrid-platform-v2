import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getPo } from "@platform/modules/purchase-orders";
import { CancelPoDialog, CompletePoButton, PoDraftActions, ReceiptDialog } from "@/components/procurement/po-client";
import { PoDetails } from "@/components/procurement/po-view";
import { toneFor } from "@/components/procurement/status";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function BuyerPoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const data = await getPo(ctx, id).catch(() => notFound());
  const { po, items, approval } = data;
  const open = po.approvalStatus === "approved" && !["completed", "cancelled"].includes(po.fulfillmentStatus);
  const editable = ["draft", "rejected"].includes(po.approvalStatus) && can(ctx, "po.create");
  return (
    <>
      <PageHeader
        title={<span dir="ltr">{po.code}</span>}
        breadcrumbs={
          <Link href="/org/purchase-orders" className="hover:underline">
            {t("po.title")}
          </Link>
        }
        actions={
          <>
            {editable ? <PoDraftActions po={po} /> : null}
            {open && can(ctx, "po.receive") ? <ReceiptDialog poId={id} lines={items} /> : null}
            {open && can(ctx, "po.receive") && po.fulfillmentStatus === "delivered" ? <CompletePoButton poId={id} /> : null}
            {po.approvalStatus !== "cancelled" && po.fulfillmentStatus !== "completed" && can(ctx, "po.cancel") ? <CancelPoDialog poId={id} /> : null}
          </>
        }
      />
      {approval ? (
        <Alert tone={approval.status === "rejected" ? "danger" : approval.status === "pending" ? "warning" : "info"} className="mb-4">
          {t("rfq.approval")}: <Badge tone={toneFor(approval.status)}>{t(`approvals.status.${approval.status as "pending"}`)}</Badge>{" "}
          <Link href={`/org/approvals/${approval.id}`} className="underline">
            {t("approvals.open")}
          </Link>
        </Alert>
      ) : null}
      {po.rfqId ? (
        <p className="mb-4 text-sm">
          <Link href={`/org/rfqs/${po.rfqId}`} className="text-primary-700 hover:underline">
            {t("rfq.title")}
          </Link>
        </p>
      ) : null}
      <PoDetails data={data} side="buyer" locale={ctx.locale} />
    </>
  );
}
