import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// custom type-scale tokens (globals.css) must merge as font sizes, not colours
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["display", "h1", "h2", "h3", "body", "caption"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function localized<T extends { nameAr?: string | null; nameEn?: string | null }>(row: T | null | undefined, locale: string): string {
  if (!row) return "";
  return (locale === "ar" ? row.nameAr || row.nameEn : row.nameEn || row.nameAr) ?? "";
}
