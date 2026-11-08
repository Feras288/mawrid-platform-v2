/**
 * Rule-based normalization of BOQ line text: engineering attribute extraction and category
 * classification. Only values explicitly present in the text are extracted — nothing is inferred.
 */
import { normalizeText, toAsciiDigits } from "@platform/core/text";
import type { AttrValues } from "@platform/db/schema";

const num = (s: string) => Number(s.replace(",", "."));

function fractionToNumber(s: string): number | null {
  const t = s.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return num(mixed[1]!) + num(mixed[2]!) / num(mixed[3]!);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return num(frac[1]!) / num(frac[2]!);
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const MATERIALS: [string, RegExp][] = [
  ["upvc", /\bu[-\s]?pvc\b|يو\s?بي\s?في\s?سي/],
  ["cpvc", /\bc[-\s]?pvc\b/],
  ["ppr", /\bpp[-\s]?r\b|\bppr\b|بي\s?بي\s?ار/],
  ["hdpe", /\bhdpe\b|بولي\s?ايثيلين|بولي\s?إيثيلين/],
  ["pvc", /\bpvc\b|بي\s?في\s?سي/],
  ["stainless", /\bstainless\b|\bs\.?s\.?\s?(304|316)\b|ستانلس|استانلس/],
  ["gi", /\bg\.?i\.?\b|galvani[sz]ed|مجلفن/],
  ["ductile_iron", /ductile\s?iron|\bd\.?i\.?\b(?=.*pipe)|حديد\s?مرن/],
  ["cast_iron", /cast\s?iron|زهر/],
  ["copper", /\bcopper\b|\bcu\b|نحاس(?!\s?اصفر)/],
  ["brass", /\bbrass\b|نحاس\s?اصفر/],
  ["grp", /\bgrp\b|\bfrp\b|فايبر\s?جلاس|الياف\s?زجاجيه/],
  ["steel", /\b(black\s)?steel\b|\bms\b|حديد(?!\s?(مجلفن|زهر|مرن|تسليح))/],
  ["aluminum", /alumin(i)?um|المنيوم|الومنيوم/],
  ["rockwool", /rock\s?wool|صوف\s?صخري/],
  ["glasswool", /glass\s?wool|صوف\s?زجاجي/],
  ["elastomeric", /elastomeric|armaflex|مطاط\s?اسفنجي/],
];

const FITTINGS: [string, RegExp][] = [
  ["elbow_90", /elbow\s?(90|٩٠)?|bend|كوع(\s?90)?/],
  ["elbow_45", /elbow\s?45|كوع\s?45/],
  ["tee", /\btee\b|\bتي\b|تيه|مشترك/],
  ["reducer", /reducer|مسلوب|مختزل/],
  ["coupling", /coupl(ing|er)|socket\b|جلبه|جلبة|وصله\s?مستقيمه/],
  ["union", /\bunion\b|رابط/],
  ["cap", /end\s?cap|\bcap\b|طبه|طبة|سداده/],
  ["adapter", /adapt(o|e)r|محول/],
];

const VALVES: [string, RegExp][] = [
  ["gate", /gate\s?valve|محبس\s?بوابه|محبس\s?سكينه/],
  ["ball", /ball\s?valve|محبس\s?كروي|محبس\s?بلف/],
  ["butterfly", /butterfly|فراشه/],
  ["check", /check\s?valve|non[-\s]?return|عدم\s?رجوع/],
  ["globe", /globe\s?valve/],
  ["prv", /pressure\s?reduc|مخفض\s?ضغط/],
  ["osy", /os\s?&\s?y|o\.s\.&y/],
];

/**
 * Map Arabic unit words to Latin tokens so unit patterns work uniformly (JS  does not treat Arabic
 * letters as word characters). Longer forms first.
 */
const AR_UNITS: [RegExp, string][] = [
  [/(مم|ملم)\s?(2|²)/g, " mm2 "],
  [/كيلو\s?فولت\s?امبير|ك\.?ف\.?ا/g, " kva "],
  [/كيلو\s?فولت/g, " kv "],
  [/كيلو\s?وات/g, " kw "],
  [/(?<![؀-ۿ])(ملم|مم)(?![؀-ۿ])/g, " mm "],
  [/فولت/g, " v "],
  [/(أمبير|امبير|أمبيــر)/g, " a "],
  [/(?<![؀-ۿ])وات(?![؀-ۿ])/g, " w "],
  [/(?<![؀-ۿ])لتر(?![؀-ۿ])/g, " l "],
  [/(إنش|انش|بوصه|بوصة)/g, " inch "],
  [/(?<![؀-ۿ])(قطب|اقطاب|أقطاب)(?![؀-ۿ])/g, " p "],
  [/(درجه|درجة)\s?(مئويه|مئوية)?/g, " c "],
];

export function latinizeUnits(s: string): string {
  let out = s;
  for (const [re, rep] of AR_UNITS) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ");
}

export function extractAttributes(text: string): AttrValues {
  const raw = latinizeUnits(toAsciiDigits(text).toLowerCase().replace(/[×]/g, "x")).replace(/\s+/g, " ");
  const n = normalizeText(text);
  const a: AttrValues = {};

  // cable size: 4x16 mm², 4c x 16sqmm, 4*16mm2
  const cable = raw.match(/(\d{1,2})\s*(?:c(?:ore)?s?)?\s*[x*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:mm2|mm²|sq\.?\s?mm|sqmm|مم2|مم²|ملم2|ملم²)/);
  if (cable) {
    a.cores = Number(cable[1]);
    a.cross_section_mm2 = num(cable[2]!);
  } else {
    const cs = raw.match(/(\d{1,3}(?:\.\d+)?)\s*(?:mm2|mm²|sq\.?\s?mm|sqmm|مم2|مم²|ملم2|ملم²)/);
    if (cs) a.cross_section_mm2 = num(cs[1]!);
  }

  // diameter in mm: "Ø110", "110mm dia", "قطر 110 مم", "dn100"
  const dia =
    raw.match(/(?:ø|⌀|dia(?:meter)?\.?|قطر|dn)\s*[:=]?\s*(\d{1,4}(?:\.\d+)?)\s*(?:mm|مم|ملم)?/) ??
    (a.cross_section_mm2 === undefined ? raw.match(/(?<![x*\d.])(\d{2,4}(?:\.\d+)?)\s*(?:mm|مم|ملم)\b(?!\s*(?:thick|سماك|سمك))/) : null);
  if (dia) a.diameter_mm = num(dia[1]!);

  // diameter in inches: 2", 1 1/2", 3/4 inch, 2 انش
  const inch = raw.match(/(\d+\s\d\/\d|\d\/\d|\d+(?:\.\d+)?)\s*(?:"|''|”|inch(?:es)?|in\.(?=\s)|انش|إنش|بوصه|بوصة)/);
  if (inch) {
    const v = fractionToNumber(inch[1]!);
    if (v) a.diameter_inch = v;
  }

  const thick = raw.match(/(\d{1,3}(?:\.\d+)?)\s*(?:mm|مم|ملم)\s*(?:thick|thk)|(?:thickness|thk|سماكه|سماكة|سمك)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)/);
  if (thick) a.thickness_mm = num((thick[1] ?? thick[2])!);

  const pn = raw.match(/\bpn\s?-?\s?(\d{1,3})\b/);
  if (pn) a.pressure_class = `PN${pn[1]}`;
  const sdr = raw.match(/\bsdr\s?-?\s?(\d{1,2}(?:\.\d)?)\b/);
  if (sdr) a.sdr = num(sdr[1]!);
  const bar = raw.match(/(\d{1,3}(?:\.\d+)?)\s*bar\b/);
  if (bar) a.pressure_bar = num(bar[1]!);
  const sch = raw.match(/\bsch(?:edule)?\.?\s?(\d{2,3}|xs|std)\b/);
  if (sch) a.schedule = `SCH${sch[1]!.toUpperCase()}`;

  const kv = raw.match(/(\d+(?:\.\d+)?)\s*kv\b/);
  const v = raw.match(/(\d{2,4})\s*(?:v|volt|vac|فولت)\b/);
  if (kv) a.voltage = Math.round(num(kv[1]!) * 1000);
  else if (v) a.voltage = Number(v[1]);

  const kw = raw.match(/(\d+(?:\.\d+)?)\s*(?:kw|كيلو\s?وات)\b/);
  if (kw) a.power_kw = num(kw[1]!);
  const kva = raw.match(/(\d+(?:\.\d+)?)\s*kva\b/);
  if (kva) a.power_kva = num(kva[1]!);
  const w = raw.match(/(\d{1,5})\s*(?:w|watt|وات)\b/);
  if (w && !kw) a.power_w = Number(w[1]);

  const amp = raw.match(/(\d{1,4})\s*(?:a|amp|amps|ampere|امبير|أمبير)\b/);
  if (amp) a.current_rating_a = Number(amp[1]);
  const ka = raw.match(/(\d{1,3}(?:\.\d+)?)\s*ka\b/);
  if (ka) a.breaking_capacity_ka = num(ka[1]!);
  const poles = raw.match(/\b([1-4])\s*(?:p|pole|poles)\b|([1-4])\s*(?:قطب|اقطاب)/) ?? (/\b(sp|dp|tp|fp)\b/.exec(raw) ? null : null);
  if (poles) a.poles = Number(poles[1] ?? poles[2]);
  const brk = raw.match(/\b(mccb|mcb|rccb|rcbo|acb)\b/);
  if (brk) a.breaker_type = brk[1] === "rcbo" ? "rccb" : brk[1]!;

  const btu = raw.match(/(\d{1,3}[,.]?\d{3})\s*btu/);
  if (btu) a.capacity_btu = Number(btu[1]!.replace(/[,.]/g, ""));
  const tr = raw.match(/(\d+(?:\.\d+)?)\s*(?:tr|ton(?:s)?\s?(?:of\s)?refrigeration|طن\s?تبريد)\b/);
  if (tr) a.capacity_tr = num(tr[1]!);
  const ltr = raw.match(/(\d{1,5})\s*(?:l|ltr|liter|litre|لتر)\b/);
  if (ltr) a.capacity_l = Number(ltr[1]);
  const flow = raw.match(/(\d+(?:\.\d+)?)\s*(?:m3\/h|m³\/h|cmh)\b/);
  if (flow) a.flow_m3h = num(flow[1]!);
  const gpm = raw.match(/(\d+(?:\.\d+)?)\s*gpm\b/);
  if (gpm) a.flow_gpm = num(gpm[1]!);
  const head = raw.match(/(?:head|رفع)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*m\b/);
  if (head) a.head_m = num(head[1]!);
  const k = raw.match(/\bk\s?[-=]?\s?(\d{1,2}(?:\.\d)?)\b/);
  if (k && /sprinkler|رشاش/.test(n)) a.k_factor = num(k[1]!);
  const temp = raw.match(/(\d{2,3})\s*°?\s*c\b/);
  if (temp && /sprinkler|رشاش/.test(n)) a.temperature_rating_c = Number(temp[1]);

  for (const [value, re] of MATERIALS)
    if (re.test(raw) || re.test(n)) {
      a.material = value;
      break;
    }
  if (/\bxlpe\b/.test(raw)) a.insulation = "xlpe";
  else if (/\blszh\b|\blsoh\b/.test(raw)) a.insulation = "lszh";
  else if (/\bswa\b|armou?red|مسلح/.test(raw)) a.insulation = "swa";
  if (a.cross_section_mm2 !== undefined) {
    if (/\bcu\b|copper|نحاس/.test(raw)) a.conductor_material = "cu";
    else if (/\bal\b|alumin|المنيوم/.test(raw)) a.conductor_material = "al";
    if (a.material === "copper" || a.material === "aluminum") delete a.material;
  }
  if (/pipe|ماسور|مواسير|انبوب/.test(n) || /fitting|elbow|tee|كوع/.test(n)) {
    for (const [value, re] of FITTINGS)
      if (re.test(raw) || re.test(n)) {
        a.fitting_type = value;
        break;
      }
    if (/(^|\s)(pipe|pipes|ماسوره|مواسير|انبوب)(\s|$)/.test(n) && !/elbow|tee|كوع|reducer|مسلوب/.test(n)) delete a.fitting_type;
  }
  for (const [value, re] of VALVES)
    if (re.test(raw) || re.test(n)) {
      a.valve_type = value;
      break;
    }
  if (/smoke\s?detector|كاشف\s?دخان/.test(n)) a.detector_type = "smoke";
  else if (/heat\s?detector|كاشف\s?حراره/.test(n)) a.detector_type = "heat";
  if (/addressable|معنون/.test(n)) a.panel_type = "addressable";
  else if (/conventional|تقليدي/.test(n)) a.panel_type = "conventional";
  if (/pendent|متدلي/.test(n)) a.sprinkler_type = "pendent";
  else if (/upright|قائم/.test(n)) a.sprinkler_type = "upright";
  else if (/sidewall|جانبي/.test(n)) a.sprinkler_type = "sidewall";
  const cat = raw.match(/\bcat\s?(6a|6|7)\b/);
  if (cat) a.cable_category = `cat${cat[1]}`;
  return a;
}

/** Category keyword dictionary (slug → keywords, normalized). Highest weighted hit wins. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "power-cables": ["power cable", "cable", "كابل", "كيبل", "xlpe", "swa"],
  "building-wires": ["wire", "سلك", "اسلاك", "building wire"],
  "conduits-trunking": ["conduit", "trunking", "cable tray", "ماسوره كهرباء", "مجرى كيابل", "حامل كابلات"],
  "distribution-boards": ["distribution board", "panel board", "smdb", "mdb", "لوحه توزيع", "لوحة توزيع", "طبلون"],
  "circuit-breakers": ["breaker", "mcb", "mccb", "rccb", "قاطع"],
  "switches-sockets": ["switch", "socket", "outlet", "مفتاح", "فيش", "مقبس", "بريزه"],
  lighting: ["light", "luminaire", "lamp", "led panel", "downlight", "spotlight", "كشاف", "انارة", "انارو", "اناره", "لمبه", "سبوت"],
  earthing: ["earthing", "earth rod", "grounding", "lightning", "تاريض", "صاعقه"],
  pipes: ["pipe", "pipes", "ماسوره", "مواسير", "انبوب", "انابيب"],
  fittings: ["elbow", "tee", "reducer", "coupling", "fitting", "union", "كوع", "تيه", "مسلوب", "جلبه", "وصله", "قطع"],
  valves: ["valve", "محبس", "صمام", "بلف"],
  pumps: ["pump", "مضخه", "طرمبه"],
  "water-heaters": ["water heater", "سخان"],
  "sanitary-ware": ["wc", "water closet", "wash basin", "sink", "mixer", "مرحاض", "مغسله", "حوض", "خلاط", "كرسي افرنجي"],
  tanks: ["tank", "خزان"],
  "split-units": ["split", "split unit", "سبليت", "مكيف جداري"],
  "package-units": ["package unit", "rooftop", "packaged", "وحده مركزيه", "باكج"],
  chillers: ["chiller", "تشلر", "مبرد مياه"],
  ducts: ["duct", "ductwork", "دكت", "مجاري هواء"],
  "grilles-diffusers": ["grille", "diffuser", "register", "louver", "فتحه تكييف", "جريل", "ناشر"],
  fans: ["fan", "exhaust fan", "مروحه", "شفاط"],
  insulation: ["insulation", "عزل حراري", "عازل"],
  "refrigerant-pipes": ["copper pipe", "refrigerant pipe", "مواسير نحاس"],
  sprinklers: ["sprinkler", "رشاش"],
  "fire-pumps": ["fire pump", "مضخه حريق", "jockey"],
  "fire-pipes": ["fire pipe", "fire fighting pipe", "مواسير حريق"],
  "hose-reels": ["hose reel", "fire hose", "بكره خرطوم", "صندوق حريق", "fire cabinet"],
  extinguishers: ["extinguisher", "طفايه"],
  "fire-valves": ["alarm valve", "zone control valve", "landing valve", "محبس حريق"],
  "fa-panels": ["fire alarm panel", "facp", "control panel fire", "لوحه انذار"],
  detectors: ["detector", "كاشف"],
  "manual-call-points": ["call point", "break glass", "mcp", "نقطه انذار يدوي"],
  "sounders-strobes": ["sounder", "strobe", "bell", "horn", "جرس انذار", "فلاش"],
  "fa-cables": ["fire alarm cable", "fire resistant cable", "كابل انذار"],
  generators: ["generator", "genset", "مولد"],
  elevators: ["elevator", "lift", "مصعد"],
  boosters: ["booster", "رفع ضغط"],
  compressors: ["compressor", "كمبروسر", "ضاغط"],
  cement: ["cement", "اسمنت", "اسمنتي"],
  rebar: ["rebar", "reinforcement", "steel bar", "حديد تسليح", "تسليح"],
  blocks: ["block", "brick", "بلوك", "طوب"],
  concrete: ["concrete", "ready mix", "خرسانه", "خرسانة"],
  waterproofing: ["waterproof", "membrane", "عزل مائي", "ممبرين"],
  tiles: ["tile", "tiles", "ceramic", "porcelain", "بلاط", "سيراميك", "بورسلان"],
  paints: ["paint", "دهان", "بويه"],
  gypsum: ["gypsum", "ceiling board", "جبس"],
  aggregates: ["sand", "aggregate", "gravel", "رمل", "بحص", "حصى"],
  cctv: ["cctv", "camera", "nvr", "كاميرا"],
  "data-network": ["network", "data outlet", "patch panel", "utp", "fiber", "شبكه", "داتا"],
  "access-control": ["access control", "card reader", "تحكم دخول"],
  "public-address": ["public address", "speaker", "سماعه", "نداء"],
  intercom: ["intercom", "انتركم"],
  manholes: ["manhole", "غرفه تفتيش", "منهول"],
  "hdpe-pipes": ["hdpe pipe", "مواسير hdpe"],
  "grp-pipes": ["grp pipe", "مواسير grp"],
  precast: ["precast", "مسبق الصب"],
  asphalt: ["asphalt", "اسفلت"],
  "street-lighting": ["street light", "pole light", "اعمده انارة", "انارة شوارع"],
};

const NORMALIZED_CATEGORY_KEYWORDS = Object.entries(CATEGORY_KEYWORDS).map(([slug, kws]) => ({ slug, kws: kws.map((k) => normalizeText(k)) }));

/** Classify text into a category slug. Longer (more specific) keyword hits weigh more. */
export function classifyCategory(text: string, sectionHint?: string | null): { slug: string; score: number } | null {
  const t = ` ${normalizeText(text)} `;
  const s = sectionHint ? ` ${normalizeText(sectionHint)} ` : "";
  let best: { slug: string; score: number } | null = null;
  for (const { slug, kws } of NORMALIZED_CATEGORY_KEYWORDS) {
    let score = 0;
    for (const k of kws) {
      if (!k) continue;
      const needle = ` ${k} `;
      if (t.includes(needle) || (k.length > 4 && t.includes(k))) score += k.length >= 8 ? 3 : k.includes(" ") ? 2.5 : 1.5;
      else if (s && (s.includes(needle) || (k.length > 4 && s.includes(k)))) score += 0.5;
    }
    if (score > 0 && (!best || score > best.score)) best = { slug, score };
  }
  return best;
}

export function detectLanguage(text: string): "ar" | "en" | "mixed" {
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (ar && en) return ar > en * 2 ? "ar" : en > ar * 2 ? "en" : "mixed";
  return ar ? "ar" : "en";
}
