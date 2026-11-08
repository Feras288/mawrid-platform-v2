import { getFormatter, getTranslations } from "next-intl/server";
import { getCart, listAddresses } from "@platform/modules/commerce";
import { listUserOrganizations } from "@platform/modules/context";
import { availableMethods } from "@platform/modules/payments";
import { listCities } from "@platform/modules/reference";
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
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-bold">{t("store.checkout")}</h1>
      <p className="text-sm text-ink-600">{t("store.buyingAs", { name: org ? (ctx.locale === "ar" ? org.nameAr : org.nameEn) : (ctx.email ?? "") })}</p>
      {blocked ? <Alert tone="warning">{t("errors.cart_invalid")}</Alert> : null}
      <Card>
        <CardHeader title={t("store.deliverTo")} actions={<AddressDialog cities={cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }))} />} />
        <CardBody>
          {!addresses.length ? (
            <p className="text-sm text-ink-600">{t("store.noAddress")}</p>
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
    </div>
  );
}
