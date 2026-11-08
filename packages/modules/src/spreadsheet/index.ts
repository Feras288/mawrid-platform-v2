import ExcelJS from "exceljs";
import Papa from "papaparse";
import { AppError } from "@platform/core";

export interface Sheet {
  name: string;
  /** Rows as arrays of cell display values (strings); empty trailing cells trimmed. */
  rows: string[][];
}

const MAX_ROWS = 20_000;
const MAX_COLS = 60;

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellText((v as { result: ExcelJS.CellValue }).result);
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

/** Parse an XLSX workbook (all sheets). Formulas use cached results; merged cells repeat the master value. */
export async function parseXlsx(buffer: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (e) {
    throw new AppError("VALIDATION", "Could not read the Excel file", { key: "spreadsheet_unreadable", cause: e });
  }
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    const lastRow = Math.min(ws.rowCount, MAX_ROWS);
    for (let r = 1; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      const cols = Math.min(Math.max(row.cellCount, ws.columnCount), MAX_COLS);
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        const v = cell.isMerged && cell.master ? cell.master.value : cell.value;
        cells.push(cellText(v).replace(/\s+/g, " ").trim());
      }
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      rows.push(cells);
    }
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

/** Parse CSV with delimiter detection; strips a UTF-8 BOM. */
export function parseCsv(buffer: Buffer): Sheet[] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false, delimitersToGuess: [",", ";", "\t", "|"] });
  const rows = res.data.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? "").replace(/\s+/g, " ").trim()));
  return [{ name: "CSV", rows }];
}

export async function parseSpreadsheet(buffer: Buffer, mime: string): Promise<Sheet[]> {
  if (mime === "text/csv") return parseCsv(buffer);
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return parseXlsx(buffer);
  throw new AppError("UNSUPPORTED_MEDIA", "Unsupported spreadsheet type", { key: "file_type_not_allowed" });
}

/** Map rows with a header row into objects keyed by normalized header names. */
export function rowsToObjects(rows: string[][], headerRow = 0): { header: string[]; records: { row: number; values: Record<string, string> }[] } {
  const header = (rows[headerRow] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const records: { row: number; values: Record<string, string> }[] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (!r.some((c) => c !== "")) continue;
    const values: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) values[h] = r[j] ?? "";
    });
    records.push({ row: i + 1, values });
  }
  return { header, records };
}

/** Build an XLSX file from rows (used for templates and exports). */
export async function buildXlsx(sheets: { name: string; rows: (string | number | null)[][]; rtl?: boolean }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ rightToLeft: Boolean(s.rtl) }] });
    for (const r of s.rows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
