"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { decideAction, savePolicyAction } from "@/app/actions/rfq";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Checkbox, Input, Select } from "@/components/ui/primitives";

export function DecisionForm({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals");
  return (
    <ActionForm action={decideAction} successMessage={t("decided")}>
      <FormError />
      <input type="hidden" name="requestId" value={requestId} />
      <Field as="textarea" name="comment" label={t("comment")} />
      <div className="flex gap-2">
        <SubmitButton variant="primary" name="decision" value="approve">
          {t("approve")}
        </SubmitButton>
        <SubmitButton variant="danger" name="decision" value="reject">
          {t("reject")}
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-500">{t("aiNote")}</p>
    </ActionForm>
  );
}

type Step = { stepOrder: number; name: string; requiredRoleKey: string | null; minApprovals: number };
type Policy = { id: string; name: string; operation: string; projectId: string | null; minAmount: string | null; maxAmount: string | null; priority: number; distinctApprovers: boolean; isActive: boolean; steps: Step[] };

export function PolicyDialog({ policy, roles, projects }: { policy?: Policy; roles: { value: string; label: string }[]; projects: { value: string; label: string }[] }) {
  const t = useTranslations();
  const [steps, setSteps] = React.useState<Step[]>(policy?.steps.length ? policy.steps : [{ stepOrder: 1, name: "", requiredRoleKey: null, minApprovals: 1 }]);
  return (
    <Modal wide title={policy ? t("common.edit") : t("policies.new")} trigger={policy ? <Button size="sm" variant="outline">{t("common.edit")}</Button> : <Button>{t("policies.new")}</Button>}>
      <ActionForm action={savePolicyAction} successMessage={t("common.saved")}>
        <FormError />
        {policy ? <input type="hidden" name="id" value={policy.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" required label={t("policies.name")} defaultValue={policy?.name} />
          <Field as="select" name="operation" required label={t("policies.operation")} defaultValue={policy?.operation ?? "award"} options={(["rfq_send", "award", "po_issue"] as const).map((o) => ({ value: o, label: t(`approvals.ops.${o}`) }))} />
          <Field as="select" name="projectId" label={t("policies.project")} defaultValue={policy?.projectId ?? ""} placeholder="—" options={projects} />
          <Field name="priority" type="number" min={0} max={1000} label={t("policies.priority")} defaultValue={policy?.priority ?? 0} dir="ltr" />
          <Field name="minAmount" inputMode="decimal" label={t("policies.minAmount")} defaultValue={policy?.minAmount ?? ""} dir="ltr" />
          <Field name="maxAmount" inputMode="decimal" label={t("policies.maxAmount")} defaultValue={policy?.maxAmount ?? ""} dir="ltr" />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox name="distinctApprovers" value="1" defaultChecked={policy?.distinctApprovers ?? true} label={t("policies.distinct")} />
          <Checkbox name="isActive" value="1" defaultChecked={policy?.isActive ?? true} label={t("policies.active")} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("policies.steps")}</legend>
          <p className="text-xs text-ink-500">{t("policies.parallelHint")}</p>
          {steps.map((s, i) => (
            <div key={i} className="grid grid-cols-[4rem_1fr_1fr_5rem_auto] items-center gap-2">
              <Input name="stepOrder[]" aria-label={t("policies.stepOrder")} type="number" min={1} max={20} value={s.stepOrder} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, stepOrder: Number(e.target.value) } : x)))} dir="ltr" />
              <Input name="stepName[]" aria-label={t("policies.stepName")} placeholder={t("policies.stepName")} value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} required />
              <Select name="stepRole[]" aria-label={t("policies.role")} value={s.requiredRoleKey ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, requiredRoleKey: e.target.value || null } : x)))}>
                <option value="">{t("policies.anyRole")}</option>
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <Input name="stepMin[]" aria-label={t("policies.minApprovals")} type="number" min={1} max={10} value={s.minApprovals} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, minApprovals: Number(e.target.value) } : x)))} dir="ltr" />
              <Button variant="ghost" size="icon" aria-label={t("common.remove")} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setSteps([...steps, { stepOrder: (steps.at(-1)?.stepOrder ?? 0) + 1, name: "", requiredRoleKey: null, minApprovals: 1 }])}>
            <Plus />
            {t("policies.addStep")}
          </Button>
        </fieldset>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}
