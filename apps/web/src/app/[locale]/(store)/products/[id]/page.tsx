import { BadgeCheck, Boxes, ClipboardList, CreditCard, Layers, ReceiptText, RotateCcw, Store, Truck } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { wishlistIds } from "@platform/modules/commerce";
import { getStoreProduct } from "@platform/modules/store";
import { CategoryArt } from "@/components/store/category-art";
import { AddToCart, WishlistButton } from "@/components/store/store-client";
import { ProductCard } from "@/components/store/product-card";
import { Alert, Card, CardBody, CardHeader, Dl, SectionHeading, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { categoryIndex } from "@/lib/categories";
import { getCtx } from "@/lib/ctx";
import { cn, localized } from "@/lib/utils";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await getCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getStoreProduct(ctx, id);
  if (!data) notFound();
  const { product: p, card, supplier, category, unit, attributes, tiers, offers } = data;
  const [wish, cats] = await Promise.all([wishlistIds(ctx), categoryIndex()]);
  const name = ctx.locale === "ar" ? p.nameAr : p.nameEn;
  const desc = ctx.locale === "ar" ? p.descriptionAr || p.descriptionEn : p.descriptionEn || p.descriptionAr;
  const available = Number(card.available);
  const money = (v: number) => f.number(v, { style: "currency", currency: "SAR" });
  const supplierBlocked = Boolean(ctx.orgId && ctx.orgType !== "buyer");
  const rootSlug = cats.rootSlug(p.categoryId);
  const root = rootSlug ? cats.bySlug.get(rootSlug) : null;
  const unitLabel = unit ? localized(unit, ctx.locale) : p.saleUnit;
  const images = p.imageFileIds.slice(0, 5);
  const facts = [
    Number(p.moq) > 1 ? { icon: Boxes, text: t("store.moq", { moq: Number(p.moq) }) } : null,
    Number(p.orderIncrement) > 1 ? { icon: Layers, text: t("store.increment", { step: Number(p.orderIncrement) }) } : null,
    p.leadTimeDays ? { icon: Truck, text: t("store.leadTime", { days: p.leadTimeDays }) } : null,
  ].filter((x): x is { icon: typeof Boxes; text: string } => Boolean(x));

  return (
    <div className="space-y-10">
      <nav aria-label="breadcrumb" className="text-xs font-medium text-ink-500">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/products" className="hover:text-ink-800 hover:underline">
              {t("store.allProducts")}
            </Link>
          </li>
          {root && root.id !== category?.id ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={`/products?category=${root.slug}`} className="hover:text-ink-800 hover:underline">
                {localized(root, ctx.locale)}
              </Link>
            </li>
          ) : null}
          {category ? (
            <li className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={`/products?category=${category.slug}`} className="hover:text-ink-800 hover:underline">
                {localized(category, ctx.locale)}
              </Link>
            </li>
          ) : null}
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
        {/* gallery */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-36 lg:self-start">
          <div className="overflow-hidden rounded-3xl border border-sand-200/80 bg-white shadow-card">
            {images[0] ? (
              <img src={`/api/v1/public-files/${images[0]}`} alt={name} className="aspect-square w-full object-cover" />
            ) : (
              <CategoryArt slug={rootSlug} inset className="aspect-[4/3] w-full lg:aspect-square">
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/5 to-transparent px-4 pt-8 pb-3 text-center text-xs font-medium text-ink-600">{t("ux.pdp.noImage")}</span>
              </CategoryArt>
            )}
          </div>
          {images.length > 1 ? (
            <ul className="grid grid-cols-5 gap-2">
              {images.map((img, i) => (
                <li key={img} className="overflow-hidden rounded-xl border border-sand-200 bg-white">
                  <img src={`/api/v1/public-files/${img}`} alt={`${name} ${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* summary + buy box */}
        <div className="min-w-0 space-y-5">
          <div>
            {p.brandName ? <p className="text-xs font-bold tracking-wide text-accent-600 uppercase">{p.brandName}</p> : null}
            <h1 className="mt-1 text-[1.625rem] leading-tight font-extrabold tracking-tight text-ink-900 sm:text-h1">{name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-sand-100 px-2 py-1 font-medium text-ink-600 ring-1 ring-inset ring-sand-200">
                SKU <bdi dir="ltr" className="font-mono">{p.sku}</bdi>
              </span>
              {category ? <span className="rounded-md bg-sand-100 px-2 py-1 font-medium text-ink-600 ring-1 ring-inset ring-sand-200">{localized(category, ctx.locale)}</span> : null}
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="space-y-4 p-5 sm:p-6">
              {card.price ? (
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <bdi dir="ltr" className="text-[2rem] leading-none font-extrabold tracking-tight text-ink-900">
                      {money(Number(card.price.unitPrice.toFixed(2)))}
                    </bdi>
                    <span className="text-sm text-ink-500">
                      / {unitLabel} · {t("store.exVat")}
                    </span>
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
                    <span>
                      <bdi dir="ltr" className="font-semibold text-ink-800">
                        {money(Number(card.price.unitPrice.times(card.price.vatRate.plus(1)).toFixed(2)))}
                      </bdi>{" "}
                      {t("store.incVat")}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", card.price.kind === "retail" ? "bg-sand-100 text-ink-600" : "bg-accent-100 text-accent-700")}>{t(`store.priceKind.${card.price.kind}`)}</span>
                  </p>
                </div>
              ) : null}
              <p className={cn("inline-flex items-center gap-2 text-sm font-semibold", available > 0 ? "text-success-600" : "text-danger-600")}>
                <span className={cn("size-2 rounded-full", available > 0 ? "bg-success-600" : "bg-danger-600")} aria-hidden />
                {available > 0 ? t("store.available", { qty: available }) : t("store.outOfStock")}
              </p>
              {facts.length ? (
                <ul className="grid gap-2 text-sm text-ink-700 sm:grid-cols-2">
                  {facts.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-ink-400 flip-rtl" aria-hidden />
                      {text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {supplierBlocked ? <Alert tone="info">{t("store.supplierCannotBuy")}</Alert> : null}
              <div className="space-y-2 border-t border-sand-100 pt-4">
                <AddToCart productId={p.id} moq={p.moq} step={p.orderIncrement} disabled={available <= 0 || !card.price || supplierBlocked} signedIn={Boolean(ctx.userId)} />
                {ctx.userId ? <WishlistButton productId={p.id} active={wish.has(p.id)} /> : null}
              </div>
            </div>
            <ul className="grid gap-px border-t border-sand-100 bg-sand-100 text-xs sm:grid-cols-3">
              {[
                { icon: ReceiptText, text: t("ux.pdp.trustInvoice") },
                { icon: CreditCard, text: t("ux.pdp.trustPayment") },
                { icon: RotateCcw, text: t("ux.pdp.trustReturns") },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2 bg-sand-50 px-4 py-3 text-ink-600">
                  <Icon className="size-4 shrink-0 text-primary-700" aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
          </Card>

          {/* seller */}
          <div className="flex items-center gap-3 rounded-2xl border border-sand-200/80 bg-white p-4 shadow-xs">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
              <Store className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-500">{t("ux.pdp.seller")}</p>
              <p className="truncate font-bold text-ink-900">{t("store.soldBy", { supplier: localized(supplier, ctx.locale) })}</p>
            </div>
            <span className="hidden items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-800 sm:inline-flex">
              <BadgeCheck className="size-3.5" aria-hidden />
              {t("ux.card.verified")}
            </span>
          </div>

          <p className="flex items-start gap-2 text-sm text-ink-600">
            <ClipboardList className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
            <Link href={ctx.userId ? "/org/rfqs" : "/register"} className="underline-offset-2 hover:text-primary-800 hover:underline">
              {t("ux.pdp.bulk")}
            </Link>
          </p>
        </div>
      </div>

      <div className={cn("grid gap-6", tiers.length > 1 && "lg:grid-cols-[1.4fr_1fr]")}>
        <div className="min-w-0 space-y-6">
          {desc ? (
            <Card>
              <CardBody>
                <p className="text-sm leading-7 whitespace-pre-line text-ink-700">{desc}</p>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("store.specs")} />
            <CardBody>
              <Dl className={tiers.length > 1 ? undefined : "lg:grid-cols-4"} items={attributes.map((a) => ({ label: localized(a, ctx.locale), value: `${String(a.value)}${a.unit ? ` ${a.unit}` : ""}` }))} />
            </CardBody>
          </Card>
        </div>
        {tiers.length > 1 ? (
          <Card className="self-start overflow-hidden">
            <CardHeader title={t("store.priceTiers")} />
            <Table>
              <thead>
                <tr>
                  <Th>{t("common.quantity")}</Th>
                  <Th className="text-end">{t("store.unitPrice")}</Th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tr) => (
                  <Tr key={tr.minQty}>
                    <Td>{t("store.fromQty", { qty: Number(tr.minQty) })}</Td>
                    <Td className="text-end font-semibold text-ink-900">
                      <bdi dir="ltr">{money(Number(tr.unitPrice) * (1 - Number(tr.discountPct) / 100))}</bdi>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </div>

      {offers.length ? (
        <section aria-labelledby="offers">
          <SectionHeading id="offers" title={t("store.otherOffers")} />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {offers.map((o) => (
              <ProductCard key={o.id} p={o} locale={ctx.locale} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
