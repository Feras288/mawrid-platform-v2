import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getSupplierForAdmin } from "@platform/modules/suppliers";
import { DecisionForm, DocumentReview, StartReviewButton } from "@/components/admin/supplier-review";
import { Badge, Card, CardBody, CardHeader, Dl, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AdminSupplierDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const s = await getSupplierForAdmin(ctx, id).catch(() => notFound());
  const status = s.profile.status;
  return (
    <>
      <PageHeader title={localized(s.org, ctx.locale)} description={s.org.nameEn} actions={<Badge tone="primary">{t(`supplier.status.${status as "new"}`)}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t("org.profile")} />
            <CardBody>
              <Dl
                items={[
                  { label: t("org.crNumber"), value: <span dir="ltr">{s.org.crNumber}</span> },
                  { label: t("org.vatNumber"), value: <span dir="ltr">{s.org.vatNumber}</span> },
                  { label: t("common.city"), value: s.org.city },
                  { label: t("common.email"), value: <span dir="ltr">{s.org.email}</span> },
                  { label: t("supplier.descriptionAr"), value: s.profile.descriptionAr },
                  { label: t("supplier.descriptionEn"), value: s.profile.descriptionEn },
                  { label: t("supplier.coverageRegions"), value: s.profile.deliversNationwide ? t("supplier.nationwide") : s.profile.coverageRegions.join(", ") },
                  { label: t("supplier.categories"), value: s.categories.map((c) => localized(c, ctx.locale)).join("، ") },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("supplier.documents")} />
            <Table caption={t("supplier.documents")}>
              <thead>
                <tr>
                  <Th>{t("supplier.docKind")}</Th>
                  <Th>{t("supplier.docNumber")}</Th>
                  <Th>{t("supplier.expiresAt")}</Th>
                  <Th>{t("common.status")}</Th>
                  <Th className="text-end">{t("common.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {s.documents.map((d) => (
                  <Tr key={d.id}>
                    <Td>{t(`supplier.docKinds.${d.kind as "other"}`)}</Td>
                    <Td dir="ltr">{d.documentNumber ?? "—"}</Td>
                    <Td>{d.expiresAt ? f.dateTime(d.expiresAt, "short") : "—"}</Td>
                    <Td>
                      <Badge tone={d.status === "verified" ? "success" : d.status === "rejected" ? "danger" : "info"}>{t(`supplier.docStatus.${d.status as "uploaded"}`)}</Badge>
                      {d.reviewerNote ? <p className="mt-1 text-xs text-ink-500">{d.reviewerNote}</p> : null}
                    </Td>
                    <Td className="text-end">
                      <DocumentReview docId={d.id} fileId={d.fileId} status={d.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("admin.decision")} />
            <CardBody className="space-y-4">
              {status === "pending_verification" ? <StartReviewButton orgId={id} /> : null}
              <DecisionForm orgId={id} status={status} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("admin.history")} />
            <CardBody>
              <ol className="space-y-3 text-sm">
                {s.history.map((h) => (
                  <li key={h.id} className="border-s-2 border-primary-200 ps-3">
                    <p className="font-medium">
                      {t(`supplier.status.${h.fromStatus as "new"}`)} ← {t(`supplier.status.${h.toStatus as "new"}`)}
                    </p>
                    <p className="text-xs text-ink-500">{f.dateTime(h.createdAt, "long")}</p>
                    {h.reason ? <p className="text-xs text-ink-600">{h.reason}</p> : null}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("admin.members")} />
            <CardBody>
              <ul className="space-y-1 text-sm">
                {s.members.map((m) => (
                  <li key={m.email}>
                    {m.name} — <span dir="ltr">{m.email}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
