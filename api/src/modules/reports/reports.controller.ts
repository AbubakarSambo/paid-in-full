import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportCsvService } from './report-csv.service';
import { ReportPdfService } from './report-pdf.service';
import { SpendByVendorQueryDto, MonthlyGridQueryDto } from './dto';
import { CurrentUser, DateRangeDto } from '../../common';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportCsvService: ReportCsvService,
    private readonly reportPdfService: ReportPdfService,
  ) {}

  @Get('spend-by-category')
  @ApiOperation({ summary: 'Total disbursed spend grouped by pay category, for a date range' })
  async spendByCategory(@CurrentUser('workspaceId') workspaceId: string, @Query() query: DateRangeDto) {
    return this.reportsService.spendByCategory(workspaceId, query.startDate, query.endDate);
  }

  @Get('spend-by-vendor')
  @ApiOperation({ summary: 'Top-N vendors by total disbursed spend, for a date range' })
  async spendByVendor(@CurrentUser('workspaceId') workspaceId: string, @Query() query: SpendByVendorQueryDto) {
    return this.reportsService.spendByVendor(workspaceId, query.startDate, query.endDate, query.limit ?? 10);
  }

  @Get('monthly-grid')
  @ApiOperation({ summary: 'Matrix of pay category x month totals for a given year, with overall totals' })
  async monthlyGrid(@CurrentUser('workspaceId') workspaceId: string, @Query() query: MonthlyGridQueryDto) {
    return this.reportsService.monthlyGrid(workspaceId, query.year);
  }

  @Get('export.csv')
  @ApiOperation({ summary: 'CSV export of disbursed batch items for a date range' })
  async exportCsv(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query() query: DateRangeDto,
    @Res() res: Response,
  ) {
    const csv = await this.reportCsvService.generateCsv(workspaceId, query.startDate, query.endDate);
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="spend-report.csv"',
    });
    res.send(csv);
  }

  @Get('export.pdf')
  @ApiOperation({ summary: 'PDF summary export (spend by category) for a date range' })
  async exportPdf(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query() query: DateRangeDto,
    @Res() res: Response,
  ) {
    const pdf = await this.reportPdfService.generatePdf(workspaceId, query.startDate, query.endDate);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="spend-report.pdf"',
    });
    res.send(pdf);
  }
}
