"use server";

import { z } from "zod";
import { createCanonical, createCategory, resolveDuplicate, updateCategory } from "@platform/modules/catalog";
import { getSupplierDocumentUrlForAdmin } from "@platform/modules/files";
import { decideSupplier, reviewDocument, startReview } from "@platform/modules/suppliers";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

const uuid = z.string().uuid();

export async function startReviewAction(orgId: string) {
  return run(async () => startReview(await getCtx(), uuid.parse(orgId)));
}

export async function decideSupplierAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await decideSupplier(await getCtx(), uuid.parse(o.orgId), { decision: o.decision as never, reason: (o.reason as string) || null });
    return true;
  });
}

export async function reviewDocumentAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await reviewDocument(await getCtx(), uuid.parse(o.docId), { status: o.status as "verified" | "rejected", note: (o.note as string) || null });
    return true;
  });
}

export async function adminDocumentUrlAction(fileId: string) {
  return run(async () => getSupplierDocumentUrlForAdmin(await getCtx(), uuid.parse(fileId)));
}

export async function createCategoryAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const c = await createCategory(await getCtx(), { parentId: (o.parentId as string) || null, system: ((o.system as string) || undefined) as never, nameAr: String(o.nameAr ?? ""), nameEn: String(o.nameEn ?? ""), slug: (o.slug as string) || undefined });
    return { id: c.id };
  });
}

export async function toggleCategoryAction(id: string, isActive: boolean) {
  return run(async () => {
    await updateCategory(await getCtx(), uuid.parse(id), { isActive });
    return true;
  });
}

export async function createCanonicalAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (k.startsWith("attr.") && v !== "") attributes[k.slice(5)] = v;
    const split = (v: unknown) =>
      String(v ?? "")
        .split(/[,،]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const r = await createCanonical(await getCtx(), {
      categoryId: String(o.categoryId ?? ""),
      nameAr: String(o.nameAr ?? ""),
      nameEn: String(o.nameEn ?? ""),
      descriptionAr: (o.descriptionAr as string) || null,
      descriptionEn: (o.descriptionEn as string) || null,
      baseUnit: String(o.baseUnit ?? ""),
      attributes,
      standards: split(o.standards),
      keywords: split(o.keywords),
    });
    return { id: r.product.id, flagged: r.duplicatesFlagged };
  });
}

export async function resolveDuplicateAction(candidateId: string, action: "dismiss" | "merge", keepId?: string) {
  return run(async () => resolveDuplicate(await getCtx(), uuid.parse(candidateId), action === "merge" ? { action, keepId: uuid.parse(keepId) } : { action: "dismiss" }));
}
