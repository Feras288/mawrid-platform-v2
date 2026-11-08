import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotForm } from "@/components/auth/auth-forms";
import { Link } from "@/i18n/navigation";

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("forgotTitle")} subtitle={t("forgotSubtitle")} footer={<Link href="/login" className="text-primary-700 hover:underline">{t("loginTitle")}</Link>}>
      <ForgotForm />
    </AuthCard>
  );
}
