import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "@/components/auth/auth-forms";

export default async function CheckEmailPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ email?: string }> }) {
  setRequestLocale((await params).locale);
  const { email = "" } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("checkEmailTitle")}>
      <p className="text-sm text-ink-600">{t("checkEmailBody", { email })}</p>
      <div className="mt-6">
        <ResendVerification email={email} />
      </div>
    </AuthCard>
  );
}
