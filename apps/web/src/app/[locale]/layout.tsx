import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Toaster } from "sonner";
import { brandName } from "@platform/core";
import { routing } from "@/i18n/routing";
import "../globals.css";

const arabic = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-arabic", display: "swap" });
const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const brand = brandName(locale === "ar" ? "ar" : "en");
  return { title: { default: brand, template: `%s · ${brand}` }, description: t("description") };
}

export const viewport: Viewport = { themeColor: "#0f5c4d", width: "device-width", initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={`${arabic.variable} ${latin.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="skip-link">
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          {children}
          <Toaster position={locale === "ar" ? "top-left" : "top-right"} richColors closeButton dir={locale === "ar" ? "rtl" : "ltr"} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
