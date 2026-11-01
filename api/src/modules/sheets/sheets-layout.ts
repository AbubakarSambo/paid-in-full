import { Prisma } from '@prisma/client';

/**
 * BATCHES tab, spec §9: 16 data columns (A–P), row 1 = header.
 * Column Q holds the app's batch-line id: the upsert key is (batch ref, line id). It sits outside the
 * 16-column layout so the business columns stay exactly as specified; the sheet owner can hide it.
 */
export const BATCH_HEADER = [
  'Batch Ref',
  'Date',
  'Category',
  'Vendor',
  'Bank',
  'Account',
  'Description',
  'Bundle',
  'COA',
  'BU',
  'BU Head',
  'P&L Period',
  'Gross',
  'WHT',
  'Net Paid',
  'Status / Reference',
  'Line ID',
] as const;

export const BATCH_COL = {
  batchRef: 0,
  date: 1,
  category: 2,
  vendor: 3,
  bank: 4,
  account: 5,
  description: 6,
  bundle: 7,
  coa: 8,
  bu: 9,
  buHead: 10,
  pnlPeriod: 11,
  gross: 12,
  wht: 13,
  net: 14,
  status: 15,
  lineId: 16,
} as const;
export const BATCH_LAST_COL = 'Q';

/** INVOICES tab: 23 columns keyed on invoice number (column A). Row 1 = header. */
export const INVOICE_HEADER = [
  'Invoice #',
  'Type',
  'Status',
  'Issue Date',
  'Due Date',
  'Customer',
  'Customer Email',
  'Customer TIN',
  'Currency',
  'FX Rate',
  'Subtotal',
  'Discount',
  'VAT',
  'WHT',
  'Total',
  'Amount Due',
  'Paid',
  'Outstanding',
  'Last Payment Date',
  'Payment References',
  'Collection Account',
  'Sent At',
  'Updated At',
] as const;
export const INVOICE_LAST_COL = 'W';

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date | null | undefined) =>
  d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : '';
const isoMinute = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '');
const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Math.round(Number(d) * 100) / 100);

export type SheetCell = string | number;

export interface BatchLineForSheet {
  id: string;
  date: Date;
  vendorName: string;
  vendorBank: string | null;
  vendorAcctNo: string | null;
  description: string;
  bundleLabel: string | null;
  coaTag: string | null;
  pnlPeriod: string | null;
  total: Prisma.Decimal;
  whtAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  payoutStatus: string;
  payoutReference: string | null;
  payCategoryName: string | null;
  costCenter: { name: string; code: string | null } | null;
  location: { name: string } | null;
}

export const BATCH_LINE_SELECT = {
  id: true,
  date: true,
  vendorName: true,
  vendorBank: true,
  vendorAcctNo: true,
  description: true,
  bundleLabel: true,
  coaTag: true,
  pnlPeriod: true,
  total: true,
  whtAmount: true,
  netAmount: true,
  paidAmount: true,
  payoutStatus: true,
  payoutReference: true,
  payCategoryName: true,
  returnedAt: true,
  costCenter: { select: { name: true, code: true } },
  location: { select: { name: true } },
} satisfies Prisma.BatchItemSelect;

export function batchRow(batch: { batchRef: string; payCategoryName: string | null }, line: BatchLineForSheet): SheetCell[] {
  const status = line.payoutReference ? `${line.payoutStatus} · ${line.payoutReference}` : line.payoutStatus;
  return [
    batch.batchRef,
    ymd(line.date),
    line.payCategoryName ?? batch.payCategoryName ?? '',
    line.vendorName,
    line.vendorBank ?? '',
    line.vendorAcctNo ?? '',
    line.description,
    line.bundleLabel ?? '',
    line.coaTag ?? '',
    line.costCenter?.name ?? '',
    line.location?.name ?? '',
    line.pnlPeriod ?? '',
    n(line.total),
    n(line.whtAmount),
    // Net Paid = the vendor leg (gross − WHT). Whether it has actually gone out is in Status / Reference.
    n(line.netAmount),
    status,
    line.id,
  ];
}

export const INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  quoteNumber: true,
  docType: true,
  status: true,
  issueDate: true,
  dueDate: true,
  currency: true,
  fxRate: true,
  subtotal: true,
  discountAmount: true,
  vatTotal: true,
  whtTotal: true,
  total: true,
  amountDue: true,
  paidAmount: true,
  customerTin: true,
  collectionAccountNumber: true,
  collectionBankName: true,
  sentAt: true,
  updatedAt: true,
  customer: { select: { name: true, email: true, taxId: true } },
  payments: { select: { paidAt: true, monnifyReference: true }, orderBy: { paidAt: 'asc' as const } },
} satisfies Prisma.InvoiceSelect;

export type InvoiceForSheet = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

export function invoiceKey(inv: Pick<InvoiceForSheet, 'invoiceNumber' | 'quoteNumber'>): string | null {
  return inv.invoiceNumber ?? inv.quoteNumber ?? null;
}

export function invoiceRow(inv: InvoiceForSheet): SheetCell[] {
  const due = n(inv.amountDue) > 0 ? n(inv.amountDue) : n(inv.total);
  const paid = n(inv.paidAmount);
  const last = inv.payments[inv.payments.length - 1];
  return [
    invoiceKey(inv) ?? '',
    inv.docType,
    inv.status,
    ymd(inv.issueDate),
    ymd(inv.dueDate),
    inv.customer.name,
    inv.customer.email ?? '',
    inv.customerTin ?? inv.customer.taxId ?? '',
    inv.currency,
    inv.fxRate ? Number(inv.fxRate) : '',
    n(inv.subtotal),
    n(inv.discountAmount),
    n(inv.vatTotal),
    n(inv.whtTotal),
    n(inv.total),
    due,
    paid,
    Math.max(0, Math.round((due - paid) * 100) / 100),
    last ? ymd(last.paidAt) : '',
    inv.payments.map((p) => p.monnifyReference).filter(Boolean).join(', '),
    inv.collectionAccountNumber ? `${inv.collectionAccountNumber} ${inv.collectionBankName ?? ''}`.trim() : '',
    isoMinute(inv.sentAt),
    isoMinute(inv.updatedAt),
  ];
}

/** Tiny RFC-4180 CSV parser (for the public gviz CSV export used by Sheet Recon without credentials). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
