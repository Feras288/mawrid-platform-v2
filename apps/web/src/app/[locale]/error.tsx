"use client";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@/components/ui/primitives";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <EmptyState title={t("errorTitle")} description={t("internal")} action={<Button variant="outline" onClick={reset}>{t("retry")}</Button>} />
    </main>
  );
}
