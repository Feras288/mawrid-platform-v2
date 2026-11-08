import { getTranslations, setRequestLocale } from "next-intl/server";
import { getInvitationByToken } from "@platform/modules/organizations";
import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInviteButton } from "@/components/account/accept-invite";
import { Alert, buttonVariants } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getCtx } from "@/lib/ctx";
import { Brand } from "@/components/shell/portal-shell";

export default async function InvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("members");
  const tn = await getTranslations("nav");
  const inv = await getInvitationByToken(token);
  const ctx = await getCtx();
  const valid = inv && inv.status === "pending" && inv.expiresAt > new Date();
  return (
    <div className="min-h-dvh bg-gradient-to-b from-primary-50 to-sand-50 px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <Brand />
        <AuthCard title={t("inviteTitle")}>
          {!valid ? (
            <Alert tone="danger">{t("inviteInvalid")}</Alert>
          ) : (
            <div className="space-y-4">
              <p className="text-ink-700">{t("inviteBody", { org: locale === "ar" ? inv.orgNameAr : inv.orgNameEn })}</p>
              {ctx.userId ? (
                <AcceptInviteButton token={token} label={t("acceptInvite")} done={t("inviteAccepted")} />
              ) : (
                <>
                  <p className="text-sm text-ink-500">{t("loginToAccept", { email: inv.email })}</p>
                  <div className="flex gap-2">
                    <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonVariants()}>{tn("login")}</Link>
                    <Link href="/register" className={buttonVariants({ variant: "outline" })}>{tn("register")}</Link>
                  </div>
                </>
              )}
            </div>
          )}
        </AuthCard>
      </div>
    </div>
  );
}
