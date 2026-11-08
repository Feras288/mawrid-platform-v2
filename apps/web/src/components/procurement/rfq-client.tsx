"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import {
  addRfqItemAction,
  cancelRfqAction,
  closeSubmissionsAction,
  createRfqAction,
  endRevisionAction,
  removeRfqItemAction,
  requestRevisionAction,
  resendRecipientAction,
  rfqAttachmentAction,
  sendRfqAction,
  setRecipientsAction,
  submitRfqAction,
  updateRfqAction,
  withdrawRfqAction,
} from "@/app/actions/rfq";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Label, Select } from "@/components/ui/primitives";

type Opt = { value: string; label: string };
const localDt = (d: Date | null | undefined) => (d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function NewRfqDialog({ projects, versions, cities }: { projects: Opt[]; versions: (Opt & { projectId: string | null })[]; cities: Opt[] }) {
  const t = useTranslations();
  const [mode, setMode] = React.useState<"boq" | "manual">(versions.length ? "boq" : "manual");
  return (
    <Modal wide title={t("rfq.new")} trigger={<Button>{t("rfq.new")}</Button>}>
      <ActionForm action={createRfqAction} successMessage={t("rfq.created")} redirectTo={(r: { id: string }) => `/org/rfqs/${r.id}`}>
        <FormError />
        <Field name="title" required label={t("rfq.name")} />
        <div className="flex gap-4" role="radiogroup">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === "boq"} onChange={() => setMode("boq")} disabled={!versions.length} className="accent-primary-700" />
            {t("rfq.fromBoq")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" checked={mode === "manual"} onChange={() => setMode("manual")} className="accent-primary-700" />
            {t("rfq.manualLines")}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "boq" ? <Field as="select" name="boqVersionId" required label={t("rfq.fromBoq")} placeholder={t("common.select")} options={versions} className="sm:col-span-2" /> : <Field as="select" name="projectId" label={t("boq.project")} placeholder={t("projects.none")} options={projects} className="sm:col-span-2" />}
          <Field name="closesAt" type="datetime-local" required label={t("rfq.closesAt")} dir="ltr" />
          <Field name="requiredBy" type="date" label={t("rfq.requiredBy")} dir="ltr" />
          <Field as="select" name="deliveryCity" label={t("rfq.deliveryCity")} placeholder="—" options={cities} />
          <Field name="deliveryAddress" label={t("rfq.deliveryAddress")} />
          <Field as="textarea" name="paymentTerms" label={t("rfq.paymentTerms")} />
          <Field as="textarea" name="deliveryTerms" label={t("rfq.deliveryTerms")} />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox name="allowRevisions" value="1" defaultChecked label={t("rfq.allowRevisions")} />
          <Checkbox name="allowPartialQuotes" value="1" defaultChecked label={t("rfq.allowPartial")} />
          <Checkbox name="allowAlternatives" value="1" defaultChecked label={t("rfq.allowAlternatives")} />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

type Rfq = { id: string; title: string; closesAt: Date | null; requiredBy: Date | null; deliveryCity: string | null; deliveryAddress: string | null; paymentTerms: string | null; deliveryTerms: string | null; allowRevisions: boolean; allowPartialQuotes: boolean; allowAlternatives: boolean };

export function EditRfqDialog({ rfq, cities }: { rfq: Rfq; cities: Opt[] }) {
  const t = useTranslations();
  return (
    <Modal wide title={t("common.edit")} trigger={<Button variant="outline">{t("common.edit")}</Button>}>
      <ActionForm action={updateRfqAction} successMessage={t("common.saved")}>
        <FormError />
        <input type="hidden" name="id" value={rfq.id} />
        <Field name="title" required label={t("rfq.name")} defaultValue={rfq.title} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="closesAt" type="datetime-local" required label={t("rfq.closesAt")} defaultValue={localDt(rfq.closesAt)} dir="ltr" />
          <Field name="requiredBy" type="date" label={t("rfq.requiredBy")} defaultValue={rfq.requiredBy ? new Date(rfq.requiredBy).toISOString().slice(0, 10) : ""} dir="ltr" />
          <Field as="select" name="deliveryCity" label={t("rfq.deliveryCity")} defaultValue={rfq.deliveryCity ?? ""} placeholder="—" options={cities} />
          <Field name="deliveryAddress" label={t("rfq.deliveryAddress")} defaultValue={rfq.deliveryAddress ?? ""} />
          <Field as="textarea" name="paymentTerms" label={t("rfq.paymentTerms")} defaultValue={rfq.paymentTerms ?? ""} />
          <Field as="textarea" name="deliveryTerms" label={t("rfq.deliveryTerms")} defaultValue={rfq.deliveryTerms ?? ""} />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox name="allowRevisions" value="1" defaultChecked={rfq.allowRevisions} label={t("rfq.allowRevisions")} />
          <Checkbox name="allowPartialQuotes" value="1" defaultChecked={rfq.allowPartialQuotes} label={t("rfq.allowPartial")} />
          <Checkbox name="allowAlternatives" value="1" defaultChecked={rfq.allowAlternatives} label={t("rfq.allowAlternatives")} />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function AddRfqLineDialog({ rfqId, units, categories }: { rfqId: string; units: Opt[]; categories: Opt[] }) {
  const t = useTranslations();
  return (
    <Modal title={t("boq.addLine")} trigger={<Button variant="outline">{t("boq.addLine")}</Button>}>
      <ActionForm action={addRfqItemAction} successMessage={t("rfq.lineAdded")} resetOnSuccess>
        <FormError />
        <input type="hidden" name="rfqId" value={rfqId} />
        <Field as="textarea" name="description" required label={t("boq.description")} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="quantity" required inputMode="decimal" label={t("boq.quantity")} dir="ltr" />
          <Field as="select" name="unit" required label={t("boq.unit")} placeholder={t("common.select")} options={units} />
          <Field as="select" name="categoryId" label={t("boq.category")} placeholder="—" options={categories} />
        </div>
        <Field name="notes" label={t("common.notes")} />
        <div className="flex justify-end">
          <SubmitButton>{t("common.add")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function RemoveLineButton({ id }: { id: string }) {
  const t = useTranslations("common");
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" action={() => removeRfqItemAction(id)} confirm={`${t("remove")}?`}>
      {t("remove")}
    </ActionButton>
  );
}

export function RecipientsCard({ rfqId, editable, current, suggestions, all }: { rfqId: string; editable: boolean; current: string[]; suggestions: { orgId: string; label: string; score: number; reasons: string[] }[]; all: Opt[] }) {
  const t = useTranslations();
  const [filter, setFilter] = React.useState("");
  const sugIds = new Set(suggestions.map((s) => s.orgId));
  const others = all.filter((a) => !sugIds.has(a.value) && a.label.toLowerCase().includes(filter.toLowerCase()));
  if (!editable) return null;
  return (
    <Card>
      <CardHeader title={t("rfq.recipients")} description={t("rfq.suggestionsHint")} />
      <CardBody>
        <ActionForm action={setRecipientsAction} successMessage={t("common.saved")}>
          <FormError />
          <input type="hidden" name="rfqId" value={rfqId} />
          {suggestions.length ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">{t("rfq.suggestions")}</legend>
              <ul className="grid gap-2 md:grid-cols-2">
                {suggestions.map((s) => (
                  <li key={s.orgId} className="rounded-lg border border-sand-200 p-2">
                    <Checkbox name="supplierOrgIds[]" value={s.orgId} defaultChecked={current.includes(s.orgId)} label={<span className="font-medium">{s.label}</span>} />
                    <div className="ms-6 mt-1 flex flex-wrap gap-1">
                      {s.reasons.map((r) => (
                        <Badge key={r} tone="primary">
                          {t(`rfq.reasons.${r as "preferred"}`)}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t("admin.suppliersTitle")}</legend>
            <input className="mb-2 h-9 w-full max-w-xs rounded-lg border border-sand-300 px-3 text-sm" placeholder={t("common.search")} aria-label={t("common.search")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="grid max-h-60 gap-1.5 overflow-y-auto md:grid-cols-3">
              {others.map((o) => (
                <Checkbox key={o.value} name="supplierOrgIds[]" value={o.value} defaultChecked={current.includes(o.value)} label={o.label} />
              ))}
            </div>
          </fieldset>
          <SubmitButton>{t("rfq.addRecipients")}</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function RfqActions({ rfqId, status, canSubmit, canSend, canEvaluate, canCancel, recipients }: { rfqId: string; status: string; canSubmit: boolean; canSend: boolean; canEvaluate: boolean; canCancel: boolean; recipients: Opt[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const key = React.useMemo(newKey, []);
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && canSubmit ? (
        <ActionButton action={() => submitRfqAction(rfqId)} successMessage={t("rfq.submitted")}>
          {t("rfq.submit")}
        </ActionButton>
      ) : null}
      {status === "pending_review" && canSubmit ? (
        <ActionButton variant="outline" action={() => withdrawRfqAction(rfqId)}>
          {t("rfq.withdraw")}
        </ActionButton>
      ) : null}
      {status === "approved_for_sending" && canSend ? (
        <ActionButton variant="accent" action={() => sendRfqAction(rfqId, key)} successMessage={t("rfq.sent")}>
          {t("rfq.send")}
        </ActionButton>
      ) : null}
      {["open", "partially_responded"].includes(status) && canEvaluate ? (
        <ActionButton variant="outline" action={() => closeSubmissionsAction(rfqId)} confirm={t("rfq.closeSubmissions") + "?"}>
          {t("rfq.closeSubmissions")}
        </ActionButton>
      ) : null}
      {status === "under_evaluation" && canEvaluate ? (
        <Modal title={t("rfq.requestRevision")} trigger={<Button variant="outline">{t("rfq.requestRevision")}</Button>}>
          <ActionForm action={requestRevisionAction} successMessage={t("common.saved")}>
            <FormError />
            <input type="hidden" name="rfqId" value={rfqId} />
            <fieldset className="grid gap-1.5">
              {recipients.map((r) => (
                <Checkbox key={r.value} name="supplierOrgIds[]" value={r.value} label={r.label} />
              ))}
            </fieldset>
            <Field name="deadline" type="datetime-local" required label={t("rfq.revisionDeadline")} dir="ltr" />
            <Field as="textarea" name="note" label={t("common.notes")} />
            <SubmitButton>{t("rfq.requestRevision")}</SubmitButton>
          </ActionForm>
        </Modal>
      ) : null}
      {status === "revision_requested" && canEvaluate ? (
        <ActionButton variant="outline" action={() => endRevisionAction(rfqId)}>
          {t("rfq.endRevision")}
        </ActionButton>
      ) : null}
      {!["awarded", "closed", "cancelled"].includes(status) && canCancel ? (
        <Modal title={t("rfq.cancel")} trigger={<Button variant="ghost" className="text-danger-600">{t("rfq.cancel")}</Button>}>
          <ActionForm action={cancelRfqAction} successMessage={t("common.saved")}>
            <FormError />
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field as="textarea" name="reason" required label={t("rfq.cancelReason")} />
            <SubmitButton variant="danger">{t("rfq.cancel")}</SubmitButton>
          </ActionForm>
        </Modal>
      ) : null}
      <span className="sr-only" lang={locale} />
    </div>
  );
}

export function ResendButton({ id }: { id: string }) {
  const t = useTranslations("rfq");
  return (
    <ActionButton size="sm" variant="outline" action={() => resendRecipientAction(id)}>
      {t("resend")}
    </ActionButton>
  );
}

export function RfqAttachmentForm({ rfqId }: { rfqId: string }) {
  const t = useTranslations();
  return (
    <ActionForm action={rfqAttachmentAction} successMessage={t("common.saved")} resetOnSuccess className="flex flex-wrap items-end gap-2 space-y-0">
      <input type="hidden" name="rfqId" value={rfqId} />
      <Field name="file" type="file" required accept=".pdf,.xlsx,.csv,.png,.jpg,.jpeg" label={t("rfq.addAttachment")} />
      <SubmitButton size="sm" variant="outline">
        {t("common.upload")}
      </SubmitButton>
    </ActionForm>
  );
}

export function SelectFilter({ name, options, value, label }: { name: string; options: Opt[]; value: string; label: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Select id={`f-${name}`} name={name} defaultValue={value}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
