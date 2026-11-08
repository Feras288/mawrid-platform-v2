import { getFormatter, getTranslations } from "next-intl/server";
import { listFlags } from "@platform/modules/config";
import { FlagToggle } from "@/components/admin/console-client";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function FlagsPage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const flags = await listFlags(ctx);
  return (
    <>
      <PageHeader title={t("flags")} />
      <Card>
        <Table caption={t("flags")}>
          <thead>
            <tr>
              <Th>{t("flag")}</Th>
              <Th>{t("status")}</Th>
              <Th>{t("time")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {flags.map((fl) => (
              <Tr key={fl.key}>
                <Td>
                  <span className="font-mono text-xs" dir="ltr">
                    {fl.key}
                  </span>
                  <span className="block text-xs text-ink-500">{fl.description}</span>
                  {fl.locked ? <Badge tone="warning">{t("locked")}</Badge> : null}
                </Td>
                <Td>
                  <Badge tone={fl.enabled ? "success" : "neutral"}>{fl.enabled ? t("on") : t("off")}</Badge>
                </Td>
                <Td>{fl.updatedAt ? f.dateTime(fl.updatedAt, "short") : "—"}</Td>
                <Td>
                  <FlagToggle flagKey={fl.key} enabled={fl.enabled} locked={fl.locked} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
