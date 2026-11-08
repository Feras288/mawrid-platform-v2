import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/auth-forms";

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("auth");
  return (
    <AuthCard title={t("resetTitle")}>
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}
