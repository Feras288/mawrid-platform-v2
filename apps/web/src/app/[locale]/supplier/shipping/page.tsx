import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listMyShippingZones } from "@platform/modules/commerce";
import { listCities, listRegions } from "@platform/modules/reference";
import { DeleteZoneButton, ZoneDialog } from "@/components/store/store-client";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function ShippingZonesPage() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const [zones, cities, regions] = await Promise.all([listMyShippingZones(ctx), listCities(), listRegions()]);
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  const regionOpts = regions.map((r) => ({ value: r.code, label: localized(r, ctx.locale) }));
  const editable = can(ctx, "supplier.orders.fulfil");
  return (
    <>
      <PageHeader title={t("shipping.title")} actions={editable ? <ZoneDialog cities={cityOpts} regions={regionOpts} /> : null} />
      {zones.length === 0 ? (
        <Card>
          <EmptyState title={t("shipping.noZones")} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {zones.map((z) => (
            <Card key={z.id}>
              <CardHeader
                title={z.name}
                description={z.nationwide ? t("shipping.nationwide") : [...z.regions.map((r) => regionOpts.find((o) => o.value === r)?.label ?? r), ...z.cities.map((c) => cityOpts.find((o) => o.value === c)?.label ?? c)].join("، ")}
                actions={
                  <>
                    {!z.isActive ? <Badge>{t("common.inactive")}</Badge> : null}
                    {editable ? <ZoneDialog zone={z} cities={cityOpts} regions={regionOpts} /> : null}
                    {editable ? <DeleteZoneButton id={z.id} /> : null}
                  </>
                }
              />
              <CardBody>
                <ul className="space-y-1 text-sm">
                  {z.rates.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-2">
                      <span>{t(`store.methods.${r.method as "standard"}`)}</span>
                      <span dir="ltr">
                        {Number(r.fee).toFixed(2)} SAR{r.freeOver ? ` · free ≥ ${Number(r.freeOver)}` : ""} · {r.etaMinDays}–{r.etaMaxDays}d
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
