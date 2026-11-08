"use client";

import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { categoryAttributesAction, savePricesAction, saveProductAction, setPublishedAction, setStockAction } from "@/app/actions/supplier";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select, Table, Td, Th } from "@/components/ui/primitives";
import type { CatOpt } from "./supplier-forms";

type AttrDef = { key: string; nameAr: string; nameEn: string; dataType: string; unit: string | null; options: { value: string; nameAr: string; nameEn: string }[]; isCritical: boolean; required: boolean };
type UnitOpt = { code: string; nameAr: string; nameEn: string };

export type ProductData = {
  id?: string;
  sku: string;
  categoryId: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  brandName: string | null;
  model: string | null;
  countryOfOrigin: string | null;
  certifications: string[];
  attributes: Record<string, string | number | boolean>;
  saleUnit: string;
  packSize: string;
  moq: string;
  orderIncrement: string;
  leadTimeDays: number | null;
  vatRate: string;
  status: string;
};

export function ProductForm({ product, categories, units }: { product?: ProductData; categories: CatOpt[]; units: UnitOpt[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const L = (r: { nameAr: string; nameEn: string }) => (locale === "ar" ? r.nameAr : r.nameEn);
  const [categoryId, setCategoryId] = React.useState(product?.categoryId ?? "");
  const [attrs, setAttrs] = React.useState<AttrDef[]>([]);
  React.useEffect(() => {
    if (!categoryId) return setAttrs([]);
    let alive = true;
    void categoryAttributesAction(categoryId).then((r) => {
      if (alive && r.ok) setAttrs(r.data as AttrDef[]);
    });
    return () => {
      alive = false;
    };
  }, [categoryId]);
  const leafs = categories.filter((c) => c.depth > 0);
  return (
    <ActionForm action={saveProductAction} successMessage={t("products.saved")} redirectTo={(d: { id: string }) => `/supplier/products/${d.id}`}>
      <FormError />
      {product?.id ? <input type="hidden" name="id" value={product.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="sku" required label={t("products.sku")} defaultValue={product?.sku} dir="ltr" />
        <div className="space-y-1.5">
          <Label htmlFor="categoryId">
            {t("products.category")} <span className="text-danger-600">*</span>
          </Label>
          <Select id="categoryId" name="categoryId" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("common.select")}</option>
            {categories
              .filter((c) => c.depth === 0)
              .map((root) => (
                <optgroup key={root.id} label={L(root)}>
                  {leafs
                    .filter((c) => c.parentId === root.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {L(c)}
                      </option>
                    ))}
                </optgroup>
              ))}
          </Select>
        </div>
        <Field name="nameAr" required label={t("products.nameAr")} defaultValue={product?.nameAr} dir="rtl" />
        <Field name="nameEn" required label={t("products.nameEn")} defaultValue={product?.nameEn} dir="ltr" />
        <Field name="brandName" label={t("products.brand")} defaultValue={product?.brandName ?? ""} />
        <Field name="model" label={t("products.model")} defaultValue={product?.model ?? ""} dir="ltr" />
        <Field as="select" name="saleUnit" required label={t("products.saleUnit")} defaultValue={product?.saleUnit ?? ""} placeholder={t("common.select")} options={units.map((u) => ({ value: u.code, label: `${L(u)} (${u.code})` }))} />
        <Field name="countryOfOrigin" label={t("products.origin")} defaultValue={product?.countryOfOrigin ?? ""} />
        <Field name="moq" inputMode="decimal" label={t("products.moq")} defaultValue={product?.moq ?? "1"} dir="ltr" />
        <Field name="orderIncrement" inputMode="decimal" label={t("products.increment")} defaultValue={product?.orderIncrement ?? "1"} dir="ltr" />
        <Field name="packSize" inputMode="decimal" label={t("products.packSize")} defaultValue={product?.packSize ?? "1"} dir="ltr" />
        <Field name="leadTimeDays" type="number" min={0} max={365} label={t("products.leadTime")} defaultValue={product?.leadTimeDays ?? ""} dir="ltr" />
        <Field as="select" name="vatRate" label={t("products.vatRate")} defaultValue={product?.vatRate ? String(Number(product.vatRate)) : "0.15"} options={[{ value: "0.15", label: "15%" }, { value: "0", label: "0%" }]} />
        <Field as="select" name="status" label={t("products.statusLabel")} defaultValue={product?.status ?? "draft"} options={(["draft", "active", "inactive"] as const).map((s) => ({ value: s, label: t(`products.status.${s}`) }))} />
        <Field name="certifications" label={t("products.certifications")} defaultValue={product?.certifications.join(", ") ?? ""} className="md:col-span-2" />
        <Field as="textarea" name="descriptionAr" label={t("products.descriptionAr")} defaultValue={product?.descriptionAr ?? ""} dir="rtl" />
        <Field as="textarea" name="descriptionEn" label={t("products.descriptionEn")} defaultValue={product?.descriptionEn ?? ""} dir="ltr" />
      </div>
      <fieldset className="rounded-lg border border-sand-200 p-4">
        <legend className="px-1 text-sm font-semibold text-ink-700">{t("products.attributes")}</legend>
        {!categoryId ? (
          <p className="text-sm text-ink-500">{t("products.selectCategoryFirst")}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {attrs.map((a) => {
              const label = (
                <>
                  {L(a)}
                  {a.unit ? <span className="text-ink-400"> ({a.unit})</span> : null}
                  {a.isCritical ? (
                    <Badge tone="accent" className="ms-1">
                      {t("catalog.critical")}
                    </Badge>
                  ) : null}
                </>
              );
              const dv = product?.attributes[a.key];
              return a.dataType === "enum" ? (
                <Field key={a.key} as="select" name={`attr.${a.key}`} label={label} defaultValue={dv === undefined ? "" : String(dv)} placeholder="—" options={a.options.map((o) => ({ value: o.value, label: L(o) }))} />
              ) : a.dataType === "boolean" ? (
                <Field key={a.key} as="select" name={`attr.${a.key}`} label={label} defaultValue={dv === undefined ? "" : String(dv)} placeholder="—" options={[{ value: "true", label: t("common.yes") }, { value: "false", label: t("common.no") }]} />
              ) : (
                <Field key={a.key} name={`attr.${a.key}`} label={label} defaultValue={dv === undefined ? "" : String(dv)} inputMode={a.dataType === "number" ? "decimal" : undefined} dir="ltr" />
              );
            })}
          </div>
        )}
      </fieldset>
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}

type Tier = { minQty: string; unitPrice: string; discountPct: string };

export function PricingEditor({ productId, lists, current }: { productId: string; lists: { id: string; name: string; kind: string }[]; current: Record<string, Tier[]> }) {
  const t = useTranslations();
  const [listId, setListId] = React.useState(lists[0]?.id ?? "");
  const [tiers, setTiers] = React.useState<Tier[]>(current[lists[0]?.id ?? ""] ?? [{ minQty: "1", unitPrice: "", discountPct: "0" }]);
  React.useEffect(() => {
    setTiers(current[listId]?.length ? current[listId]! : [{ minQty: "1", unitPrice: "", discountPct: "0" }]);
  }, [listId, current]);
  return (
    <Card>
      <CardHeader title={t("products.pricing")} />
      <CardBody>
        <ActionForm action={savePricesAction} successMessage={t("products.pricesSaved")}>
          <FormError />
          <input type="hidden" name="supplierProductId" value={productId} />
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="priceListId">{t("products.priceList")}</Label>
            <Select id="priceListId" name="priceListId" value={listId} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {t(`products.kinds.${l.kind as "retail"}`)}
                </option>
              ))}
            </Select>
          </div>
          <Table caption={t("products.pricing")}>
            <thead>
              <tr>
                <Th>{t("products.minQty")}</Th>
                <Th>{t("products.unitPrice")}</Th>
                <Th>{t("products.discount")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={i}>
                  <Td>
                    <Input name="minQty[]" aria-label={t("products.minQty")} inputMode="decimal" dir="ltr" value={tier.minQty} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} />
                  </Td>
                  <Td>
                    <Input name="unitPrice[]" aria-label={t("products.unitPrice")} inputMode="decimal" dir="ltr" value={tier.unitPrice} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                  </Td>
                  <Td>
                    <Input name="discountPct[]" aria-label={t("products.discount")} inputMode="decimal" dir="ltr" value={tier.discountPct} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, discountPct: e.target.value } : x)))} />
                  </Td>
                  <Td>
                    <Button variant="ghost" size="icon" aria-label={t("common.remove")} disabled={tiers.length === 1} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setTiers([...tiers, { minQty: "", unitPrice: "", discountPct: "0" }])}>
              <Plus />
              {t("products.addTier")}
            </Button>
            <SubmitButton>{t("products.savePrices")}</SubmitButton>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

export function StockEditor({ productId, warehouses, stock }: { productId: string; warehouses: { id: string; name: string }[]; stock: { warehouseId: string; onHand: string; reserved: string }[] }) {
  const t = useTranslations();
  if (!warehouses.length) return <p className="text-sm text-ink-500">{t("products.needWarehouse")}</p>;
  return (
    <Table caption={t("products.stock")}>
      <thead>
        <tr>
          <Th>{t("products.warehouse")}</Th>
          <Th>{t("products.reserved")}</Th>
          <Th>{t("products.onHand")}</Th>
        </tr>
      </thead>
      <tbody>
        {warehouses.map((w) => {
          const s = stock.find((x) => x.warehouseId === w.id);
          return (
            <tr key={w.id}>
              <Td>{w.name}</Td>
              <Td dir="ltr">{Number(s?.reserved ?? 0)}</Td>
              <Td>
                <ActionForm action={setStockAction} successMessage={t("products.stockSaved")} className="flex items-center gap-2 space-y-0">
                  <input type="hidden" name="warehouseId" value={w.id} />
                  <input type="hidden" name="supplierProductId" value={productId} />
                  <Input name="onHand" aria-label={t("products.onHand")} inputMode="decimal" defaultValue={Number(s?.onHand ?? 0)} className="w-28" dir="ltr" />
                  <SubmitButton size="sm" variant="outline">
                    {t("products.setStock")}
                  </SubmitButton>
                </ActionForm>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function PublishToggle({ productId, published }: { productId: string; published: boolean }) {
  const t = useTranslations("products");
  return (
    <ActionButton variant={published ? "outline" : "accent"} action={() => setPublishedAction(productId, !published)} successMessage={published ? t("notPublished") : t("published")}>
      {published ? t("unpublish") : t("publish")}
    </ActionButton>
  );
}
