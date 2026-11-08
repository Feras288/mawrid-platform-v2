import { getTranslations } from "next-intl/server";
import { getCategoryBySlug, listCategories } from "@platform/modules/catalog";
import { searchProducts, SORTS, type StoreSort } from "@platform/modules/store";
import { ProductCard } from "@/components/store/product-card";
import { Pagination } from "@/components/ui/pagination";
import { Card, EmptyState } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

type SP = { q?: string; category?: string; brand?: string; min?: string; max?: string; stock?: string; sort?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getCtx();
  const t = await getTranslations();
  const sp = await searchParams;
  const sort = SORTS.includes(sp.sort as StoreSort) ? (sp.sort as StoreSort) : undefined;
  const [data, cats, current] = await Promise.all([
    searchProducts(ctx, { q: sp.q, categorySlug: sp.category, brand: sp.brand, minPrice: sp.min, maxPrice: sp.max, inStock: sp.stock === "1", sort, page: Number(sp.page) || 1 }),
    listCategories(),
    sp.category ? getCategoryBySlug(sp.category) : Promise.resolve(null),
  ]);
  const roots = cats.filter((c) => c.depth === 0);
  const title = current ? localized(current, ctx.locale) : sp.q ? `“${sp.q}”` : t("store.allProducts");
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">{t("store.categories")}</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <Link href={`/products${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`} className={!sp.category ? "font-semibold text-primary-700" : "hover:underline"}>
                {t("store.allProducts")}
              </Link>
            </li>
            {roots.map((c) => (
              <li key={c.id}>
                <Link href={`/products?category=${c.slug}`} className={sp.category === c.slug ? "font-semibold text-primary-700" : "hover:underline"}>
                  {localized(c, ctx.locale)}
                </Link>
                {current && (current.id === c.id || current.parentId === c.id) ? (
                  <ul className="ms-3 mt-1 space-y-1 text-xs">
                    {cats
                      .filter((s) => s.parentId === c.id)
                      .map((s) => (
                        <li key={s.id}>
                          <Link href={`/products?category=${s.slug}`} className={sp.category === s.slug ? "font-semibold text-primary-700" : "hover:underline"}>
                            {localized(s, ctx.locale)}
                          </Link>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <form method="get" className="space-y-3 text-sm" aria-label={t("store.filters")}>
            <h2 className="font-semibold">{t("store.filters")}</h2>
            {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
            {sp.category ? <input type="hidden" name="category" value={sp.category} /> : null}
            <label className="block">
              <span className="mb-1 block text-xs text-ink-600">{t("store.brand")}</span>
              <select name="brand" defaultValue={sp.brand ?? ""} className="h-9 w-full rounded-lg border border-sand-300 bg-white px-2">
                <option value="">{t("store.anyBrand")}</option>
                {data.brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-xs text-ink-600">{t("store.priceMin")}</span>
                <input name="min" defaultValue={sp.min ?? ""} inputMode="decimal" dir="ltr" className="h-9 w-full rounded-lg border border-sand-300 px-2" />
              </label>
              <label>
                <span className="mb-1 block text-xs text-ink-600">{t("store.priceMax")}</span>
                <input name="max" defaultValue={sp.max ?? ""} inputMode="decimal" dir="ltr" className="h-9 w-full rounded-lg border border-sand-300 px-2" />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} className="size-4 accent-primary-700" />
              {t("store.inStock")}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-600">{t("store.sort")}</span>
              <select name="sort" defaultValue={sort ?? ""} className="h-9 w-full rounded-lg border border-sand-300 bg-white px-2">
                <option value="">—</option>
                {SORTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`store.sorts.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="h-9 flex-1 rounded-lg bg-primary-700 text-white hover:bg-primary-800">
                {t("store.apply")}
              </button>
              <Link href="/products" className="grid h-9 place-items-center rounded-lg border border-sand-300 px-3">
                {t("store.clear")}
              </Link>
            </div>
          </form>
        </Card>
      </aside>
      <section aria-labelledby="results-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="results-title" className="text-xl font-bold">
            {title}
          </h1>
          <p className="text-sm text-ink-500" role="status">
            {t("store.results", { count: data.total })}
          </p>
        </div>
        {data.items.length === 0 ? (
          <Card>
            <EmptyState title={t("store.noResults")} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {data.items.map((p) => (
              <ProductCard key={p.id} p={p} locale={ctx.locale} />
            ))}
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      </section>
    </div>
  );
}
