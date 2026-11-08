import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AppError, isAppError, notFound } from "@platform/core";
import { parseLocaleNumber } from "@platform/core/text";
import { pageParams, withContext, withSystem, type Tx } from "@platform/db";
import { categories, importBatches, importBatchRows, supplierProducts, units, warehouses } from "@platform/db/schema";
import { audit } from "../audit";
import { authorize, requireOrg } from "../authz";
import { dbCtx, resolveContext, type Ctx } from "../context";
import { readFileContent, uploadFile } from "../files";
import { emit } from "../outbox";
import { resolveUnitCode } from "../reference";
import { parseSpreadsheet, rowsToObjects } from "../spreadsheet";
import { createProduct, ensureRetailList, setProductPrices, setStock, updateProduct, type ProductInput } from "../supplier-products";

/** Accepted column headers (normalized lower_snake) → field. Arabic headers supported. */
const ALIASES: Record<string, string> = {
  sku: "sku",
  "رمز_الصنف": "sku",
  "رقم_الصنف": "sku",
  name_ar: "nameAr",
  "الاسم_بالعربية": "nameAr",
  "الاسم_العربي": "nameAr",
  name_en: "nameEn",
  "الاسم_بالإنجليزية": "nameEn",
  "الاسم_الانجليزي": "nameEn",
  category: "category",
  "التصنيف": "category",
  unit: "unit",
  "الوحدة": "unit",
  brand: "brandName",
  "العلامة_التجارية": "brandName",
  model: "model",
  "الموديل": "model",
  price: "price",
  retail_price: "price",
  "السعر": "price",
  moq: "moq",
  "الحد_الأدنى": "moq",
  lead_time_days: "leadTimeDays",
  "مدة_التوريد": "leadTimeDays",
  stock: "stock",
  "المخزون": "stock",
  warehouse: "warehouse",
  "المستودع": "warehouse",
  status: "status",
  "الحالة": "status",
  description_ar: "descriptionAr",
  description_en: "descriptionEn",
  country_of_origin: "countryOfOrigin",
  "بلد_المنشأ": "countryOfOrigin",
};

export const PRODUCT_TEMPLATE_HEADER = ["sku", "name_ar", "name_en", "category", "unit", "brand", "model", "price", "moq", "lead_time_days", "stock", "warehouse", "status", "attr:diameter_mm", "attr:material"];

/** Start an import: store the file and enqueue processing (via outbox → worker). */
export async function startProductImport(ctx: Ctx, file: { buffer: Buffer; fileName: string }) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.manage", { write: true });
  return withContext(dbCtx(ctx), async (tx) => {
    const f = await uploadFile(ctx, { buffer: file.buffer, fileName: file.fileName, ownerType: "project_file", classification: "org_private" }, tx);
    if (!["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(f.mimeType)) {
      throw new AppError("UNSUPPORTED_MEDIA", "Upload a CSV or XLSX file", { key: "file_type_not_allowed" });
    }
    const [b] = await tx.insert(importBatches).values({ orgId: ctx.orgId, kind: "supplier_products", fileId: f.id, createdBy: ctx.userId }).returning();
    await emit({ topic: "import.requested", aggregateType: "import_batch", aggregateId: b!.id, orgId: ctx.orgId, payload: { batchId: b!.id, userId: ctx.userId, orgId: ctx.orgId } }, tx);
    await audit(ctx, { action: "import.started", entityType: "import_batch", entityId: b!.id }, tx);
    return b!;
  });
}

/**
 * Process an import batch as the requesting user (their permissions & RLS apply). Each row is
 * applied in its own savepoint so one bad row never corrupts others. Idempotent per batch.
 */
export async function processProductImport(batchId: string, userId: string, orgId: string): Promise<{ ok: number; errors: number }> {
  const ctx = await resolveContext({ userId, orgId });
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.manage", { write: true });
  const [batch] = await withSystem((tx) => tx.select().from(importBatches).where(eq(importBatches.id, batchId)).limit(1));
  if (!batch) throw notFound("Import");
  if (batch.status === "completed") return { ok: batch.okRows, errors: batch.errorRows };
  await withSystem((tx) => tx.update(importBatches).set({ status: "processing" }).where(eq(importBatches.id, batchId)));
  try {
    const { buffer, file } = await withContext(dbCtx(ctx), (tx) => readFileContent(tx, batch.fileId!));
    const sheets = await parseSpreadsheet(buffer, file.mimeType);
    const { header, records } = rowsToObjects(sheets[0]?.rows ?? []);
    if (!header.includes("sku") && !header.includes("رمز_الصنف") && !header.includes("رقم_الصنف")) {
      throw new AppError("VALIDATION", "Missing sku column", { key: "import_missing_sku" });
    }
    const lookups = await withContext(dbCtx(ctx), async (tx) => ({
      cats: await tx.select({ id: categories.id, slug: categories.slug, nameAr: categories.nameAr, nameEn: categories.nameEn }).from(categories),
      units: await tx.select({ code: units.code, aliases: units.aliases }).from(units),
      warehouses: await tx.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.orgId, orgId)),
      retailListId: await ensureRetailList(tx, orgId),
    }));
    let ok = 0;
    let errors = 0;
    await withSystem((tx) => tx.delete(importBatchRows).where(eq(importBatchRows.batchId, batchId)));
    for (const rec of records) {
      const v: Record<string, string> = {};
      const attrs: Record<string, string> = {};
      for (const [k, val] of Object.entries(rec.values)) {
        if (k.startsWith("attr:")) {
          if (val) attrs[k.slice(5)] = val;
        } else if (ALIASES[k]) v[ALIASES[k]] = val;
      }
      const rowErrors: string[] = [];
      let status: "created" | "updated" | "error" = "error";
      let entityId: string | null = null;
      try {
        const cat = lookups.cats.find((c) => c.slug === v.category?.trim().toLowerCase() || c.nameAr === v.category?.trim() || c.nameEn.toLowerCase() === v.category?.trim().toLowerCase());
        if (!cat) rowErrors.push("unknown_category");
        const unitCode = resolveUnitCode(v.unit, lookups.units);
        if (!unitCode) rowErrors.push("unknown_unit");
        const price = v.price ? parseLocaleNumber(v.price) : null;
        if (v.price && !price) rowErrors.push("invalid_price");
        const stock = v.stock ? parseLocaleNumber(v.stock) : null;
        if (v.stock && !stock) rowErrors.push("invalid_stock");
        const wh = v.warehouse ? lookups.warehouses.find((w) => w.name.toLowerCase() === v.warehouse!.toLowerCase()) : lookups.warehouses[0];
        if (stock && !wh) rowErrors.push("unknown_warehouse");
        if (!v.sku) rowErrors.push("missing_sku");
        if (!v.nameAr) rowErrors.push("missing_name_ar");
        if (!v.nameEn) rowErrors.push("missing_name_en");
        if (rowErrors.length) throw new AppError("VALIDATION", rowErrors.join(","));
        const input: ProductInput = {
          sku: v.sku!,
          categoryId: cat!.id,
          nameAr: v.nameAr!,
          nameEn: v.nameEn!,
          descriptionAr: v.descriptionAr || null,
          descriptionEn: v.descriptionEn || null,
          brandName: v.brandName || null,
          model: v.model || null,
          countryOfOrigin: v.countryOfOrigin || null,
          saleUnit: unitCode!,
          moq: v.moq ? (parseLocaleNumber(v.moq) ?? "1") : "1",
          leadTimeDays: v.leadTimeDays ? Number(parseLocaleNumber(v.leadTimeDays)) : null,
          status: v.status === "active" || v.status === "نشط" ? "active" : v.status === "inactive" ? "inactive" : "draft",
          attributes: attrs,
        };
        await withContext(dbCtx(ctx), (tx: Tx) =>
          tx.transaction(async (sp) => {
            const s = sp as Tx;
            const [existing] = await s.select({ id: supplierProducts.id }).from(supplierProducts).where(and(eq(supplierProducts.orgId, orgId), eq(supplierProducts.sku, input.sku))).limit(1);
            const prod = existing ? await updateProduct(ctx, existing.id, input, s) : await createProduct(ctx, input, s);
            entityId = prod.id;
            status = existing ? "updated" : "created";
            if (price) await setProductPrices(ctx, { priceListId: lookups.retailListId, supplierProductId: prod.id, tiers: [{ minQty: "1", unitPrice: price, discountPct: 0 }] }, s);
            if (stock && wh) await setStock(ctx, { warehouseId: wh.id, supplierProductId: prod.id, onHand: stock, reason: `import:${batchId}` }, s);
          }),
        );
        ok++;
      } catch (e) {
        errors++;
        status = "error";
        if (!rowErrors.length) rowErrors.push(isAppError(e) ? `${e.messageKey}:${e.message}` : "internal");
      }
      await withSystem((tx) => tx.insert(importBatchRows).values({ batchId, orgId, rowNumber: rec.row, data: rec.values, status, errors: rowErrors, entityId }));
    }
    await withSystem((tx) => tx.update(importBatches).set({ status: "completed", totalRows: records.length, okRows: ok, errorRows: errors, finishedAt: new Date() }).where(eq(importBatches.id, batchId)));
    await audit(ctx, { action: "import.completed", entityType: "import_batch", entityId: batchId, data: { ok, errors } });
    return { ok, errors };
  } catch (e) {
    await withSystem((tx) => tx.update(importBatches).set({ status: "failed", error: isAppError(e) ? e.messageKey : "internal", finishedAt: new Date() }).where(eq(importBatches.id, batchId)));
    if (isAppError(e) && e.code !== "INTERNAL") return { ok: 0, errors: 0 };
    throw e;
  }
}

export async function listImports(ctx: Ctx, page = 1) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.view");
  const { limit, offset } = pageParams(page, 20);
  return withContext(dbCtx(ctx), (tx) => tx.select().from(importBatches).where(eq(importBatches.orgId, ctx.orgId)).orderBy(desc(importBatches.createdAt)).limit(limit).offset(offset));
}

export async function getImport(ctx: Ctx, batchId: string, opts: { errorsOnly?: boolean } = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "products.view");
  return withContext(dbCtx(ctx), async (tx) => {
    const [b] = await tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.orgId, ctx.orgId))).limit(1);
    if (!b) throw notFound("Import");
    const rows = await tx
      .select()
      .from(importBatchRows)
      .where(and(eq(importBatchRows.batchId, batchId), opts.errorsOnly ? eq(importBatchRows.status, "error") : undefined))
      .orderBy(asc(importBatchRows.rowNumber))
      .limit(1000);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(importBatchRows).where(eq(importBatchRows.batchId, batchId));
    return { batch: b, rows, rowCount: c?.n ?? 0 };
  });
}
