"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { declineRfqAction, quotationAttachmentAction, reviseQuotationAction, saveQuotationAction, withdrawQuotationAction } from "@/app/actions/rfq";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Card, CardBody, CardHeader, Input, Table, Td, Th } from "@/components/ui/primitives";

type Line = { id: string; lineNo: number; description: string; quantity: string; unit: string; attributes: Record<string, unknown> };
type QItem = { rfqItemId: string; offered: boolean; unitPrice: string | null; quantity: string | null; discountPct: string; vatRate: string; leadTimeDays: number | null; isAlternative: boolean; alternativeDescription: string | null; brand: string | null; exceptionNote: string | null };
type Quote = { validUntil: Date | null; leadTimeDays: number | null; paymentTerms: string | null; deliveryTerms: string | null; notes: string | null; exceptions: string | null; shippingAmount: string; status: string };

const num = (v: string | null | undefined) => (v ? String(Number(v)) : "");

export function QuotationForm({ rfqId, lines, quote, items, allowAlternatives, editable }: { rfqId: string; lines: Line[]; quote: Quote | null; items: QItem[]; allowAlternatives: boolean; editable: boolean }) {
  const t = useTranslations();
  const byLine = new Map(items.map((i) => [i.rfqItemId, i]));
  const [offered, setOffered] = React.useState<Set<string>>(new Set(items.length ? items.filter((i) => i.offered).map((i) => i.rfqItemId) : lines.map((l) => l.id)));
  const [prices, setPrices] = React.useState<Record<string, { p: string; q: string; d: string }>>(() => Object.fromEntries(lines.map((l) => [l.id, { p: num(byLine.get(l.id)?.unitPrice), q: num(byLine.get(l.id)?.quantity) || num(l.quantity), d: num(byLine.get(l.id)?.discountPct) || "0" }])));
  const net = lines.reduce((acc, l) => {
    if (!offered.has(l.id)) return acc;
    const v = prices[l.id]!;
    return acc + (Number(v.p) || 0) * (Number(v.q) || 0) * (1 - (Number(v.d) || 0) / 100);
  }, 0);
  return (
    <ActionForm action={saveQuotationAction} onSuccess={(r) => toast.success(r.submitted ? t("quote.submittedOk") : t("quote.saved"))}>
      <FormError />
      <input type="hidden" name="rfqId" value={rfqId} />
      <fieldset disabled={!editable} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <Field name="validUntil" type="date" required label={t("quote.validUntil")} defaultValue={quote?.validUntil ? new Date(quote.validUntil).toISOString().slice(0, 10) : ""} dir="ltr" />
          <Field name="leadTimeDays" type="number" min={0} max={730} label={t("quote.leadTime")} defaultValue={quote?.leadTimeDays ?? ""} dir="ltr" />
          <Field name="shippingAmount" inputMode="decimal" label={t("quote.shipping")} defaultValue={num(quote?.shippingAmount) || "0"} dir="ltr" />
          <Field name="paymentTerms" label={t("rfq.paymentTerms")} defaultValue={quote?.paymentTerms ?? ""} />
        </div>
        <div className="overflow-x-auto">
          <Table caption={t("rfq.lines")}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t("boq.description")}</Th>
                <Th>{t("quote.requested")}</Th>
                <Th>{t("quote.offered")}</Th>
                <Th>{t("quote.unitPrice")}</Th>
                <Th>{t("quote.qty")}</Th>
                <Th>{t("quote.discount")}</Th>
                <Th>{t("quote.leadTime")}</Th>
                <Th>{t("quote.brand")}</Th>
                {allowAlternatives ? <Th>{t("quote.alternative")}</Th> : null}
                <Th>{t("quote.exception")}</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const it = byLine.get(l.id);
                const on = offered.has(l.id);
                return (
                  <tr key={l.id} className={on ? undefined : "opacity-60"}>
                    <Td dir="ltr">{l.lineNo}</Td>
                    <Td className="min-w-48 max-w-sm">
                      {l.description}
                      <input type="hidden" name="rfqItemId[]" value={l.id} />
                      <input type="hidden" name="vatRate[]" value={it?.vatRate ?? "0.15"} />
                    </Td>
                    <Td dir="ltr" className="whitespace-nowrap">
                      {Number(l.quantity)} {l.unit}
                    </Td>
                    <Td>
                      <input
                        type="checkbox"
                        name="offered[]"
                        value={l.id}
                        aria-label={`${t("quote.offered")} ${l.lineNo}`}
                        checked={on}
                        onChange={() => setOffered((s) => {
                          const n = new Set(s);
                          if (n.has(l.id)) n.delete(l.id);
                          else n.add(l.id);
                          return n;
                        })}
                        className="size-4 accent-primary-700"
                      />
                    </Td>
                    <Td>
                      <Input name="unitPrice[]" aria-label={`${t("quote.unitPrice")} ${l.lineNo}`} inputMode="decimal" className="w-24" dir="ltr" value={prices[l.id]!.p} onChange={(e) => setPrices({ ...prices, [l.id]: { ...prices[l.id]!, p: e.target.value } })} />
                    </Td>
                    <Td>
                      <Input name="quantity[]" aria-label={`${t("quote.qty")} ${l.lineNo}`} inputMode="decimal" className="w-24" dir="ltr" value={prices[l.id]!.q} onChange={(e) => setPrices({ ...prices, [l.id]: { ...prices[l.id]!, q: e.target.value } })} />
                    </Td>
                    <Td>
                      <Input name="discountPct[]" aria-label={`${t("quote.discount")} ${l.lineNo}`} inputMode="decimal" className="w-16" dir="ltr" value={prices[l.id]!.d} onChange={(e) => setPrices({ ...prices, [l.id]: { ...prices[l.id]!, d: e.target.value } })} />
                    </Td>
                    <Td>
                      <Input name="lineLeadTime[]" aria-label={`${t("quote.leadTime")} ${l.lineNo}`} inputMode="numeric" className="w-16" dir="ltr" defaultValue={it?.leadTimeDays ?? ""} />
                    </Td>
                    <Td>
                      <Input name="brand[]" aria-label={`${t("quote.brand")} ${l.lineNo}`} className="w-28" defaultValue={it?.brand ?? ""} />
                    </Td>
                    {allowAlternatives ? (
                      <Td>
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="isAlternative[]" value={l.id} defaultChecked={it?.isAlternative} className="size-4 accent-primary-700" />
                          {t("quote.alternative")}
                        </label>
                        <Input name="alternativeDescription[]" aria-label={`${t("quote.alternativeDesc")} ${l.lineNo}`} className="mt-1 w-40" defaultValue={it?.alternativeDescription ?? ""} />
                      </Td>
                    ) : (
                      <input type="hidden" name="alternativeDescription[]" value="" />
                    )}
                    <Td>
                      <Input name="exceptionNote[]" aria-label={`${t("quote.exception")} ${l.lineNo}`} className="w-40" defaultValue={it?.exceptionNote ?? ""} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field as="textarea" name="exceptions" label={t("quote.exceptions")} defaultValue={quote?.exceptions ?? ""} />
          <Field as="textarea" name="notes" label={t("quote.notes")} defaultValue={quote?.notes ?? ""} />
        </div>
        <p className="text-sm text-ink-600">
          {t("quote.subtotal")}: <bdi className="font-semibold" dir="ltr">{net.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</bdi> {t("common.sar")}
        </p>
      </fieldset>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant="outline" name="intent" value="save">
            {t("quote.saveDraft")}
          </SubmitButton>
          <SubmitButton variant="accent" name="intent" value="submit">
            {t("quote.submit")}
          </SubmitButton>
        </div>
      ) : null}
    </ActionForm>
  );
}

export function QuoteSecondaryActions({ rfqId, status, canRevise, canDecline }: { rfqId: string; status: string | null; canRevise: boolean; canDecline: boolean }) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap gap-2">
      {status === "submitted" && canRevise ? (
        <ActionButton variant="outline" action={() => reviseQuotationAction(rfqId)}>
          {t("quote.revise")}
        </ActionButton>
      ) : null}
      {status === "submitted" ? (
        <ActionButton variant="ghost" className="text-danger-600" confirm={t("quote.withdraw") + "?"} action={() => withdrawQuotationAction(rfqId)}>
          {t("quote.withdraw")}
        </ActionButton>
      ) : null}
      {canDecline ? (
        <Modal title={t("quote.decline")} trigger={<Button variant="ghost">{t("quote.decline")}</Button>}>
          <ActionForm action={declineRfqAction} successMessage={t("common.saved")}>
            <FormError />
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field as="textarea" name="reason" required label={t("quote.declineReason")} />
            <SubmitButton>{t("quote.decline")}</SubmitButton>
          </ActionForm>
        </Modal>
      ) : null}
    </div>
  );
}

export function QuoteAttachments({ rfqId, files, editable }: { rfqId: string; files: { id: string; file_id: string; original_name: string }[]; editable: boolean }) {
  const t = useTranslations();
  return (
    <Card>
      <CardHeader title={t("rfq.attachments")} />
      <CardBody className="space-y-3">
        <ul className="space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.id}>
              <a className="text-primary-700 hover:underline" href={`/api/v1/files/${f.file_id}`}>
                {f.original_name}
              </a>
            </li>
          ))}
        </ul>
        {editable ? (
          <ActionForm action={quotationAttachmentAction} successMessage={t("common.saved")} resetOnSuccess className="flex flex-wrap items-end gap-2 space-y-0">
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field name="file" type="file" required accept=".pdf,.xlsx,.csv" label={t("rfq.addAttachment")} />
            <SubmitButton size="sm" variant="outline">
              {t("common.upload")}
            </SubmitButton>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
