"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createOrgAction } from "@/app/actions/account";
import { switchOrgAction } from "@/app/actions/session";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlay";

const ACTIVITIES = ["contractor", "developer", "operations_maintenance", "consultant", "factory", "trading", "government", "other"] as const;

export function CreateOrgDialog({ type }: { type: "buyer" | "supplier" }) {
  const t = useTranslations();
  return (
    <Modal
      wide
      title={type === "buyer" ? t("account.createBuyerOrg") : t("account.createSupplierOrg")}
      description={type === "buyer" ? t("org.createBuyerSubtitle") : t("org.createSupplierSubtitle")}
      trigger={<Button variant={type === "buyer" ? "primary" : "accent"}>{type === "buyer" ? t("account.createBuyerOrg") : t("account.createSupplierOrg")}</Button>}
    >
      <ActionForm action={createOrgAction} successMessage={t("org.created")} redirectTo={(d) => (d.type === "supplier" ? "/supplier/profile" : "/org")}>
        <input type="hidden" name="type" value={type} />
        <FormError />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="nameAr" label={t("org.nameAr")} required dir="rtl" />
          <Field name="nameEn" label={t("org.nameEn")} required dir="ltr" />
          <Field as="select" name="activityType" label={t("org.activityType")} placeholder={t("common.select")} options={ACTIVITIES.map((a) => ({ value: a, label: t(`org.activity.${a}`) }))} />
          <Field name="city" label={t("common.city")} />
          <Field name="vatNumber" label={t("org.vatNumber")} hint={t("org.vatHint")} inputMode="numeric" dir="ltr" />
          <Field name="crNumber" label={t("org.crNumber")} hint={t("org.crHint")} inputMode="numeric" dir="ltr" />
          <Field name="email" type="email" label={t("common.email")} dir="ltr" />
          <Field name="phone" type="tel" label={t("common.phone")} dir="ltr" />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function OpenOrgButton({ orgId, type, label }: { orgId: string; type: string; label: string }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await switchOrgAction(orgId);
        router.push(type === "supplier" ? "/supplier" : type === "platform" ? "/admin" : "/org");
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
