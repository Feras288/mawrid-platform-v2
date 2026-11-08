"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { savePriceListAction } from "@/app/actions/supplier";
import { ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Button, Checkbox, Label, Select } from "@/components/ui/primitives";

type List = { id: string; name: string; kind: string; buyerOrgId: string | null; regions: string[]; pricesIncludeVat: boolean; validFrom: string; validTo: string; isActive: boolean; priority: number };

export function PriceListDialog({ list, regions, buyers }: { list?: List; regions: { code: string; nameAr: string; nameEn: string }[]; buyers: { id: string; name: string }[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [kind, setKind] = React.useState(list?.kind ?? "retail");
  return (
    <Modal wide title={list ? t("common.edit") : t("products.newPriceList")} trigger={list ? <Button size="sm" variant="outline">{t("common.edit")}</Button> : <Button>{t("products.newPriceList")}</Button>}>
      <ActionForm action={savePriceListAction} successMessage={t("common.saved")}>
        <FormError />
        {list ? <input type="hidden" name="id" value={list.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" required label={t("products.listName")} defaultValue={list?.name} />
          <div className="space-y-1.5">
            <Label htmlFor="pl-kind">{t("products.listKind")}</Label>
            <Select id="pl-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {(["retail", "enterprise", "org_specific", "regional"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`products.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          {kind === "org_specific" ? (
            buyers.length ? (
              <Field as="select" name="buyerOrgId" required label={t("products.buyerOrg")} defaultValue={list?.buyerOrgId ?? ""} placeholder={t("common.select")} options={buyers.map((b) => ({ value: b.id, label: b.name }))} className="sm:col-span-2" />
            ) : (
              <p className="text-sm text-warning-600 sm:col-span-2">{t("products.noBuyers")}</p>
            )
          ) : null}
          {kind === "regional" ? (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium text-ink-700">{t("products.regions")}</legend>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {regions.map((r) => (
                  <Checkbox key={r.code} name="regions[]" value={r.code} defaultChecked={list?.regions.includes(r.code)} label={locale === "ar" ? r.nameAr : r.nameEn} />
                ))}
              </div>
            </fieldset>
          ) : null}
          <Field name="validFrom" type="date" label={t("products.validFrom")} defaultValue={list?.validFrom} dir="ltr" />
          <Field name="validTo" type="date" label={t("products.validTo")} defaultValue={list?.validTo} dir="ltr" />
          <Field name="priority" type="number" min={0} max={1000} label={t("products.priority")} defaultValue={list?.priority ?? 0} dir="ltr" />
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox name="pricesIncludeVat" value="1" defaultChecked={list?.pricesIncludeVat} label={t("products.includesVat")} />
          <Checkbox name="isActive" value="1" defaultChecked={list?.isActive ?? true} label={t("supplier.active")} />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}
