import { getTranslations } from "next-intl/server";
import { aiUsageReport } from "@platform/modules/admin";
import { Badge, Card, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AiUsagePage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const r = await aiUsageReport(ctx);
  return (
    <>
      <PageHeader
        title={t("aiUsage")}
        actions={
          <Badge tone={r.provider.configured ? "success" : "neutral"}>
            {t("providerStatus")}: {r.provider.name} {r.provider.configured ? "✓" : "—"}
          </Badge>
        }
      />
      <Card>
        <Table caption={t("aiUsage")}>
          <thead>
            <tr>
              <Th>{t("month")}</Th>
              <Th>{t("model")}</Th>
              <Th>{t("purpose")}</Th>
              <Th>{t("calls")}</Th>
              <Th>{t("tokensIn")}</Th>
              <Th>{t("tokensOut")}</Th>
              <Th>{t("costUsd")}</Th>
              <Th>{t("errors")}</Th>
            </tr>
          </thead>
          <tbody>
            {r.byMonth.length === 0 ? (
              <Tr>
                <Td colSpan={8} className="text-ink-500">
                  {t("noData")}
                </Td>
              </Tr>
            ) : (
              r.byMonth.map((m) => (
                <Tr key={`${m.month}-${m.model}-${m.purpose}`}>
                  <Td dir="ltr">{m.month}</Td>
                  <Td dir="ltr" className="text-xs">
                    {m.model}
                  </Td>
                  <Td dir="ltr" className="text-xs">
                    {m.purpose}
                  </Td>
                  <Td>{m.calls}</Td>
                  <Td dir="ltr">{m.input_tokens}</Td>
                  <Td dir="ltr">{m.output_tokens}</Td>
                  <Td dir="ltr">{Number(m.cost).toFixed(4)}</Td>
                  <Td>{m.errors}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title={t("byOrg")} />
        <Table caption={t("byOrg")}>
          <thead>
            <tr>
              <Th>{t("orgs")}</Th>
              <Th>{t("calls")}</Th>
              <Th>{t("costUsd")}</Th>
            </tr>
          </thead>
          <tbody>
            {r.byOrg.map((o) => (
              <Tr key={o.orgId ?? "none"}>
                <Td>{(ctx.locale === "ar" ? o.nameAr : o.nameEn) ?? "—"}</Td>
                <Td>{o.calls}</Td>
                <Td dir="ltr">{Number(o.cost).toFixed(4)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
