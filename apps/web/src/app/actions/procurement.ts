"use server";

import { z } from "zod";
import { addManualItem, approveBoq, createManualBoq, reprocessBoq, rematchItem, selectMatch, setColumnMapping, setReviewStatus, updateItem, uploadBoq } from "@platform/modules/boq";
import { createProject, setProjectMember, updateProject } from "@platform/modules/projects";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

const uuid = z.string().uuid();
const opt = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : String(v));

export async function saveProjectAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ctx = await getCtx();
    const input = {
      name: String(o.name ?? ""),
      description: opt(o.description) ?? null,
      projectType: opt(o.projectType) as never,
      city: opt(o.city) ?? null,
      siteAddress: opt(o.siteAddress) ?? null,
      managerUserId: opt(o.managerUserId),
      status: opt(o.status) as never,
      visibility: opt(o.visibility) as never,
      startDate: opt(o.startDate) as never,
      endDate: opt(o.endDate) as never,
      budget: opt(o.budget),
    };
    const p = o.id ? await updateProject(ctx, uuid.parse(o.id), input) : await createProject(ctx, input);
    return { id: p.id };
  });
}

export async function setProjectMemberAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const role = opt(o.role) as "manager" | "member" | "viewer" | undefined;
    await setProjectMember(await getCtx(), uuid.parse(o.projectId), uuid.parse(o.userId), role ?? null);
    return true;
  });
}

export async function uploadBoqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new z.ZodError([{ code: "custom", path: ["file"], message: "required", input: undefined }]);
    const doc = await uploadBoq(await getCtx(), { projectId: opt(o.projectId) ?? null, title: opt(o.title) ?? null }, { buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name });
    return { id: doc.id };
  });
}

export async function createManualBoqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const doc = await createManualBoq(await getCtx(), { projectId: opt(o.projectId) ?? null, title: String(o.title ?? "") });
    return { id: doc.id };
  });
}

export async function updateItemAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const attributes: Record<string, unknown> = {};
    let hasAttrs = false;
    for (const [k, v] of Object.entries(o))
      if (k.startsWith("attr.")) {
        hasAttrs = true;
        if (v !== "") attributes[k.slice(5)] = v;
      }
    await updateItem(await getCtx(), uuid.parse(o.itemId), {
      description: opt(o.description),
      quantity: opt(o.quantity),
      unit: opt(o.unit),
      categoryId: o.categoryId === undefined ? undefined : (opt(o.categoryId) ?? null),
      notes: o.notes === undefined ? undefined : (opt(o.notes) ?? null),
      attributes: hasAttrs ? attributes : undefined,
    });
    return true;
  });
}

export async function selectMatchAction(itemId: string, canonicalId: string | null) {
  return run(async () => selectMatch(await getCtx(), uuid.parse(itemId), canonicalId ? uuid.parse(canonicalId) : null));
}

export async function rematchAction(itemId: string) {
  return run(async () => {
    const d = await rematchItem(await getCtx(), uuid.parse(itemId));
    return d.status;
  });
}

export async function setReviewAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ids = Array.isArray(o.itemIds) ? (o.itemIds as string[]) : o.itemIds ? [String(o.itemIds)] : [];
    const status = z.enum(["approved", "excluded", "needs_review"]).parse(o.status);
    return setReviewStatus(await getCtx(), uuid.parse(o.documentId), o.mode === "all_clean" ? "all_clean" : ids.map((i) => uuid.parse(i)), status);
  });
}

export async function addLineAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const row = await addManualItem(await getCtx(), uuid.parse(o.documentId), { description: String(o.description ?? ""), quantity: String(o.quantity ?? ""), unit: String(o.unit ?? ""), itemCode: opt(o.itemCode) ?? null, section: opt(o.section) ?? null });
    return { id: row.id };
  });
}

export async function approveBoqAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const v = await approveBoq(await getCtx(), uuid.parse(o.documentId), opt(o.notes) ?? null);
    return { version: v.version };
  });
}

export async function reprocessAction(documentId: string) {
  return run(async () => reprocessBoq(await getCtx(), uuid.parse(documentId)));
}

export async function columnMappingAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const n = (v: unknown) => (v === "" || v === undefined ? undefined : Number(v));
    await setColumnMapping(await getCtx(), uuid.parse(o.documentId), {
      sheet: opt(o.sheet),
      headerRow: Math.max(0, (n(o.headerRow) ?? 1) - 1),
      description: n(o.description)!,
      quantity: n(o.quantity)!,
      unit: n(o.unit),
      itemCode: n(o.itemCode),
    });
    return true;
  });
}
