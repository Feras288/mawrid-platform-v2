import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { TwoFactorForm } from "@/components/auth/auth-forms";

export default async function TwoFactorPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("twoFactorTitle")} subtitle={t("twoFactorSubtitle")}>
      <Suspense>
        <TwoFactorForm />
      </Suspense>
    </AuthCard>
  );
}
