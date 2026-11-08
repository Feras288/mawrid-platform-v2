import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { listCategories } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { getMyProduct, listPriceLists } from "@platform/modules/supplier-products";
import { listWarehouses } from "@platform/modules/suppliers";
import { PricingEditor, ProductForm, PublishToggle, StockEditor } from "@/components/supplier/product-editor";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations("products");
  const [{ product, prices, stock }, cats, units, lists, warehouses] = await Promise.all([getMyProduct(ctx, id).catch(() => notFound()), listCategories(), listUnits(), listPriceLists(ctx), listWarehouses(ctx)]);
  const current: Record<string, { minQty: string; unitPrice: string; discountPct: string }[]> = {};
  for (const p of prices) (current[p.list.id] ??= []).push({ minQty: String(Number(p.item.minQty)), unitPrice: String(Number(p.item.unitPrice)), discountPct: String(Number(p.item.discountPct)) });
  const manage = can(ctx, "products.manage");
  return (
    <>
      <PageHeader
        title={localized(product, ctx.locale)}
        description={<span dir="ltr">{product.sku}</span>}
        actions={
          <>
            <Badge tone={product.isPublished ? "primary" : "neutral"}>{product.isPublished ? t("published") : t("notPublished")}</Badge>
            {manage ? <PublishToggle productId={product.id} published={product.isPublished} /> : null}
          </>
        }
      />
      <p className="-mt-4 mb-6 text-xs text-ink-500">{t("publishHint")}</p>
      <div className="grid gap-6">
        <Card>
          <CardHeader title={t("edit")} />
          <CardBody>
            <ProductForm
              categories={cats}
              units={units}
              product={{ ...product, packSize: String(Number(product.packSize)), moq: String(Number(product.moq)), orderIncrement: String(Number(product.orderIncrement)) }}
            />
          </CardBody>
        </Card>
        {can(ctx, "pricing.manage") && lists.length ? <PricingEditor productId={product.id} lists={lists} current={current} /> : null}
        {can(ctx, "pricing.manage") && !lists.length ? (
          <Card>
            <CardHeader title={t("pricing")} />
            <CardBody className="text-sm text-ink-500">{t("newPriceList")}</CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={t("stock")} />
          <CardBody>
            <StockEditor productId={product.id} warehouses={warehouses.filter((w) => w.isActive)} stock={stock.map((s) => ({ warehouseId: s.warehouseId, onHand: s.onHand, reserved: s.reserved }))} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
