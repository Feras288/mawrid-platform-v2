import { ChevronDown, SearchX, SlidersHorizontal, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCategoryBySlug, listCategories } from "@platform/modules/catalog";
import { searchProducts, SORTS, type StoreSort } from "@platform/modules/store";
import { CategoryIcon } from "@/components/store/category-art";
import { AutoSubmitSelect } from "@/components/store/listing-client";
import { ProductCard } from "@/components/store/product-card";
import { Pagination } from "@/components/ui/pagination";
import { buttonVariants, Card, EmptyState } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { cn, localized } from "@/lib/utils";

type SP = { q?: string; category?: string; brand?: string; min?: string; max?: string; stock?: string; sort?: string; page?: string };
type Cat = Awaited<ReturnType<typeof listCategories>>[number];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getCtx();
  const t = await getTranslations();
  const sp = await searchParams;
  const sort = SORTS.includes(sp.sort as StoreSort) ? (sp.sort as StoreSort) : undefined;
  const [data, cats, current] = await Promise.all([
    searchProducts(ctx, { q: sp.q, categorySlug: sp.category || undefined, brand: sp.brand || undefined, minPrice: sp.min || undefined, maxPrice: sp.max || undefined, inStock: sp.stock === "1", sort, page: Number(sp.page) || 1 }),
    listCategories(),
    sp.category ? getCategoryBySlug(sp.category) : Promise.resolve(null),
  ]);
  const roots = cats.filter((c) => c.depth === 0);
  const rootOf = (c: Cat | null): Cat | null => {
    let cur = c;
    for (let i = 0; cur && cur.parentId && i < 6; i++) cur = cats.find((x) => x.id === cur!.parentId) ?? null;
    return cur;
  };
  const currentRoot = current ? rootOf(current as Cat) : null;
  const title = current ? localized(current, ctx.locale) : sp.q ? t("ux.list.searchFor", { q: sp.q }) : t("store.allProducts");

  // query-string builder that drops one or more params (and always resets paging)
  const href = (drop: (keyof SP)[], extra: Partial<SP> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra }) as [keyof SP, string | undefined][]) if (v && k !== "page" && !drop.includes(k)) q.set(k, v);
    const s = q.toString();
    return `/products${s ? `?${s}` : ""}`;
  };
  const chips: { key: keyof SP; label: string }[] = [];
  if (sp.q) chips.push({ key: "q", label: `“${sp.q}”` });
  if (current) chips.push({ key: "category", label: localized(current, ctx.locale) });
  if (sp.brand) chips.push({ key: "brand", label: sp.brand });
  if (sp.min) chips.push({ key: "min", label: `${t("store.priceMin")}: ${sp.min}` });
  if (sp.max) chips.push({ key: "max", label: `${t("store.priceMax")}: ${sp.max}` });
  if (sp.stock === "1") chips.push({ key: "stock", label: t("store.inStock") });
  const filterCount = chips.filter((c) => c.key !== "q").length;

  const categoryNav = (
    <nav aria-label={t("store.categories")}>
      <h2 className="mb-2 px-2 text-xs font-bold tracking-wide text-ink-500">{t("store.categories")}</h2>
      <ul className="space-y-0.5 text-sm">
        <li>
          <Link href={href(["category"])} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", !sp.category ? "bg-primary-50 font-semibold text-primary-800" : "text-ink-700 hover:bg-sand-100")}>
            {t("store.allProducts")}
          </Link>
        </li>
        {roots.map((c) => {
          const open = currentRoot?.id === c.id;
          return (
            <li key={c.id}>
              <Link
                href={href(["category"], { category: c.slug })}
                aria-current={sp.category === c.slug ? "page" : undefined}
                className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", sp.category === c.slug ? "bg-primary-50 font-semibold text-primary-800" : open ? "font-semibold text-ink-900 hover:bg-sand-100" : "text-ink-700 hover:bg-sand-100")}
              >
                <CategoryIcon slug={c.slug} className="text-ink-400" />
                <span className="min-w-0 flex-1">{localized(c, ctx.locale)}</span>
              </Link>
              {open ? (
                <ul className="ms-4 mt-0.5 mb-1 space-y-0.5 border-s border-sand-200 ps-2 text-[0.8125rem]">
                  {cats
                    .filter((s) => s.parentId === c.id)
                    .map((s) => (
                      <li key={s.id}>
                        <Link
                          href={href(["category"], { category: s.slug })}
                          aria-current={sp.category === s.slug ? "page" : undefined}
                          className={cn("block rounded-md px-2 py-1", sp.category === s.slug ? "font-semibold text-primary-800" : "text-ink-600 hover:bg-sand-100 hover:text-ink-900")}
                        >
                          {localized(s, ctx.locale)}
                        </Link>
                      </li>
                    ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const filterForm = (
    <form method="get" className="space-y-4 text-sm" aria-label={t("store.filters")}>
      {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
      {sp.category ? <input type="hidden" name="category" value={sp.category} /> : null}
      {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold text-ink-600">{t("store.brand")}</span>
        <select name="brand" defaultValue={sp.brand ?? ""} className="h-10 w-full rounded-lg border border-sand-300 bg-white px-2 shadow-xs">
          <option value="">{t("store.anyBrand")}</option>
          {data.brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1.5 text-xs font-bold text-ink-600">{t("ux.list.price")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">{t("store.priceMin")}</span>
            <input name="min" defaultValue={sp.min ?? ""} placeholder={t("store.priceMin")} inputMode="decimal" dir="ltr" className="h-10 w-full rounded-lg border border-sand-300 bg-white px-2 shadow-xs placeholder:text-ink-400 rtl:text-right" />
          </label>
          <label>
            <span className="sr-only">{t("store.priceMax")}</span>
            <input name="max" defaultValue={sp.max ?? ""} placeholder={t("store.priceMax")} inputMode="decimal" dir="ltr" className="h-10 w-full rounded-lg border border-sand-300 bg-white px-2 shadow-xs placeholder:text-ink-400 rtl:text-right" />
          </label>
        </div>
      </fieldset>
      <label className="flex items-center gap-2 rounded-lg border border-sand-200 bg-sand-50 px-3 py-2.5">
        <input type="checkbox" name="stock" value="1" defaultChecked={sp.stock === "1"} className="size-4 accent-primary-700" />
        <span className="font-medium text-ink-800">{t("store.inStock")}</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" className={cn(buttonVariants({ variant: "primary" }), "flex-1")}>
          {t("store.apply")}
        </button>
        <Link href="/products" className={buttonVariants({ variant: "outline" })}>
          {t("store.clear")}
        </Link>
      </div>
    </form>
  );

  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr] lg:gap-8">
      {/* desktop sidebar */}
      <aside className="hidden space-y-4 lg:block">
        <Card className="p-3">{categoryNav}</Card>
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900">
            <SlidersHorizontal className="size-4 text-ink-500" aria-hidden />
            {t("store.filters")}
          </h2>
          {filterForm}
        </Card>
      </aside>

      <section aria-labelledby="results-title" className="min-w-0">
        <nav aria-label="breadcrumb" className="mb-2 text-xs font-medium text-ink-500">
          <Link href="/" className="hover:underline">
            {t("nav.home")}
          </Link>
          <span aria-hidden> / </span>
          {current ? (
            <>
              <Link href="/products" className="hover:underline">
                {t("store.allProducts")}
              </Link>
              {currentRoot && currentRoot.id !== current.id ? (
                <>
                  <span aria-hidden> / </span>
                  <Link href={`/products?category=${currentRoot.slug}`} className="hover:underline">
                    {localized(currentRoot, ctx.locale)}
                  </Link>
                </>
              ) : null}
            </>
          ) : (
            <span>{t("store.allProducts")}</span>
          )}
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-sand-200 pb-4">
          <div className="min-w-0">
            <h1 id="results-title" className="text-h1 font-extrabold tracking-tight text-ink-900">
              {title}
            </h1>
            <p className="mt-1 text-sm text-ink-500" role="status">
              {t("store.results", { count: data.total })}
              {data.total > 0 ? <span className="ms-1">· {t("ux.list.showing", { from, to })}</span> : null}
            </p>
          </div>
          <form method="get" className="flex items-center gap-2">
            {Object.entries(sp).map(([k, v]) => (v && k !== "sort" && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <label htmlFor="sort" className="text-xs font-bold whitespace-nowrap text-ink-600">
              {t("store.sort")}
            </label>
            <AutoSubmitSelect id="sort" name="sort" defaultValue={sort ?? ""} className="h-10 rounded-lg border border-sand-300 bg-white ps-3 pe-8 text-sm font-medium shadow-xs">
              <option value="">{t(`store.sorts.${sp.q ? "relevance" : "newest"}`)}</option>
              {SORTS.filter((s) => s !== (sp.q ? "relevance" : "newest")).map((s) => (
                <option key={s} value={s}>
                  {t(`store.sorts.${s}`)}
                </option>
              ))}
            </AutoSubmitSelect>
            <button type="submit" className="sr-only focus:not-sr-only focus:rounded-md focus:bg-primary-700 focus:px-2 focus:py-1 focus:text-white">
              {t("store.apply")}
            </button>
          </form>
        </div>

        {/* mobile filters: collapsed below the toolbar so products stay above the fold */}
        <details className="group mt-3 rounded-xl border border-sand-200 bg-white shadow-xs lg:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink-800 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4 text-ink-500" aria-hidden />
            {t("store.filters")}
            {filterCount ? <span className="rounded-full bg-primary-700 px-2 text-xs text-white">{filterCount}</span> : null}
            <ChevronDown className="ms-auto size-4 text-ink-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="grid gap-5 border-t border-sand-100 p-4 sm:grid-cols-2">
            {categoryNav}
            {filterForm}
          </div>
        </details>

        {chips.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="sr-only">{t("ux.list.activeFilters")}</span>
            {chips.map((c) => (
              <Link
                key={c.key}
                href={href([c.key])}
                aria-label={t("ux.list.removeFilter", { label: c.label })}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 py-1 ps-3 pe-2 text-xs font-semibold text-primary-800 hover:bg-primary-100"
              >
                <span className="truncate">{c.label}</span>
                <X className="size-3.5 shrink-0" aria-hidden />
              </Link>
            ))}
            {chips.length > 1 ? (
              <Link href="/products" className="text-xs font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
                {t("store.clear")}
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5">
          {data.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX />}
                title={t("store.noResults")}
                description={t("ux.list.tryAgain")}
                action={
                  <Link href="/products" className={buttonVariants({ variant: "outline" })}>
                    {t("store.allProducts")}
                  </Link>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-4">
              {data.items.map((p) => (
                <ProductCard key={p.id} p={p} locale={ctx.locale} />
              ))}
            </div>
          )}
        </div>
        <div className="mt-6 overflow-hidden rounded-xl border border-sand-200 bg-white empty:hidden">
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
        </div>
      </section>
    </div>
  );
}
