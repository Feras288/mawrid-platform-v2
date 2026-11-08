"use client";

import { useTranslations } from "next-intl";
import { createAlertAction, deleteAlertAction } from "@/app/actions/analytics";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";

export function AlertDialog({ subjectType, subjectId, kinds }: { subjectType: string; subjectId: string; kinds: string[] }) {
  const t = useTranslations("priceIndex");
  return (
    <Modal title={t("newAlert")} trigger={<Button variant="outline">{t("newAlert")}</Button>}>
      <ActionForm action={createAlertAction} successMessage={t("alertCreated")}>
        <FormError />
        <input type="hidden" name="subjectType" value={subjectType} />
        <input type="hidden" name="subjectId" value={subjectId} />
        <Field as="select" name="kind" required label={t("kind")} options={kinds.map((k) => ({ value: k, label: t(`kinds.${k as "po"}`) }))} />
        <Field name="thresholdPct" type="number" min={1} max={100} required defaultValue="10" label={t("threshold")} dir="ltr" />
        <Field as="select" name="direction" label={t("direction")} options={(["any", "up", "down"] as const).map((d) => ({ value: d, label: t(`directions.${d}`) }))} />
        <SubmitButton>{t("newAlert")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function DeleteAlertButton({ id }: { id: string }) {
  const t = useTranslations("priceIndex");
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" action={() => deleteAlertAction(id)}>
      {t("delete")}
    </ActionButton>
  );
}
