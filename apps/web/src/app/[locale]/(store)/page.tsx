import { getTranslations } from "next-intl/server";
import { storeHome } from "@platform/modules/store";
import { ProductCard } from "@/components/store/product-card";
import { buttonVariants } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { cn, localized } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StoreHome() {
  const ctx = await getCtx();
  const t = await getTranslations();
  const home = await storeHome(ctx);
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-gradient-to-br from-primary-800 to-primary-600 px-6 py-10 text-white sm:px-10">
        <h1 className="max-w-2xl text-2xl font-bold sm:text-3xl">{t("store.heroTitle")}</h1>
        <p className="mt-3 max-w-2xl text-primary-50">{t("store.heroBody")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/products" className={buttonVariants({ variant: "accent" })}>
            {t("store.allProducts")}
          </Link>
          <Link href={ctx.userId ? "/org" : "/register"} className={cn(buttonVariants({ variant: "outline" }), "border-white/60 bg-transparent text-white hover:bg-white/10 hover:text-white")}>
            {t("store.forBusiness")}
          </Link>
        </div>
      </section>
      <section aria-labelledby="cats">
        <h2 id="cats" className="mb-4 text-lg font-bold">
          {t("store.categories")}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {home.roots.map((c) => (
            <li key={c.id} className="rounded-xl border border-sand-200 bg-white p-4">
              <Link href={`/products?category=${c.slug}`} className="font-semibold text-primary-800 hover:underline">
                {localized(c, ctx.locale)}
              </Link>
              <ul className="mt-2 space-y-1 text-xs text-ink-500">
                {home.children
                  .filter((s) => s.parentId === c.id)
                  .slice(0, 4)
                  .map((s) => (
                    <li key={s.id}>
                      <Link href={`/products?category=${s.slug}`} className="hover:underline">
                        {localized(s, ctx.locale)}
                      </Link>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      {home.latest.length ? (
        <section aria-labelledby="latest">
          <h2 id="latest" className="mb-4 text-lg font-bold">
            {t("store.latest")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {home.latest.map((p) => (
              <ProductCard key={p.id} p={p} locale={ctx.locale} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
