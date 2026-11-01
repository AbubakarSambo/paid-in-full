import { round2 } from './invoice-dates.util';

export interface CalcLineInput {
  quantity: number;
  unitPrice: number;
  /** VAT percent, e.g. 7.5 */
  vatRate?: number;
  /** WHT percent, e.g. 5 */
  whtRate?: number;
}

export interface CalcOptions {
  /** Unit prices already include VAT (VAT is backed out of each line). */
  taxInclusive?: boolean;
  discountType?: 'PERCENT' | 'FLAT' | null;
  discountValue?: number;
  /** Late fee already applied to this invoice (added to amount due). */
  lateFeeAmount?: number;
  /** Early-payment discount already applied (deducted from amount due). */
  earlyPayDiscountAmount?: number;
}

export interface CalcResult {
  lines: { lineTotal: number; net: number; vat: number; wht: number }[];
  /** Sum of line values net of VAT, before the invoice discount. */
  subtotal: number;
  discountAmount: number;
  vatTotal: number;
  whtTotal: number;
  /** subtotal - discount + VAT */
  total: number;
  /** total - WHT + late fee - early-pay discount */
  amountDue: number;
}

/**
 * Server-side invoice totals (spec §5.8 "Totals: Subtotal, Discount, VAT, Less WHT, Amount due").
 *
 * - Each line's gross value is qty × unit price (stored as lineTotal).
 * - Tax-inclusive: the line's VAT is backed out of the gross (net = gross / (1 + vat%)).
 * - The invoice discount (percent of subtotal, or flat, capped at the subtotal) is spread across
 *   lines pro rata to their net value, so VAT and WHT are charged on the discounted base.
 * - WHT is deducted by the customer at source, so it reduces the amount due, not the total.
 */
export function computeInvoiceTotals(items: CalcLineInput[], opts: CalcOptions = {}): CalcResult {
  const prelim = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    const vatRate = Math.max(0, Number(it.vatRate ?? 0));
    const whtRate = Math.max(0, Number(it.whtRate ?? 0));
    const gross = qty * price;
    const net = opts.taxInclusive ? gross / (1 + vatRate / 100) : gross;
    return { gross, net, vatRate, whtRate };
  });

  const subtotalRaw = prelim.reduce((s, l) => s + l.net, 0);
  const subtotal = round2(subtotalRaw);

  let discountAmount = 0;
  const dv = Math.max(0, Number(opts.discountValue ?? 0));
  if (opts.discountType === 'PERCENT') discountAmount = subtotalRaw * (Math.min(dv, 100) / 100);
  else if (opts.discountType === 'FLAT') discountAmount = Math.min(dv, subtotalRaw);
  const factor = subtotalRaw > 0 ? (subtotalRaw - discountAmount) / subtotalRaw : 0;

  let vatRaw = 0;
  let whtRaw = 0;
  const lines = prelim.map((l) => {
    const base = l.net * factor;
    const vat = base * (l.vatRate / 100);
    const wht = base * (l.whtRate / 100);
    vatRaw += vat;
    whtRaw += wht;
    return { lineTotal: round2(l.gross), net: round2(l.net), vat: round2(vat), wht: round2(wht) };
  });

  const discount = round2(discountAmount);
  const vatTotal = round2(vatRaw);
  const whtTotal = round2(whtRaw);
  const total = round2(subtotal - discount + vatTotal);
  const amountDue = round2(
    Math.max(0, total - whtTotal + Number(opts.lateFeeAmount ?? 0) - Number(opts.earlyPayDiscountAmount ?? 0)),
  );

  return { lines, subtotal, discountAmount: discount, vatTotal, whtTotal, total, amountDue };
}
