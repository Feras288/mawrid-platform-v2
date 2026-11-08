"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { createPosAction, selectAwardAction, setEvaluationAction, submitAwardAction } from "@/app/actions/rfq";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Badge, Button, Select } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function TechnicalSelect({ rfqId, rfqItemId, supplierOrgId, value, disabled }: { rfqId: string; rfqItemId: string; supplierOrgId: string; value: string; disabled?: boolean }) {
  const t = useTranslations("compare");
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Select
      aria-label={t("technical")}
      className="h-8 text-xs"
      defaultValue={value}
      disabled={disabled || pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("rfqId", rfqId);
        fd.set("rfqItemId", rfqItemId);
        fd.set("supplierOrgId", supplierOrgId);
        fd.set("technicalStatus", e.target.value);
        start(async () => {
          await setEvaluationAction(fd);
          router.refresh();
        });
      }}
    >
      {(["not_evaluated", "compliant", "clarification", "non_compliant"] as const).map((s) => (
        <option key={s} value={s}>
          {t(`tech.${s}`)}
        </option>
      ))}
    </Select>
  );
}

export function AwardLineForm({ rfqId, rfqItemId, options, current, reason, disabled }: { rfqId: string; rfqItemId: string; options: { value: string; label: string }[]; current: string | null; reason: string | null; disabled: boolean }) {
  const t = useTranslations("compare");
  return (
    <ActionForm action={selectAwardAction} successMessage={t("saveAward")} className="flex flex-col gap-1 space-y-0">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="rfqItemId" value={rfqItemId} />
      <Select name="supplierOrgId" aria-label={t("awardTo")} defaultValue={current ?? ""} disabled={disabled} className="h-8 text-xs">
        <option value="">{t("noAward")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <input name="reason" aria-label={t("reason")} placeholder={t("reason")} defaultValue={reason ?? ""} disabled={disabled} className="h-8 rounded-lg border border-sand-300 px-2 text-xs" />
      <SubmitButton size="sm" variant="outline" disabled={disabled}>
        {t("saveAward")}
      </SubmitButton>
    </ActionForm>
  );
}

export function SubmitAwardDialog({ rfqId, total }: { rfqId: string; total: string }) {
  const t = useTranslations();
  return (
    <Modal title={t("compare.submitAward")} description={`${t("compare.awardedTotal")}: ${total}`} trigger={<Button variant="accent">{t("compare.submitAward")}</Button>}>
      <ActionForm action={submitAwardAction} successMessage={t("common.saved")}>
        <FormError />
        <input type="hidden" name="rfqId" value={rfqId} />
        <Field as="textarea" name="notes" label={t("common.notes")} />
        <SubmitButton variant="accent">{t("compare.submitAward")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function CreatePosButton({ rfqId }: { rfqId: string }) {
  const t = useTranslations("compare");
  const key = React.useMemo(newKey, []);
  return (
    <ActionButton variant="accent" action={() => createPosAction(rfqId, key)} successMessage={t("posCreated")} redirectTo="/org/purchase-orders">
      {t("createPos")}
    </ActionButton>
  );
}

export function Flag({ tone, children }: { tone: "success" | "info" | "warning" | "accent" | "danger"; children: React.ReactNode }) {
  return (
    <Badge tone={tone} className="text-[10px]">
      {children}
    </Badge>
  );
}
