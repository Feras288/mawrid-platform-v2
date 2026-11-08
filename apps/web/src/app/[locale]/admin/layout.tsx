import { getTranslations, setRequestLocale } from "next-intl/server";
import { PortalShell } from "@/components/shell/portal-shell";
import { Alert, buttonVariants } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireAdminCtx } from "@/lib/ctx";
import { adminNav } from "@/lib/nav";

export default async function AdminLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const mfaOk = ctx.mfaEnabled || (process.env.APP_ENV === "development" && process.env.ADMIN_MFA_OPTIONAL === "true");
  return (
    <PortalShell ctx={ctx} portalLabel={t("nav.admin")} nav={adminNav()}>
      {mfaOk ? (
        children
      ) : (
        <Alert tone="warning" title={t("admin.mfaRequiredTitle")}>
          <p>{t("admin.mfaRequiredBody")}</p>
          <Link href="/account/security" className={buttonVariants({ size: "sm", className: "mt-3" })}>
            {t("account.enable2fa")}
          </Link>
        </Alert>
      )}
    </PortalShell>
  );
}
