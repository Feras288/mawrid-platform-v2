import { Search, ShoppingCart, User } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cartCount } from "@platform/modules/commerce";
import type { Ctx } from "@platform/modules/context";
import { Brand } from "@/components/shell/portal-shell";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { Link } from "@/i18n/navigation";

/** Public storefront chrome: brand, search, cart, account. */
export async function StoreShell({ ctx, children, q }: { ctx: Ctx; children: React.ReactNode; q?: string }) {
  const t = await getTranslations();
  const count = await cartCount(ctx).catch(() => 0);
  return (
    <div className="flex min-h-dvh flex-col bg-sand-50">
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Brand />
          <form action={`/${ctx.locale}/products`} method="get" role="search" className="order-last flex w-full items-center gap-2 sm:order-none sm:ms-6 sm:w-auto sm:flex-1">
            <label htmlFor="store-q" className="sr-only">
              {t("store.search")}
            </label>
            <input id="store-q" name="q" type="search" defaultValue={q ?? ""} placeholder={t("store.searchPlaceholder")} className="h-10 w-full rounded-lg border border-sand-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary-600" />
            <button type="submit" className="inline-flex h-10 items-center gap-1 rounded-lg bg-primary-700 px-3 text-sm font-medium text-white hover:bg-primary-800">
              <Search className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("store.search")}</span>
            </button>
          </form>
          <nav aria-label={t("nav.store")} className="ms-auto flex items-center gap-1">
            <LocaleSwitcher />
            <Link href="/cart" className="relative inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-ink-700 hover:bg-sand-100" aria-label={`${t("store.cart")}${count ? ` (${count})` : ""}`}>
              <ShoppingCart className="size-5" aria-hidden />
              {count > 0 ? <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-accent-600 px-1 text-center text-[10px] font-bold text-white">{count}</span> : null}
            </Link>
            {ctx.userId ? (
              <Link href="/account" className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-ink-700 hover:bg-sand-100">
                <User className="size-5" aria-hidden />
                <span className="hidden sm:inline">{t("nav.account")}</span>
              </Link>
            ) : (
              <Link href="/login" className="rounded-lg bg-primary-700 px-3 py-2 text-sm font-medium text-white hover:bg-primary-800">
                {t("nav.login")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-sand-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-4 px-4 py-6 text-xs text-ink-500">
          <span>{t("store.sellerOfRecord")}</span>
          <span>{t("store.legalDraft")}</span>
        </div>
      </footer>
    </div>
  );
}
