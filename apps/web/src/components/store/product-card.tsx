import { Package } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { StoreCard } from "@platform/modules/store";
import { Link } from "@/i18n/navigation";

export async function ProductCard({ p, locale }: { p: StoreCard; locale: string }) {
  const t = await getTranslations("store");
  const f = await getFormatter();
  const name = locale === "ar" ? p.nameAr : p.nameEn;
  const supplier = locale === "ar" ? p.supplierNameAr : p.supplierNameEn;
  const inStock = Number(p.available) > 0;
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-sand-200 bg-white transition hover:shadow-md">
      <div className="grid aspect-[4/3] place-items-center bg-sand-100 text-ink-300">
        {p.imageFileId ? <img src={`/api/v1/public-files/${p.imageFileId}`} alt="" className="size-full object-cover" loading="lazy" /> : <Package className="size-12" aria-hidden />}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold">
          <Link href={`/products/${p.id}`} className="hover:underline">
            {name}
          </Link>
        </h3>
        <p className="text-xs text-ink-500">{t("soldBy", { supplier })}</p>
        {p.brandName ? <p className="text-xs text-ink-400">{p.brandName}</p> : null}
        <div className="mt-auto pt-2">
          {p.price ? (
            <p className="text-base font-bold text-primary-800">
              <bdi dir="ltr">{f.number(Number(p.price.unitPrice.toFixed(2)), { style: "currency", currency: "SAR" })}</bdi>
              <span className="ms-1 text-xs font-normal text-ink-500">
                / {p.saleUnit} · {t("exVat")}
              </span>
            </p>
          ) : null}
          <p className={inStock ? "text-xs text-success-600" : "text-xs text-danger-600"}>{inStock ? t("available", { qty: Number(p.available) }) : t("outOfStock")}</p>
        </div>
      </div>
    </article>
  );
}
