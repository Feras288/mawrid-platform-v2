import { getFormatter, getTranslations } from "next-intl/server";
import { getCart, listAddresses } from "@platform/modules/commerce";
import { listUserOrganizations } from "@platform/modules/context";
import { availableMethods } from "@platform/modules/payments";
import { listCities } from "@platform/modules/reference";
import { MapPin, ShieldCheck } from "lucide-react";
import { CheckoutSteps } from "@/components/store/checkout-steps";
import { AddressDialog, CheckoutForm } from "@/components/store/store-client";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { redirect } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  if (ctx.orgId && ctx.orgType !== "buyer") return <Alert tone="info">{t("store.supplierCannotBuy")}</Alert>;
  const sp = await searchParams;
  const [addresses, cities, methods] = await Promise.all([listAddresses(ctx), listCities(), availableMethods()]);
  const address = addresses.find((a) => a.id === sp.address) ?? addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const cart = await getCart(ctx, { city: address?.city ?? null });
  if (!cart.groups.length) redirect({ href: "/cart", locale: ctx.locale });
  const cityName = (code: string) => localized(cities.find((c) => c.code === code), ctx.locale) || code;
  const money = (v: number | string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const shipping = cart.groups.reduce((a, g) => {
    const o = g.shippingOptions[0];
    return a + (o ? Number(o.fee) * (1 + Number(o.vatRate)) : 0);
  }, 0);
  const goods = cart.groups.reduce((a, g) => a + Number(g.goodsNet) + Number(g.goodsVat), 0);
  const blocked = cart.groups.some((g) => g.lines.some((l) => l.issues.length) || (address && !g.shippingOptions.length));
  const org = ctx.orgId ? (await listUserOrganizations(ctx.userId)).find((o) => o.orgId === ctx.orgId) : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sand-200 pb-5">
        <div className="min-w-0">
          <h1 className="text-h1 font-extrabold tracking-tight text-ink-900">{t("store.checkout")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("store.buyingAs", { name: org ? (ctx.locale === "ar" ? org.nameAr : org.nameEn) : (ctx.email ?? "") })}</p>
        </div>
        <CheckoutSteps current={2} />
      </div>
      {blocked ? <Alert tone="warning">{t("errors.cart_invalid")}</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:gap-8">
      <Card className="min-w-0">
        <CardHeader title={t("store.deliverTo")} actions={<AddressDialog cities={cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }))} />} />
        <CardBody>
          {!addresses.length ? (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-sand-300 bg-sand-50 p-4 text-sm text-ink-600">
              <MapPin className="size-4 shrink-0 text-ink-400" aria-hidden />
              {t("store.noAddress")}
            </p>
          ) : (
            <CheckoutForm
              addresses={addresses.map((a) => ({ value: a.id, label: `${a.label ? `${a.label} — ` : ""}${a.recipientName}, ${a.line1}, ${cityName(a.city)} · ${a.phone}` }))}
              addressId={address?.id ?? null}
              groups={cart.groups.map((g) => ({
                supplierOrgId: g.supplierOrgId,
                supplierName: ctx.locale === "ar" ? g.supplierNameAr : g.supplierNameEn,
                options: g.shippingOptions.map((o) => ({ method: o.method, label: t(`store.methods.${o.method}`), fee: money(Number(o.fee) * (1 + Number(o.vatRate))), eta: t("store.eta", { min: o.etaMinDays, max: o.etaMaxDays }), free: o.free })),
              }))}
              methods={methods}
              canSubmit={!blocked}
              totalLabel={cart.groups.every((g) => g.shippingOptions.length <= 1) ? money(goods + shipping) : ""}
            />
          )}
        </CardBody>
      </Card>
      <aside className="lg:sticky lg:top-36 lg:self-start">
        <Card>
          <div className="border-b border-sand-100 px-5 py-4">
            <h2 className="text-h3 font-bold text-ink-900">{t("ux.cart.summary")}</h2>
          </div>
          <ul className="divide-y divide-sand-100 px-5 text-sm">
            {cart.groups.flatMap((g) =>
              g.lines.map((l) => (
                <li key={l.itemId} className="flex justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-ink-700">
                    {ctx.locale === "ar" ? l.nameAr : l.nameEn} <span className="text-ink-500">× <bdi dir="ltr">{Number(l.quantity)}</bdi></span>
                  </span>
                  <bdi dir="ltr" className="shrink-0 font-medium text-ink-900">
                    {money(l.total)}
                  </bdi>
                </li>
              )),
            )}
          </ul>
          <dl className="space-y-2 border-t border-sand-200 px-5 py-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t("store.goods")}</dt>
              <dd>
                <bdi dir="ltr" className="font-medium">{money(goods)}</bdi>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t("store.shipping")}</dt>
              <dd>
                <bdi dir="ltr" className="font-medium">{address ? money(shipping) : "—"}</bdi>
              </dd>
            </div>
          </dl>
          <p className="flex items-start gap-2 border-t border-sand-100 px-5 py-4 text-xs leading-5 text-ink-500">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-700" aria-hidden />
            {t("store.sellerOfRecord")}
          </p>
        </Card>
      </aside>
      </div>
    </div>
  );
}
