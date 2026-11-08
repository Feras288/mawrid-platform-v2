import { getTranslations } from "next-intl/server";
import { listPos } from "@platform/modules/purchase-orders";
import { PoTable } from "@/components/procurement/po-view";
import { PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function BuyerPosPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const sp = await searchParams;
  const data = await listPos(ctx, { side: "buyer", page: Number(sp.page) || 1, status: sp.status?.match(/^[a-z_]{3,30}$/) ? sp.status : undefined });
  return (
    <>
      <PageHeader title={t("po.title")} />
      <PoTable data={data} side="buyer" locale={ctx.locale} />
    </>
  );
}
