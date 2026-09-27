import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportCsvService } from './report-csv.service';
import { ReportPdfService } from './report-pdf.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportCsvService, ReportPdfService],
  exports: [ReportsService],
})
export class ReportsModule {}
