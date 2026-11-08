import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { CONTENT_SLUGS, publishedContent } from "@platform/modules/admin";
import { Alert, Card } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function LegalPage({ params }: { params: Promise<{ slug: string; locale: string }> }) {
  const { slug, locale } = await params;
  if (!(CONTENT_SLUGS as readonly string[]).includes(slug)) notFound();
  const t = await getTranslations("legal");
  const f = await getFormatter();
  const page = await publishedContent(slug, locale === "en" ? "en" : "ar");
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{page?.title ?? t(slug as "terms")}</h1>
      <Alert tone="warning">{t("draftNotice")}</Alert>
      <Card className="p-6">
        {page ? (
          <>
            <p className="mb-4 text-xs text-ink-500">
              v{page.version} · {page.publishedAt ? f.dateTime(page.publishedAt, { dateStyle: "medium" }) : ""}
            </p>
            <div className="whitespace-pre-line leading-8 text-ink-700">{page.body}</div>
          </>
        ) : (
          <p className="text-ink-500">{t("notPublished")}</p>
        )}
      </Card>
    </article>
  );
}
