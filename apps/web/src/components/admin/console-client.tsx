"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import {
  breakglassAction,
  confirmTransferAction,
  consentAction,
  decideDeletionAction,
  enterBreakglassAction,
  manualRefundAction,
  orgStatusAction,
  orgTestFlagAction,
  publishContentAction,
  requestDeletionAction,
  requestExportAction,
  retryDeliveryAction,
  revokeBreakglassAction,
  saveDefaultZoneAction,
  saveDraftAction,
  saveSettingAction,
  setFlagAction,
  testIntegrationAction,
  userStatusAction,
} from "@/app/actions/console";
import { ActionButton, ActionForm, Field, FormError, SubmitButton, useErrorMessage } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Checkbox, Input } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";

type Opt = { value: string; label: string };

function ReasonDialog({ title, trigger, action, hidden, danger }: { title: string; trigger: React.ReactNode; action: (fd: FormData) => Promise<never | { ok: boolean }>; hidden: Record<string, string>; danger?: boolean }) {
  const t = useTranslations("adm");
  return (
    <Modal title={title} trigger={trigger}>
      <ActionForm action={action as never} successMessage={t("saved")}>
        <FormError />
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Field as="textarea" name="reason" required label={t("reason")} />
        <SubmitButton variant={danger ? "danger" : "primary"}>{title}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function UserStatusButton({ userId, status }: { userId: string; status: string }) {
  const t = useTranslations("adm");
  if (status === "deleted") return null;
  const next = status === "active" ? "suspended" : "active";
  const label = next === "suspended" ? t("suspend") : t("reactivate");
  return <ReasonDialog title={label} danger={next === "suspended"} trigger={<Button size="sm" variant={next === "suspended" ? "ghost" : "outline"} className={next === "suspended" ? "text-danger-600" : undefined}>{label}</Button>} action={userStatusAction as never} hidden={{ userId, status: next }} />;
}

export function OrgActions({ orgId, status, isTest }: { orgId: string; status: string; isTest: boolean }) {
  const t = useTranslations("adm");
  const next = status === "active" ? "suspended" : "active";
  const label = next === "suspended" ? t("suspend") : t("reactivate");
  return (
    <div className="flex flex-wrap gap-1">
      <ReasonDialog title={label} danger={next === "suspended"} trigger={<Button size="sm" variant="ghost" className={next === "suspended" ? "text-danger-600" : undefined}>{label}</Button>} action={orgStatusAction as never} hidden={{ orgId, status: next }} />
      <ActionButton size="sm" variant="ghost" action={() => orgTestFlagAction(orgId, !isTest)} successMessage={t("saved")}>
        {isTest ? t("unmarkTest") : t("markTest")}
      </ActionButton>
      <Modal title={t("openBreakglass")} description={t("breakglassHint")} trigger={<Button size="sm" variant="ghost">{t("breakglass")}</Button>}>
        <ActionForm action={breakglassAction} successMessage={t("saved")}>
          <FormError />
          <input type="hidden" name="orgId" value={orgId} />
          <Field as="textarea" name="reason" required minLength={15} label={t("reason")} />
          <Field name="minutes" type="number" min={5} max={240} defaultValue="30" required label={t("minutes")} dir="ltr" />
          <SubmitButton variant="danger">{t("openBreakglass")}</SubmitButton>
        </ActionForm>
      </Modal>
    </div>
  );
}

export function BreakglassRow({ id, orgId, active }: { id: string; orgId: string; active: boolean }) {
  const t = useTranslations("adm");
  const router = useRouter();
  const err = useErrorMessage();
  const [pending, start] = React.useTransition();
  if (!active) return null;
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await enterBreakglassAction(orgId);
            if (r.ok) router.push("/org");
            else toast.error(err(r.error));
          })
        }
      >
        {t("enterOrg")}
      </Button>
      <ActionButton size="sm" variant="ghost" className="text-danger-600" action={() => revokeBreakglassAction(id)}>
        {t("revoke")}
      </ActionButton>
    </div>
  );
}

// ------------------------------------------------------------------------------------- settings

type FieldDef = { name: string; label: string; type?: string; options?: Opt[]; dir?: "ltr"; checkbox?: boolean };

export function SettingForm({ settingKey, title, fields, value, secret }: { settingKey: string; title: string; fields: FieldDef[]; value: Record<string, unknown>; secret?: { label: string; hasSecret: boolean } }) {
  const t = useTranslations("adm");
  const c = useTranslations("common");
  return (
    <ActionForm action={saveSettingAction} successMessage={t("saved")} aria-label={title}>
      <FormError />
      <input type="hidden" name="__key" value={settingKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) =>
          f.checkbox ? (
            <Checkbox key={f.name} name={f.name} value="1" defaultChecked={Boolean(value[f.name])} label={f.label} />
          ) : f.options ? (
            <Field key={f.name} as="select" name={f.name} label={f.label} defaultValue={String(value[f.name] ?? "")} options={f.options} />
          ) : (
            <Field key={f.name} name={f.name} label={f.label} type={f.type} defaultValue={value[f.name] === undefined || value[f.name] === null ? "" : String(value[f.name])} dir={f.dir} />
          ),
        )}
        {secret ? (
          <div className="space-y-1 sm:col-span-2">
            <Field name="__secret" type="password" autoComplete="new-password" label={secret.label} dir="ltr" />
            <p className="text-xs text-ink-500">{secret.hasSecret ? t("secretSet") : t("secretNone")}</p>
            {secret.hasSecret ? <Checkbox name="__clearSecret" value="1" label={t("clearSecret")} /> : null}
          </div>
        ) : null}
      </div>
      <SubmitButton size="sm">{c("save")}</SubmitButton>
    </ActionForm>
  );
}

export function TestIntegration({ kind, withEmail }: { kind: "smtp" | "ai" | "payments"; withEmail?: boolean }) {
  const t = useTranslations("adm");
  const err = useErrorMessage();
  const [to, setTo] = React.useState("");
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {withEmail ? <Input aria-label={t("testSendTo")} placeholder={t("testSendTo")} value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-56" dir="ltr" type="email" /> : null}
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await testIntegrationAction(kind, to || undefined);
            if (r.ok) setResult(r.data);
            else toast.error(err(r.error));
          })
        }
      >
        {t("test")}
      </Button>
      {result ? (
        <span role="status" className={result.ok ? "text-sm text-success-600" : "text-sm text-danger-600"}>
          {result.ok ? t("testOk") : t("testFail")} — <span dir="ltr">{result.detail}</span>
        </span>
      ) : null}
    </div>
  );
}

export function FlagToggle({ flagKey, enabled, locked }: { flagKey: string; enabled: boolean; locked: boolean }) {
  const t = useTranslations("adm");
  return (
    <ActionButton size="sm" variant={enabled ? "outline" : "primary"} action={() => setFlagAction(flagKey, !enabled)} successMessage={t("saved")} aria-label={`${t("toggle")} ${flagKey}`} title={locked ? t("locked") : undefined}>
      {enabled ? t("off") : t("on")}
    </ActionButton>
  );
}

export function RetryDeliveryButton({ id }: { id: string }) {
  const t = useTranslations("adm");
  return (
    <ActionButton size="sm" variant="outline" action={() => retryDeliveryAction(id)} successMessage={t("saved")}>
      {t("retry")}
    </ActionButton>
  );
}

export function ConfirmTransferDialog({ intentId }: { intentId: string }) {
  const t = useTranslations("adm");
  return (
    <Modal title={t("confirm")} trigger={<Button size="sm">{t("confirm")}</Button>}>
      <ActionForm action={confirmTransferAction} successMessage={t("saved")}>
        <FormError />
        <input type="hidden" name="intentId" value={intentId} />
        <Field name="note" required label={t("confirmNote")} />
        <SubmitButton>{t("confirm")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function ManualRefundDialog({ refundId }: { refundId: string }) {
  const t = useTranslations("adm");
  return (
    <Modal title={t("markRefunded")} trigger={<Button size="sm" variant="outline">{t("markRefunded")}</Button>}>
      <ActionForm action={manualRefundAction} successMessage={t("saved")}>
        <FormError />
        <input type="hidden" name="refundId" value={refundId} />
        <Field name="providerRef" label={t("providerRef")} dir="ltr" />
        <SubmitButton>{t("markRefunded")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function ContentDraftDialog({ slugs, initial }: { slugs: Opt[]; initial?: { slug: string; locale: string; title: string; body: string } }) {
  const t = useTranslations("adm");
  return (
    <Modal wide title={t("newDraft")} trigger={<Button size={initial ? "sm" : "md"} variant={initial ? "outline" : "primary"}>{t("newDraft")}</Button>}>
      <ActionForm action={saveDraftAction} successMessage={t("saved")}>
        <FormError />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field as="select" name="slug" required label={t("slug")} options={slugs} defaultValue={initial?.slug} />
          <Field as="select" name="locale" required label="Locale" options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} defaultValue={initial?.locale ?? "ar"} />
        </div>
        <Field name="title" required label={t("title")} defaultValue={initial?.title} />
        <Field as="textarea" name="body" required label={t("body")} defaultValue={initial?.body} rows={14} />
        <SubmitButton>{t("newDraft")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function PublishButton({ id }: { id: string }) {
  const t = useTranslations("adm");
  return (
    <ActionButton size="sm" action={() => publishContentAction(id)} confirm={`${t("publish")}?`} successMessage={t("saved")}>
      {t("publish")}
    </ActionButton>
  );
}

export function DeletionDecision({ requestId }: { requestId: string }) {
  const t = useTranslations("adm");
  return (
    <ActionForm action={decideDeletionAction} successMessage={t("saved")} className="flex flex-wrap items-end gap-2 space-y-0">
      <input type="hidden" name="requestId" value={requestId} />
      <Input name="notes" required minLength={3} aria-label={t("notes")} placeholder={t("notes")} className="h-8 w-56" />
      <SubmitButton size="sm" variant="danger" name="decision" value="approve">
        {t("approveDeletion")}
      </SubmitButton>
      <SubmitButton size="sm" variant="outline" name="decision" value="reject">
        {t("reject")}
      </SubmitButton>
    </ActionForm>
  );
}

export function DefaultZoneForm({ zone, cities, regions }: { zone?: { id: string; name: string; nationwide: boolean; cities: string[]; regions: string[]; isActive: boolean; rates: { method: string; fee: string; freeOver: string | null; etaMinDays: number; etaMaxDays: number }[] }; cities: Opt[]; regions: Opt[] }) {
  const t = useTranslations("shipping");
  const s = useTranslations("store");
  const c = useTranslations("common");
  const [nationwide, setNationwide] = React.useState(zone?.nationwide ?? true);
  return (
    <ActionForm action={saveDefaultZoneAction} successMessage={c("saved")}>
      <FormError />
      {zone ? <input type="hidden" name="id" value={zone.id} /> : null}
      <Field name="name" required label={t("zoneName")} defaultValue={zone?.name ?? ""} />
      <Checkbox name="nationwide" value="1" checked={nationwide} onChange={(e) => setNationwide(e.target.checked)} label={t("nationwide")} />
      {!nationwide ? (
        <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-3">
          {regions.map((r) => (
            <Checkbox key={r.value} name="regions[]" value={r.value} defaultChecked={zone?.regions.includes(r.value)} label={r.label} />
          ))}
          {cities.map((r) => (
            <Checkbox key={r.value} name="cities[]" value={r.value} defaultChecked={zone?.cities.includes(r.value)} label={r.label} />
          ))}
        </div>
      ) : null}
      {(["standard", "express", "pickup"] as const).map((m) => {
        const r = zone?.rates.find((x) => x.method === m);
        return (
          <div key={m} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
            <span className="text-sm sm:pb-2">{s(`methods.${m}`)}</span>
            <input type="hidden" name="method[]" value={m} />
            <Input name="fee[]" aria-label={`${t("fee")} — ${m}`} placeholder={t("fee")} defaultValue={r ? String(Number(r.fee)) : ""} dir="ltr" />
            <Input name="freeOver[]" aria-label={`${t("freeOver")} — ${m}`} placeholder={t("freeOver")} defaultValue={r?.freeOver ? String(Number(r.freeOver)) : ""} dir="ltr" />
            <Input name="etaMin[]" aria-label={`${t("etaMin")} — ${m}`} defaultValue={String(r?.etaMinDays ?? 1)} dir="ltr" />
            <Input name="etaMax[]" aria-label={`${t("etaMax")} — ${m}`} defaultValue={String(r?.etaMaxDays ?? 5)} dir="ltr" />
          </div>
        );
      })}
      {zone ? <Checkbox name="isActive" value="1" defaultChecked={zone.isActive} label={t("active")} /> : null}
      <SubmitButton size="sm">{c("save")}</SubmitButton>
    </ActionForm>
  );
}

// ------------------------------------------------------------------------------------- account privacy

export function ConsentToggle({ kind, granted }: { kind: "marketing" | "external_ai_processing"; granted: boolean }) {
  const t = useTranslations("privacy");
  return (
    <ActionButton size="sm" variant={granted ? "outline" : "primary"} action={() => consentAction(kind, !granted)} successMessage={t("requested")}>
      {granted ? t("withdraw") : t("grant")}
    </ActionButton>
  );
}

export function ExportButton({ disabled }: { disabled: boolean }) {
  const t = useTranslations("privacy");
  return (
    <ActionButton action={() => requestExportAction()} successMessage={t("requested")} disabled={disabled}>
      {t("requestExport")}
    </ActionButton>
  );
}

export function DeletionDialog({ disabled }: { disabled: boolean }) {
  const t = useTranslations("privacy");
  return (
    <Modal title={t("deletion")} description={t("deletionHint")} trigger={<Button variant="ghost" className="text-danger-600" disabled={disabled}>{t("requestDeletion")}</Button>}>
      <ActionForm action={requestDeletionAction} successMessage={t("requested")}>
        <FormError />
        <Field as="textarea" name="reason" label={t("reason")} />
        <SubmitButton variant="danger">{t("requestDeletion")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}
