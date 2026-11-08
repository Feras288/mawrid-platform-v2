import { Warehouse } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listCities } from "@platform/modules/reference";
import { listWarehouses } from "@platform/modules/suppliers";
import { WarehouseDialog } from "@/components/supplier/supplier-forms";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function WarehousesPage() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const [items, cities] = await Promise.all([listWarehouses(ctx), listCities()]);
  const manage = can(ctx, "inventory.manage");
  return (
    <>
      <PageHeader title={t("supplier.warehouses")} actions={manage ? <WarehouseDialog cities={cities} /> : null} />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Warehouse />} title={t("supplier.noWarehouses")} />
        ) : (
          <Table caption={t("supplier.warehouses")}>
            <thead>
              <tr>
                <Th>{t("supplier.warehouseName")}</Th>
                <Th>{t("common.city")}</Th>
                <Th>{t("common.status")}</Th>
                {manage ? <Th className="text-end">{t("common.actions")}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <Tr key={w.id}>
                  <Td className="font-medium">{w.name}</Td>
                  <Td>{localized(cities.find((c) => c.code === w.city), ctx.locale) || w.city}</Td>
                  <Td>
                    <Badge tone={w.isActive ? "success" : "neutral"}>{w.isActive ? t("supplier.active") : t("supplier.inactive")}</Badge>
                  </Td>
                  {manage ? (
                    <Td className="text-end">
                      <WarehouseDialog warehouse={w} cities={cities} />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
