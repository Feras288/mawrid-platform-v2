import { getTranslations } from "next-intl/server";
import { listCategories } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { adminListSuppliersForProducts } from "@platform/modules/supplier-products";
import { AdminProductForm } from "@/components/admin/products-client";
import { Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AdminNewProductPage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const [cats, units, suppliers] = await Promise.all([listCategories(), listUnits(), adminListSuppliersForProducts(ctx)]);
  const options = suppliers
    .filter((s) => s.status === "active")
    .map((s) => ({ value: s.id, label: `${localized(s, ctx.locale)}${s.profileStatus && s.profileStatus !== "approved" ? ` (${t("admProducts.notApproved")})` : ""}` }));
  return (
    <>
      <PageHeader title={t("admProducts.newTitle")} description={t("admProducts.newHint")} />
      <Card>
        <CardBody>
          <AdminProductForm categories={cats} units={units} suppliers={options} />
        </CardBody>
      </Card>
    </>
  );
}
