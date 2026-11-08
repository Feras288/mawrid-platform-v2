import { Package, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listMyProducts } from "@platform/modules/supplier-products";
import { Pagination } from "@/components/ui/pagination";
import { Badge, buttonVariants, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const sp = await searchParams;
  const data = await listMyProducts(ctx, { q: sp.q, status: sp.status || undefined, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader
        title={t("products.title")}
        actions={
          can(ctx, "products.manage") ? (
            <>
              <Link href="/supplier/pricing" className={buttonVariants({ variant: "outline" })}>
                {t("products.priceLists")}
              </Link>
              <Link href="/supplier/products/new" className={buttonVariants()}>
                <Plus />
                {t("products.new")}
              </Link>
            </>
          ) : null
        }
      />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-sand-200 p-4" role="search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("products.searchPlaceholder")} aria-label={t("common.search")} className="max-w-xs" />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label={t("common.status")} className="max-w-48">
            <option value="">{t("common.all")}</option>
            {(["draft", "active", "inactive"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`products.status.${s}`)}
              </option>
            ))}
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>{t("common.filter")}</button>
        </form>
        {data.items.length === 0 ? (
          <EmptyState icon={<Package />} title={t("products.noProducts")} />
        ) : (
          <Table caption={t("products.title")}>
            <thead>
              <tr>
                <Th>{t("products.sku")}</Th>
                <Th>{t("common.name")}</Th>
                <Th>{t("products.statusLabel")}</Th>
                <Th>{t("products.available")}</Th>
                <Th>{t("products.canonical")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <Tr key={p.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    <Link href={`/supplier/products/${p.id}`} className="text-primary-700 hover:underline">
                      {p.sku}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/supplier/products/${p.id}`} className="font-medium text-ink-900 hover:underline">
                      {localized(p, ctx.locale)}
                    </Link>
                    {p.brandName ? <span className="block text-xs text-ink-500">{p.brandName}</span> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={p.status === "active" ? "success" : "neutral"}>{t(`products.status.${p.status as "draft"}`)}</Badge>
                      {p.isPublished ? <Badge tone="primary">{t("products.published")}</Badge> : null}
                    </div>
                  </Td>
                  <Td dir="ltr">
                    {Number(p.available)} {p.saleUnit}
                  </Td>
                  <Td>
                    <Badge tone={p.matchStatus === "confirmed" ? "success" : "neutral"}>{t(`products.match.${p.matchStatus as "unmatched"}`)}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
