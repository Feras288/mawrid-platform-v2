"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { buttonVariants } from "./primitives";
import { cn } from "@/lib/utils";

export function Pagination(props: { page: number; pageSize: number; total: number }) {
  return (
    <Suspense>
      <PaginationInner {...props} />
    </Suspense>
  );
}

function PaginationInner({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(sp.toString());
    q.set("page", String(p));
    return `${pathname}?${q.toString()}`;
  };
  const Prev = locale === "ar" ? ChevronRight : ChevronLeft;
  const Next = locale === "ar" ? ChevronLeft : ChevronRight;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-sand-200 px-5 py-3 text-sm">
      <span className="text-ink-500">{t("page", { page, pages })}</span>
      <div className="flex gap-2">
        <Link href={href(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
          <Prev />
          {t("previous")}
        </Link>
        <Link href={href(page + 1)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && "pointer-events-none opacity-50")}>
          {t("next")}
          <Next />
        </Link>
      </div>
    </nav>
  );
}
