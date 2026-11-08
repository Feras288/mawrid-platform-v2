"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { deleteDocumentAction, saveSupplierProfileAction, saveWarehouseAction, submitVerificationAction, uploadDocumentAction } from "@/app/actions/supplier";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Card, CardBody, CardHeader, Checkbox, Label } from "@/components/ui/primitives";

export type CatOpt = { id: string; parentId: string | null; system: string; nameAr: string; nameEn: string; depth: number };
export type RegionOpt = { code: string; nameAr: string; nameEn: string };

export function SubmitVerificationButton() {
  const t = useTranslations("supplier");
  return (
    <ActionButton action={submitVerificationAction} successMessage={t("submitted")}>
      {t("submit")}
    </ActionButton>
  );
}

/** Checkbox tree: systems → subcategories. */
export function CategoryPicker({ categories, selected, name = "categoryIds[]" }: { categories: CatOpt[]; selected: string[]; name?: string }) {
  const locale = useLocale();
  const roots = categories.filter((c) => c.depth === 0);
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {roots.map((r) => (
        <fieldset key={r.id} className="rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-semibold text-primary-800">{locale === "ar" ? r.nameAr : r.nameEn}</legend>
          <div className="grid gap-1.5">
            {categories
              .filter((c) => c.parentId === r.id)
              .map((c) => (
                <Checkbox key={c.id} name={name} value={c.id} defaultChecked={selected.includes(c.id)} label={locale === "ar" ? c.nameAr : c.nameEn} />
              ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

type Profile = {
  descriptionAr: string | null;
  descriptionEn: string | null;
  establishedYear: number | null;
  employeesRange: string | null;
  coverageRegions: string[];
  deliversNationwide: boolean;
  minOrderValue: string | null;
  defaultLeadTimeDays: number | null;
  paymentTerms: string | null;
  acceptsStoreOrders: boolean;
  acceptsRfqs: boolean;
};

export function SupplierProfileForm({ profile, categoryIds, categories, regions, canEdit }: { profile: Profile; categoryIds: string[]; categories: CatOpt[]; regions: RegionOpt[]; canEdit: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Card>
      <CardHeader title={t("supplier.profileTitle")} />
      <CardBody>
        <ActionForm action={saveSupplierProfileAction} successMessage={t("supplier.saved")}>
          <FormError />
          <fieldset disabled={!canEdit} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field as="textarea" name="descriptionAr" label={t("supplier.descriptionAr")} defaultValue={profile.descriptionAr ?? ""} dir="rtl" />
              <Field as="textarea" name="descriptionEn" label={t("supplier.descriptionEn")} defaultValue={profile.descriptionEn ?? ""} dir="ltr" />
              <Field name="establishedYear" type="number" min={1900} max={2100} label={t("supplier.establishedYear")} defaultValue={profile.establishedYear ?? ""} dir="ltr" />
              <Field as="select" name="employeesRange" label={t("supplier.employees")} defaultValue={profile.employeesRange ?? ""} placeholder={t("common.select")} options={["1-10", "11-50", "51-200", "201-500", "500+"].map((v) => ({ value: v, label: v }))} />
              <Field name="minOrderValue" inputMode="decimal" label={t("supplier.minOrderValue")} defaultValue={profile.minOrderValue ?? ""} dir="ltr" />
              <Field name="defaultLeadTimeDays" type="number" min={0} max={365} label={t("supplier.leadTime")} defaultValue={profile.defaultLeadTimeDays ?? ""} dir="ltr" />
              <Field as="textarea" name="paymentTerms" label={t("supplier.paymentTerms")} defaultValue={profile.paymentTerms ?? ""} className="md:col-span-2" />
            </div>
            <div className="flex flex-wrap gap-6">
              <Checkbox name="acceptsStoreOrders" value="1" defaultChecked={profile.acceptsStoreOrders} label={t("supplier.acceptsStore")} />
              <Checkbox name="acceptsRfqs" value="1" defaultChecked={profile.acceptsRfqs} label={t("supplier.acceptsRfqs")} />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-700">{t("supplier.coverage")}</legend>
              <Checkbox name="deliversNationwide" value="1" defaultChecked={profile.deliversNationwide} label={t("supplier.nationwide")} />
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                {regions.map((r) => (
                  <Checkbox key={r.code} name="coverageRegions[]" value={r.code} defaultChecked={profile.coverageRegions.includes(r.code)} label={locale === "ar" ? r.nameAr : r.nameEn} />
                ))}
              </div>
            </fieldset>
            <div>
              <Label>{t("supplier.categories")}</Label>
              <div className="mt-2">
                <CategoryPicker categories={categories} selected={categoryIds} />
              </div>
            </div>
          </fieldset>
          {canEdit ? (
            <div className="flex justify-end">
              <SubmitButton>{t("common.save")}</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

const DOC_KINDS = ["commercial_registration", "vat_certificate", "chamber_membership", "municipality_license", "iso_certificate", "brand_authorization", "bank_letter", "national_address", "other"] as const;

export function UploadDocumentDialog() {
  const t = useTranslations();
  return (
    <Modal title={t("supplier.uploadDocument")} description={t("supplier.uploadNotVerify")} trigger={<Button>{t("supplier.uploadDocument")}</Button>}>
      <ActionForm action={uploadDocumentAction} successMessage={t("supplier.docUploaded")} resetOnSuccess>
        <FormError />
        <Field as="select" name="kind" required label={t("supplier.docKind")} options={DOC_KINDS.map((k) => ({ value: k, label: t(`supplier.docKinds.${k}`) }))} />
        <Field name="documentNumber" label={t("supplier.docNumber")} dir="ltr" />
        <Field name="expiresAt" type="date" label={t("supplier.expiresAt")} dir="ltr" />
        <Field name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp" label={t("supplier.file")} hint="PDF / PNG / JPG — 10MB" />
        <div className="flex justify-end">
          <SubmitButton>{t("common.upload")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function DeleteDocumentButton({ id }: { id: string }) {
  const t = useTranslations("common");
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" confirm={`${t("delete")}?`} action={() => deleteDocumentAction(id)}>
      {t("delete")}
    </ActionButton>
  );
}

export function WarehouseDialog({ warehouse, cities }: { warehouse?: { id: string; name: string; city: string; addressLine: string | null; isActive: boolean }; cities: { code: string; nameAr: string; nameEn: string; regionCode: string }[] }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Modal title={warehouse ? t("common.edit") : t("supplier.addWarehouse")} trigger={warehouse ? <Button size="sm" variant="outline">{t("common.edit")}</Button> : <Button>{t("supplier.addWarehouse")}</Button>}>
      <ActionForm action={saveWarehouseAction} successMessage={t("common.saved")}>
        <FormError />
        {warehouse ? <input type="hidden" name="id" value={warehouse.id} /> : null}
        <Field name="name" required label={t("supplier.warehouseName")} defaultValue={warehouse?.name} />
        <Field as="select" name="city" required label={t("common.city")} defaultValue={warehouse?.city} placeholder={t("common.select")} options={cities.map((c) => ({ value: c.code, label: locale === "ar" ? c.nameAr : c.nameEn }))} />
        <Field name="addressLine" label={t("common.address")} defaultValue={warehouse?.addressLine ?? ""} />
        {warehouse ? <Checkbox name="isActive" value="1" defaultChecked={warehouse.isActive} label={t("supplier.active")} /> : null}
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function useLocalized() {
  const locale = useLocale();
  return React.useCallback((r: { nameAr?: string | null; nameEn?: string | null } | null | undefined) => (r ? ((locale === "ar" ? r.nameAr || r.nameEn : r.nameEn || r.nameAr) ?? "") : ""), [locale]);
}
