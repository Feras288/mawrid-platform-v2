import { getFormatter, getTranslations } from "next-intl/server";
import { adminListProducts, adminListSuppliersForProducts } from "@platform/modules/supplier-products";
import { Link } from "@/i18n/navigation";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr, buttonVariants } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

type SP = { q?: string; supplier?: string; status?: string; published?: string; page?: string };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const status = ["draft", "active", "inactive"].includes(sp.status ?? "") ? sp.status : undefined;
  const published = sp.published === "yes" || sp.published === "no" ? sp.published : undefined;
  const [data, suppliers] = await Promise.all([
    adminListProducts(ctx, { q: sp.q, supplierOrgId: sp.supplier && /^[0-9a-f-]{36}$/i.test(sp.supplier) ? sp.supplier : undefined, status, published, page: Number(sp.page) || 1 }),
    adminListSuppliersForProducts(ctx),
  ]);
  const select = "h-10 rounded-lg border border-sand-300 bg-white px-3 text-sm";
  return (
    <>
      <PageHeader
        title={t("admProducts.title")}
        description={t("admProducts.description")}
        actions={
          <Link href="/admin/products/new" className={buttonVariants({ variant: "primary" })}>
            {t("products.new")}
          </Link>
        }
      />
      <form method="get" className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q ?? ""} aria-label={t("common.search")} placeholder={t("products.searchPlaceholder")} className="h-10 min-w-56 flex-1 rounded-lg border border-sand-300 px-3 text-sm" />
        <select name="supplier" defaultValue={sp.supplier ?? ""} aria-label={t("admProducts.supplier")} className={select}>
          <option value="">{t("admProducts.allSuppliers")}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, ctx.locale)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label={t("products.statusLabel")} className={select}>
          <option value="">{t("common.all")}</option>
          {(["draft", "active", "inactive"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`products.status.${s}`)}
            </option>
          ))}
        </select>
        <select name="published" defaultValue={published ?? ""} aria-label={t("products.published")} className={select}>
          <option value="">{t("common.all")}</option>
          <option value="yes">{t("products.published")}</option>
          <option value="no">{t("products.notPublished")}</option>
        </select>
        <button className="h-10 rounded-lg bg-primary-700 px-4 text-sm text-white">{t("common.search")}</button>
      </form>
      <Card>
        {!data.items.length ? (
          <EmptyState title={t("products.noProducts")} />
        ) : (
          <Table caption={t("admProducts.title")}>
            <thead>
              <tr>
                <Th>{t("products.sku")}</Th>
                <Th>{t("common.name")}</Th>
                <Th>{t("admProducts.supplier")}</Th>
                <Th>{t("products.statusLabel")}</Th>
                <Th>{t("products.available")}</Th>
                <Th>{t("common.updatedAt")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <Tr key={p.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {p.sku}
                  </Td>
                  <Td>{localized(p, ctx.locale)}</Td>
                  <Td className="text-sm">
                    <Link href={`/admin/products?supplier=${p.supplierOrgId}`} className="hover:underline">
                      {ctx.locale === "ar" ? p.supplierAr : p.supplierEn}
                    </Link>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge>{t(`products.status.${p.status as "draft"}`)}</Badge>
                      <Badge tone={p.isPublished ? "primary" : "neutral"}>{p.isPublished ? t("products.published") : t("products.notPublished")}</Badge>
                    </div>
                  </Td>
                  <Td dir="ltr">
                    {Number(p.available)} {p.saleUnit}
                  </Td>
                  <Td className="text-xs">{f.dateTime(p.updatedAt, "short")}</Td>
                  <Td className="text-end">
                    <Link href={`/admin/products/${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t("common.edit")}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
    </>
  );
}
