import { getFormatter, getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listRegions } from "@platform/modules/reference";
import { listPriceLists } from "@platform/modules/supplier-products";
import { PriceListDialog } from "@/components/supplier/price-list-dialog";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function PricingPage() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const [lists, regions] = await Promise.all([listPriceLists(ctx), listRegions()]);
  const manage = can(ctx, "pricing.manage");
  return (
    <>
      <PageHeader title={t("products.priceLists")} actions={manage ? <PriceListDialog regions={regions} buyers={[]} /> : null} />
      <Card>
        {lists.length === 0 ? (
          <EmptyState title={t("common.none")} />
        ) : (
          <Table caption={t("products.priceLists")}>
            <thead>
              <tr>
                <Th>{t("products.listName")}</Th>
                <Th>{t("products.listKind")}</Th>
                <Th>{t("products.validFrom")}</Th>
                <Th>{t("products.validTo")}</Th>
                <Th>{t("common.status")}</Th>
                {manage ? <Th className="text-end">{t("common.actions")}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <Tr key={l.id}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td>
                    <Badge tone="primary">{t(`products.kinds.${l.kind as "retail"}`)}</Badge>
                    {l.pricesIncludeVat ? <span className="ms-2 text-xs text-ink-500">{t("products.includesVat")}</span> : null}
                  </Td>
                  <Td>{l.validFrom ? f.dateTime(l.validFrom, "short") : "—"}</Td>
                  <Td>{l.validTo ? f.dateTime(l.validTo, "short") : "—"}</Td>
                  <Td>
                    <Badge tone={l.isActive ? "success" : "neutral"}>{l.isActive ? t("supplier.active") : t("supplier.inactive")}</Badge>
                  </Td>
                  {manage ? (
                    <Td className="text-end">
                      <PriceListDialog regions={regions} buyers={[]} list={{ ...l, validFrom: l.validFrom?.toISOString().slice(0, 10) ?? "", validTo: l.validTo?.toISOString().slice(0, 10) ?? "" }} />
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
