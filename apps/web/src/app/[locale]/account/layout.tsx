import { getTranslations, setRequestLocale } from "next-intl/server";
import { PortalShell } from "@/components/shell/portal-shell";
import { requireUserCtx } from "@/lib/ctx";
import { accountNav } from "@/lib/nav";

export default async function AccountLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const ctx = await requireUserCtx();
  const t = await getTranslations("nav");
  return (
    <PortalShell ctx={ctx} portalLabel={t("account")} nav={accountNav()}>
      {children}
    </PortalShell>
  );
}
