import { Heart } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { listWishlist } from "@platform/modules/commerce";
import { WishlistButton } from "@/components/store/store-client";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";

export default async function WishlistPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const items = await listWishlist(ctx);
  return (
    <>
      <PageHeader title={t("wishlist.title")} />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<Heart />} title={t("wishlist.empty")} />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map(({ p, price, available, supAr, supEn }) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col gap-2 p-4">
                <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                  {ctx.locale === "ar" ? p.nameAr : p.nameEn}
                </Link>
                <p className="text-xs text-ink-500">{t("store.soldBy", { supplier: ctx.locale === "ar" ? supAr : supEn })}</p>
                <p className="text-sm font-semibold">{available && price ? <bdi dir="ltr">{f.number(Number(price.unitPrice.toFixed(2)), { style: "currency", currency: "SAR" })}</bdi> : t("store.issues.unavailable")}</p>
                <div className="mt-auto">
                  <WishlistButton productId={p.id} active />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
