import { Upload } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { authorize } from "@platform/modules/authz";
import { listImports } from "@platform/modules/imports";
import { ImportUploadForm } from "@/components/supplier/import-form";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function ImportsPage() {
  const ctx = await requireOrgCtx("supplier");
  authorize(ctx, "products.manage");
  const t = await getTranslations();
  const f = await getFormatter();
  const items = await listImports(ctx);
  return (
    <>
      <PageHeader title={t("imports.title")} />
      <div className="grid gap-6">
        <Card>
          <CardHeader title={t("imports.upload")} description={t("imports.hint")} actions={<a className="text-sm text-primary-700 hover:underline" href="/api/v1/imports/template">{t("imports.template")}</a>} />
          <CardBody>
            <ImportUploadForm />
          </CardBody>
        </Card>
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={<Upload />} title={t("imports.noImports")} />
          ) : (
            <Table caption={t("imports.title")}>
              <thead>
                <tr>
                  <Th>{t("common.date")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th>{t("imports.rows")}</Th>
                  <Th>{t("imports.ok")}</Th>
                  <Th>{t("imports.errors")}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <Tr key={b.id}>
                    <Td>
                      <Link href={`/supplier/imports/${b.id}`} className="text-primary-700 hover:underline">
                        {f.dateTime(b.createdAt, "long")}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={b.status === "completed" ? "success" : b.status === "failed" ? "danger" : "info"}>{t(`imports.status.${b.status as "pending"}`)}</Badge>
                    </Td>
                    <Td>{b.totalRows}</Td>
                    <Td>{b.okRows}</Td>
                    <Td className={b.errorRows ? "text-danger-600" : undefined}>{b.errorRows}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
