"use client";

import { useTranslations } from "next-intl";
import { acknowledgePoAction, cancelPoAction, completePoAction, delayAction, receiptAction, shipmentAction, submitPoAction, updatePoAction } from "@/app/actions/rfq";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Input, Table, Td, Th } from "@/components/ui/primitives";

type Line = { id: string; lineNo: number; description: string; quantity: string; unit: string; shippedQty: string; receivedQty: string; rejectedQty: string };
const n = (v: string) => Number(v);

export function PoDraftActions({ po }: { po: { id: string; notes: string | null; paymentTerms: string | null; deliveryTerms: string | null; deliveryAddress: string | null; expectedDeliveryAt: Date | null } }) {
  const t = useTranslations();
  return (
    <>
      <Modal wide title={t("po.edit")} trigger={<Button variant="outline">{t("po.edit")}</Button>}>
        <ActionForm action={updatePoAction} successMessage={t("po.saved")}>
          <FormError />
          <input type="hidden" name="poId" value={po.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field as="textarea" name="paymentTerms" label={t("rfq.paymentTerms")} defaultValue={po.paymentTerms ?? ""} />
            <Field as="textarea" name="deliveryTerms" label={t("rfq.deliveryTerms")} defaultValue={po.deliveryTerms ?? ""} />
            <Field name="deliveryAddress" label={t("rfq.deliveryAddress")} defaultValue={po.deliveryAddress ?? ""} />
            <Field name="expectedDeliveryAt" type="date" label={t("po.expected")} defaultValue={po.expectedDeliveryAt ? new Date(po.expectedDeliveryAt).toISOString().slice(0, 10) : ""} dir="ltr" />
          </div>
          <Field as="textarea" name="notes" label={t("common.notes")} defaultValue={po.notes ?? ""} />
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ActionForm>
      </Modal>
      <ActionButton action={() => submitPoAction(po.id)} successMessage={t("po.saved")}>
        {t("po.submit")}
      </ActionButton>
    </>
  );
}

export function CancelPoDialog({ poId }: { poId: string }) {
  const t = useTranslations();
  return (
    <Modal title={t("po.cancel")} trigger={<Button variant="ghost" className="text-danger-600">{t("po.cancel")}</Button>}>
      <ActionForm action={cancelPoAction} successMessage={t("po.saved")}>
        <FormError />
        <input type="hidden" name="poId" value={poId} />
        <Field as="textarea" name="reason" required label={t("common.reason")} />
        <SubmitButton variant="danger">{t("po.cancel")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function ReceiptDialog({ poId, lines }: { poId: string; lines: Line[] }) {
  const t = useTranslations();
  const open = lines.filter((l) => n(l.shippedQty) > n(l.receivedQty) + n(l.rejectedQty));
  return (
    <Modal wide title={t("po.receive")} trigger={<Button disabled={!open.length}>{t("po.receive")}</Button>}>
      <ActionForm action={receiptAction} successMessage={t("po.saved")}>
        <FormError />
        <input type="hidden" name="poId" value={poId} />
        <Table caption={t("po.receive")}>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>{t("boq.description")}</Th>
              <Th>{t("po.shipped")}</Th>
              <Th>{t("po.received")}</Th>
              <Th>{t("po.rejectedQty")}</Th>
            </tr>
          </thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.id}>
                <Td>{l.lineNo}</Td>
                <Td className="max-w-xs">{l.description}</Td>
                <Td dir="ltr">{n(l.shippedQty) - n(l.receivedQty) - n(l.rejectedQty)}</Td>
                <Td>
                  <input type="hidden" name="poItemId[]" value={l.id} />
                  <Input name="received[]" aria-label={`${t("po.received")} ${l.lineNo}`} inputMode="decimal" defaultValue={String(n(l.shippedQty) - n(l.receivedQty) - n(l.rejectedQty))} className="w-24" dir="ltr" />
                </Td>
                <Td>
                  <Input name="rejected[]" aria-label={`${t("po.rejectedQty")} ${l.lineNo}`} inputMode="decimal" defaultValue="0" className="w-20" dir="ltr" />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Field as="textarea" name="notes" label={t("common.notes")} />
        <SubmitButton>{t("po.receive")}</SubmitButton>
      </ActionForm>
    </Modal>
  );
}

export function CompletePoButton({ poId }: { poId: string }) {
  const t = useTranslations("po");
  return (
    <ActionButton variant="accent" action={() => completePoAction(poId)}>
      {t("complete")}
    </ActionButton>
  );
}

export function SupplierPoActions({ poId, acknowledged, lines, closed }: { poId: string; acknowledged: boolean; lines: Line[]; closed: boolean }) {
  const t = useTranslations();
  const remaining = lines.filter((l) => n(l.quantity) > n(l.shippedQty));
  if (closed) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {!acknowledged ? (
        <ActionButton action={() => acknowledgePoAction(poId)} successMessage={t("po.saved")}>
          {t("po.acknowledge")}
        </ActionButton>
      ) : null}
      <Modal wide title={t("po.ship")} trigger={<Button variant="accent" disabled={!remaining.length}>{t("po.ship")}</Button>}>
        <ActionForm action={shipmentAction} successMessage={t("po.saved")}>
          <FormError />
          <input type="hidden" name="poId" value={poId} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="carrier" label={t("po.carrier")} />
            <Field name="trackingNumber" label={t("po.tracking")} dir="ltr" />
            <Field name="expectedAt" type="date" label={t("po.expected")} dir="ltr" />
          </div>
          <Table caption={t("po.ship")}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t("boq.description")}</Th>
                <Th>{t("po.ordered")}</Th>
                <Th>{t("po.shipped")}</Th>
                <Th>{t("common.quantity")}</Th>
              </tr>
            </thead>
            <tbody>
              {remaining.map((l) => (
                <tr key={l.id}>
                  <Td>{l.lineNo}</Td>
                  <Td className="max-w-xs">{l.description}</Td>
                  <Td dir="ltr">
                    {n(l.quantity)} {l.unit}
                  </Td>
                  <Td dir="ltr">{n(l.shippedQty)}</Td>
                  <Td>
                    <input type="hidden" name="poItemId[]" value={l.id} />
                    <Input name="quantity[]" aria-label={`${t("common.quantity")} ${l.lineNo}`} inputMode="decimal" defaultValue={String(n(l.quantity) - n(l.shippedQty))} className="w-24" dir="ltr" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Field as="textarea" name="notes" label={t("common.notes")} />
          <SubmitButton variant="accent">{t("po.ship")}</SubmitButton>
        </ActionForm>
      </Modal>
      <Modal title={t("po.reportDelay")} trigger={<Button variant="outline">{t("po.reportDelay")}</Button>}>
        <ActionForm action={delayAction} successMessage={t("po.saved")}>
          <FormError />
          <input type="hidden" name="poId" value={poId} />
          <Field as="textarea" name="reason" required label={t("po.delayReason")} />
          <Field name="newExpectedAt" type="date" required label={t("po.newDate")} dir="ltr" />
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ActionForm>
      </Modal>
    </div>
  );
}
