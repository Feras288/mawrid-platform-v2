import { BadgeCheck, Building2, ReceiptText, Search, ShoppingCart, Truck, User } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cartCount } from "@platform/modules/commerce";
import type { Ctx } from "@platform/modules/context";
import { Brand } from "@/components/shell/portal-shell";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { CategoryIcon } from "@/components/store/category-art";
import { Link } from "@/i18n/navigation";
import { categoryIndex } from "@/lib/categories";
import { localized } from "@/lib/utils";

/** Public storefront chrome: trust bar, brand, scoped search, departments, account/cart, footer. */
export async function StoreShell({ ctx, children, q }: { ctx: Ctx; children: React.ReactNode; q?: string }) {
  const t = await getTranslations();
  const [count, cats] = await Promise.all([cartCount(ctx).catch(() => 0), categoryIndex()]);
  const businessHref = ctx.userId ? "/org" : "/register";
  return (
    <div className="flex min-h-dvh flex-col bg-sand-50">
      {/* trust / utility bar */}
      <div className="hidden bg-primary-900 text-primary-50 lg:block">
        <div className="container-shell flex h-9 items-center gap-6 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <BadgeCheck className="size-3.5 text-accent-300" aria-hidden />
            {t("ux.trust.verified")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ReceiptText className="size-3.5 text-accent-300" aria-hidden />
            {t("ux.trust.vat")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Truck className="size-3.5 text-accent-300 flip-rtl" aria-hidden />
            {t("ux.trust.delivery")}
          </span>
          <Link href={businessHref} className="ms-auto inline-flex items-center gap-1.5 font-semibold text-white hover:text-accent-200">
            <Building2 className="size-3.5" aria-hidden />
            {t("store.forBusiness")}
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/95 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="container-shell flex flex-wrap items-center gap-x-3 gap-y-3 py-3 md:flex-nowrap md:gap-x-6">
          <Brand />
          <form action={`/${ctx.locale}/products`} method="get" role="search" className="order-last w-full md:order-none md:w-auto md:max-w-3xl md:min-w-0 md:flex-1">
            <div className="flex h-11 w-full items-stretch overflow-hidden rounded-xl border border-sand-300 bg-white shadow-xs transition-[border-color,box-shadow] focus-within:border-primary-600 focus-within:ring-4 focus-within:ring-primary-600/15">
              <label htmlFor="store-cat" className="sr-only">
                {t("ux.searchIn")}
              </label>
              <select
                id="store-cat"
                name="category"
                defaultValue=""
                className="hidden max-w-44 shrink-0 cursor-pointer border-e border-sand-200 bg-sand-50 px-3 text-[0.8125rem] font-medium text-ink-700 outline-none focus-visible:bg-sand-100 sm:block md:hidden lg:block"
              >
                <option value="">{t("ux.allCategories")}</option>
                {cats.roots.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {localized(c, ctx.locale)}
                  </option>
                ))}
              </select>
              <label htmlFor="store-q" className="sr-only">
                {t("store.search")}
              </label>
              <input
                id="store-q"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder={t("store.searchPlaceholder")}
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
              <button type="submit" className="m-1 inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 text-sm font-semibold text-white hover:bg-primary-800 sm:px-4">
                <Search className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{t("store.search")}</span>
              </button>
            </div>
          </form>
          <nav aria-label={t("nav.store")} className="ms-auto flex items-center gap-0.5 sm:gap-1">
            <LocaleSwitcher />
            {ctx.userId ? (
              <Link href="/account" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink-700 hover:bg-sand-100 sm:px-3">
                <User className="size-5" aria-hidden />
                <span className="hidden lg:inline">{t("nav.account")}</span>
              </Link>
            ) : (
              <Link href="/login" className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary-800 hover:bg-primary-50 sm:px-3">
                <User className="size-5" aria-hidden />
                <span>{t("nav.login")}</span>
              </Link>
            )}
            <Link
              href="/cart"
              className="relative inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-ink-700 hover:bg-sand-100 sm:px-3"
              aria-label={`${t("store.cart")}${count ? ` (${count})` : ""}`}
            >
              <span className="relative">
                <ShoppingCart className="size-5 flip-rtl" aria-hidden />
                {count > 0 ? (
                  <span className="absolute -top-2 -end-2 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </span>
              <span className="hidden lg:inline" aria-hidden>
                {t("store.cart")}
              </span>
            </Link>
          </nav>
        </div>
        {/* departments */}
        <nav aria-label={t("ux.departments")} className="border-t border-sand-100">
          <div className="container-shell">
            <ul className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto py-1.5">
              <li className="shrink-0">
                <Link href="/products" className="inline-flex h-8 items-center rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap text-primary-800 hover:bg-primary-50">
                  {t("store.allProducts")}
                </Link>
              </li>
              {cats.roots.map((c) => (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={`/products?category=${c.slug}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-ink-700 hover:bg-sand-100 hover:text-ink-900"
                  >
                    <CategoryIcon slug={c.slug} className="size-3.5 text-ink-400" />
                    {localized(c, ctx.locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </header>

      <main id="main" className="container-shell flex-1 py-6 sm:py-8">
        {children}
      </main>

      <footer className="mt-12 border-t border-primary-900 bg-primary-950 text-primary-100">
        <div className="pattern-lattice">
          <div className="container-shell grid grid-cols-2 gap-x-6 gap-y-10 py-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="col-span-2 max-w-sm space-y-4 lg:col-span-1">
              <Brand tone="inverse" />
              <p className="text-sm leading-6 text-primary-100/90">{t("ux.footer.about")}</p>
              <p className="text-xs leading-5 text-primary-200">{t("store.sellerOfRecord")}</p>
            </div>
            <FooterCol title={t("ux.footer.shop")}>
              <FooterLink href="/products">{t("store.allProducts")}</FooterLink>
              {cats.roots.slice(0, 5).map((c) => (
                <FooterLink key={c.id} href={`/products?category=${c.slug}`}>
                  {localized(c, ctx.locale)}
                </FooterLink>
              ))}
            </FooterCol>
            <FooterCol title={t("ux.footer.business")}>
              <FooterLink href={businessHref}>{t("store.forBusiness")}</FooterLink>
              <FooterLink href="/org/price-index">{t("nav.priceIndex")}</FooterLink>
              <FooterLink href="/account/organizations">{t("ux.supplierCta.cta")}</FooterLink>
            </FooterCol>
            <FooterCol title={t("ux.footer.policies")}>
              {(["terms", "privacy", "returns", "seller-terms"] as const).map((s) => (
                <FooterLink key={s} href={`/legal/${s}`}>
                  {t(`legal.${s}`)}
                </FooterLink>
              ))}
            </FooterCol>
          </div>
          <div className="border-t border-white/10">
            <div className="container-shell flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-primary-200">
              <span>{t("ux.footer.rights", { year: new Date().getFullYear() })}</span>
              <span>{t("store.legalDraft")}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-bold text-white">{title}</h2>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-primary-100/90 hover:text-white hover:underline">
        {children}
      </Link>
    </li>
  );
}
