"use server";

import { z } from "zod";
import { attributesForCategory } from "@platform/modules/catalog";
import { startProductImport } from "@platform/modules/imports";
import {
  createProduct,
  setProductPrices,
  setPublished,
  setStock,
  updateProduct,
  upsertPriceList,
  type ProductInput,
} from "@platform/modules/supplier-products";
import { deleteSupplierDocument, submitForVerification, updateMyProfile, uploadSupplierDocument, upsertWarehouse } from "@platform/modules/suppliers";
import { formToObject, run } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

const uuid = z.string().uuid();
const bool = (v: unknown) => v === "1" || v === "on" || v === "true";
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);

async function fileFrom(fd: FormData, name = "file") {
  const f = fd.get(name);
  if (!(f instanceof File) || f.size === 0) throw new z.ZodError([{ code: "custom", path: [name], message: "required", input: undefined }]);
  return { buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name };
}

export async function saveSupplierProfileAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await updateMyProfile(await getCtx(), {
      descriptionAr: (o.descriptionAr as string) || null,
      descriptionEn: (o.descriptionEn as string) || null,
      establishedYear: o.establishedYear ? Number(o.establishedYear) : null,
      employeesRange: ((o.employeesRange as string) || null) as never,
      coverageRegions: arr(o.coverageRegions),
      deliversNationwide: bool(o.deliversNationwide),
      minOrderValue: (o.minOrderValue as string) || null,
      defaultLeadTimeDays: o.defaultLeadTimeDays ? Number(o.defaultLeadTimeDays) : null,
      paymentTerms: (o.paymentTerms as string) || null,
      acceptsStoreOrders: bool(o.acceptsStoreOrders),
      acceptsRfqs: bool(o.acceptsRfqs),
      categoryIds: arr(o.categoryIds),
    });
    return true;
  });
}

export async function submitVerificationAction() {
  return run(async () => {
    await submitForVerification(await getCtx());
    return true;
  });
}

export async function uploadDocumentAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const doc = await uploadSupplierDocument(await getCtx(), { kind: o.kind as never, documentNumber: (o.documentNumber as string) || null, expiresAt: (o.expiresAt as string) || null }, await fileFrom(fd));
    return { id: doc.id };
  });
}

export async function deleteDocumentAction(id: string) {
  return run(async () => deleteSupplierDocument(await getCtx(), uuid.parse(id)));
}

export async function saveWarehouseAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const w = await upsertWarehouse(await getCtx(), o.id ? uuid.parse(o.id) : null, { name: String(o.name ?? ""), city: String(o.city ?? ""), region: (o.region as string) || null, addressLine: (o.addressLine as string) || null, isActive: o.isActive === undefined ? true : bool(o.isActive) });
    return { id: w.id };
  });
}

function productFromForm(o: Record<string, unknown>): ProductInput {
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (k.startsWith("attr.") && v !== "") attributes[k.slice(5)] = v;
  return {
    sku: String(o.sku ?? ""),
    categoryId: String(o.categoryId ?? ""),
    canonicalProductId: (o.canonicalProductId as string) || null,
    nameAr: String(o.nameAr ?? ""),
    nameEn: String(o.nameEn ?? ""),
    descriptionAr: (o.descriptionAr as string) || null,
    descriptionEn: (o.descriptionEn as string) || null,
    brandName: (o.brandName as string) || null,
    model: (o.model as string) || null,
    countryOfOrigin: (o.countryOfOrigin as string) || null,
    certifications: String(o.certifications ?? "")
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean),
    attributes,
    saleUnit: String(o.saleUnit ?? ""),
    packSize: String(o.packSize || "1"),
    moq: String(o.moq || "1"),
    orderIncrement: String(o.orderIncrement || "1"),
    leadTimeDays: o.leadTimeDays ? Number(o.leadTimeDays) : null,
    vatRate: String(o.vatRate || "0.15"),
    status: (o.status as "draft" | "active" | "inactive") ?? "draft",
  };
}

export async function saveProductAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const ctx = await getCtx();
    const input = productFromForm(o);
    const p = o.id ? await updateProduct(ctx, uuid.parse(o.id), input) : await createProduct(ctx, input);
    return { id: p.id };
  });
}

export async function setPublishedAction(id: string, published: boolean) {
  return run(async () => setPublished(await getCtx(), uuid.parse(id), published));
}

export async function savePricesAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const mins = arr(o.minQty);
    const prices = arr(o.unitPrice);
    const discounts = arr(o.discountPct);
    const tiers = mins.map((m, i) => ({ minQty: m, unitPrice: prices[i] ?? "", discountPct: Number(discounts[i] || 0) })).filter((t) => t.minQty !== "" && t.unitPrice !== "");
    await setProductPrices(await getCtx(), { priceListId: String(o.priceListId), supplierProductId: String(o.supplierProductId), tiers });
    return true;
  });
}

export async function setStockAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    await setStock(await getCtx(), { warehouseId: String(o.warehouseId), supplierProductId: String(o.supplierProductId), onHand: String(o.onHand ?? "") });
    return true;
  });
}

export async function savePriceListAction(fd: FormData) {
  return run(async () => {
    const o = formToObject(fd);
    const pl = await upsertPriceList(await getCtx(), o.id ? uuid.parse(o.id) : null, {
      name: String(o.name ?? ""),
      kind: o.kind as never,
      buyerOrgId: (o.buyerOrgId as string) || null,
      regions: arr(o.regions),
      pricesIncludeVat: bool(o.pricesIncludeVat),
      validFrom: (o.validFrom as string) || null,
      validTo: (o.validTo as string) || null,
      isActive: o.isActive === undefined ? true : bool(o.isActive),
      priority: Number(o.priority || 0),
    });
    return { id: pl.id };
  });
}

export async function startImportAction(fd: FormData) {
  return run(async () => {
    const b = await startProductImport(await getCtx(), await fileFrom(fd));
    return { id: b.id };
  });
}

/** Attribute definitions for a category (used by the product form when the category changes). */
export async function categoryAttributesAction(categoryId: string) {
  return run(async () => attributesForCategory(uuid.parse(categoryId)));
}
