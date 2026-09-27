import { Injectable } from '@nestjs/common';
import { ReportsService } from './reports.service';

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Injectable()
export class ReportCsvService {
  constructor(private readonly reportsService: ReportsService) {}

  async generateCsv(workspaceId: string, startDate?: Date, endDate?: Date): Promise<string> {
    const rows = await this.reportsService.exportRows(workspaceId, startDate, endDate);

    const header = ['Date', 'Vendor', 'Category', 'Cost Center', 'Gross Amount', 'WHT Amount', 'Net Amount'];
    const lines = [header.join(',')];

    for (const row of rows) {
      lines.push(
        [
          csvEscape(row.date.toISOString().slice(0, 10)),
          csvEscape(row.vendor),
          csvEscape(row.category),
          csvEscape(row.costCenter),
          csvEscape(row.grossAmount.toFixed(2)),
          csvEscape(row.whtAmount.toFixed(2)),
          csvEscape(row.netAmount.toFixed(2)),
        ].join(','),
      );
    }

    return lines.join('\n');
  }
}
