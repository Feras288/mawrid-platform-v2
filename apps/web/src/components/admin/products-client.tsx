"use client";

import { useTranslations } from "next-intl";
import { adminSaveProductAction, adminSetPublishedAction } from "@/app/actions/admin";
import { ProductForm, type ProductData } from "@/components/supplier/product-editor";
import type { CatOpt } from "@/components/supplier/supplier-forms";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";

type UnitOpt = { code: string; nameAr: string; nameEn: string };

/** Product form for platform admins acting on a supplier's behalf: supplier (on create) and a mandatory reason. */
export function AdminProductForm({ product, categories, units, suppliers }: { product?: ProductData; categories: CatOpt[]; units: UnitOpt[]; suppliers?: { value: string; label: string }[] }) {
  const t = useTranslations("admProducts");
  return (
    <ProductForm product={product} categories={categories} units={units} action={adminSaveProductAction} redirectBase="/admin/products">
      <div className="grid gap-4 rounded-lg border border-accent-200 bg-accent-50 p-4 md:grid-cols-2">
        {suppliers ? <Field as="select" name="supplierOrgId" required label={t("supplier")} placeholder={t("chooseSupplier")} options={suppliers} /> : null}
        <Field name="reason" required minLength={3} maxLength={500} label={t("reason")} hint={t("reasonHint")} className={suppliers ? "" : "md:col-span-2"} />
      </div>
    </ProductForm>
  );
}

/** Publish / unpublish on the supplier's behalf (same store rules; reason required). */
export function AdminPublishForm({ productId, published }: { productId: string; published: boolean }) {
  const t = useTranslations();
  return (
    <ActionForm action={adminSetPublishedAction} successMessage={published ? t("products.notPublished") : t("products.published")} resetOnSuccess className="flex flex-wrap items-end gap-2 space-y-0">
      <FormError />
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="published" value={published ? "0" : "1"} />
      <Field name="reason" required minLength={3} maxLength={500} label={t("admProducts.reason")} className="min-w-64 flex-1" />
      <SubmitButton variant={published ? "outline" : "accent"}>{published ? t("products.unpublish") : t("products.publish")}</SubmitButton>
    </ActionForm>
  );
}
