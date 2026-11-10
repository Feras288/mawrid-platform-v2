import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { listCategories } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { adminGetProduct } from "@platform/modules/supplier-products";
import { Link } from "@/i18n/navigation";
import { AdminProductForm, AdminPublishForm } from "@/components/admin/products-client";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const [{ product, supplier, prices, stock }, cats, units] = await Promise.all([adminGetProduct(ctx, id).catch(() => notFound()), listCategories(), listUnits()]);
  return (
    <>
      <PageHeader
        title={localized(product, ctx.locale)}
        description={
          <span>
            <span dir="ltr">{product.sku}</span> ·{" "}
            <Link href={`/admin/products?supplier=${supplier.id}`} className="hover:underline">
              {localized(supplier, ctx.locale)}
            </Link>
          </span>
        }
        actions={
          <>
            <Badge tone={product.isPublished ? "primary" : "neutral"}>{product.isPublished ? t("products.published") : t("products.notPublished")}</Badge>
            {supplier.profileStatus !== "approved" ? <Badge tone="accent">{t("admProducts.notApproved")}</Badge> : null}
          </>
        }
      />
      <p className="-mt-4 mb-6 text-xs text-ink-500">{t("admProducts.onBehalfNote")}</p>
      <div className="grid gap-6">
        <Card>
          <CardHeader title={product.isPublished ? t("products.unpublish") : t("products.publish")} />
          <CardBody>
            <p className="mb-3 text-xs text-ink-500">{t("products.publishHint")}</p>
            <AdminPublishForm productId={product.id} published={product.isPublished} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("products.edit")} />
          <CardBody>
            <AdminProductForm
              categories={cats}
              units={units}
              product={{ ...product, attributes: product.attributes as Record<string, string | number | boolean>, packSize: String(Number(product.packSize)), moq: String(Number(product.moq)), orderIncrement: String(Number(product.orderIncrement)) }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("products.pricing")} />
          <p className="px-4 pt-3 text-xs text-ink-500">{t("admProducts.readOnlyBySupplier")}</p>
          {!prices.length ? (
            <EmptyState title={t("common.none")} />
          ) : (
            <Table caption={t("products.pricing")}>
              <thead>
                <tr>
                  <Th>{t("products.priceList")}</Th>
                  <Th>{t("products.listKind")}</Th>
                  <Th>{t("products.minQty")}</Th>
                  <Th>{t("products.unitPrice")}</Th>
                  <Th>{t("products.discount")}</Th>
                </tr>
              </thead>
              <tbody>
                {prices.map(({ item, list }) => (
                  <Tr key={item.id}>
                    <Td>{list.name}</Td>
                    <Td>{t(`products.kinds.${list.kind as "retail"}`)}</Td>
                    <Td dir="ltr">{Number(item.minQty)}</Td>
                    <Td dir="ltr">{f.number(Number(item.unitPrice), { style: "currency", currency: "SAR" })}</Td>
                    <Td dir="ltr">{Number(item.discountPct)}%</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("products.stock")} />
          <p className="px-4 pt-3 text-xs text-ink-500">{t("admProducts.readOnlyBySupplier")}</p>
          {!stock.length ? (
            <EmptyState title={t("common.none")} />
          ) : (
            <Table caption={t("products.stock")}>
              <thead>
                <tr>
                  <Th>{t("products.warehouse")}</Th>
                  <Th>{t("products.onHand")}</Th>
                  <Th>{t("products.reserved")}</Th>
                </tr>
              </thead>
              <tbody>
                {stock.map((s) => (
                  <Tr key={s.warehouseId}>
                    <Td>{s.warehouse}</Td>
                    <Td dir="ltr">{Number(s.onHand)}</Td>
                    <Td dir="ltr">{Number(s.reserved)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
