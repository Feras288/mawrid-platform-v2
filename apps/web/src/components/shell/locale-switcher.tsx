"use client";
import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Link, usePathname } from "@/i18n/navigation";

export function LocaleSwitcher() {
  return (
    <Suspense fallback={<span className="inline-block w-20" />}>
      <LocaleSwitcherInner />
    </Suspense>
  );
}

function LocaleSwitcherInner() {
  const locale = useLocale();
  const t = useTranslations("common");
  const pathname = usePathname();
  const sp = useSearchParams();
  const other = locale === "ar" ? "en" : "ar";
  const qs = sp.toString();
  return (
    <Link href={`${pathname}${qs ? `?${qs}` : ""}`} locale={other} lang={other} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-ink-600 hover:bg-sand-100" aria-label={t("language")}>
      <Languages className="size-4" />
      <span>{t("switchLanguage")}</span>
    </Link>
  );
}
