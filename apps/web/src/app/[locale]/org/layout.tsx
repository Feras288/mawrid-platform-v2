import { getTranslations, setRequestLocale } from "next-intl/server";
import { PortalShell } from "@/components/shell/portal-shell";
import { requireOrgCtx } from "@/lib/ctx";
import { orgNav } from "@/lib/nav";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations("nav");
  return (
    <PortalShell ctx={ctx} portalLabel={t("procurement")} nav={orgNav(ctx)}>
      {children}
    </PortalShell>
  );
}
