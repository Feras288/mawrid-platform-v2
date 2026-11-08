/**
 * ZATCA e-invoicing helpers (phase 1 "generation" data). The QR code for simplified tax invoices is a
 * Base64-encoded TLV of: 1 seller name, 2 seller VAT number, 3 invoice timestamp (ISO 8601),
 * 4 invoice total incl. VAT, 5 VAT total. Phase 2 (integration: UBL XML, cryptographic stamp, CSID,
 * clearance/reporting with Fatoora) requires onboarding with ZATCA and is Integration Pending.
 */
export interface QrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: Date;
  total: string;
  vatTotal: string;
}

function tlv(tag: number, value: string): Buffer {
  const v = Buffer.from(value, "utf8");
  if (v.length > 255) throw new Error(`TLV value for tag ${tag} too long`);
  return Buffer.concat([Buffer.from([tag, v.length]), v]);
}

export function zatcaQrTlv(f: QrFields): string {
  return Buffer.concat([
    tlv(1, f.sellerName),
    tlv(2, f.vatNumber),
    tlv(3, f.timestamp.toISOString().replace(/\.\d{3}Z$/, "Z")),
    tlv(4, f.total),
    tlv(5, f.vatTotal),
  ]).toString("base64");
}

export function decodeTlv(b64: string): Record<number, string> {
  const buf = Buffer.from(b64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i + 2 <= buf.length) {
    const tag = buf[i]!;
    const len = buf[i + 1]!;
    out[tag] = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  return out;
}

/** Saudi VAT numbers: 15 digits starting and ending with 3. */
export const isSaudiVatNumber = (v: string | null | undefined) => Boolean(v && /^3\d{13}3$/.test(v));
