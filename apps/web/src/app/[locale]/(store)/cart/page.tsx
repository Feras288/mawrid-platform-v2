import { ShoppingCart } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { getCart } from "@platform/modules/commerce";
import { CartQty, RemoveCartItem } from "@/components/store/store-client";
import { Alert, buttonVariants, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
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
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t("store.cart")}</h1>
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
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {(cart as { hiddenItems?: number }).hiddenItems ? <Alert tone="warning">{t("store.hiddenItems")}</Alert> : null}
            {cart.groups.map((g) => (
              <Card key={g.supplierOrgId}>
                <CardHeader title={t("store.shipmentFrom", { supplier: ctx.locale === "ar" ? g.supplierNameAr : g.supplierNameEn })} />
                <ul className="divide-y divide-sand-200">
                  {g.lines.map((l) => (
                    <li key={l.itemId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-48 flex-1">
                        <Link href={`/products/${l.productId}`} className="font-medium hover:underline">
                          {ctx.locale === "ar" ? l.nameAr : l.nameEn}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {l.unitPrice ? (
                            <>
                              {t("store.unitPrice")}: <bdi dir="ltr">{money(l.unitPrice)}</bdi> / {l.unit}
                            </>
                          ) : null}
                        </p>
                        {l.priceChanged ? <p className="text-xs text-warning-600">{t("store.priceChanged")}</p> : null}
                        {l.issues.map((i) => (
                          <p key={i} className="text-xs text-danger-600" role="alert">
                            {t(`store.issues.${i}`)}
                          </p>
                        ))}
                      </div>
                      <CartQty itemId={l.itemId} quantity={l.quantity} />
                      <p className="w-28 text-end font-semibold" dir="ltr">
                        {money(l.total)}
                      </p>
                      <RemoveCartItem itemId={l.itemId} />
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <Card className="h-fit">
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>{t("store.goods")}</span>
                <bdi dir="ltr">{money(goods)}</bdi>
              </div>
              <div className="flex justify-between">
                <span>{t("store.vat")}</span>
                <bdi dir="ltr">{money(vat)}</bdi>
              </div>
              <p className="text-xs text-ink-500">{t("store.shipping")}: —</p>
              <div className="flex justify-between border-t border-sand-200 pt-2 text-base font-bold">
                <span>{t("store.total")}</span>
                <bdi dir="ltr">{money(goods + vat)}</bdi>
              </div>
              {hasIssues ? (
                <span className={cn(buttonVariants({ variant: "accent" }), "pointer-events-none w-full opacity-50")} aria-disabled>
                  {t("store.checkout")}
                </span>
              ) : (
                <Link href="/checkout" className={cn(buttonVariants({ variant: "accent" }), "w-full")}>
                  {t("store.checkout")}
                </Link>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
