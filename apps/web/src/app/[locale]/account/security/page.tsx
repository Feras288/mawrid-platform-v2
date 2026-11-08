import { getTranslations } from "next-intl/server";
import { getMe } from "@platform/modules/identity";
import { updateProfileAction } from "@/app/actions/account";
import { ChangePasswordCard, SessionsCard, TwoFactorCard } from "@/components/account/security-panel";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";

export default async function SecurityPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const me = await getMe(ctx);
  return (
    <>
      <PageHeader title={t("account.security")} />
      <div className="grid gap-6">
        <Card>
          <CardHeader title={t("account.profile")} description={me?.email} />
          <CardBody>
            <ActionForm action={updateProfileAction} successMessage={t("common.saved")} className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <FormError />
              <Field name="name" label={t("auth.name")} defaultValue={me?.name ?? ""} required />
              <Field name="phone" type="tel" label={t("common.phone")} defaultValue={me?.phone ?? ""} dir="ltr" />
              <Field as="select" name="locale" label={t("account.preferredLanguage")} defaultValue={me?.locale ?? "ar"} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
              <div className="flex items-end sm:col-span-2">
                <SubmitButton>{t("common.save")}</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <TwoFactorCard enabled={Boolean(me?.twoFactorEnabled)} />
        <ChangePasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}
