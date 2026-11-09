import { Package, ShieldCheck, ShoppingCart, Store } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { getCart } from "@platform/modules/commerce";
import { CheckoutSteps } from "@/components/store/checkout-steps";
import { CartQty, RemoveCartItem } from "@/components/store/store-client";
import { Alert, buttonVariants, Card, EmptyState } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";
import { cn } from "@/lib/utils";

export default async function CartPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  if (ctx.orgId && ctx.orgType !== "buyer") return <Alert tone="info">{t("store.supplierCannotBuy")}</Alert>;
  const cart = await getCart(ctx);
  const money = (v: string | number) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const goods = cart.groups.reduce((a, g) => a + Number(g.goodsNet), 0);
  const vat = cart.groups.reduce((a, g) => a + Number(g.goodsVat), 0);
  const hasIssues = cart.groups.some((g) => g.lines.some((l) => l.issues.length));
  const itemCount = cart.groups.reduce((a, g) => a + g.lines.length, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sand-200 pb-5">
        <div>
          <h1 className="text-h1 font-extrabold tracking-tight text-ink-900">{t("store.cart")}</h1>
          {itemCount ? <p className="mt-1 text-sm text-ink-500">{t("ux.cart.items", { count: itemCount })}</p> : null}
        </div>
        {itemCount ? <CheckoutSteps current={1} /> : null}
      </div>
      {cart.groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingCart />}
            title={t("store.cartEmpty")}
            action={
              <Link href="/products" className={buttonVariants()}>
                {t("store.continueShopping")}
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:gap-8">
          <div className="min-w-0 space-y-4">
            {(cart as { hiddenItems?: number }).hiddenItems ? <Alert tone="warning">{t("store.hiddenItems")}</Alert> : null}
            {cart.groups.map((g) => (
              <Card key={g.supplierOrgId} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-sand-100 bg-sand-50/70 px-5 py-3.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary-50 text-primary-700">
                    <Store className="size-4" aria-hidden />
                  </span>
                  <h2 className="min-w-0 truncate text-sm font-bold text-ink-900">{t("store.shipmentFrom", { supplier: ctx.locale === "ar" ? g.supplierNameAr : g.supplierNameEn })}</h2>
                </div>
                <ul className="divide-y divide-sand-100">
                  {g.lines.map((l) => (
                    <li key={l.itemId} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                      <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-sand-100 text-ink-300 ring-1 ring-inset ring-sand-200" aria-hidden>
                        <Package className="size-7" />
                      </span>
                      <div className="min-w-0 flex-1 basis-48">
                        <Link href={`/products/${l.productId}`} className="line-clamp-2 font-semibold text-ink-900 hover:text-primary-800 hover:underline">
                          {ctx.locale === "ar" ? l.nameAr : l.nameEn}
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-500">
                          <bdi dir="ltr" className="font-mono">
                            {l.sku}
                          </bdi>
                          {l.unitPrice ? (
                            <>
                              {" · "}
                              {t("store.unitPrice")}: <bdi dir="ltr">{money(l.unitPrice)}</bdi> / {l.unit}
                            </>
                          ) : null}
                        </p>
                        {l.priceChanged ? <p className="mt-1 text-xs font-medium text-warning-600">{t("store.priceChanged")}</p> : null}
                        {l.issues.map((i) => (
                          <p key={i} className="mt-1 text-xs font-medium text-danger-600" role="alert">
                            {t(`store.issues.${i}`)}
                          </p>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
                        <CartQty itemId={l.itemId} quantity={l.quantity} />
                        <p className="w-28 text-end text-base font-bold text-ink-900" dir="ltr">
                          {money(l.total)}
                        </p>
                        <RemoveCartItem itemId={l.itemId} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            <Link href="/products" className="inline-flex text-sm font-semibold text-primary-700 hover:underline">
              {t("store.continueShopping")}
            </Link>
          </div>
          <aside className="lg:sticky lg:top-36 lg:self-start">
            <Card>
              <div className="border-b border-sand-100 px-5 py-4">
                <h2 className="text-h3 font-bold text-ink-900">{t("ux.cart.summary")}</h2>
              </div>
              <dl className="space-y-3 px-5 py-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-600">{t("store.goods")}</dt>
                  <dd>
                    <bdi dir="ltr" className="font-medium text-ink-900">
                      {money(goods)}
                    </bdi>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-600">{t("store.vat")}</dt>
                  <dd>
                    <bdi dir="ltr" className="font-medium text-ink-900">
                      {money(vat)}
                    </bdi>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-600">{t("store.shipping")}</dt>
                  <dd className="text-ink-500">—</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-sand-200 pt-3">
                  <dt className="text-base font-bold text-ink-900">{t("store.total")}</dt>
                  <dd>
                    <bdi dir="ltr" className="text-xl font-extrabold text-ink-900">
                      {money(goods + vat)}
                    </bdi>
                  </dd>
                </div>
              </dl>
              <div className="space-y-3 px-5 pb-5">
                {hasIssues ? (
                  <span className={cn(buttonVariants({ variant: "accent", size: "lg" }), "pointer-events-none w-full opacity-50")} aria-disabled>
                    {t("store.checkout")}
                  </span>
                ) : (
                  <Link href="/checkout" className={cn(buttonVariants({ variant: "accent", size: "lg" }), "w-full")}>
                    {t("store.checkout")}
                  </Link>
                )}
                <p className="flex items-start gap-2 text-xs leading-5 text-ink-500">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-700" aria-hidden />
                  {t("ux.cart.recheck")}
                </p>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
