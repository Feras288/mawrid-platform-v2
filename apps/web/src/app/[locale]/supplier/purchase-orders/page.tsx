import { getTranslations } from "next-intl/server";
import { listPos } from "@platform/modules/purchase-orders";
import { PoTable } from "@/components/procurement/po-view";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function SupplierPosPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const sp = await searchParams;
  const data = await listPos(ctx, { side: "supplier", page: Number(sp.page) || 1, status: sp.status?.match(/^[a-z_]{3,30}$/) ? sp.status : undefined });
  return (
    <>
      <PageHeader title={t("po.title")} />
      <PoTable data={data} side="supplier" locale={ctx.locale} />
    </>
  );
}
