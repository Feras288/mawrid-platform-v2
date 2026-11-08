import { getTranslations } from "next-intl/server";
import { getIntegrationSettings } from "@platform/modules/admin";
import { SettingForm, TestIntegration } from "@/components/admin/console-client";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function IntegrationsPage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const s = await getIntegrationSettings(ctx);
  return (
    <>
      <PageHeader title={t("integrations")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("smtp")} actions={<TestIntegration kind="smtp" withEmail />} />
          <CardBody>
            <SettingForm
              settingKey="smtp"
              title={t("smtp")}
              value={s.smtp.value}
              secret={{ label: t("password"), hasSecret: s.smtp.hasSecret }}
              fields={[
                { name: "host", label: t("host"), dir: "ltr" },
                { name: "port", label: t("port"), type: "number", dir: "ltr" },
                { name: "user", label: t("user"), dir: "ltr" },
                { name: "from", label: t("from"), dir: "ltr" },
                { name: "secure", label: t("secure"), checkbox: true },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("ai")} actions={<TestIntegration kind="ai" />} />
          <CardBody>
            <SettingForm
              settingKey="ai"
              title={t("ai")}
              value={s.ai.value}
              secret={{ label: t("apiKey"), hasSecret: s.ai.hasSecret }}
              fields={[
                { name: "provider", label: t("provider"), options: [{ value: "none", label: t("providers.none") }, { value: "anthropic", label: t("providers.anthropic") }] },
                { name: "modelExtraction", label: t("modelExtraction"), dir: "ltr" },
                { name: "modelFast", label: t("modelFast"), dir: "ltr" },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("bank")} actions={<TestIntegration kind="payments" />} />
          <CardBody>
            <p className="mb-3 text-xs text-ink-500">{t("envNote")}</p>
            <SettingForm
              settingKey="payments.bank_transfer"
              title={t("bank")}
              value={s["payments.bank_transfer"].value}
              fields={[
                { name: "enabled", label: t("enabled"), checkbox: true },
                { name: "bankName", label: t("bankName") },
                { name: "iban", label: t("iban"), dir: "ltr" },
                { name: "beneficiary", label: t("beneficiary") },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("commission")} />
          <CardBody>
            <SettingForm settingKey="commission" title={t("commission")} value={s.commission.value} fields={[{ name: "ratePct", label: t("ratePct"), type: "number", dir: "ltr" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("storePolicies")} />
          <CardBody>
            <SettingForm settingKey="store.policies" title={t("storePolicies")} value={s["store.policies"].value} fields={[{ name: "returnWindowDays", label: t("returnWindow"), type: "number", dir: "ltr" }]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("priceIndex")} />
          <CardBody>
            <SettingForm
              settingKey="price_index"
              title={t("priceIndex")}
              value={s.price_index.value}
              fields={[
                { name: "windowDays", label: t("windowDays"), type: "number", dir: "ltr" },
                { name: "minObs", label: t("minObs"), type: "number", dir: "ltr" },
                { name: "minOrgs", label: t("minOrgs"), type: "number", dir: "ltr" },
                { name: "maxSharePct", label: t("maxShare"), type: "number", dir: "ltr" },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
