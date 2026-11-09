import { BadgeCheck, ClipboardList, ReceiptText } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/shell/portal-shell";
import { LocaleSwitcher } from "@/components/shell/locale-switcher";

export default async function AuthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      {/* brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 text-white lg:flex lg:flex-col">
        <div className="pattern-lattice absolute inset-0" aria-hidden />
        <div className="relative px-12 pt-10">
          <Brand tone="inverse" />
        </div>
        <div className="relative mt-auto max-w-lg px-12 pb-14">
          <p className="text-xs font-bold tracking-wide text-accent-300">{t("ux.hero.eyebrow")}</p>
          <p className="mt-4 text-[2rem] leading-[1.25] font-extrabold tracking-tight">{t("store.heroTitle")}</p>
          <ul className="mt-8 space-y-3 text-sm text-primary-100">
            {[
              { icon: BadgeCheck, text: t("ux.trust.verified") },
              { icon: ReceiptText, text: t("ux.trust.vat") },
              { icon: ClipboardList, text: t("ux.trust.b2b") },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-white/10 text-accent-200">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="flex min-h-dvh flex-col bg-gradient-to-b from-primary-50/70 to-sand-50">
        <header className="flex items-center justify-between px-4 py-4 sm:px-8">
          <div className="lg:invisible">
            <Brand />
          </div>
          <LocaleSwitcher />
        </header>
        <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12 lg:items-center lg:pt-0">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
