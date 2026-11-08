"use server";

import { z } from "zod";
import {
  openBreakglass,
  publishContent,
  retryDelivery,
  revokeBreakglass,
  saveContentDraft,
  saveDefaultZone,
  saveIntegrationSetting,
  setOrgStatus,
  setOrgTestFlag,
  setUserStatus,
  testIntegration,
  type SettingKey,
} from "@platform/modules/admin";
import { setFlag, type FlagKey } from "@platform/modules/config";
import { completeRefund, confirmBankTransfer } from "@platform/modules/payments";
import { decideDeletion, requestDeletion, requestExport, setConsent } from "@platform/modules/privacy";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";
import { switchOrgAction } from "./session";

const uuid = z.string().uuid();
const opt = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : String(v));
const bool = (v: unknown) => v === "1" || v === "on" || v === "true";
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);

export async function userStatusAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await setUserStatus(await getCtx(), uuid.parse(o.userId), z.enum(["active", "suspended"]).parse(o.status), String(o.reason ?? ""));
  });
}

export async function orgStatusAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await setOrgStatus(await getCtx(), uuid.parse(o.orgId), z.enum(["active", "suspended"]).parse(o.status), String(o.reason ?? ""));
  });
}

export async function orgTestFlagAction(orgId: string, isTest: boolean) {
  return run(async () => setOrgTestFlag(await getCtx(), uuid.parse(orgId), isTest));
}

export async function breakglassAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const g = await openBreakglass(await getCtx(), { orgId: String(o.orgId ?? ""), reason: String(o.reason ?? ""), minutes: String(o.minutes ?? "30") as never });
    return { id: g.id };
  });
}

export async function enterBreakglassAction(orgId: string) {
  return run(async () => {
    const r = await switchOrgAction(uuid.parse(orgId));
    if (!r.ok) throw new Error("No active grant");
    return r;
  });
}

export async function revokeBreakglassAction(id: string) {
  return run(async () => revokeBreakglass(await getCtx(), uuid.parse(id)));
}

export async function saveSettingAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const key = String(o.__key) as SettingKey;
    const secretRaw = o.__secret;
    const clear = bool(o.__clearSecret);
    const value: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (!k.startsWith("__")) value[k] = v;
    for (const b of ["secure", "enabled"]) if (b in value || key === "smtp" || key === "payments.bank_transfer") value[b] = bool(value[b]);
    if (key !== "smtp") delete value.secure;
    if (key !== "payments.bank_transfer") delete value.enabled;
    const secret = clear ? "" : typeof secretRaw === "string" && secretRaw.length ? secretRaw : undefined;
    await saveIntegrationSetting(await getCtx(), key, value, secret);
  });
}

export async function testIntegrationAction(kind: "smtp" | "ai" | "payments", sendTo?: string) {
  return run(async () => testIntegration(await getCtx(), kind, { sendTo: opt(sendTo) }));
}

export async function setFlagAction(key: string, enabled: boolean) {
  return run(async () => setFlag(await getCtx(), key as FlagKey, enabled));
}

export async function retryDeliveryAction(id: string) {
  return run(async () => retryDelivery(await getCtx(), uuid.parse(id)));
}

export async function confirmTransferAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    return confirmBankTransfer(await getCtx(), uuid.parse(o.intentId), String(o.note ?? ""));
  });
}

export async function manualRefundAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await completeRefund(uuid.parse(o.refundId), opt(o.providerRef) ?? null, await getCtx());
  });
}

export async function saveDraftAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const r = await saveContentDraft(await getCtx(), { slug: String(o.slug) as "terms", locale: String(o.locale) as "ar", title: String(o.title ?? ""), body: String(o.body ?? "") });
    return { id: r.id };
  });
}

export async function publishContentAction(id: string) {
  return run(async () => publishContent(await getCtx(), uuid.parse(id)));
}

export async function decideDeletionAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await decideDeletion(await getCtx(), uuid.parse(o.requestId), z.enum(["approve", "reject"]).parse(o.decision), String(o.notes ?? ""));
  });
}

export async function saveDefaultZoneAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const methods = arr(o.method);
    const fees = arr(o.fee);
    const free = arr(o.freeOver);
    const mins = arr(o.etaMin);
    const maxs = arr(o.etaMax);
    return saveDefaultZone(await getCtx(), opt(o.id) ? uuid.parse(o.id) : null, {
      name: String(o.name ?? ""),
      nationwide: bool(o.nationwide),
      cities: arr(o.cities),
      regions: arr(o.regions),
      isActive: o.isActive === undefined ? !opt(o.id) : bool(o.isActive),
      rates: methods.map((m, i) => ({ method: m, fee: fees[i] ?? "", freeOver: free[i] ?? "", etaMinDays: mins[i] ?? "1", etaMaxDays: maxs[i] ?? "5" })).filter((r) => r.fee !== ""),
    });
  });
}

// ---------------------------------------------------------------------------- account privacy (self-service)

export async function consentAction(kind: "marketing" | "external_ai_processing", granted: boolean) {
  return run(async () => setConsent(await getCtx(), kind, granted));
}

export async function requestExportAction() {
  return run(async () => {
    const r = await requestExport(await getCtx());
    return { id: r.id };
  });
}

export async function requestDeletionAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const r = await requestDeletion(await getCtx(), opt(o.reason) ?? null);
    return { id: r.id };
  });
}
