import { getFormatter, getTranslations } from "next-intl/server";
import { myPrivacy } from "@platform/modules/privacy";
import { ConsentToggle, DeletionDialog, ExportButton } from "@/components/admin/console-client";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";

export default async function PrivacyPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const p = await myPrivacy(ctx);
  const granted = (kind: string) => p.consents.find((c) => c.kind === kind)?.granted ?? false;
  const openExport = p.requests.some((r) => r.kind === "export" && ["pending", "processing"].includes(r.status));
  const openDeletion = p.requests.some((r) => r.kind === "deletion" && r.status === "pending");
  return (
    <>
      <PageHeader title={t("privacy.title")} description={t("privacy.intro")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("privacy.consents")} />
          <CardBody className="space-y-3 text-sm">
            {(["terms", "privacy_policy"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span>
                  <Link href={`/legal/${k === "terms" ? "terms" : "privacy"}`} className="text-primary-700 hover:underline">
                    {t(`legal.${k === "terms" ? "terms" : "privacy"}`)}
                  </Link>{" "}
                  <span className="text-xs text-ink-500">({t("privacy.version", { v: p.policyVersions[k] })})</span>
                </span>
                <Badge tone="success">{t("privacy.required")}</Badge>
              </div>
            ))}
            {(["marketing", "external_ai_processing"] as const).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span>
                  {k === "marketing" ? t("privacy.marketing") : t("privacy.externalAi")}{" "}
                  <Badge tone={granted(k) ? "success" : "neutral"}>{granted(k) ? t("privacy.granted") : t("privacy.withdrawn")}</Badge>
                </span>
                <ConsentToggle kind={k} granted={granted(k)} />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("privacy.export")} />
          <CardBody className="space-y-3 text-sm">
            <p className="text-ink-600">{t("privacy.exportHint")}</p>
            <ExportButton disabled={openExport} />
            <h3 className="pt-2 font-semibold">{t("privacy.deletion")}</h3>
            <p className="text-ink-600">{t("privacy.deletionHint")}</p>
            <DeletionDialog disabled={openDeletion} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title={t("privacy.requests")} />
        <CardBody>
          {p.requests.length === 0 ? (
            <p className="text-sm text-ink-500">{t("adm.noData")}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {p.requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {t(`adm.kinds.${r.kind as "export"}`)} · {f.dateTime(r.createdAt, "short")} · <Badge>{t(`adm.reqStatus.${r.status as "pending"}`)}</Badge>
                    {r.notes && r.kind === "deletion" && r.status === "rejected" ? <span className="block text-xs text-ink-500">{r.notes}</span> : null}
                  </span>
                  {r.resultFileId ? (
                    <a className="text-primary-700 hover:underline" href={`/api/v1/files/${r.resultFileId}`}>
                      {t("privacy.download")}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
