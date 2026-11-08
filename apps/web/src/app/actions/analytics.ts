"use server";

import { z } from "zod";
import { createAlert, deleteAlert } from "@platform/modules/price-index";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

export async function createAlertAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const a = await createAlert(await getCtx(), {
      subjectType: String(o.subjectType) as "canonical",
      subjectId: String(o.subjectId ?? ""),
      kind: String(o.kind) as "catalog_retail",
      thresholdPct: String(o.thresholdPct ?? "") as never,
      direction: String(o.direction ?? "any") as "any",
    });
    return { id: a.id };
  });
}

export async function deleteAlertAction(id: string) {
  return run(async () => deleteAlert(await getCtx(), z.string().uuid().parse(id)));
}
