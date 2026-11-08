/**
 * Synthetic golden BOQ set (bilingual) with expected extraction and attribute results.
 * Used to measure rule-engine accuracy in CI. No real customer data.
 */
export interface GoldenLine {
  description: string;
  quantity: string;
  unit: string; // raw unit as written
  unitCode: string; // expected resolved code
  code?: string;
  expect: { category: string; attrs: Record<string, string | number> };
}

export const GOLDEN_SECTIONS: { section: string; lines: GoldenLine[] }[] = [
  {
    section: "أعمال السباكة / Plumbing works",
    lines: [
      { code: "P-01", description: "توريد وتركيب ماسورة يو بي في سي قطر 110 مم للصرف PN10", quantity: "120", unit: "م.ط", unitCode: "m", expect: { category: "pipes", attrs: { material: "upvc", diameter_mm: 110, pressure_class: "PN10" } } },
      { code: "P-02", description: "Supply and install uPVC drainage pipe Ø160mm", quantity: "85.5", unit: "L.M", unitCode: "m", expect: { category: "pipes", attrs: { material: "upvc", diameter_mm: 160 } } },
      { code: "P-03", description: "PPR pipe 25mm PN20 for hot water", quantity: "1,250", unit: "m", unitCode: "m", expect: { category: "pipes", attrs: { material: "ppr", diameter_mm: 25, pressure_class: "PN20" } } },
      { code: "P-04", description: "كوع يو بي في سي 110 مم 90 درجة", quantity: "٤٠", unit: "عدد", unitCode: "pc", expect: { category: "fittings", attrs: { material: "upvc", diameter_mm: 110, fitting_type: "elbow_90" } } },
      { code: "P-05", description: 'Gate valve 2" brass, threaded', quantity: "12", unit: "No.", unitCode: "pc", expect: { category: "valves", attrs: { valve_type: "gate", diameter_inch: 2, material: "brass" } } },
      { code: "P-06", description: "مضخة مياه 1.5 كيلو وات 220 فولت", quantity: "2", unit: "No", unitCode: "pc", expect: { category: "pumps", attrs: { power_kw: 1.5, voltage: 220 } } },
    ],
  },
  {
    section: "الأعمال الكهربائية / Electrical works",
    lines: [
      { code: "E-01", description: "Copper cable 4x16mm² XLPE/SWA 0.6/1kV", quantity: "300", unit: "m", unitCode: "m", expect: { category: "power-cables", attrs: { cores: 4, cross_section_mm2: 16, conductor_material: "cu", insulation: "xlpe" } } },
      { code: "E-02", description: "كابل نحاس 3×2.5 مم2 PVC", quantity: "1500", unit: "متر", unitCode: "m", expect: { category: "power-cables", attrs: { cores: 3, cross_section_mm2: 2.5, conductor_material: "cu" } } },
      { code: "E-03", description: "MCB 1P 20A 6kA", quantity: "48", unit: "pcs", unitCode: "pc", expect: { category: "circuit-breakers", attrs: { poles: 1, current_rating_a: 20, breaking_capacity_ka: 6, breaker_type: "mcb" } } },
      { code: "E-04", description: "قاطع MCCB ثلاثي 3P 100A", quantity: "3", unit: "عدد", unitCode: "pc", expect: { category: "circuit-breakers", attrs: { poles: 3, current_rating_a: 100, breaker_type: "mccb" } } },
      { code: "E-05", description: "LED panel light 36W 600x600", quantity: "220", unit: "Nos", unitCode: "pc", expect: { category: "lighting", attrs: { power_w: 36 } } },
    ],
  },
  {
    section: "التكييف والحريق / HVAC & fire",
    lines: [
      { code: "M-01", description: "Split unit 24,000 BTU R410A", quantity: "10", unit: "set", unitCode: "set", expect: { category: "split-units", attrs: { capacity_btu: 24000 } } },
      { code: "F-01", description: "Pendent sprinkler K5.6 68°C UL/FM", quantity: "400", unit: "ea", unitCode: "pc", expect: { category: "sprinklers", attrs: { sprinkler_type: "pendent", k_factor: 5.6, temperature_rating_c: 68 } } },
      { code: "F-02", description: "كاشف دخان معنون", quantity: "150", unit: "عدد", unitCode: "pc", expect: { category: "detectors", attrs: { detector_type: "smoke", panel_type: "addressable" } } },
      { code: "B-01", description: "أسمنت بورتلاندي عادي 50 كجم", quantity: "800", unit: "كيس", unitCode: "bag", expect: { category: "cement", attrs: {} } },
    ],
  },
];

export const GOLDEN_LINES = GOLDEN_SECTIONS.flatMap((s) => s.lines.map((l) => ({ ...l, section: s.section })));

/** Build sheet rows the way a contractor's BOQ typically looks (title rows, header, sections, totals). */
export function goldenRows(lang: "ar" | "en"): string[][] {
  const header = lang === "ar" ? ["رقم البند", "الوصف", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي"] : ["Item No.", "Description", "Unit", "Qty", "Rate", "Amount"];
  const rows: string[][] = [[lang === "ar" ? "جدول الكميات - مشروع تجريبي" : "Bill of Quantities - Demo Project"], [], header];
  for (const s of GOLDEN_SECTIONS) {
    rows.push(["", s.section]);
    for (const l of s.lines) rows.push([l.code ?? "", l.description, l.unit, l.quantity, "", ""]);
    rows.push(["", lang === "ar" ? "الإجمالي" : "Sub Total", "", "", "", ""]);
  }
  return rows;
}
