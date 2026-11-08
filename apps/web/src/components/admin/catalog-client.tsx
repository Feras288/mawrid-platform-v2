"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { createCanonicalAction, createCategoryAction, resolveDuplicateAction, toggleCategoryAction } from "@/app/actions/admin";
import { categoryAttributesAction } from "@/app/actions/supplier";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Label, Select } from "@/components/ui/primitives";

type Cat = { id: string; parentId: string | null; system: string; nameAr: string; nameEn: string; depth: number; isActive: boolean };
const SYSTEMS = ["electrical", "plumbing", "hvac", "fire_fighting", "fire_alarm", "mechanical_equipment", "building_materials", "low_current", "infrastructure"] as const;

export function NewCategoryDialog({ categories }: { categories: Cat[] }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <Modal title={t("catalog.newCategory")} trigger={<Button>{t("catalog.newCategory")}</Button>}>
      <ActionForm action={createCategoryAction} successMessage={t("catalog.created")} resetOnSuccess>
        <FormError />
        <Field as="select" name="parentId" label={t("catalog.parent")} placeholder="—" options={categories.filter((c) => c.depth < 2).map((c) => ({ value: c.id, label: `${"— ".repeat(c.depth)}${locale === "ar" ? c.nameAr : c.nameEn}` }))} />
        <Field as="select" name="system" label={t("catalog.system")} placeholder="—" hint="Root categories only" options={SYSTEMS.map((s) => ({ value: s, label: t(`catalog.systems.${s}`) }))} />
        <Field name="nameAr" required label={t("org.nameAr")} dir="rtl" />
        <Field name="nameEn" required label={t("org.nameEn")} dir="ltr" />
        <Field name="slug" label="Slug" dir="ltr" />
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ToggleCategory({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations("supplier");
  return (
    <ActionButton size="sm" variant="ghost" action={() => toggleCategoryAction(id, !isActive)}>
      {isActive ? t("inactive") : t("active")}
    </ActionButton>
  );
}

type AttrDef = { key: string; nameAr: string; nameEn: string; dataType: string; unit: string | null; options: { value: string; nameAr: string; nameEn: string }[] };

export function NewCanonicalDialog({ categories, units }: { categories: Cat[]; units: { code: string; nameAr: string; nameEn: string }[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const L = (r: { nameAr: string; nameEn: string }) => (locale === "ar" ? r.nameAr : r.nameEn);
  const [categoryId, setCategoryId] = React.useState("");
  const [attrs, setAttrs] = React.useState<AttrDef[]>([]);
  React.useEffect(() => {
    if (!categoryId) return setAttrs([]);
    void categoryAttributesAction(categoryId).then((r) => r.ok && setAttrs(r.data as AttrDef[]));
  }, [categoryId]);
  return (
    <Modal wide title={t("catalog.newProduct")} trigger={<Button>{t("catalog.newProduct")}</Button>}>
      <ActionForm action={createCanonicalAction} successMessage={t("catalog.created")} resetOnSuccess>
        <FormError />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cp-cat">{t("products.category")}</Label>
            <Select id="cp-cat" name="categoryId" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t("common.select")}</option>
              {categories
                .filter((c) => c.depth > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {L(categories.find((r) => r.id === c.parentId) ?? c)} / {L(c)}
                  </option>
                ))}
            </Select>
          </div>
          <Field as="select" name="baseUnit" required label={t("catalog.baseUnit")} placeholder={t("common.select")} options={units.map((u) => ({ value: u.code, label: `${L(u)} (${u.code})` }))} />
          <Field name="nameAr" required label={t("org.nameAr")} dir="rtl" />
          <Field name="nameEn" required label={t("org.nameEn")} dir="ltr" />
          <Field name="standards" label={t("catalog.standards")} dir="ltr" />
          <Field name="keywords" label={t("catalog.keywords")} />
          {attrs.map((a) =>
            a.dataType === "enum" ? (
              <Field key={a.key} as="select" name={`attr.${a.key}`} label={L(a)} placeholder="—" options={a.options.map((o) => ({ value: o.value, label: L(o) }))} />
            ) : (
              <Field key={a.key} name={`attr.${a.key}`} label={`${L(a)}${a.unit ? ` (${a.unit})` : ""}`} dir="ltr" />
            ),
          )}
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function DuplicateActions({ id, aId, bId }: { id: string; aId: string; bId: string }) {
  const t = useTranslations("catalog");
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton size="sm" variant="outline" action={() => resolveDuplicateAction(id, "merge", aId)}>
        {t("merge")} (A)
      </ActionButton>
      <ActionButton size="sm" variant="outline" action={() => resolveDuplicateAction(id, "merge", bId)}>
        {t("merge")} (B)
      </ActionButton>
      <ActionButton size="sm" variant="ghost" action={() => resolveDuplicateAction(id, "dismiss")}>
        {t("dismiss")}
      </ActionButton>
    </div>
  );
}
