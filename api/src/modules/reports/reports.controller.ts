import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportCsvService } from './report-csv.service';
import { ReportPdfService } from './report-pdf.service';
import { MonthlyGridQueryDto, ReportQueryDto, SpendByVendorQueryDto, VendorDebtQueryDto } from './dto';
import { Capability, CurrentUser, DateRangeDto, RequireCapability } from '../../common';
import { ymd } from './report-period';

function sendFile(res: Response, type: string, filename: string, body: string | Buffer) {
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(body);
}

const stamp = (q: ReportQueryDto) => q.period ?? (q.from || q.to ? 'custom' : 'this_month');
const legacyRange = (q: DateRangeDto) => ({
  from: q.startDate ? ymd(q.startDate) : undefined,
  to: q.endDate ? ymd(q.endDate) : undefined,
});

@ApiTags('Reports')
@ApiBearerAuth()
@RequireCapability(Capability.VIEW)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly csv: ReportCsvService,
    private readonly pdf: ReportPdfService,
  ) {}

  // ─── Money out ──────────────────────────────────────────────────────────────

  @Get('money-out')
  @ApiOperation({ summary: 'Money-out report: KPIs, trend, category/vendor/BU/COA breakdowns, WHT, batch history' })
  moneyOut(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto) {
    return this.reports.moneyOut(workspaceId, q.period, q.from, q.to);
  }

  @Get('wht')
  @ApiOperation({ summary: 'WHT remittance report (paid lines carrying WHT) for FIRS' })
  wht(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto) {
    return this.reports.whtReport(workspaceId, q.period, q.from, q.to);
  }

  @Get('money-out/export.csv')
  async moneyOutCsv(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto, @Res() res: Response) {
    const body = await this.csv.moneyOutCsv(workspaceId, q.period, q.from, q.to);
    sendFile(res, 'text/csv', `money-out-${stamp(q)}.csv`, body);
  }

  @Get('money-out/export.pdf')
  async moneyOutPdf(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto, @Res() res: Response) {
    const body = await this.pdf.moneyOutPdf(workspaceId, q.period, q.from, q.to);
    sendFile(res, 'application/pdf', `money-out-${stamp(q)}.pdf`, body);
  }

  @Get('wht/export.csv')
  async whtCsv(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto, @Res() res: Response) {
    const body = await this.csv.whtCsv(workspaceId, q.period, q.from, q.to);
    sendFile(res, 'text/csv', `wht-remittance-${stamp(q)}.csv`, body);
  }

  // ─── Sales ──────────────────────────────────────────────────────────────────

  @Get('sales')
  @ApiOperation({ summary: 'Sales report: invoiced, collected, outstanding, VAT, WHT, by month and customer' })
  sales(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto) {
    return this.reports.sales(workspaceId, q.period, q.from, q.to);
  }

  @Get('sales/export.csv')
  async salesCsv(@CurrentUser('workspaceId') workspaceId: string, @Query() q: ReportQueryDto, @Res() res: Response) {
    const body = await this.csv.salesCsv(workspaceId, q.period, q.from, q.to);
    sendFile(res, 'text/csv', `sales-${stamp(q)}.csv`, body);
  }

  // ─── Vendor debt ────────────────────────────────────────────────────────────

  @Get('vendor-debt')
  @ApiOperation({ summary: 'Vendor debt as at a month end (posted unpaid + in queue)' })
  vendorDebt(@CurrentUser('workspaceId') workspaceId: string, @Query() q: VendorDebtQueryDto) {
    return this.reports.vendorDebt(workspaceId, q.asOf);
  }

  @Get('vendor-debt/export.csv')
  async vendorDebtCsv(@CurrentUser('workspaceId') workspaceId: string, @Query() q: VendorDebtQueryDto, @Res() res: Response) {
    const body = await this.csv.vendorDebtCsv(workspaceId, q.asOf);
    sendFile(res, 'text/csv', `vendor-debt-${q.asOf ?? 'current'}.csv`, body);
  }

  @Get('vendor-debt/export.pdf')
  async vendorDebtPdf(@CurrentUser('workspaceId') workspaceId: string, @Query() q: VendorDebtQueryDto, @Res() res: Response) {
    const body = await this.pdf.vendorDebtPdf(workspaceId, q.asOf);
    sendFile(res, 'application/pdf', `vendor-debt-${q.asOf ?? 'current'}.pdf`, body);
  }

  // ─── Legacy routes (kept so the current client keeps working; prefer the routes above) ──────────

  @Get('spend-by-category')
  async spendByCategory(@CurrentUser('workspaceId') workspaceId: string, @Query() q: DateRangeDto) {
    const { from, to } = legacyRange(q);
    const r = await this.reports.moneyOut(workspaceId, from || to ? 'custom' : 'all', from, to);
    return r.categories.map((c) => ({ payCategoryId: null, payCategory: c.label, total: c.total }));
  }

  @Get('spend-by-vendor')
  async spendByVendor(@CurrentUser('workspaceId') workspaceId: string, @Query() q: SpendByVendorQueryDto) {
    const { from, to } = legacyRange(q);
    const r = await this.reports.moneyOut(workspaceId, from || to ? 'custom' : 'all', from, to, q.limit ?? 10);
    return r.topVendors.rows.map((v) => ({ vendorId: v.vendorId, vendor: v.label, total: v.total }));
  }

  @Get('monthly-grid')
  async monthlyGrid(@CurrentUser('workspaceId') workspaceId: string, @Query() q: MonthlyGridQueryDto) {
    const r = await this.reports.moneyOut(workspaceId, 'custom', `${q.year}-01-01`, `${q.year}-12-31`);
    const rows = r.monthlyByCategory.categories.map((cat) => {
      const months = new Array(12).fill(0);
      for (const m of r.monthlyByCategory.rows) months[Number(m.month.slice(5, 7)) - 1] += m.byCategory[cat] ?? 0;
      return { payCategoryId: null, payCategory: cat, months, total: r.monthlyByCategory.totals[cat] ?? 0 };
    });
    const monthlyTotals = new Array(12).fill(0);
    for (const m of r.monthlyByCategory.rows) monthlyTotals[Number(m.month.slice(5, 7)) - 1] = m.total;
    return { year: q.year, rows, monthlyTotals, grandTotal: r.kpis.totalSpend };
  }

  @Get('export.csv')
  async exportCsv(@CurrentUser('workspaceId') workspaceId: string, @Query() q: DateRangeDto, @Res() res: Response) {
    const { from, to } = legacyRange(q);
    const body = await this.csv.moneyOutCsv(workspaceId, from || to ? 'custom' : 'all', from, to);
    sendFile(res, 'text/csv', 'spend-report.csv', body);
  }

  @Get('export.pdf')
  async exportPdf(@CurrentUser('workspaceId') workspaceId: string, @Query() q: DateRangeDto, @Res() res: Response) {
    const { from, to } = legacyRange(q);
    const body = await this.pdf.moneyOutPdf(workspaceId, from || to ? 'custom' : 'all', from, to);
    sendFile(res, 'application/pdf', 'spend-report.pdf', body);
  }
}
