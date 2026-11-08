import { Package } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { wishlistIds } from "@platform/modules/commerce";
import { getStoreProduct } from "@platform/modules/store";
import { AddToCart, WishlistButton } from "@/components/store/store-client";
import { ProductCard } from "@/components/store/product-card";
import { Alert, Card, CardBody, CardHeader, Dl } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getStoreProduct(ctx, id);
  if (!data) notFound();
  const { product: p, card, supplier, category, unit, attributes, tiers, offers } = data;
  const wish = await wishlistIds(ctx);
  const name = ctx.locale === "ar" ? p.nameAr : p.nameEn;
  const desc = ctx.locale === "ar" ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
  const available = Number(card.available);
  const money = (v: number) => f.number(v, { style: "currency", currency: "SAR" });
  const supplierBlocked = Boolean(ctx.orgId && ctx.orgType !== "buyer");
  return (
    <div className="space-y-8">
      <nav aria-label="breadcrumb" className="text-xs text-ink-500">
        <Link href="/products" className="hover:underline">
          {t("store.allProducts")}
        </Link>
        {category ? (
          <>
            {" / "}
            <Link href={`/products?category=${category.slug}`} className="hover:underline">
              {localized(category, ctx.locale)}
            </Link>
          </>
        ) : null}
      </nav>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid aspect-square place-items-center rounded-2xl border border-sand-200 bg-white text-ink-300">
          {p.imageFileIds[0] ? <img src={`/api/v1/public-files/${p.imageFileIds[0]}`} alt={name} className="size-full rounded-2xl object-cover" /> : <Package className="size-24" aria-hidden />}
        </div>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-sm text-ink-600">
            {t("store.soldBy", { supplier: localized(supplier, ctx.locale) })} · <span dir="ltr">SKU {p.sku}</span>
            {p.brandName ? ` · ${p.brandName}` : ""}
          </p>
          {card.price ? (
            <div>
              <p className="text-3xl font-bold text-primary-800">
                <bdi dir="ltr">{money(Number(card.price.unitPrice.toFixed(2)))}</bdi>
                <span className="ms-2 text-sm font-normal text-ink-500">
                  / {unit ? localized(unit, ctx.locale) : p.saleUnit} · {t("store.exVat")}
                </span>
              </p>
              <p className="text-sm text-ink-500">
                <bdi dir="ltr">{money(Number(card.price.unitPrice.times(card.price.vatRate.plus(1)).toFixed(2)))}</bdi> {t("store.incVat")} · {t(`store.priceKind.${card.price.kind}`)}
              </p>
            </div>
          ) : null}
          <p className={available > 0 ? "text-sm font-medium text-success-600" : "text-sm font-medium text-danger-600"}>{available > 0 ? t("store.available", { qty: available }) : t("store.outOfStock")}</p>
          <ul className="space-y-1 text-sm text-ink-600">
            {Number(p.moq) > 1 ? <li>{t("store.moq", { moq: Number(p.moq) })}</li> : null}
            {Number(p.orderIncrement) > 1 ? <li>{t("store.increment", { step: Number(p.orderIncrement) })}</li> : null}
            {p.leadTimeDays ? <li>{t("store.leadTime", { days: p.leadTimeDays })}</li> : null}
          </ul>
          {supplierBlocked ? <Alert tone="info">{t("store.supplierCannotBuy")}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <AddToCart productId={p.id} moq={p.moq} step={p.orderIncrement} disabled={available <= 0 || !card.price || supplierBlocked} signedIn={Boolean(ctx.userId)} />
            {ctx.userId ? <WishlistButton productId={p.id} active={wish.has(p.id)} /> : null}
          </div>
          {desc ? <p className="whitespace-pre-line text-sm leading-7 text-ink-700">{desc}</p> : null}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("store.specs")} />
          <CardBody>
            <Dl items={attributes.map((a) => ({ label: localized(a, ctx.locale), value: `${String(a.value)}${a.unit ? ` ${a.unit}` : ""}` }))} />
          </CardBody>
        </Card>
        {tiers.length > 1 ? (
          <Card>
            <CardHeader title={t("store.priceTiers")} />
            <CardBody>
              <Dl items={tiers.map((tr) => ({ label: t("store.fromQty", { qty: Number(tr.minQty) }), value: <bdi dir="ltr">{money(Number(tr.unitPrice) * (1 - Number(tr.discountPct) / 100))}</bdi> }))} />
            </CardBody>
          </Card>
        ) : null}
      </div>
      {offers.length ? (
        <section aria-labelledby="offers">
          <h2 id="offers" className="mb-3 text-lg font-bold">
            {t("store.otherOffers")}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {offers.map((o) => (
              <ProductCard key={o.id} p={o} locale={ctx.locale} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
