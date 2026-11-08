import { getFormatter, getTranslations } from "next-intl/server";
import { CONTENT_SLUGS, listContent } from "@platform/modules/admin";
import { ContentDraftDialog, PublishButton } from "@/components/admin/console-client";
import { Alert, Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminContent() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const pages = await listContent(ctx);
  const slugs = CONTENT_SLUGS.map((s) => ({ value: s, label: t(`adm.slugs.${s}`) }));
  return (
    <>
      <PageHeader title={t("adm.content")} actions={<ContentDraftDialog slugs={slugs} />} />
      <Alert tone="warning" className="mb-4">
        {t("legal.draftNotice")}
      </Alert>
      <Card>
        <Table caption={t("adm.content")}>
          <thead>
            <tr>
              <Th>{t("adm.slug")}</Th>
              <Th>Locale</Th>
              <Th>{t("adm.version")}</Th>
              <Th>{t("adm.title")}</Th>
              <Th>{t("adm.status")}</Th>
              <Th>{t("adm.time")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="text-ink-500">
                  {t("adm.noData")}
                </Td>
              </Tr>
            ) : (
              pages.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/legal/${p.slug}`} className="text-primary-700 hover:underline">
                      {t(`adm.slugs.${p.slug as "terms"}`)}
                    </Link>
                  </Td>
                  <Td>{p.locale}</Td>
                  <Td>{p.version}</Td>
                  <Td>{p.title}</Td>
                  <Td>
                    <Badge tone={p.status === "published" ? "success" : p.status === "draft" ? "warning" : "neutral"}>{t(`adm.pageStatus.${p.status as "draft"}`)}</Badge>
                  </Td>
                  <Td className="text-xs">{f.dateTime(p.publishedAt ?? p.createdAt, "short")}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {p.status === "draft" ? <PublishButton id={p.id} /> : null}
                      <ContentDraftDialog slugs={slugs} initial={{ slug: p.slug, locale: p.locale, title: p.title, body: p.body }} />
                    </div>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
