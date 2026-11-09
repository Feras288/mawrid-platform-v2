import { BadgeCheck, Truck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { StoreCard } from "@platform/modules/store";
import { CategoryArt } from "@/components/store/category-art";
import { Link } from "@/i18n/navigation";
import { categoryIndex } from "@/lib/categories";
import { cn, localized } from "@/lib/utils";

/**
 * Store product card. The whole card is one link (stretched over the title link) so it is a single tab stop.
 * Prices are the viewer's resolved price (ex-VAT) with the VAT-inclusive amount as secondary information.
 */
export async function ProductCard({ p, locale }: { p: StoreCard; locale: string }) {
  const t = await getTranslations();
  const f = await getFormatter();
  const cats = await categoryIndex();
  const name = locale === "ar" ? p.nameAr : p.nameEn;
  const supplier = locale === "ar" ? p.supplierNameAr : p.supplierNameEn;
  const available = Number(p.available);
  const inStock = available > 0;
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const special = p.price && p.price.kind !== "retail";
  const leafRow = cats.byId.get(p.categoryId);
  const leaf = leafRow ? localized(leafRow, locale) : null;
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-sand-200/80 bg-white shadow-card transition-[box-shadow,border-color] duration-200 hover:border-sand-300 hover:shadow-raised">
      <div className="relative aspect-[4/3] overflow-hidden bg-sand-100">
        {p.imageFileId ? (
          <img src={`/api/v1/public-files/${p.imageFileId}`} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <CategoryArt slug={cats.rootSlug(p.categoryId)} inset className="size-full transition-transform duration-300 group-hover:scale-[1.03]">
            {leaf ? (
              <span className="absolute start-2 bottom-2 max-w-[85%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-700 shadow-xs">{leaf}</span>
            ) : null}
          </CategoryArt>
        )}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap gap-1">
          {special ? <span className="rounded-full bg-accent-500 px-2 py-0.5 text-[11px] font-bold text-white shadow-xs">{t(`store.priceKind.${p.price!.kind}`)}</span> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        {p.brandName ? <p className="truncate text-[11px] font-bold tracking-wide text-ink-500 uppercase">{p.brandName}</p> : null}
        <h3 className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold text-ink-900">
          <Link href={`/products/${p.id}`} className="outline-none after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-primary-600 group-hover:text-primary-800">
            {name}
          </Link>
        </h3>
        <p className="flex min-w-0 items-center gap-1 text-xs text-ink-500">
          <span className="truncate">{t("store.soldBy", { supplier })}</span>
          <BadgeCheck className="size-3.5 shrink-0 text-primary-600" aria-hidden />
          <span className="sr-only">{t("ux.card.verified")}</span>
        </p>
        <div className="mt-auto pt-3">
          {p.price ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <bdi dir="ltr" className="text-lg leading-tight font-extrabold tracking-tight text-ink-900">
                  {money(p.price.unitPrice.toFixed(2))}
                </bdi>
                <span className="text-xs text-ink-500">
                  {t("ux.card.perUnit", { unit: p.saleUnit })} · {t("store.exVat")}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                <bdi dir="ltr">{money(p.price.unitPrice.times(p.price.vatRate.plus(1)).toFixed(2))}</bdi> {t("store.incVat")}
              </p>
            </>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-sand-100 pt-2.5 text-xs">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", inStock ? "text-success-600" : "text-danger-600")}>
              <span className={cn("size-1.5 rounded-full", inStock ? "bg-success-600" : "bg-danger-600")} aria-hidden />
              {inStock ? t("store.available", { qty: available }) : t("store.outOfStock")}
            </span>
            {p.leadTimeDays ? (
              <span className="inline-flex items-center gap-1 text-ink-500">
                <Truck className="size-3.5 flip-rtl" aria-hidden />
                {t("store.leadTime", { days: p.leadTimeDays })}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
