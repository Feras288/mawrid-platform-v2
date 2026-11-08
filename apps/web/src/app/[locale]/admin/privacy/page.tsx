import { getFormatter, getTranslations } from "next-intl/server";
import { listDataRequests } from "@platform/modules/privacy";
import { DeletionDecision } from "@/components/admin/console-client";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminPrivacy() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const rows = await listDataRequests(ctx);
  return (
    <>
      <PageHeader title={t("privacy")} />
      <Card>
        <Table caption={t("privacy")}>
          <thead>
            <tr>
              <Th>{t("requestedAt")}</Th>
              <Th>{t("email")}</Th>
              <Th>{t("kind")}</Th>
              <Th>{t("status")}</Th>
              <Th>{t("openOrders")}</Th>
              <Th>{t("notes")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="text-ink-500">
                  {t("noData")}
                </Td>
              </Tr>
            ) : (
              rows.map(({ r, email, openOrders }) => (
                <Tr key={r.id}>
                  <Td className="text-xs">{f.dateTime(r.createdAt, "short")}</Td>
                  <Td dir="ltr" className="text-xs">
                    {email}
                  </Td>
                  <Td>{t(`kinds.${r.kind as "export"}`)}</Td>
                  <Td>
                    <Badge tone={r.status === "completed" ? "success" : r.status === "rejected" ? "danger" : "warning"}>{t(`reqStatus.${r.status as "pending"}`)}</Badge>
                  </Td>
                  <Td>{openOrders}</Td>
                  <Td className="max-w-xs text-xs">{r.notes}</Td>
                  <Td>{r.kind === "deletion" && r.status === "pending" ? <DeletionDecision requestId={r.id} /> : null}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
