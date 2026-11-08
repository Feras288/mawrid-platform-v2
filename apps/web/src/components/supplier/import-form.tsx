"use client";

import { useTranslations } from "next-intl";
import { startImportAction } from "@/app/actions/supplier";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";

export function ImportUploadForm() {
  const t = useTranslations();
  return (
    <ActionForm action={startImportAction} successMessage={t("imports.started")} redirectTo={(d: { id: string }) => `/supplier/imports/${d.id}`} className="flex flex-wrap items-end gap-3 space-y-0">
      <FormError />
      <Field name="file" type="file" required accept=".csv,.xlsx" label={t("supplier.file")} className="min-w-64" />
      <SubmitButton>{t("common.upload")}</SubmitButton>
    </ActionForm>
  );
}
