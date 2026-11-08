"use client";

import { useTranslations } from "next-intl";
import { updateOrgProfileAction, updateOrgSettingsAction } from "@/app/actions/team";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader, Checkbox } from "@/components/ui/primitives";

const ACTIVITIES = ["contractor", "developer", "operations_maintenance", "consultant", "factory", "trading", "government", "other"] as const;

type Org = {
  nameAr: string;
  nameEn: string;
  activityType: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  vatNumber: string | null;
  crNumber: string | null;
  addressLine: string | null;
  district: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export function OrgProfileForm({ org, canEdit }: { org: Org; canEdit: boolean }) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader title={t("org.profile")} />
      <CardBody>
        <ActionForm action={updateOrgProfileAction} successMessage={t("org.updated")}>
          <FormError />
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
            <Field name="nameAr" label={t("org.nameAr")} defaultValue={org.nameAr} required dir="rtl" />
            <Field name="nameEn" label={t("org.nameEn")} defaultValue={org.nameEn} required dir="ltr" />
            <Field as="select" name="activityType" label={t("org.activityType")} defaultValue={org.activityType ?? ""} placeholder={t("common.select")} options={ACTIVITIES.map((a) => ({ value: a, label: t(`org.activity.${a}`) }))} />
            <Field name="website" type="url" label={t("org.website")} defaultValue={org.website ?? ""} dir="ltr" />
            <Field name="email" type="email" label={t("common.email")} defaultValue={org.email ?? ""} dir="ltr" />
            <Field name="phone" type="tel" label={t("common.phone")} defaultValue={org.phone ?? ""} dir="ltr" />
            <Field name="vatNumber" label={t("org.vatNumber")} hint={t("org.vatHint")} defaultValue={org.vatNumber ?? ""} dir="ltr" inputMode="numeric" />
            <Field name="crNumber" label={t("org.crNumber")} hint={t("org.crHint")} defaultValue={org.crNumber ?? ""} dir="ltr" inputMode="numeric" />
            <Field name="addressLine" label={t("org.addressLine")} defaultValue={org.addressLine ?? ""} />
            <Field name="district" label={t("org.district")} defaultValue={org.district ?? ""} />
            <Field name="city" label={t("common.city")} defaultValue={org.city ?? ""} />
            <Field name="region" label={t("common.region")} defaultValue={org.region ?? ""} />
            <Field name="postalCode" label={t("org.postalCode")} defaultValue={org.postalCode ?? ""} dir="ltr" inputMode="numeric" />
          </fieldset>
          {canEdit ? (
            <div className="flex justify-end">
              <SubmitButton>{t("common.save")}</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function OrgSettingsForm({ settings, canEdit }: { settings: Record<string, unknown>; canEdit: boolean }) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader title={t("org.dataPolicy")} />
      <CardBody>
        <ActionForm action={updateOrgSettingsAction} successMessage={t("common.saved")}>
          <FormError />
          <fieldset disabled={!canEdit} className="space-y-4">
            <div>
              <Checkbox name="allowExternalAI" value="1" defaultChecked={Boolean(settings.allowExternalAI)} label={t("org.allowExternalAI")} />
              <p className="ms-6 mt-1 text-xs text-ink-500">{t("org.allowExternalAIHint")}</p>
            </div>
            <Field name="aiMonthlyBudgetUsd" label={t("org.aiBudget")} defaultValue={String(settings.aiMonthlyBudgetUsd ?? "50")} inputMode="decimal" dir="ltr" className="max-w-xs" />
            <Checkbox name="requireMfaForApprovers" value="1" defaultChecked={Boolean(settings.requireMfaForApprovers)} label={t("org.requireMfa")} />
            <Checkbox name="rfqAllowRevisionsUntilClose" value="1" defaultChecked={settings.rfqAllowRevisionsUntilClose !== false} label={t("org.rfqRevisions")} />
          </fieldset>
          {canEdit ? (
            <div className="flex justify-end">
              <SubmitButton>{t("common.save")}</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      </CardBody>
    </Card>
  );
}
