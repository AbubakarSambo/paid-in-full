import { Injectable } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportPeriod } from './dto/report-query.dto';

type Cell = string | number | null | undefined;

export function csvEscape(value: Cell): string {
  if (value == null) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const row = (cells: Cell[]) => cells.map(csvEscape).join(',');
const money = (n: number) => n.toFixed(2);
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

@Injectable()
export class ReportCsvService {
  constructor(private readonly reports: ReportsService) {}

  /** Money-out CSV with the spec's sections: Category, Business Unit, Vendor, COA by category, Monthly by category, Batch history. */
  async moneyOutCsv(workspaceId: string, period?: ReportPeriod, from?: string, to?: string): Promise<string> {
    const r = await this.reports.moneyOut(workspaceId, period, from, to, Number.POSITIVE_INFINITY);
    const out: string[] = [];
    out.push(row(['Money out report', r.period.label]));
    out.push(row(['Total spend', money(r.kpis.totalSpend), 'Paid', money(r.kpis.paid), 'Batches', r.kpis.batches, 'Items', r.kpis.items]));
    out.push('');

    out.push(row(['CATEGORY']));
    out.push(row(['Category', 'Items', 'Paid', 'Total', 'Share']));
    for (const c of r.categories) out.push(row([c.label, c.items, money(c.paid), money(c.total), pct(c.share)]));
    out.push('');

    out.push(row(['BUSINESS UNIT']));
    out.push(row(['Business Unit', 'Code', 'Items', 'Paid', 'Total', 'Share']));
    for (const b of r.businessUnits) out.push(row([b.label, b.code, b.items, money(b.paid), money(b.total), pct(b.share)]));
    out.push('');

    const full = r.topVendors.rows; // full list: vendorLimit = Infinity above
    out.push(row(['VENDOR', `${r.topVendors.uniqueCount} unique`]));
    out.push(row(['Vendor', 'Items', 'Paid', 'Total', 'Share']));
    for (const v of full) out.push(row([v.label, v.items, money(v.paid), money(v.total), pct(v.share)]));
    out.push('');

    out.push(row(['COA BY CATEGORY']));
    out.push(row(['COA', ...r.coa.categories, 'Total']));
    for (const c of r.coa.rows) {
      out.push(row([c.coa, ...r.coa.categories.map((k) => money(c.byCategory[k] ?? 0)), money(c.total)]));
    }
    out.push('');

    out.push(row(['MONTHLY BY CATEGORY']));
    out.push(row(['Month', ...r.monthlyByCategory.categories, 'Total']));
    for (const m of r.monthlyByCategory.rows) {
      out.push(row([m.month, ...r.monthlyByCategory.categories.map((k) => money(m.byCategory[k] ?? 0)), money(m.total)]));
    }
    out.push(
      row([
        'Total',
        ...r.monthlyByCategory.categories.map((k) => money(r.monthlyByCategory.totals[k] ?? 0)),
        money(r.kpis.totalSpend),
      ]),
    );
    out.push('');

    out.push(row(['BATCH HISTORY']));
    out.push(row(['Batch Ref', 'Date', 'Category', 'Items', 'Total', 'Status']));
    for (const b of r.batchHistory) out.push(row([b.batchRef, b.date, b.category, b.items, money(b.total), b.status]));

    return out.join('\n');
  }

  async whtCsv(workspaceId: string, period?: ReportPeriod, from?: string, to?: string): Promise<string> {
    const r = await this.reports.whtReport(workspaceId, period, from, to);
    const out: string[] = [];
    out.push(row(['Date', 'Vendor', 'TIN', 'Contract Amt', 'Rate', 'WHT', 'COA', 'Description']));
    for (const l of r.lines) {
      out.push(row([l.date, l.vendor, l.tin, money(l.contractAmount), pct(l.rate), money(l.wht), l.coa, l.description]));
    }
    out.push(row(['TOTAL', `${r.lineCount} lines`, '', money(r.totals.contractAmount), '', money(r.totals.wht), '', '']));
    if (r.vendorsMissingTin > 0) {
      out.push(row([`${r.vendorsMissingTin} vendors missing TIN`, r.vendorsMissingTinNames.join('; ')]));
    }
    return out.join('\n');
  }

  async salesCsv(workspaceId: string, period?: ReportPeriod, from?: string, to?: string): Promise<string> {
    const r = await this.reports.sales(workspaceId, period, from, to);
    const out: string[] = [];
    out.push(row(['Sales report', r.period.label]));
    out.push(
      row([
        'Invoiced', money(r.kpis.invoiced), 'Collected', money(r.kpis.collected),
        'Outstanding', money(r.kpis.outstanding), 'VAT', money(r.kpis.vat), 'WHT', money(r.kpis.wht),
      ]),
    );
    out.push('');
    out.push(row(['BY MONTH']));
    out.push(row(['Month', 'Invoiced', 'Collected']));
    for (const m of r.byMonth) out.push(row([m.month, money(m.invoiced), money(m.collected)]));
    out.push('');
    out.push(row(['BY CUSTOMER']));
    out.push(row(['Customer', 'Invoices', 'Invoiced', 'Collected', 'Outstanding']));
    for (const c of r.byCustomer) out.push(row([c.customer, c.invoices, money(c.invoiced), money(c.collected), money(c.outstanding)]));
    out.push('');
    out.push(row(['INVOICES']));
    out.push(row(['Invoice #', 'Customer', 'Issue date', 'Due date', 'Status', 'Currency', 'Total', 'VAT', 'WHT', 'Amount due', 'Paid', 'Outstanding']));
    for (const i of r.invoices) {
      out.push(
        row([
          i.invoiceNumber, i.customer, i.issueDate, i.dueDate, i.status, i.currency,
          money(i.total), money(i.vat), money(i.wht), money(i.amountDue), money(i.paid), money(i.outstanding),
        ]),
      );
    }
    return out.join('\n');
  }

  async vendorDebtCsv(workspaceId: string, asOf?: string): Promise<string> {
    const r = await this.reports.vendorDebt(workspaceId, asOf);
    const out: string[] = [];
    out.push(row(['Vendor debt as at', r.asOf]));
    out.push(row(['Vendor', 'Lines', 'Oldest item', 'Posted unpaid (in batches)', 'In queue', 'Total owed']));
    for (const v of r.rows) {
      out.push(row([v.vendor, v.lines, v.oldestItem, money(v.postedUnpaid), money(v.inQueue), money(v.totalOwed)]));
    }
    out.push(row(['TOTAL', r.totals.lines, '', money(r.totals.postedUnpaid), money(r.totals.inQueue), money(r.totals.totalOwed)]));
    return out.join('\n');
  }
}
