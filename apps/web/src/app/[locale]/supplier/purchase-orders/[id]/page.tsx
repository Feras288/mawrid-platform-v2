import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { getPo } from "@platform/modules/purchase-orders";
import { SupplierPoActions } from "@/components/procurement/po-client";
import { PoDetails } from "@/components/procurement/po-view";
import { PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierPoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const data = await getPo(ctx, id).catch(() => notFound());
  const { po, items } = data;
  const closed = po.approvalStatus !== "approved" || ["completed", "cancelled", "delivered"].includes(po.fulfillmentStatus);
  return (
    <>
      <PageHeader
        title={<span dir="ltr">{po.code}</span>}
        breadcrumbs={
          <Link href="/supplier/purchase-orders" className="hover:underline">
            {t("po.title")}
          </Link>
        }
        actions={can(ctx, "supplier.po.fulfil") ? <SupplierPoActions poId={id} acknowledged={Boolean(po.acknowledgedAt)} lines={items} closed={closed} /> : null}
      />
      <PoDetails data={data} side="supplier" locale={ctx.locale} />
    </>
  );
}
