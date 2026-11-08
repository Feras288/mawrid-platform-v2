"use client";

import { useTranslations } from "next-intl";
import * as React from "react";
import { addLineAction, approveBoqAction, columnMappingAction, rematchAction, reprocessAction, selectMatchAction, setReviewAction, updateItemAction } from "@/app/actions/procurement";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { Badge, type BadgeTone, Button, Card, Table, Td, Th } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const PROCESSING = new Set(["received", "extracting", "parsed", "normalizing", "matching"]);

/** Refreshes server data while the document is processing in the worker. */
export function AutoRefresh({ status }: { status: string }) {
  const router = useRouter();
  React.useEffect(() => {
    if (!PROCESSING.has(status)) return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [status, router]);
  return null;
}

type Opt = { value: string; label: string };
export type ItemRow = {
  id: string;
  lineNo: number;
  itemCode: string | null;
  section: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitRaw: string | null;
  categoryId: string | null;
  categoryLabel: string;
  attributes: Record<string, string | number | boolean>;
  confidence: string;
  matchStatus: string;
  reviewStatus: string;
  matchedCanonicalId: string | null;
  issues: string[];
  notes: string | null;
  candidates: { canonicalProductId: string; score: string; label: string; reasons: string[] }[];
};

const REVIEW_TONE: Record<string, BadgeTone> = { pending: "info", needs_review: "warning", approved: "success", excluded: "neutral" };
const MATCH_TONE: Record<string, BadgeTone> = { auto_suggested: "primary", confirmed: "success", needs_review: "warning", no_match: "neutral", rejected: "neutral", unmatched: "neutral" };

export function ItemsTable({ documentId, items, units, categories, editable }: { documentId: string; items: ItemRow[]; units: Opt[]; categories: Opt[]; editable: boolean }) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  return (
    <Card>
      {editable ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 p-3">
          <BulkButton documentId={documentId} ids={[...selected]} status="approved" label={t("approveSelected")} disabled={!selected.size} onDone={() => setSelected(new Set())} />
          <BulkButton documentId={documentId} ids={[...selected]} status="excluded" label={t("excludeSelected")} variant="outline" disabled={!selected.size} onDone={() => setSelected(new Set())} />
          <BulkButton documentId={documentId} ids={[]} mode="all_clean" status="approved" label={t("approveClean")} variant="secondary" />
          <span className="ms-auto text-xs text-ink-500">{t("aiNeverApproves")}</span>
        </div>
      ) : null}
      <Table caption={t("title")}>
        <thead>
          <tr>
            {editable ? (
              <Th className="w-8">
                <input type="checkbox" aria-label={t("selectAll")} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} className="size-4 accent-primary-700" />
              </Th>
            ) : null}
            <Th className="w-10">{t("line")}</Th>
            <Th>{t("description")}</Th>
            <Th className="text-end">{t("quantity")}</Th>
            <Th>{t("unit")}</Th>
            <Th>{t("category")}</Th>
            <Th>{t("match")}</Th>
            <Th>{t("review")}</Th>
            {editable ? <Th /> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className={cn("hover:bg-sand-50/60", i.reviewStatus === "excluded" && "opacity-60")}>
              {editable ? (
                <Td>
                  <input type="checkbox" aria-label={`${t("line")} ${i.lineNo}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="size-4 accent-primary-700" />
                </Td>
              ) : null}
              <Td className="text-xs text-ink-500" dir="ltr">
                {i.lineNo}
                {i.itemCode ? <span className="block">{i.itemCode}</span> : null}
              </Td>
              <Td className="max-w-md">
                <p className="text-ink-900">{i.description}</p>
                {i.section ? <p className="mt-0.5 text-xs text-ink-400">{i.section}</p> : null}
                {Object.keys(i.attributes).length ? (
                  <p className="mt-1 text-[11px] text-ink-500" dir="ltr">
                    {Object.entries(i.attributes)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")}
                  </p>
                ) : null}
                {i.issues.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.issues.map((x) => (
                      <Badge key={x} tone="warning">
                        {t.has(`issues.${x}`) ? t(`issues.${x}` as "issues.unit_missing") : x}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Td>
              <Td className="text-end font-medium" dir="ltr">
                {i.quantity ? Number(i.quantity).toLocaleString("en-US", { maximumFractionDigits: 4 }) : <span className="text-danger-600">—</span>}
              </Td>
              <Td dir="ltr">{i.unit ?? <span className="text-danger-600">{i.unitRaw ?? "—"}</span>}</Td>
              <Td className="text-xs">{i.categoryLabel || "—"}</Td>
              <Td className="max-w-56 text-xs">
                <Badge tone={MATCH_TONE[i.matchStatus] ?? "neutral"}>{t(`matchStatus.${i.matchStatus as "unmatched"}`)}</Badge>
                {i.matchedCanonicalId ? <p className="mt-1 text-ink-600">{i.candidates.find((c) => c.canonicalProductId === i.matchedCanonicalId)?.label}</p> : null}
              </Td>
              <Td>
                <Badge tone={REVIEW_TONE[i.reviewStatus] ?? "neutral"}>{t(`reviewStatus.${i.reviewStatus as "pending"}`)}</Badge>
              </Td>
              {editable ? (
                <Td className="text-end">
                  <EditItemDialog item={i} units={units} categories={categories} />
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>
      {!items.length ? <p className="p-6 text-center text-sm text-ink-500">{tc("none")}</p> : null}
    </Card>
  );
}

function BulkButton({ documentId, ids, status, label, variant, disabled, mode, onDone }: { documentId: string; ids: string[]; status: string; label: string; variant?: "outline" | "secondary"; disabled?: boolean; mode?: "all_clean"; onDone?: () => void }) {
  const t = useTranslations("boq");
  return (
    <ActionButton
      size="sm"
      variant={variant}
      disabled={disabled}
      successMessage={t("updated")}
      action={async () => {
        const fd = new FormData();
        fd.set("documentId", documentId);
        fd.set("status", status);
        if (mode) fd.set("mode", mode);
        for (const id of ids) fd.append("itemIds[]", id);
        const r = await setReviewAction(fd);
        if (r.ok) onDone?.();
        return r;
      }}
    >
      {label}
    </ActionButton>
  );
}

function EditItemDialog({ item, units, categories }: { item: ItemRow; units: Opt[]; categories: Opt[] }) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  return (
    <Modal wide title={`${t("editLine")} #${item.lineNo}`} trigger={<Button size="sm" variant="outline">{tc("edit")}</Button>}>
      <div className="space-y-6">
        <ActionForm action={updateItemAction} successMessage={t("lineSaved")}>
          <FormError />
          <input type="hidden" name="itemId" value={item.id} />
          <Field as="textarea" name="description" required label={t("description")} defaultValue={item.description} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="quantity" inputMode="decimal" label={t("quantity")} defaultValue={item.quantity ? String(Number(item.quantity)) : ""} dir="ltr" />
            <Field as="select" name="unit" label={t("unit")} defaultValue={item.unit ?? ""} placeholder="—" options={units} />
            <Field as="select" name="categoryId" label={t("category")} defaultValue={item.categoryId ?? ""} placeholder="—" options={categories} />
          </div>
          <Field name="notes" label={tc("notes")} defaultValue={item.notes ?? ""} />
          <div className="flex justify-end">
            <SubmitButton>{tc("save")}</SubmitButton>
          </div>
        </ActionForm>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("candidates")}</h3>
            <ActionButton size="sm" variant="ghost" action={() => rematchAction(item.id)}>
              {t("rematch")}
            </ActionButton>
          </div>
          {item.candidates.length === 0 ? (
            <p className="text-sm text-ink-500">{t("noCandidates")}</p>
          ) : (
            <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
              {item.candidates.map((c) => (
                <li key={c.canonicalProductId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{c.label}</p>
                    <p className="text-[11px] text-ink-500" dir="ltr">
                      {t("score")}: {Number(c.score).toFixed(2)} · {c.reasons.filter((r) => !r.startsWith("ai:")).join(", ")}
                    </p>
                  </div>
                  {item.matchedCanonicalId === c.canonicalProductId && item.matchStatus === "confirmed" ? (
                    <Badge tone="success">{t("matchStatus.confirmed")}</Badge>
                  ) : (
                    <ActionButton size="sm" variant="outline" action={() => selectMatchAction(item.id, c.canonicalProductId)}>
                      {t("confirmMatch")}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ActionButton size="sm" variant="ghost" className="mt-2" action={() => selectMatchAction(item.id, null)}>
            {t("noMatch")}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

export function AddLineDialog({ documentId, units }: { documentId: string; units: Opt[] }) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  return (
    <Modal title={t("addLine")} trigger={<Button variant="outline">{t("addLine")}</Button>}>
      <ActionForm action={addLineAction} successMessage={t("lineSaved")} resetOnSuccess>
        <FormError />
        <input type="hidden" name="documentId" value={documentId} />
        <Field as="textarea" name="description" required label={t("description")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="quantity" required inputMode="decimal" label={t("quantity")} dir="ltr" />
          <Field as="select" name="unit" required label={t("unit")} placeholder={tc("select")} options={units} />
          <Field name="itemCode" label={t("itemCode")} dir="ltr" />
          <Field name="section" label={t("section")} />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{tc("add")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ApproveBoqDialog({ documentId }: { documentId: string }) {
  const t = useTranslations("boq");
  const tc = useTranslations("common");
  return (
    <Modal title={t("approve")} description={t("approveHint")} trigger={<Button variant="accent">{t("approve")}</Button>}>
      <ActionForm action={approveBoqAction} successMessage={t("updated")}>
        <FormError />
        <input type="hidden" name="documentId" value={documentId} />
        <Field as="textarea" name="notes" label={tc("notes")} />
        <div className="flex justify-end">
          <SubmitButton variant="accent">{t("approve")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function ReprocessButton({ documentId }: { documentId: string }) {
  const t = useTranslations("boq");
  return (
    <ActionButton variant="outline" action={() => reprocessAction(documentId)}>
      {t("reprocess")}
    </ActionButton>
  );
}

export function ColumnMappingForm({ documentId, preview }: { documentId: string; preview: { sheet: string; rows: string[][] }[] }) {
  const t = useTranslations("boq");
  const [sheet, setSheet] = React.useState(preview[0]?.sheet ?? "");
  const current = preview.find((p) => p.sheet === sheet) ?? preview[0];
  const width = Math.max(1, ...(current?.rows.map((r) => r.length) ?? [1]));
  const cols = Array.from({ length: width }, (_, i) => ({ value: String(i), label: t("column", { n: i + 1 }) }));
  return (
    <Card className="p-4">
      <ActionForm action={columnMappingAction} successMessage={t("updated")}>
        <FormError />
        <input type="hidden" name="documentId" value={documentId} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field as="select" name="sheet" label={t("sheet")} value={sheet} onChange={(e) => setSheet(e.currentTarget.value)} options={preview.map((p) => ({ value: p.sheet, label: p.sheet }))} />
          <Field name="headerRow" type="number" min={1} max={40} required label={t("headerRow")} defaultValue={1} dir="ltr" />
          <Field as="select" name="description" required label={t("colDescription")} placeholder="—" options={cols} />
          <Field as="select" name="quantity" required label={t("colQuantity")} placeholder="—" options={cols} />
          <Field as="select" name="unit" label={t("colUnit")} placeholder="—" options={cols} />
          <Field as="select" name="itemCode" label={t("colItemCode")} placeholder="—" options={cols} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-sand-200">
          <table className="text-xs">
            <tbody>
              {current?.rows.map((r, i) => (
                <tr key={i} className="border-b border-sand-100">
                  <td className="bg-sand-50 px-2 py-1 text-ink-400">{i + 1}</td>
                  {Array.from({ length: width }, (_, j) => (
                    <td key={j} className="max-w-48 truncate px-2 py-1">
                      {r[j] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SubmitButton>{t("applyMapping")}</SubmitButton>
      </ActionForm>
    </Card>
  );
}
