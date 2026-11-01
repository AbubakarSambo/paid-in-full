/** Dependency-free CSV parser: quoted fields with "" escapes, embedded commas/newlines, CRLF/LF. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      if (c === '\r' && src[i + 1] === '\n') i++;
    } else {
      field += c;
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ''));
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function parseCsvAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[₦,\s]/g, '').replace(/^NGN/i, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalised header key: lower-case letters only ("Unit Amount" → "unitamount"). */
export function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '');
}

export const QUEUE_CSV_COLUMNS = [
  'Date',
  'Vendor',
  'Description',
  'Category',
  'COA',
  'Business Unit',
  'BU Head',
  'Units',
  'Unit Name',
  'Unit Amount',
  'Activity Month',
  'Urgent',
] as const;

/** Accepted header aliases → canonical field. */
export const QUEUE_CSV_ALIASES: Record<string, string> = {
  date: 'date',
  vendor: 'vendor',
  vendorname: 'vendor',
  description: 'description',
  category: 'category',
  paycategory: 'category',
  paymentcategory: 'category',
  coa: 'coa',
  coatag: 'coa',
  businessunit: 'bu',
  bu: 'bu',
  costcenter: 'bu',
  buhead: 'head',
  head: 'head',
  location: 'head',
  units: 'units',
  qty: 'units',
  quantity: 'units',
  unitname: 'unitName',
  unit: 'unitName',
  unitamount: 'unitAmount',
  unitamt: 'unitAmount',
  amount: 'amount',
  amt: 'amount',
  total: 'amount',
  activitymonth: 'pnlPeriod',
  pnlperiod: 'pnlPeriod',
  plperiod: 'pnlPeriod',
  urgent: 'urgent',
};
