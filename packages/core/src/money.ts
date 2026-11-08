import Decimal from "decimal.js";

/**
 * All monetary and quantity arithmetic goes through Decimal. Never use JS numbers for money.
 * Amounts are rounded to 2 dp (halalas), unit prices / quantities to 4 dp, ROUND_HALF_UP.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type DecInput = Decimal.Value;

export const MONEY_DP = 2;
export const UNIT_DP = 4;

export function dec(v: DecInput | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new D(0);
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Non-finite number");
  return new D(v);
}

/** Round to money precision (2 dp, half-up). */
export function money(v: DecInput): Decimal {
  return dec(v).toDecimalPlaces(MONEY_DP, D.ROUND_HALF_UP);
}

/** Round to unit precision (4 dp, half-up). */
export function unit(v: DecInput): Decimal {
  return dec(v).toDecimalPlaces(UNIT_DP, D.ROUND_HALF_UP);
}

export function sum(values: Iterable<DecInput>): Decimal {
  let acc = new D(0);
  for (const v of values) acc = acc.plus(dec(v));
  return acc;
}

/** Serialize for a numeric column. */
export function toDb(v: DecInput, dp = MONEY_DP): string {
  return dec(v).toFixed(dp, D.ROUND_HALF_UP);
}

export function isPositive(v: DecInput): boolean {
  return dec(v).greaterThan(0);
}

export interface LineInput {
  unitPrice: DecInput;
  quantity: DecInput;
  /** Discount on this line as an absolute amount (pre-tax). */
  discount?: DecInput;
  /** VAT rate as a fraction, e.g. 0.15. */
  vatRate?: DecInput;
  /** When true unitPrice already includes VAT. */
  pricesIncludeVat?: boolean;
}

export interface LineTotals {
  gross: Decimal; // unitPrice * qty (pre-discount, ex-VAT)
  discount: Decimal;
  net: Decimal; // ex-VAT after discount
  vat: Decimal;
  total: Decimal; // net + vat
}

/**
 * Compute line totals. VAT is computed per line and rounded per line (ZATCA practice: line VAT
 * rounded to 2 dp; invoice VAT = sum of line VAT).
 */
export function lineTotals(input: LineInput): LineTotals {
  const qty = dec(input.quantity);
  if (qty.isNegative()) throw new Error("Quantity must be >= 0");
  const rate = dec(input.vatRate ?? 0);
  let unitEx = dec(input.unitPrice);
  if (unitEx.isNegative()) throw new Error("Unit price must be >= 0");
  if (input.pricesIncludeVat && rate.greaterThan(0)) {
    unitEx = unitEx.div(rate.plus(1));
  }
  const gross = money(unitEx.times(qty));
  const discount = money(input.discount ?? 0);
  if (discount.greaterThan(gross)) throw new Error("Discount exceeds line amount");
  const net = gross.minus(discount);
  const vat = money(net.times(rate));
  return { gross, discount, net, vat, total: net.plus(vat) };
}

export interface DocumentTotals {
  subtotal: Decimal;
  discount: Decimal;
  net: Decimal;
  vat: Decimal;
  shipping: Decimal;
  shippingVat: Decimal;
  total: Decimal;
}

export function documentTotals(
  lines: LineTotals[],
  opts: { shipping?: DecInput; vatRate?: DecInput } = {},
): DocumentTotals {
  const subtotal = sum(lines.map((l) => l.gross));
  const discount = sum(lines.map((l) => l.discount));
  const net = sum(lines.map((l) => l.net));
  const vat = sum(lines.map((l) => l.vat));
  const shipping = money(opts.shipping ?? 0);
  const shippingVat = money(shipping.times(dec(opts.vatRate ?? 0)));
  return {
    subtotal,
    discount,
    net,
    vat: vat.plus(shippingVat),
    shipping,
    shippingVat,
    total: net.plus(vat).plus(shipping).plus(shippingVat),
  };
}

/** Split an amount proportionally across weights so that parts sum exactly to the amount. */
export function allocate(amount: DecInput, weights: DecInput[]): Decimal[] {
  const total = money(amount);
  const ws = weights.map(dec);
  const wSum = sum(ws);
  if (ws.length === 0) return [];
  if (wSum.isZero()) {
    const parts = ws.map(() => new D(0));
    parts[0] = total;
    return parts;
  }
  const parts = ws.map((w) => money(total.times(w).div(wSum)).toDecimalPlaces(2, D.ROUND_DOWN));
  let remainder = total.minus(sum(parts));
  const cent = new D("0.01");
  let i = 0;
  while (remainder.greaterThan(0)) {
    parts[i % parts.length] = parts[i % parts.length]!.plus(cent);
    remainder = remainder.minus(cent);
    i++;
  }
  return parts;
}

export function formatMoney(v: DecInput, locale: string, currency = "SAR"): string {
  const n = dec(v).toNumber(); // display only
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
