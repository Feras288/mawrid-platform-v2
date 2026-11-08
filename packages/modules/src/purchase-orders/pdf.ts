import { embeddedFontCss } from "@platform/integrations/pdf";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface PoPdfData {
  brand: string;
  code: string;
  issuedAt: Date;
  status: string;
  buyer: { name: string; vat: string | null; cr: string | null; address: string | null; city: string | null };
  supplier: { name: string; vat: string | null; cr: string | null; address: string | null; city: string | null };
  project: string | null;
  rfq: string | null;
  lines: { no: number; description: string; brand: string | null; quantity: string; unit: string; unitPrice: string; vatRate: string; lineNet: string; lineVat: string; lineTotal: string }[];
  subtotal: string;
  shipping: string;
  vat: string;
  total: string;
  currency: string;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  deliveryAddress: string | null;
  expectedDeliveryAt: Date | null;
  notes: string | null;
  approvals: { name: string; at: Date; step: string }[];
  verificationCode: string;
  verificationUrl: string;
  qr: string;
}

const L = {
  ar: { title: "أمر شراء", no: "رقم أمر الشراء", date: "تاريخ الإصدار", buyer: "المشتري", supplier: "المورد", vat: "الرقم الضريبي", cr: "السجل التجاري", project: "المشروع", rfq: "طلب عرض السعر", line: "#", desc: "الوصف", qty: "الكمية", unit: "الوحدة", price: "سعر الوحدة", vatPct: "الضريبة %", net: "الصافي", vatAmt: "الضريبة", total: "الإجمالي", subtotal: "الإجمالي قبل الضريبة", shipping: "الشحن", vatTotal: "ضريبة القيمة المضافة", grand: "الإجمالي شامل الضريبة", payment: "شروط الدفع", delivery: "شروط التسليم", address: "عنوان التسليم", expected: "تاريخ التسليم المتوقع", notes: "ملاحظات", approvals: "الاعتمادات", verify: "التحقق من صحة المستند", verifyHint: "امسح الرمز أو افتح الرابط للتحقق من صحة أمر الشراء", status: "الحالة" },
  en: { title: "Purchase Order", no: "PO number", date: "Issue date", buyer: "Buyer", supplier: "Supplier", vat: "VAT no.", cr: "CR no.", project: "Project", rfq: "RFQ", line: "#", desc: "Description", qty: "Qty", unit: "Unit", price: "Unit price", vatPct: "VAT %", net: "Net", vatAmt: "VAT", total: "Total", subtotal: "Subtotal (ex-VAT)", shipping: "Shipping", vatTotal: "VAT", grand: "Total incl. VAT", payment: "Payment terms", delivery: "Delivery terms", address: "Delivery address", expected: "Expected delivery", notes: "Notes", approvals: "Approvals", verify: "Document verification", verifyHint: "Scan the code or open the link to verify this purchase order", status: "Status" },
};

const fmtNum = (v: string, dp: number, locale: "ar" | "en") => new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v));
const fmtDate = (d: Date, locale: "ar" | "en") => new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh" }).format(d);

/** Bilingual-ready PO document (one language per PDF; numbers & codes isolated LTR). */
export function poHtml(d: PoPdfData, locale: "ar" | "en"): string {
  const t = L[locale];
  const dir = locale === "ar" ? "rtl" : "ltr";
  const money = (v: string) => `<bdi class="n">${fmtNum(v, 2, locale)}</bdi>`;
  const party = (title: string, p: PoPdfData["buyer"]) => `<div class="box"><h3>${title}</h3><p class="strong">${esc(p.name)}</p>${p.vat ? `<p>${t.vat}: <bdi class="n">${esc(p.vat)}</bdi></p>` : ""}${p.cr ? `<p>${t.cr}: <bdi class="n">${esc(p.cr)}</bdi></p>` : ""}${p.address || p.city ? `<p>${esc([p.address, p.city].filter(Boolean).join("، "))}</p>` : ""}</div>`;
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><style>
${embeddedFontCss()}
*{box-sizing:border-box}body{font-family:"Plex Arabic",Arial,sans-serif;color:#1d2622;font-size:10.5px;margin:0}
.n{unicode-bidi:isolate;direction:ltr;font-variant-numeric:tabular-nums}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f5c4d;padding-bottom:10px;margin-bottom:12px}
.brand{font-size:20px;font-weight:700;color:#0f5c4d}h1{margin:0;font-size:22px}.meta p{margin:2px 0}
.parties{display:flex;gap:10px;margin-bottom:12px}.box{flex:1;border:1px solid #d6d3c7;border-radius:6px;padding:8px}.box h3{margin:0 0 4px;font-size:11px;color:#6b746f}.box p{margin:2px 0}.strong{font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:6px}th{background:#eef7f4;color:#0b463b;font-weight:700;padding:6px;border:1px solid #d6d3c7;text-align:start}td{padding:5px 6px;border:1px solid #e8e6de;vertical-align:top}td.num,th.num{text-align:end;white-space:nowrap}
tr{page-break-inside:avoid}.totals{width:45%;margin-${locale === "ar" ? "right" : "left"}:auto;margin-top:8px}.totals td{border:none;padding:3px 6px}.totals tr.grand td{font-weight:700;font-size:12px;border-top:2px solid #0f5c4d}
.terms{display:flex;gap:10px;margin-top:12px}.terms .box{min-height:40px}.verify{display:flex;gap:12px;align-items:center;margin-top:14px;border:1px dashed #b8893b;border-radius:6px;padding:8px}.verify img{width:84px;height:84px}
.small{color:#6b746f;font-size:9px}
</style></head><body>
<header><div><div class="brand">${esc(d.brand)}</div><h1>${t.title}</h1></div><div class="meta"><p>${t.no}: <bdi class="n strong">${esc(d.code)}</bdi></p><p>${t.date}: ${fmtDate(d.issuedAt, locale)}</p>${d.project ? `<p>${t.project}: ${esc(d.project)}</p>` : ""}${d.rfq ? `<p>${t.rfq}: <bdi class="n">${esc(d.rfq)}</bdi></p>` : ""}</div></header>
<div class="parties">${party(t.buyer, d.buyer)}${party(t.supplier, d.supplier)}</div>
<table><thead><tr><th>${t.line}</th><th>${t.desc}</th><th class="num">${t.qty}</th><th>${t.unit}</th><th class="num">${t.price}</th><th class="num">${t.vatPct}</th><th class="num">${t.net}</th><th class="num">${t.vatAmt}</th><th class="num">${t.total}</th></tr></thead><tbody>
${d.lines.map((l) => `<tr><td class="num"><bdi class="n">${l.no}</bdi></td><td>${esc(l.description)}${l.brand ? `<div class="small">${esc(l.brand)}</div>` : ""}</td><td class="num"><bdi class="n">${fmtNum(l.quantity, 2, locale)}</bdi></td><td><bdi class="n">${esc(l.unit)}</bdi></td><td class="num">${money(l.unitPrice)}</td><td class="num"><bdi class="n">${fmtNum(String(Number(l.vatRate) * 100), 0, locale)}</bdi></td><td class="num">${money(l.lineNet)}</td><td class="num">${money(l.lineVat)}</td><td class="num">${money(l.lineTotal)}</td></tr>`).join("")}
</tbody></table>
<table class="totals"><tr><td>${t.subtotal}</td><td class="num">${money(d.subtotal)}</td></tr><tr><td>${t.shipping}</td><td class="num">${money(d.shipping)}</td></tr><tr><td>${t.vatTotal}</td><td class="num">${money(d.vat)}</td></tr><tr class="grand"><td>${t.grand} (${esc(d.currency)})</td><td class="num">${money(d.total)}</td></tr></table>
<div class="terms"><div class="box"><h3>${t.payment}</h3><p>${esc(d.paymentTerms ?? "—")}</p></div><div class="box"><h3>${t.delivery}</h3><p>${esc(d.deliveryTerms ?? "—")}</p>${d.deliveryAddress ? `<p>${t.address}: ${esc(d.deliveryAddress)}</p>` : ""}${d.expectedDeliveryAt ? `<p>${t.expected}: ${fmtDate(d.expectedDeliveryAt, locale)}</p>` : ""}</div></div>
${d.notes ? `<div class="box" style="margin-top:10px"><h3>${t.notes}</h3><p>${esc(d.notes)}</p></div>` : ""}
${d.approvals.length ? `<div class="box" style="margin-top:10px"><h3>${t.approvals}</h3>${d.approvals.map((a) => `<p>${esc(a.step)} — ${esc(a.name)} — ${fmtDate(a.at, locale)}</p>`).join("")}</div>` : ""}
<div class="verify"><img src="${d.qr}" alt=""><div><p class="strong">${t.verify}</p><p class="small">${t.verifyHint}</p><p><bdi class="n">${esc(d.verificationUrl)}</bdi></p><p class="small">ID: <bdi class="n">${esc(d.verificationCode)}</bdi></p></div></div>
</body></html>`;
}
