import { setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/shell/portal-shell";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export default async function AuthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-primary-50 to-sand-50">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Brand />
        <LocaleSwitcher />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
