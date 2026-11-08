"use server";

import { z } from "zod";
import { decide, savePolicy } from "@platform/modules/approvals";
import { awardHash, selectAward, setEvaluation, submitAward } from "@platform/modules/evaluation";
import { acknowledgePo, cancelPo, completePo, createFromAward, createShipment, recordReceipt, reportDelay, submitPo, updatePoDraft } from "@platform/modules/purchase-orders";
import { addQuotationAttachment, reviseQuotation, saveQuotation, submitQuotation, withdrawQuotation } from "@platform/modules/quotations";
import {
  addRfqAttachment,
  addRfqItem,
  cancelRfq,
  closeSubmissions,
  createRfq,
  declineRfq,
  endRevisionRound,
  removeRfqItem,
  requestRevision,
  resendRecipient,
  sendRfq,
  setRecipients,
  submitRfq,
  updateRfq,
  withdrawRfq,
} from "@platform/modules/rfq";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

const uuid = z.string().uuid();
const opt = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : String(v));
const bool = (v: unknown) => v === "1" || v === "on" || v === "true";
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);

async function fileFrom(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new z.ZodError([{ code: "custom", path: ["file"], message: "required", input: undefined }]);
  return { buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name };
}

// ------------------------------------------------------------------------------------- RFQ (buyer)

export async function createRfqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const r = await createRfq(await getCtx(), {
      title: String(o.title ?? ""),
      description: opt(o.description) ?? null,
      projectId: opt(o.projectId),
      boqVersionId: opt(o.boqVersionId),
      closesAt: opt(o.closesAt) as never,
      requiredBy: opt(o.requiredBy) as never,
      deliveryCity: opt(o.deliveryCity) ?? null,
      deliveryAddress: opt(o.deliveryAddress) ?? null,
      deliveryTerms: opt(o.deliveryTerms) ?? null,
      paymentTerms: opt(o.paymentTerms) ?? null,
      allowRevisions: bool(o.allowRevisions),
      allowPartialQuotes: bool(o.allowPartialQuotes),
      allowAlternatives: bool(o.allowAlternatives),
    });
    return { id: r.id };
  });
}

export async function updateRfqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await updateRfq(await getCtx(), uuid.parse(o.id), {
      title: opt(o.title),
      closesAt: opt(o.closesAt) as never,
      requiredBy: opt(o.requiredBy) as never,
      deliveryCity: opt(o.deliveryCity) ?? null,
      deliveryAddress: opt(o.deliveryAddress) ?? null,
      deliveryTerms: opt(o.deliveryTerms) ?? null,
      paymentTerms: opt(o.paymentTerms) ?? null,
      allowRevisions: bool(o.allowRevisions),
      allowPartialQuotes: bool(o.allowPartialQuotes),
      allowAlternatives: bool(o.allowAlternatives),
    });
    return true;
  });
}

export async function addRfqItemAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await addRfqItem(await getCtx(), uuid.parse(o.rfqId), { description: String(o.description ?? ""), quantity: String(o.quantity ?? ""), unit: String(o.unit ?? ""), categoryId: opt(o.categoryId), notes: opt(o.notes) ?? null });
    return true;
  });
}

export async function removeRfqItemAction(id: string) {
  return run(async () => removeRfqItem(await getCtx(), uuid.parse(id)));
}

export async function setRecipientsAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    return setRecipients(await getCtx(), uuid.parse(o.rfqId), arr(o.supplierOrgIds));
  });
}

export async function rfqAttachmentAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await addRfqAttachment(await getCtx(), uuid.parse(o.rfqId), await fileFrom(fd));
    return true;
  });
}

export async function submitRfqAction(id: string) {
  return run(async () => (await submitRfq(await getCtx(), uuid.parse(id))).status);
}
export async function withdrawRfqAction(id: string) {
  return run(async () => withdrawRfq(await getCtx(), uuid.parse(id)));
}
export async function sendRfqAction(id: string, key: string) {
  return run(async () => sendRfq(await getCtx(), uuid.parse(id), z.string().min(8).max(100).parse(key)));
}
export async function resendRecipientAction(id: string) {
  return run(async () => resendRecipient(await getCtx(), uuid.parse(id)));
}
export async function closeSubmissionsAction(id: string) {
  return run(async () => closeSubmissions(await getCtx(), uuid.parse(id)));
}
export async function endRevisionAction(id: string) {
  return run(async () => endRevisionRound(await getCtx(), uuid.parse(id)));
}
export async function cancelRfqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await cancelRfq(await getCtx(), uuid.parse(o.rfqId), String(o.reason ?? ""));
    return true;
  });
}
export async function requestRevisionAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await requestRevision(await getCtx(), uuid.parse(o.rfqId), { supplierOrgIds: arr(o.supplierOrgIds), deadline: String(o.deadline ?? "") as never, note: opt(o.note) ?? null });
    return true;
  });
}

// ------------------------------------------------------------------------------------- evaluation & award

export async function setEvaluationAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await setEvaluation(await getCtx(), uuid.parse(o.rfqId), {
      rfqItemId: String(o.rfqItemId),
      supplierOrgId: String(o.supplierOrgId),
      technicalStatus: opt(o.technicalStatus) as never,
      technicalNote: o.technicalNote === undefined ? undefined : (opt(o.technicalNote) ?? null),
    });
    return true;
  });
}

export async function selectAwardAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    return selectAward(await getCtx(), uuid.parse(o.rfqId), { rfqItemId: String(o.rfqItemId), supplierOrgId: opt(o.supplierOrgId) ?? null, quantity: opt(o.quantity), reason: opt(o.reason) ?? null });
  });
}

export async function submitAwardAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    return submitAward(await getCtx(), uuid.parse(o.rfqId), opt(o.notes) ?? null);
  });
}

export async function createPosAction(rfqId: string, key: string) {
  return run(async () => createFromAward(await getCtx(), uuid.parse(rfqId), z.string().min(8).max(100).parse(key)));
}

// ------------------------------------------------------------------------------------- approvals

export async function decideAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ctx = await getCtx();
    return decide(ctx, uuid.parse(o.requestId), { decision: z.enum(["approve", "reject"]).parse(o.decision), comment: opt(o.comment) ?? null }, async (tx, req) => (req.subjectType === "award" ? awardHash(tx, req.subjectId) : null));
  });
}

export async function savePolicyAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const orders = arr(o.stepOrder);
    const names = arr(o.stepName);
    const rolesA = arr(o.stepRole);
    const mins = arr(o.stepMin);
    const steps = orders.map((ord, i) => ({ stepOrder: Number(ord), name: names[i] ?? "", requiredRoleKey: rolesA[i] || null, minApprovals: Number(mins[i] || 1) })).filter((s) => s.name);
    const p = await savePolicy(await getCtx(), o.id ? uuid.parse(o.id) : null, {
      name: String(o.name ?? ""),
      operation: o.operation as never,
      projectId: opt(o.projectId) ?? null,
      minAmount: opt(o.minAmount) ?? null,
      maxAmount: opt(o.maxAmount) ?? null,
      priority: Number(o.priority || 0),
      distinctApprovers: bool(o.distinctApprovers),
      isActive: o.isActive === undefined ? true : bool(o.isActive),
      steps,
    });
    return { id: p.id };
  });
}

// ------------------------------------------------------------------------------------- quotations (supplier)

export async function saveQuotationAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ids = arr(o.rfqItemId);
    const g = (k: string) => arr(o[k]);
    const offered = new Set(g("offered"));
    const alt = new Set(g("isAlternative"));
    const lines = ids.map((id, i) => ({
      rfqItemId: id,
      offered: offered.has(id),
      unitPrice: g("unitPrice")[i],
      quantity: g("quantity")[i],
      discountPct: g("discountPct")[i] as never,
      vatRate: g("vatRate")[i] ?? "0.15",
      leadTimeDays: g("lineLeadTime")[i] as never,
      isAlternative: alt.has(id),
      alternativeDescription: g("alternativeDescription")[i],
      brand: g("brand")[i],
      exceptionNote: g("exceptionNote")[i],
    }));
    const ctx = await getCtx();
    const rfqId = uuid.parse(o.rfqId);
    await saveQuotation(ctx, rfqId, { validUntil: opt(o.validUntil) as never, leadTimeDays: opt(o.leadTimeDays) as never, paymentTerms: opt(o.paymentTerms), deliveryTerms: opt(o.deliveryTerms), notes: opt(o.notes), exceptions: opt(o.exceptions), shippingAmount: opt(o.shippingAmount), lines });
    if (o.intent === "submit") await submitQuotation(ctx, rfqId);
    return { submitted: o.intent === "submit" };
  });
}

export async function reviseQuotationAction(rfqId: string) {
  return run(async () => {
    await reviseQuotation(await getCtx(), uuid.parse(rfqId));
    return true;
  });
}
export async function withdrawQuotationAction(rfqId: string) {
  return run(async () => withdrawQuotation(await getCtx(), uuid.parse(rfqId)));
}
export async function declineRfqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await declineRfq(await getCtx(), uuid.parse(o.rfqId), String(o.reason ?? ""));
    return true;
  });
}
export async function quotationAttachmentAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await addQuotationAttachment(await getCtx(), uuid.parse(o.rfqId), await fileFrom(fd));
    return true;
  });
}

// ------------------------------------------------------------------------------------- purchase orders

export async function updatePoAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await updatePoDraft(await getCtx(), uuid.parse(o.poId), { notes: opt(o.notes) ?? null, paymentTerms: opt(o.paymentTerms) ?? null, deliveryTerms: opt(o.deliveryTerms) ?? null, deliveryAddress: opt(o.deliveryAddress) ?? null, expectedDeliveryAt: (opt(o.expectedDeliveryAt) ?? null) as never });
    return true;
  });
}
export async function submitPoAction(id: string) {
  return run(async () => (await submitPo(await getCtx(), uuid.parse(id))).status);
}
export async function cancelPoAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await cancelPo(await getCtx(), uuid.parse(o.poId), String(o.reason ?? ""));
    return true;
  });
}
export async function completePoAction(id: string) {
  return run(async () => completePo(await getCtx(), uuid.parse(id)));
}
export async function receiptAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ids = arr(o.poItemId);
    const rec = arr(o.received);
    const rej = arr(o.rejected);
    return recordReceipt(await getCtx(), uuid.parse(o.poId), { notes: opt(o.notes) ?? null, items: ids.map((id, i) => ({ poItemId: id, received: rec[i] ?? "0", rejected: rej[i] ?? "0" })) });
  });
}
export async function acknowledgePoAction(id: string) {
  return run(async () => acknowledgePo(await getCtx(), uuid.parse(id)));
}
export async function shipmentAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ids = arr(o.poItemId);
    const qtys = arr(o.quantity);
    const s = await createShipment(await getCtx(), uuid.parse(o.poId), { carrier: opt(o.carrier) ?? null, trackingNumber: opt(o.trackingNumber) ?? null, expectedAt: opt(o.expectedAt) as never, notes: opt(o.notes) ?? null, items: ids.map((id, i) => ({ poItemId: id, quantity: qtys[i] ?? "0" })) });
    return { id: s.id };
  });
}
export async function delayAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await reportDelay(await getCtx(), uuid.parse(o.poId), { reason: String(o.reason ?? ""), newExpectedAt: String(o.newExpectedAt ?? "") as never });
    return true;
  });
}
