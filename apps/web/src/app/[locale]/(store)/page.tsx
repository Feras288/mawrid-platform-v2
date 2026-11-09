import { ArrowLeft, BadgeCheck, Building2, Check, ClipboardList, FileCheck2, FileSpreadsheet, ReceiptText, Scale, Search, Send, Truck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { storeHome } from "@platform/modules/store";
import { CategoryArt, CategoryIcon } from "@/components/store/category-art";
import { ProductCard } from "@/components/store/product-card";
import { buttonVariants, SectionHeading } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { cn, localized } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StoreHome() {
  const ctx = await getCtx();
  const t = await getTranslations();
  const home = await storeHome(ctx);
  const businessHref = ctx.userId ? "/org" : "/register";
  const terms = t("ux.hero.popularTerms")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const collage = home.roots.slice(0, 4);
  const steps = [
    { icon: FileSpreadsheet, title: t("ux.b2b.step1"), body: t("ux.b2b.step1Body") },
    { icon: Send, title: t("ux.b2b.step2"), body: t("ux.b2b.step2Body") },
    { icon: Scale, title: t("ux.b2b.step3"), body: t("ux.b2b.step3Body") },
    { icon: FileCheck2, title: t("ux.b2b.step4"), body: t("ux.b2b.step4Body") },
  ];
  return (
    <div className="space-y-14 sm:space-y-16">
      {/* hero */}
      <section className="relative -mt-2 overflow-hidden rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-primary-700 text-white shadow-raised">
        <div className="pattern-lattice absolute inset-0" aria-hidden />
        <div className="relative grid items-center gap-10 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1.15fr_1fr] lg:px-14">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-accent-200 ring-1 ring-inset ring-white/15">
              <span className="size-1.5 rounded-full bg-accent-300" aria-hidden />
              {t("ux.hero.eyebrow")}
            </p>
            <h1 className="mt-5 text-[2rem] leading-[1.2] font-extrabold tracking-tight sm:text-display">{t("store.heroTitle")}</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-primary-100">{t("store.heroBody")}</p>
            <form action={`/${ctx.locale}/products`} method="get" role="search" className="mt-7 max-w-xl">
              <label htmlFor="hero-q" className="sr-only">
                {t("ux.hero.searchLabel")}
              </label>
              <div className="flex h-13 items-stretch overflow-hidden rounded-2xl bg-white p-1.5 shadow-overlay">
                <Search className="ms-3 size-5 shrink-0 self-center text-ink-400" aria-hidden />
                <input id="hero-q" name="q" type="search" placeholder={t("store.searchPlaceholder")} className="min-w-0 flex-1 bg-transparent px-3 text-[0.9375rem] text-ink-900 outline-none placeholder:text-ink-400" />
                <button type="submit" className={cn(buttonVariants({ variant: "accent" }), "h-auto rounded-xl px-5")}>
                  {t("store.search")}
                </button>
              </div>
            </form>
            {terms.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-primary-200">{t("ux.hero.popular")}:</span>
                {terms.map((term) => (
                  <Link key={term} href={`/products?q=${encodeURIComponent(term)}`} className="rounded-full bg-white/10 px-3 py-1 font-medium text-white ring-1 ring-inset ring-white/15 hover:bg-white/20">
                    {term}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/products" className={buttonVariants({ variant: "accent", size: "lg" })}>
                {t("store.allProducts")}
                <ArrowLeft className="ltr:rotate-180" aria-hidden />
              </Link>
              <Link href={businessHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-white/40 bg-white/5 text-white shadow-none hover:border-white/60 hover:bg-white/10")}>
                <Building2 aria-hidden />
                {t("store.forBusiness")}
              </Link>
            </div>
          </div>
          <div className="hidden lg:block" aria-hidden>
            <div className="grid grid-cols-2 gap-4">
              {collage.map((c, i) => (
                <div key={c.id} className={cn("overflow-hidden rounded-2xl bg-white/95 shadow-raised ring-1 ring-white/30", i % 2 === 1 && "translate-y-6")}>
                  <CategoryArt slug={c.slug} className="aspect-[4/3]" />
                  <p className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-ink-900">
                    <CategoryIcon slug={c.slug} className="text-ink-500" />
                    {localized(c, ctx.locale)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <ul className="relative grid gap-px border-t border-white/10 bg-white/10 text-sm sm:grid-cols-3">
          {[t("ux.hero.proof1"), t("ux.hero.proof2"), t("ux.hero.proof3")].map((s) => (
            <li key={s} className="flex items-center gap-2.5 bg-primary-900/60 px-6 py-4 sm:px-10 lg:px-14">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-500/20 text-accent-200">
                <Check className="size-3.5" aria-hidden />
              </span>
              <span className="text-primary-50">{s}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* trust strip */}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: BadgeCheck, label: t("ux.trust.verified") },
          { icon: ReceiptText, label: t("ux.trust.vat") },
          { icon: Truck, label: t("ux.trust.delivery") },
          { icon: ClipboardList, label: t("ux.trust.b2b") },
        ].map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-3 rounded-2xl border border-sand-200/80 bg-white px-4 py-3.5 shadow-xs">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
              <Icon className="size-5 flip-rtl" aria-hidden />
            </span>
            <span className="text-sm leading-5 font-semibold text-ink-800">{label}</span>
          </li>
        ))}
      </ul>

      {/* shop by system */}
      <section aria-labelledby="cats">
        <SectionHeading
          id="cats"
          title={t("ux.shopBySystem")}
          description={t("ux.shopBySystemHint")}
          action={
            <Link href="/products" className="text-sm font-semibold text-primary-700 hover:underline">
              {t("ux.viewAll")}
            </Link>
          }
        />
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {home.roots.map((c) => {
            const subs = home.children.filter((s) => s.parentId === c.id);
            return (
              <li key={c.id} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sand-200/80 bg-white shadow-card transition-shadow hover:shadow-raised md:flex-row">
                <CategoryArt slug={c.slug} className="aspect-[16/10] shrink-0 md:aspect-auto md:w-36 lg:w-44" />
                <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
                  <h3 className="text-[0.9375rem] leading-6 font-bold text-ink-900">
                    <Link href={`/products?category=${c.slug}`} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-primary-600 group-hover:text-primary-800">
                      {localized(c, ctx.locale)}
                    </Link>
                  </h3>
                  <ul className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
                    {subs.slice(0, 4).map((s) => (
                      <li key={s.id} className="relative z-10">
                        <Link href={`/products?category=${s.slug}`} className="inline-block rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-ink-600 hover:bg-primary-50 hover:text-primary-800">
                          {localized(s, ctx.locale)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {home.latest.length ? (
        <section aria-labelledby="latest">
          <SectionHeading
            id="latest"
            title={t("store.latest")}
            description={t("ux.latestHint")}
            action={
              <Link href="/products?sort=newest" className="text-sm font-semibold text-primary-700 hover:underline">
                {t("ux.viewAll")}
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {home.latest.map((p) => (
              <ProductCard key={p.id} p={p} locale={ctx.locale} />
            ))}
          </div>
        </section>
      ) : null}

      {/* procurement band */}
      <section aria-labelledby="b2b" className="relative overflow-hidden rounded-3xl bg-primary-950 text-white">
        <div className="pattern-lattice absolute inset-0" aria-hidden />
        <div className="relative grid gap-10 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[1fr_1.3fr] lg:px-14">
          <div>
            <p className="text-xs font-bold tracking-wide text-accent-300">{t("ux.b2b.eyebrow")}</p>
            <h2 id="b2b" className="mt-3 text-[1.625rem] leading-tight font-extrabold tracking-tight sm:text-[2rem]">
              {t("ux.b2b.title")}
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-primary-100">{t("ux.b2b.body")}</p>
            <Link href={businessHref} className={cn(buttonVariants({ variant: "accent", size: "lg" }), "mt-7")}>
              {t("ux.b2b.cta")}
              <ArrowLeft className="ltr:rotate-180" aria-hidden />
            </Link>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {steps.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10">
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-accent-500/20 text-accent-200">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-2xl font-extrabold text-white/20 tabular-nums" aria-hidden>
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-4 font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-primary-200">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* supplier call to action */}
      <section aria-labelledby="sup-cta" className="flex flex-col items-start justify-between gap-5 rounded-3xl border border-accent-200 bg-gradient-to-br from-accent-50 to-white px-6 py-8 sm:flex-row sm:items-center sm:px-10">
        <div className="max-w-2xl">
          <h2 id="sup-cta" className="text-h2 font-extrabold text-ink-900">
            {t("ux.supplierCta.title")}
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-ink-600">{t("ux.supplierCta.body")}</p>
        </div>
        <Link href="/account/organizations" className={buttonVariants({ variant: "primary", size: "lg" })}>
          {t("ux.supplierCta.cta")}
        </Link>
      </section>
    </div>
  );
}
