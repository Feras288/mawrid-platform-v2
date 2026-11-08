import { getTranslations } from "next-intl/server";
import { authorize } from "@platform/modules/authz";
import { listCategories } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { ProductForm } from "@/components/supplier/product-editor";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function NewProductPage() {
  const ctx = await requireOrgCtx("supplier");
  authorize(ctx, "products.manage");
  const t = await getTranslations("products");
  const [cats, units] = await Promise.all([listCategories(), listUnits()]);
  return (
    <>
      <PageHeader title={t("new")} />
      <Card>
        <CardBody>
          <ProductForm categories={cats} units={units} />
        </CardBody>
      </Card>
    </>
  );
}
