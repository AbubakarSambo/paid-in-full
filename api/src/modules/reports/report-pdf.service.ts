import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(value);
}

@Injectable()
export class ReportPdfService {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  async generatePdf(workspaceId: string, startDate?: Date, endDate?: Date): Promise<Buffer> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, currency: true },
    });
    const currency = workspace?.currency ?? 'NGN';
    const categories = await this.reportsService.spendByCategory(workspaceId, startDate, endDate);
    const grandTotal = categories.reduce((sum, row) => sum + row.total, 0);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const rangeLabel = [
        startDate ? startDate.toISOString().slice(0, 10) : 'inception',
        endDate ? endDate.toISOString().slice(0, 10) : 'now',
      ].join(' — ');

      doc.fontSize(18).font('Helvetica-Bold').text(workspace?.name ?? 'Paid in Full', { align: 'left' });
      doc.fontSize(12).font('Helvetica').text('Spend by Category Report');
      doc.fontSize(10).fillColor('#555555').text(`Period: ${rangeLabel}`);
      doc.fillColor('#000000');
      doc.moveDown(1.5);

      let y = doc.y;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Category', 50, y);
      doc.text('Total', 400, y, { width: 145, align: 'right' });
      y += 16;
      doc.moveTo(50, y).lineTo(545, y).stroke();
      y += 8;

      doc.font('Helvetica');
      for (const row of categories) {
        if (y > 760) {
          doc.addPage();
          y = 50;
        }
        doc.text(row.payCategory, 50, y);
        doc.text(formatCurrency(row.total, currency), 400, y, { width: 145, align: 'right' });
        y += 18;
      }

      y += 8;
      doc.moveTo(50, y).lineTo(545, y).stroke();
      y += 8;
      doc.font('Helvetica-Bold');
      doc.text('Total', 50, y);
      doc.text(formatCurrency(grandTotal, currency), 400, y, { width: 145, align: 'right' });

      doc.end();
    });
  }
}
