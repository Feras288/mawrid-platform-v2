import "server-only";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { isAppError } from "@platform/core";
import { logger } from "@platform/core/logger";

export type ActionError = { code: string; key: string; message: string; fieldErrors?: Record<string, string[]> };
export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Map any thrown error into a safe, serializable action error (no internals leaked). */
export function toActionError(e: unknown): ActionError {
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of e.issues) {
      const k = issue.path.join(".") || "_";
      (fieldErrors[k] ??= []).push(issue.message);
    }
    return { code: "VALIDATION", key: "validation", message: "Validation failed", fieldErrors };
  }
  if (isAppError(e)) {
    if (e.code === "INTERNAL") logger.error({ err: e }, "internal app error");
    return { code: e.code, key: e.messageKey, message: e.code === "INTERNAL" ? "Internal error" : e.message, fieldErrors: undefined };
  }
  // Next.js redirect/notFound control-flow errors must propagate
  if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) throw e;
  logger.error({ err: e }, "unhandled action error");
  return { code: "INTERNAL", key: "internal", message: "Internal error" };
}

/** Localize Zod issues using the `validation` messages namespace (code-based, with params). */
async function localizeZod(e: z.ZodError): Promise<Record<string, string[]>> {
  const t = await getTranslations("validation");
  const out: Record<string, string[]> = {};
  for (const issue of e.issues) {
    const k = issue.path.join(".") || "_";
    const i = issue as unknown as { code: string; minimum?: number | bigint; maximum?: number | bigint; origin?: string; format?: string };
    let msg: string;
    if (i.code === "too_small") msg = i.origin === "string" ? t("tooShort", { min: Number(i.minimum ?? 0) }) : i.origin === "array" ? t("selectAtLeast", { min: Number(i.minimum ?? 1) }) : t("tooSmall", { min: Number(i.minimum ?? 0) });
    else if (i.code === "too_big") msg = i.origin === "string" ? t("tooLong", { max: Number(i.maximum ?? 0) }) : t("tooBig", { max: Number(i.maximum ?? 0) });
    else if (i.code === "invalid_format") msg = i.format === "email" ? t("email") : i.format === "url" ? t("url") : t("format");
    else if (i.code === "invalid_value") msg = t("choice");
    else if (i.code === "invalid_type") msg = t("required");
    else msg = t("invalid");
    (out[k] ??= []).push(msg);
  }
  return out;
}

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const err = toActionError(e);
    if (e instanceof z.ZodError) err.fieldErrors = await localizeZod(e).catch(() => err.fieldErrors);
    return { ok: false, error: err };
  }
}

/** FormData → plain object (repeated keys become arrays when key ends with []). */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      ((out[key] as unknown[]) ??= []).push(v);
    } else out[k] = typeof v === "string" ? v : v;
  }
  return out;
}
