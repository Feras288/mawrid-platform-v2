"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { adminDocumentUrlAction, decideSupplierAction, reviewDocumentAction, startReviewAction } from "@/app/actions/admin";
import { ActionButton, ActionForm, Field, FormError, SubmitButton, useErrorMessage } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";

export function StartReviewButton({ orgId }: { orgId: string }) {
  const t = useTranslations("admin");
  return (
    <ActionButton className="w-full" action={() => startReviewAction(orgId)}>
      {t("startReview")}
    </ActionButton>
  );
}

const OPTIONS: Record<string, string[]> = {
  under_review: ["approved", "rejected", "pending_verification"],
  approved: ["suspended"],
  suspended: ["approved", "rejected"],
};

export function DecisionForm({ orgId, status }: { orgId: string; status: string }) {
  const t = useTranslations();
  const opts = OPTIONS[status] ?? [];
  if (!opts.length) return <p className="text-sm text-ink-500">{t(`supplier.statusHint.${status as "new"}`)}</p>;
  const label: Record<string, string> = { approved: status === "suspended" ? t("admin.reinstate") : t("admin.approve"), rejected: t("admin.reject"), suspended: t("admin.suspend"), pending_verification: t("admin.returnForInfo") };
  return (
    <ActionForm action={decideSupplierAction} successMessage={t("admin.decided")}>
      <FormError />
      <input type="hidden" name="orgId" value={orgId} />
      <Field as="select" name="decision" required label={t("admin.decision")} options={opts.map((o) => ({ value: o, label: label[o]! }))} />
      <Field as="textarea" name="reason" label={t("common.reason")} hint={t("admin.reasonRequired")} />
      <SubmitButton className="w-full">{t("common.save")}</SubmitButton>
    </ActionForm>
  );
}

export function DocumentReview({ docId, fileId, status }: { docId: string; fileId: string; status: string }) {
  const t = useTranslations();
  const errMsg = useErrorMessage();
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await adminDocumentUrlAction(fileId);
            if (r.ok) window.open(r.data, "_blank", "noopener,noreferrer");
            else toast.error(errMsg(r.error));
          })
        }
      >
        {t("admin.viewFile")}
      </Button>
      {status === "uploaded" ? (
        <>
          <ActionButton size="sm" variant="secondary" action={() => { const fd = new FormData(); fd.set("docId", docId); fd.set("status", "verified"); return reviewDocumentAction(fd); }}>
            {t("admin.verify")}
          </ActionButton>
          <Modal title={t("admin.rejectDoc")} trigger={<Button size="sm" variant="ghost" className="text-danger-600">{t("admin.reject")}</Button>}>
            <ActionForm action={reviewDocumentAction} successMessage={t("admin.decided")}>
              <FormError />
              <input type="hidden" name="docId" value={docId} />
              <input type="hidden" name="status" value="rejected" />
              <Field as="textarea" name="note" required label={t("supplier.docNote")} />
              <SubmitButton variant="danger">{t("admin.rejectDoc")}</SubmitButton>
            </ActionForm>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
