import { and, eq, isNull } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { AppError, forbidden, notFound, sha256, uuidv7 } from "@platform/core";
import { withContext, type Tx } from "@platform/db";
import { files } from "@platform/db/schema";
import { getStorage } from "@platform/integrations/storage";
import { audit } from "../audit";
import { requireUser } from "../authz";
import { dbCtx, type Ctx } from "../context";

export type FileOwnerType =
  | "boq_document"
  | "supplier_document"
  | "rfq_attachment"
  | "quotation_attachment"
  | "po_document"
  | "shipment_attachment"
  | "receipt_attachment"
  | "product_image"
  | "org_logo"
  | "project_file"
  | "data_export"
  | "return_attachment";

export type Classification = "public" | "org_private" | "confidential";

interface Rule {
  maxBytes: number;
  types: Record<string, string[]>; // mime → allowed extensions
}

const DOCS: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
};
const SHEETS: Record<string, string[]> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "text/csv": ["csv"],
};
const IMAGES: Record<string, string[]> = { "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"] };
const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<FileOwnerType, Rule> = {
  boq_document: { maxBytes: 25 * MB, types: { ...DOCS, ...SHEETS } },
  supplier_document: { maxBytes: 10 * MB, types: DOCS },
  rfq_attachment: { maxBytes: 20 * MB, types: { ...DOCS, ...SHEETS } },
  quotation_attachment: { maxBytes: 20 * MB, types: { ...DOCS, ...SHEETS } },
  po_document: { maxBytes: 20 * MB, types: DOCS },
  shipment_attachment: { maxBytes: 10 * MB, types: DOCS },
  receipt_attachment: { maxBytes: 10 * MB, types: DOCS },
  product_image: { maxBytes: 5 * MB, types: IMAGES },
  org_logo: { maxBytes: 2 * MB, types: IMAGES },
  project_file: { maxBytes: 25 * MB, types: { ...DOCS, ...SHEETS } },
  data_export: { maxBytes: 50 * MB, types: { "application/json": ["json"], "application/zip": ["zip"] } },
  return_attachment: { maxBytes: 5 * MB, types: DOCS },
};

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

function sanitizeName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (base || "file").slice(0, 200);
}

/** Detect the real content type using magic bytes; CSV is validated as UTF-8 text without NULs. */
export async function sniff(buf: Buffer, fileName: string): Promise<string | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft) {
    // XLSX is a zip container; file-type reports xlsx when it can see the content types part.
    return ft.mime;
  }
  const e = ext(fileName);
  if (e === "csv" || e === "json") {
    const sample = buf.subarray(0, Math.min(buf.length, 64 * 1024));
    if (sample.includes(0)) return null;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
    if (text.includes("�") && !/[؀-ۿ]/.test(text)) return null;
    return e === "csv" ? "text/csv" : "application/json";
  }
  return null;
}

export interface UploadInput {
  buffer: Buffer;
  fileName: string;
  ownerType: FileOwnerType;
  ownerId?: string | null;
  classification?: Classification;
  /** Organization owning the file. Defaults to active org; null for personal (individual buyer) files. */
  orgId?: string | null;
}

export async function validateUpload(input: Pick<UploadInput, "buffer" | "fileName" | "ownerType">) {
  const rule = UPLOAD_RULES[input.ownerType];
  if (!rule) throw new AppError("VALIDATION", "Unknown upload type");
  if (input.buffer.length === 0) throw new AppError("VALIDATION", "Empty file", { key: "file_empty" });
  if (input.buffer.length > rule.maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "File too large", { key: "file_too_large", details: { maxBytes: rule.maxBytes } });
  const mime = await sniff(input.buffer, input.fileName);
  if (!mime || !rule.types[mime]) throw new AppError("UNSUPPORTED_MEDIA", "File type not allowed", { key: "file_type_not_allowed", details: { allowed: Object.values(rule.types).flat() } });
  if (!rule.types[mime]!.includes(ext(input.fileName))) throw new AppError("UNSUPPORTED_MEDIA", "File extension does not match its content", { key: "file_ext_mismatch" });
  return mime;
}

/** Validate, store privately and register a file. Runs in the caller's security context. */
export async function uploadFile(ctx: Ctx, input: UploadInput, tx?: Tx) {
  requireUser(ctx);
  const mime = await validateUpload(input);
  const orgId = input.orgId === undefined ? ctx.orgId : input.orgId;
  const fileId = uuidv7();
  const fileName = sanitizeName(input.fileName);
  const storageKey = `${orgId ? `org/${orgId}` : `user/${ctx.userId}`}/${input.ownerType}/${fileId}.${ext(fileName)}`;
  await getStorage().put(storageKey, input.buffer, mime);
  const write = async (t: Tx) => {
    const [row] = await t
      .insert(files)
      .values({
        id: fileId,
        orgId,
        uploadedBy: ctx.userId,
        ownerType: input.ownerType,
        ownerId: input.ownerId ?? null,
        classification: input.classification ?? "org_private",
        storageKey,
        originalName: fileName,
        mimeType: mime,
        sizeBytes: input.buffer.length,
        sha256: sha256(input.buffer),
        status: "ready",
        scanStatus: "not_scanned",
      })
      .returning();
    await audit(ctx, { action: "file.uploaded", entityType: "file", entityId: fileId, orgId, data: { ownerType: input.ownerType, size: input.buffer.length, mime } }, t);
    return row!;
  };
  try {
    return tx ? await write(tx) : await withContext(dbCtx(ctx), write);
  } catch (e) {
    await getStorage().delete(storageKey).catch(() => undefined);
    throw e;
  }
}

export async function attachFile(tx: Tx, fileId: string, ownerType: FileOwnerType, ownerId: string) {
  const rows = await tx.update(files).set({ ownerId }).where(and(eq(files.id, fileId), eq(files.ownerType, ownerType))).returning({ id: files.id });
  if (!rows.length) throw notFound("File");
}

/**
 * Return a short-lived download URL. Visibility is enforced by RLS (the row is only readable when the
 * caller's org owns it, it is public, or a related entity grants access) plus an optional owner check.
 */
export async function getDownloadUrl(ctx: Ctx, fileId: string, opts: { inline?: boolean; expectOwnerType?: FileOwnerType } = {}) {
  return withContext(dbCtx(ctx), async (tx) => {
    const [f] = await tx.select().from(files).where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
    if (!f || f.status !== "ready") throw notFound("File");
    if (opts.expectOwnerType && f.ownerType !== opts.expectOwnerType) throw forbidden();
    const url = await getStorage().signedDownloadUrl(f.storageKey, { fileName: f.originalName, contentType: f.mimeType, ttlSeconds: 300, inline: opts.inline });
    if (f.classification === "confidential") {
      await audit(ctx, { action: "file.downloaded", entityType: "file", entityId: f.id, orgId: ctx.orgId }, tx);
    }
    return { url, file: f };
  });
}

export async function readFileContent(tx: Tx, fileId: string): Promise<{ buffer: Buffer; file: typeof files.$inferSelect }> {
  const [f] = await tx.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f) throw notFound("File");
  return { buffer: await getStorage().get(f.storageKey), file: f };
}

export async function listFiles(ctx: Ctx, ownerType: FileOwnerType, ownerId: string) {
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .select({ id: files.id, originalName: files.originalName, mimeType: files.mimeType, sizeBytes: files.sizeBytes, createdAt: files.createdAt, uploadedBy: files.uploadedBy })
      .from(files)
      .where(and(eq(files.ownerType, ownerType), eq(files.ownerId, ownerId), isNull(files.deletedAt)))
      .orderBy(files.createdAt),
  );
}

export async function softDeleteFile(ctx: Ctx, fileId: string) {
  requireUser(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const rows = await tx.update(files).set({ deletedAt: new Date(), status: "deleted" }).where(eq(files.id, fileId)).returning({ id: files.id });
    if (!rows.length) throw notFound("File");
    await audit(ctx, { action: "file.deleted", entityType: "file", entityId: fileId }, tx);
  });
}
