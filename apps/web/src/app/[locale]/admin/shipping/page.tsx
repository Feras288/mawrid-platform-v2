import { getTranslations } from "next-intl/server";
import { listDefaultZones } from "@platform/modules/admin";
import { listCities, listRegions } from "@platform/modules/reference";
import { DefaultZoneForm } from "@/components/admin/console-client";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AdminShipping() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const [zones, cities, regions] = await Promise.all([listDefaultZones(ctx), listCities(), listRegions()]);
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  const regionOpts = regions.map((r) => ({ value: r.code, label: localized(r, ctx.locale) }));
  return (
    <>
      <PageHeader title={t("adm.shipping")} description={t("adm.shippingHint")} />
      <div className="grid gap-6 lg:grid-cols-2">
        {zones.map((z) => (
          <Card key={z.id}>
            <CardHeader title={z.name} />
            <CardBody>
              <DefaultZoneForm zone={z} cities={cityOpts} regions={regionOpts} />
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardHeader title={t("shipping.newZone")} />
          <CardBody>
            <DefaultZoneForm cities={cityOpts} regions={regionOpts} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
