import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function localized<T extends { nameAr?: string | null; nameEn?: string | null }>(row: T | null | undefined, locale: string): string {
  if (!row) return "";
  return (locale === "ar" ? row.nameAr || row.nameEn : row.nameEn || row.nameAr) ?? "";
}
