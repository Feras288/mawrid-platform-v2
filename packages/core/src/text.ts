/**
 * Text normalization for Arabic/English search and matching.
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Convert Arabic-Indic and Persian digits to ASCII; Arabic decimal/thousands separators too. */
export function toAsciiDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const i = ARABIC_INDIC.indexOf(ch);
    if (i >= 0) {
      out += String(i);
      continue;
    }
    const j = EXT_ARABIC_INDIC.indexOf(ch);
    if (j >= 0) {
      out += String(j);
      continue;
    }
    if (ch === "٫") out += "."; // Arabic decimal separator
    else if (ch === "٬") out += ","; // Arabic thousands separator
    else out += ch;
  }
  return out;
}

/** Normalize Arabic letter variants for matching (not for display). */
export function normalizeArabic(s: string): string {
  return s
    .replace(ARABIC_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

/** Full normalization for search/matching keys. */
export function normalizeText(s: string): string {
  return normalizeArabic(toAsciiDigits(s))
    .toLowerCase()
    .replace(/[×xX]\s*(?=\d)/g, "x")
    .replace(/[“”"'`´]/g, "")
    .replace(/[‌-‏‪-‮]/g, "") // bidi marks
    .replace(/[^\p{L}\p{N}.\/x²³]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Parse a localized number like "١٬٢٣٤٫٥", "1,234.50", "1 234,5" → string decimal or null. */
export function parseLocaleNumber(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  let s = toAsciiDigits(String(raw)).trim().replace(/\s+/g, "");
  if (!s) return null;
  s = s.replace(/[^0-9.,\-]/g, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // the later one is the decimal separator
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,234" (thousands) vs "12,5" (decimal): treat as thousands if exactly 3 digits follow
    const after = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) ?? []).length;
    s = after === 3 && (commaCount > 1 || s.length > 4) ? s.replace(/,/g, "") : s.replace(",", ".");
    if (commaCount > 1) s = s.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

export function slugify(s: string): string {
  return toAsciiDigits(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Levenshtein-based similarity in [0,1] for short strings. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[n]! / Math.max(m, n);
}

/** Jaccard similarity over token sets. */
export function tokenJaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
