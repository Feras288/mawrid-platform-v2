import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { listAddresses } from "@platform/modules/commerce";
import { listCities } from "@platform/modules/reference";
import { AddressDialog, DeleteAddressButton } from "@/components/store/store-client";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AddressesPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  if (ctx.orgId && ctx.orgType !== "buyer") return <Alert tone="info">{t("store.supplierCannotBuy")}</Alert>;
  const [items, cities] = await Promise.all([listAddresses(ctx), listCities()]);
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  return (
    <>
      <PageHeader title={t("addresses.title")} actions={<AddressDialog cities={cityOpts} />} />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={<MapPin />} title={t("addresses.none")} />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id}>
              <Card className="space-y-1 p-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{a.label ?? a.recipientName}</span>
                  {a.isDefault ? <Badge tone="primary">{t("addresses.default")}</Badge> : null}
                </div>
                <p>{a.recipientName}</p>
                <p>
                  {a.line1}
                  {a.line2 ? `، ${a.line2}` : ""}
                </p>
                <p>
                  {a.district ? `${a.district}، ` : ""}
                  {cityOpts.find((c) => c.value === a.city)?.label ?? a.city}
                </p>
                <p dir="ltr" className="text-end">
                  {a.phone}
                </p>
                <div className="flex gap-1 pt-2">
                  <AddressDialog cities={cityOpts} address={a as never} />
                  <DeleteAddressButton id={a.id} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
