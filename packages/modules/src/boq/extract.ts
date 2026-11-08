/**
 * Rule-based BOQ extraction from tabular rows (XLSX/CSV sheets or PDF text reconstructed into rows).
 * Pure functions — no I/O — so they are unit-tested against a golden set.
 */
import { normalizeText, parseLocaleNumber } from "@platform/core/text";

export type Field = "description" | "quantity" | "unit" | "itemCode" | "rate" | "amount";

const HEADER_KEYWORDS: Record<Field, string[]> = {
  description: ["description", "desc", "item description", "description of work", "description of works", "particulars", "specification", "الوصف", "وصف", "البيان", "بيان الاعمال", "وصف البند", "وصف الاعمال", "الاعمال"],
  quantity: ["qty", "qty.", "quantity", "quantities", "الكميه", "الكمية", "كميه", "كمية", "العدد"],
  unit: ["unit", "units", "uom", "u/m", "unit of measure", "الوحده", "الوحدة", "وحده", "وحدة", "وحدة القياس"],
  itemCode: ["item", "item no", "item no.", "no", "no.", "s.no", "sr", "sr.", "s/n", "ref", "ref.", "code", "item code", "رقم البند", "رقم", "الرقم", "م", "البند", "مسلسل", "رمز"],
  rate: ["rate", "unit rate", "unit price", "price", "سعر", "سعر الوحده", "سعر الوحدة", "الفئه", "الفئة", "السعر"],
  amount: ["amount", "total", "total price", "value", "المبلغ", "الاجمالي", "الإجمالي", "القيمه", "القيمة", "المجموع"],
};

const NORMALIZED_KEYWORDS: Record<Field, Set<string>> = Object.fromEntries(
  (Object.keys(HEADER_KEYWORDS) as Field[]).map((f) => [f, new Set(HEADER_KEYWORDS[f].map((k) => normalizeText(k)))]),
) as Record<Field, Set<string>>;

const TOTAL_WORDS = ["total", "sub total", "subtotal", "grand total", "carried forward", "brought forward", "carried to summary", "الاجمالي", "اجمالي", "المجموع", "مجموع", "المرحل", "مرحل", "الاجمالى"];

export function classifyHeaderCell(cell: string): Field | null {
  const n = normalizeText(cell);
  if (!n) return null;
  // exact keyword first, then contained keyword (longest wins)
  for (const f of Object.keys(NORMALIZED_KEYWORDS) as Field[]) if (NORMALIZED_KEYWORDS[f].has(n)) return f;
  let best: { f: Field; len: number } | null = null;
  for (const f of Object.keys(NORMALIZED_KEYWORDS) as Field[]) {
    for (const k of NORMALIZED_KEYWORDS[f]) {
      if (k.length >= 3 && n.includes(k) && (!best || k.length > best.len)) best = { f, len: k.length };
    }
  }
  return best?.f ?? null;
}

export interface Mapping {
  headerRow: number;
  description: number;
  quantity: number;
  unit?: number;
  itemCode?: number;
  rate?: number;
  amount?: number;
  score: number;
}

/** Find the header row and column mapping in the first rows of a sheet. */
export function detectMapping(rows: string[][], maxScan = 40): Mapping | null {
  let best: Mapping | null = null;
  for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
    const row = rows[r] ?? [];
    const found: Partial<Record<Field, number>> = {};
    row.forEach((cell, c) => {
      const f = classifyHeaderCell(cell);
      if (f && found[f] === undefined) found[f] = c;
    });
    if (found.description === undefined || found.quantity === undefined) continue;
    const score = Object.keys(found).length;
    if (!best || score > best.score) {
      best = { headerRow: r, description: found.description, quantity: found.quantity, unit: found.unit, itemCode: found.itemCode, rate: found.rate, amount: found.amount, score };
    }
  }
  return best;
}

/** Fallback when no header row is recognizable: infer columns from content statistics. */
export function inferMapping(rows: string[][], unitAliases: Set<string>): Mapping | null {
  const sample = rows.slice(0, 200).filter((r) => r.some((c) => c));
  if (sample.length < 3) return null;
  const width = Math.max(...sample.map((r) => r.length));
  const stats = Array.from({ length: width }, (_, c) => {
    let numeric = 0;
    let unitLike = 0;
    let textLen = 0;
    let nonEmpty = 0;
    for (const r of sample) {
      const v = (r[c] ?? "").trim();
      if (!v) continue;
      nonEmpty++;
      if (parseLocaleNumber(v) !== null && !/[a-zA-Z؀-ۿ]{2,}/.test(v)) numeric++;
      if (unitAliases.has(v.toLowerCase())) unitLike++;
      textLen += v.length;
    }
    return { c, numeric, unitLike, avgLen: nonEmpty ? textLen / nonEmpty : 0, nonEmpty };
  });
  const desc = [...stats].sort((a, b) => b.avgLen - a.avgLen)[0];
  const unit = [...stats].filter((s) => s.unitLike >= sample.length * 0.3).sort((a, b) => b.unitLike - a.unitLike)[0];
  const numericCols = stats.filter((s) => s.numeric >= sample.length * 0.3 && s.c !== desc?.c).sort((a, b) => a.c - b.c);
  if (!desc || !numericCols.length) return null;
  // quantity: first numeric column after the unit column if any, else the first numeric column
  const qty = unit ? (numericCols.find((s) => s.c > unit.c) ?? numericCols[0]!) : numericCols[0]!;
  return { headerRow: -1, description: desc.c, quantity: qty.c, unit: unit?.c, score: 1 };
}

export interface ParsedLine {
  lineNo: number;
  itemCode: string | null;
  section: string | null;
  rawText: string;
  description: string;
  quantity: string | null;
  unitRaw: string | null;
  source: { sheet?: string; row?: number; page?: number };
  issues: string[];
}

const isTotalRow = (text: string) => {
  const n = normalizeText(text);
  return TOTAL_WORDS.some((w) => n === normalizeText(w) || n.startsWith(normalizeText(w) + " "));
};

/**
 * Turn rows into BOQ lines given a mapping:
 * - rows with description + quantity → items
 * - rows with description only: section heading (short) or continuation of the previous item
 * - total / carried-forward rows are skipped
 */
export function parseRows(rows: string[][], m: Mapping, meta: { sheet?: string; page?: (rowIndex: number) => number | undefined } = {}): ParsedLine[] {
  const out: ParsedLine[] = [];
  let section: string | null = null;
  let prevWasItem = false;
  for (let r = m.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const cell = (i?: number) => (i === undefined ? "" : (row[i] ?? "").trim());
    const desc = cell(m.description);
    const qtyRaw = cell(m.quantity);
    const unitRaw = cell(m.unit);
    const code = cell(m.itemCode);
    if (!row.some((c) => c && c.trim())) {
      prevWasItem = false;
      continue;
    }
    if (desc && isTotalRow(desc)) {
      prevWasItem = false;
      continue;
    }
    // repeated header rows on later pages
    if (classifyHeaderCell(desc) === "description" && classifyHeaderCell(qtyRaw) === "quantity") continue;
    const qty = qtyRaw ? parseLocaleNumber(qtyRaw) : null;
    const source = { sheet: meta.sheet, row: r + 1, page: meta.page?.(r) };
    if (desc && (qty !== null || unitRaw)) {
      const issues: string[] = [];
      if (qty === null) issues.push(qtyRaw ? "quantity_unreadable" : "quantity_missing");
      if (!unitRaw) issues.push("unit_missing");
      out.push({
        lineNo: out.length + 1,
        itemCode: code || null,
        section,
        rawText: row.filter(Boolean).join(" | "),
        description: desc,
        quantity: qty,
        unitRaw: unitRaw || null,
        source,
        issues,
      });
      prevWasItem = true;
      continue;
    }
    if (desc && !qtyRaw && !unitRaw) {
      const prev = out[out.length - 1];
      if (prevWasItem && prev && !code && desc.length > 0 && !/[:：]$/.test(desc) && desc.length > 25) {
        prev.description = `${prev.description} ${desc}`;
        prev.rawText = `${prev.rawText} ${desc}`;
        continue;
      }
      section = desc.replace(/[:：]\s*$/, "").slice(0, 200);
      prevWasItem = false;
      continue;
    }
    if (!desc && qty !== null && out.length && prevWasItem) {
      // quantity on its own row under a description — attach if previous lacks quantity
      const prev = out[out.length - 1]!;
      if (prev.quantity === null) {
        prev.quantity = qty;
        prev.issues = prev.issues.filter((i) => !i.startsWith("quantity"));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------- PDF text → rows

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

/** Group positioned text items into visual lines (by page and y), each a list of cells sorted by x. */
export function itemsToLines(items: TextItem[], yTolerance = 3): { page: number; y: number; cells: { text: string; x: number; xEnd: number }[] }[] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= yTolerance) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it] });
  }
  return lines.map((l) => {
    const its = l.items.sort((a, b) => a.x - b.x);
    const cells: { text: string; x: number; xEnd: number }[] = [];
    for (const it of its) {
      const prev = cells[cells.length - 1];
      const gap = prev ? it.x - prev.xEnd : Infinity;
      if (prev && gap < 6) {
        prev.text += (gap > 1.5 ? " " : "") + it.str;
        prev.xEnd = it.x + it.width;
      } else cells.push({ text: it.str, x: it.x, xEnd: it.x + it.width });
    }
    return { page: l.page, y: l.y, cells: cells.map((c) => ({ ...c, text: c.text.trim() })) };
  });
}

/**
 * Convert visual lines into a column grid. Columns are anchored on the detected header line (cells'
 * x centers); every later cell is assigned to the nearest header column.
 */
export function linesToGrid(lines: ReturnType<typeof itemsToLines>): { rows: string[][]; pages: number[] } {
  let header: { centers: number[] } | null = null;
  const rows: string[][] = [];
  const pages: number[] = [];
  for (const l of lines) {
    if (!header) {
      const fields = l.cells.map((c) => classifyHeaderCell(c.text));
      if (fields.includes("description") && fields.includes("quantity")) {
        header = { centers: l.cells.map((c) => (c.x + c.xEnd) / 2) };
        rows.push(l.cells.map((c) => c.text));
        pages.push(l.page);
      }
      continue;
    }
    const row = new Array<string>(header.centers.length).fill("");
    for (const c of l.cells) {
      const center = (c.x + c.xEnd) / 2;
      // a cell spanning several columns (long description) goes to the column under its start
      let idx = 0;
      let bestD = Infinity;
      header.centers.forEach((hc, i) => {
        const d = Math.min(Math.abs(hc - center), Math.abs(hc - c.x));
        if (d < bestD) {
          bestD = d;
          idx = i;
        }
      });
      row[idx] = row[idx] ? `${row[idx]} ${c.text}` : c.text;
    }
    rows.push(row);
    pages.push(l.page);
  }
  return { rows, pages };
}

/** Line-level extraction confidence (0..1) from the issues found. */
export function lineConfidence(l: { description: string; quantity: string | null; unit: string | null; issues: string[] }): number {
  let c = 0.95;
  if (!l.quantity) c -= 0.35;
  if (!l.unit) c -= 0.2;
  if (l.description.length < 6) c -= 0.2;
  c -= 0.05 * l.issues.filter((i) => !i.startsWith("quantity") && i !== "unit_missing" && i !== "unit_unknown").length;
  return Math.max(0.05, Math.min(1, Number(c.toFixed(4))));
}
