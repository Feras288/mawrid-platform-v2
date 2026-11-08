import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getImport } from "@platform/modules/imports";
import { Badge, Card, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

export default async function ImportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations("imports");
  const { batch, rows } = await getImport(ctx, id).catch(() => notFound());
  return (
    <>
      <PageHeader title={t("title")} actions={<Badge tone={batch.status === "completed" ? "success" : batch.status === "failed" ? "danger" : "info"}>{t(`status.${batch.status as "pending"}`)}</Badge>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label={t("rows")} value={batch.totalRows} />
        <Stat label={t("ok")} value={batch.okRows} />
        <Stat label={t("errors")} value={batch.errorRows} />
      </div>
      <Card>
        <Table caption={t("title")}>
          <thead>
            <tr>
              <Th>{t("row")}</Th>
              <Th>SKU</Th>
              <Th>{t("result")}</Th>
              <Th>{t("errors")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>{r.rowNumber}</Td>
                <Td dir="ltr" className="font-mono text-xs">
                  {String(r.data.sku ?? "")}
                </Td>
                <Td>
                  <Badge tone={r.status === "error" ? "danger" : "success"}>{t(`status.${r.status as "created"}`)}</Badge>
                </Td>
                <Td dir="ltr" className="text-xs text-danger-600">
                  {r.errors.join(", ")}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
