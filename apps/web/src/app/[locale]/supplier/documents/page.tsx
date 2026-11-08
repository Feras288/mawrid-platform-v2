import { FileText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { getMyProfile } from "@platform/modules/suppliers";
import { DeleteDocumentButton, UploadDocumentDialog } from "@/components/supplier/supplier-forms";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";

const TONE = { uploaded: "info", verified: "success", rejected: "danger", expired: "warning" } as const;

export default async function DocumentsPage() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const { documents } = await getMyProfile(ctx);
  const manage = can(ctx, "supplier.documents.manage");
  return (
    <>
      <PageHeader title={t("supplier.documents")} actions={manage ? <UploadDocumentDialog /> : null} />
      <Alert tone="info" className="mb-4">
        {t("supplier.uploadNotVerify")}
      </Alert>
      <Card>
        {documents.length === 0 ? (
          <EmptyState icon={<FileText />} title={t("common.none")} />
        ) : (
          <Table caption={t("supplier.documents")}>
            <thead>
              <tr>
                <Th>{t("supplier.docKind")}</Th>
                <Th>{t("supplier.docNumber")}</Th>
                <Th>{t("supplier.expiresAt")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("supplier.docNote")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">{t(`supplier.docKinds.${d.kind as "other"}`)}</Td>
                  <Td dir="ltr">{d.documentNumber ?? "—"}</Td>
                  <Td>{d.expiresAt ? f.dateTime(d.expiresAt, "short") : "—"}</Td>
                  <Td>
                    <Badge tone={TONE[d.status as keyof typeof TONE] ?? "neutral"}>{t(`supplier.docStatus.${d.status as "uploaded"}`)}</Badge>
                  </Td>
                  <Td className="max-w-xs text-xs">{d.reviewerNote ?? ""}</Td>
                  <Td className="text-end">
                    <div className="flex justify-end gap-2">
                      <a className="text-sm text-primary-700 hover:underline" href={`/api/v1/files/${d.fileId}?inline=1`} target="_blank" rel="noopener noreferrer">
                        {t("common.view")}
                      </a>
                      {manage && d.status !== "verified" ? <DeleteDocumentButton id={d.id} /> : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
