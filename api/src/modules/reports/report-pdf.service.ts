import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { ReportsService } from './reports.service';
import { ReportPeriod } from './dto/report-query.dto';

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

const LEFT = 40;
const RIGHT = 555;
const BOTTOM = 790;

function fmt(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en-NG')}`;
  }
}

/** Small table/section helpers around pdfkit's imperative API. */
class PdfWriter {
  constructor(private readonly doc: any) {}

  ensure(space: number) {
    if (this.doc.y + space > BOTTOM) this.doc.addPage();
  }

  title(workspace: string, title: string, subtitle: string) {
    this.doc.fontSize(18).font('Helvetica-Bold').fillColor('#000').text(workspace, LEFT, 40);
    this.doc.fontSize(12).font('Helvetica').text(title);
    this.doc.fontSize(9).fillColor('#555').text(subtitle);
    this.doc.fillColor('#000').moveDown(1);
  }

  section(label: string) {
    this.ensure(50);
    this.doc.moveDown(0.6).fontSize(11).font('Helvetica-Bold').fillColor('#000').text(label, LEFT);
    this.doc.moveDown(0.3);
  }

  kpis(items: [string, string][]) {
    this.ensure(40);
    const w = (RIGHT - LEFT) / items.length;
    const y = this.doc.y;
    items.forEach(([label, value], i) => {
      this.doc.fontSize(8).font('Helvetica').fillColor('#666').text(label, LEFT + i * w, y, { width: w - 6 });
      this.doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(value, LEFT + i * w, y + 11, { width: w - 6 });
    });
    this.doc.x = LEFT;
    this.doc.y = y + 32;
  }

  table(columns: Column[], rows: string[][], totals?: string[]) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const scale = (RIGHT - LEFT) / total;
    const cols = columns.map((c) => ({ ...c, width: c.width * scale }));
    const drawRow = (cells: string[], bold: boolean) => {
      this.doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      const heights = cells.map((cell, i) => this.doc.heightOfString(cell ?? '', { width: cols[i].width - 4 }));
      const h = Math.max(10, ...heights) + 3;
      if (this.doc.y + h > BOTTOM) {
        this.doc.addPage();
        header();
      }
      const y = this.doc.y;
      let x = LEFT;
      cells.forEach((cell, i) => {
        this.doc.text(cell ?? '', x + 2, y, { width: cols[i].width - 4, align: cols[i].align ?? 'left' });
        x += cols[i].width;
      });
      this.doc.x = LEFT;
      this.doc.y = y + h;
    };
    const header = () => {
      drawRow(cols.map((c) => c.header), true);
      this.doc.moveTo(LEFT, this.doc.y - 1).lineTo(RIGHT, this.doc.y - 1).lineWidth(0.5).strokeColor('#999').stroke();
    };
    this.ensure(30);
    header();
    for (const r of rows) drawRow(r, false);
    if (totals) {
      this.doc.moveTo(LEFT, this.doc.y).lineTo(RIGHT, this.doc.y).lineWidth(0.5).strokeColor('#999').stroke();
      this.doc.y += 2;
      drawRow(totals, true);
    }
    if (rows.length === 0) this.doc.fontSize(8).font('Helvetica-Oblique').text('No data for this period.', LEFT);
  }

  note(text: string, color = '#555') {
    this.doc.fontSize(8).font('Helvetica').fillColor(color).text(text, LEFT).fillColor('#000');
  }
}

function render(build: (w: PdfWriter) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(new PdfWriter(doc));
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor('#888').text(`Page ${i + 1} of ${range.count} · Generated ${new Date().toISOString().slice(0, 10)} by Paid in Full`, LEFT, 815, {
          width: RIGHT - LEFT,
          align: 'center',
          lineBreak: false,
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

@Injectable()
export class ReportPdfService {
  constructor(private readonly reports: ReportsService) {}

  async moneyOutPdf(workspaceId: string, period?: ReportPeriod, from?: string, to?: string): Promise<Buffer> {
    const [ws, r] = await Promise.all([
      this.reports.workspaceInfo(workspaceId),
      this.reports.moneyOut(workspaceId, period, from, to),
    ]);
    const m = (n: number) => fmt(n, r.currency);
    const pct = (s: number) => `${(s * 100).toFixed(1)}%`;
    return render((w) => {
      w.title(ws.name, 'Money out report', `Period: ${r.period.label} (by line date)`);
      w.kpis([
        ['Total spend', m(r.kpis.totalSpend)],
        ['Paid', m(r.kpis.paid)],
        ['Batches', String(r.kpis.batches)],
        ['Items', String(r.kpis.items)],
      ]);

      w.section('Spend by category');
      w.table(
        [{ header: 'Category', width: 3 }, { header: 'Items', width: 1, align: 'right' }, { header: 'Paid', width: 2, align: 'right' }, { header: 'Total', width: 2, align: 'right' }, { header: 'Share', width: 1, align: 'right' }],
        r.categories.map((c) => [c.label, String(c.items), m(c.paid), m(c.total), pct(c.share)]),
        ['Total', String(r.kpis.items), m(r.kpis.paid), m(r.kpis.totalSpend), '100%'],
      );

      w.section('Spend by business unit');
      w.table(
        [{ header: 'Business unit', width: 3 }, { header: 'Code', width: 1 }, { header: 'Items', width: 1, align: 'right' }, { header: 'Paid', width: 2, align: 'right' }, { header: 'Total', width: 2, align: 'right' }, { header: 'Share', width: 1, align: 'right' }],
        r.businessUnits.map((b) => [b.label, b.code ?? '', String(b.items), m(b.paid), m(b.total), pct(b.share)]),
      );

      w.section(`Top vendors (${r.topVendors.uniqueCount} unique)`);
      w.table(
        [{ header: 'Vendor', width: 4 }, { header: 'Items', width: 1, align: 'right' }, { header: 'Total', width: 2, align: 'right' }, { header: 'Share', width: 1, align: 'right' }],
        r.topVendors.rows.map((v) => [v.label, String(v.items), m(v.total), pct(v.share)]),
      );

      w.section('Spend by COA');
      w.table(
        [{ header: 'COA', width: 3 }, ...r.coa.categories.map((c) => ({ header: c, width: 2, align: 'right' as const })), { header: 'Total', width: 2, align: 'right' }],
        r.coa.rows.map((c) => [c.coa, ...r.coa.categories.map((k) => (c.byCategory[k] ? m(c.byCategory[k]) : '–')), m(c.total)]),
      );

      w.section('Monthly spend by category');
      w.table(
        [{ header: 'Month', width: 2 }, ...r.monthlyByCategory.categories.map((c) => ({ header: c, width: 2, align: 'right' as const })), { header: 'Total', width: 2, align: 'right' }],
        r.monthlyByCategory.rows.map((row) => [row.month, ...r.monthlyByCategory.categories.map((k) => (row.byCategory[k] ? m(row.byCategory[k]) : '–')), m(row.total)]),
        ['Total', ...r.monthlyByCategory.categories.map((k) => m(r.monthlyByCategory.totals[k] ?? 0)), m(r.kpis.totalSpend)],
      );

      w.section(`WHT remittance — ${r.wht.lineCount} lines · WHT ${m(r.wht.totals.wht)}`);
      if (r.wht.vendorsMissingTin > 0) w.note(`${r.wht.vendorsMissingTin} vendors missing TIN`, '#b45309');
      w.table(
        [{ header: 'Date', width: 1.4 }, { header: 'Vendor', width: 2.5 }, { header: 'TIN', width: 1.6 }, { header: 'Contract', width: 1.8, align: 'right' }, { header: 'Rate', width: 0.8, align: 'right' }, { header: 'WHT', width: 1.5, align: 'right' }, { header: 'COA', width: 2 }],
        r.wht.lines.map((l) => [l.date, l.vendor, l.tin ?? '—', m(l.contractAmount), pct(l.rate), m(l.wht), l.coa ?? '']),
        ['Total', '', '', m(r.wht.totals.contractAmount), '', m(r.wht.totals.wht), ''],
      );

      w.section('Batch / disbursement history');
      w.table(
        [{ header: 'Batch ref', width: 3 }, { header: 'Date', width: 1.5 }, { header: 'Category', width: 2 }, { header: 'Items', width: 1, align: 'right' }, { header: 'Total', width: 2, align: 'right' }, { header: 'Status', width: 1.5 }],
        r.batchHistory.map((b) => [b.batchRef, b.date, b.category, String(b.items), m(b.total), b.status]),
      );
    });
  }

  async vendorDebtPdf(workspaceId: string, asOf?: string): Promise<Buffer> {
    const [ws, r] = await Promise.all([this.reports.workspaceInfo(workspaceId), this.reports.vendorDebt(workspaceId, asOf)]);
    const m = (n: number) => fmt(n, r.currency);
    return render((w) => {
      w.title(ws.name, 'Vendor debt', `As at ${r.asOf}`);
      w.kpis([
        ['Vendors owed', String(r.rows.length)],
        ['Posted unpaid', m(r.totals.postedUnpaid)],
        ['In queue', m(r.totals.inQueue)],
        ['Total owed', m(r.totals.totalOwed)],
      ]);
      w.table(
        [{ header: 'Vendor', width: 4 }, { header: 'Lines', width: 1, align: 'right' }, { header: 'Oldest item', width: 1.8 }, { header: 'Posted unpaid (in batches)', width: 2.4, align: 'right' }, { header: 'In queue', width: 2, align: 'right' }, { header: 'Total owed', width: 2, align: 'right' }],
        r.rows.map((v) => [v.vendor, String(v.lines), v.oldestItem ?? '', m(v.postedUnpaid), m(v.inQueue), m(v.totalOwed)]),
        ['Total', String(r.totals.lines), '', m(r.totals.postedUnpaid), m(r.totals.inQueue), m(r.totals.totalOwed)],
      );
    });
  }
}
