import { getTranslations, setRequestLocale } from "next-intl/server";
import { PortalShell } from "@/components/shell/portal-shell";
import { requireOrgCtx } from "@/lib/ctx";
import { supplierNav } from "@/lib/nav";

export default async function SupplierLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations("nav");
  return (
    <PortalShell ctx={ctx} portalLabel={t("supplierPortal")} nav={supplierNav(ctx)}>
      {children}
    </PortalShell>
  );
}
