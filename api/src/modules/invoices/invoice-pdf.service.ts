import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  notes?: string | null;
  customerAddress?: string | null;
  customer: { name: string; email?: string | null; phone?: string | null };
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  workspace: { name: string; invoicePrefix: string; taxRate: number };
}

interface ReceiptPdfData {
  receiptNumber: string;
  createdAt: Date;
  amount: number;
  invoiceNumber: string;
  customer: { name: string };
  workspace: { name: string };
}

/**
 * Renders invoice + payment-receipt PDFs directly with PDFKit (no headless-browser dependency —
 * pdfkit is already installed for this repo). Kept intentionally simple/text-first; swap in
 * workspace branding (logo, colors) here once an asset-storage module exists.
 */
@Injectable()
export class InvoicePdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generateInvoicePdfById(invoiceId: string, workspaceId: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      include: { customer: true, items: true },
    });
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, invoicePrefix: true, taxRate: true },
    });

    const data: InvoicePdfData = {
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      subtotal: Number(invoice.subtotal),
      taxAmount: Number(invoice.taxAmount),
      total: Number(invoice.total),
      amountPaid: Number(invoice.amountPaid),
      notes: invoice.notes,
      customerAddress: invoice.customerAddress,
      customer: invoice.customer,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
      workspace: {
        name: workspace!.name,
        invoicePrefix: workspace!.invoicePrefix,
        taxRate: Number(workspace!.taxRate),
      },
    };

    const buffer = await this.renderInvoice(data);
    return { buffer, invoiceNumber: invoice.invoiceNumber };
  }

  async generateReceiptPdfById(
    invoiceId: string,
    receiptId: string,
    workspaceId: string,
  ): Promise<{ buffer: Buffer; receiptNumber: string }> {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { id: receiptId, invoiceId, invoice: { workspaceId } },
      include: { invoice: { include: { customer: true } }, invoicePayment: true },
    });
    if (!receipt) {
      throw new Error('Receipt not found');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });

    const data: ReceiptPdfData = {
      receiptNumber: receipt.receiptNumber,
      createdAt: receipt.createdAt,
      amount: Number(receipt.invoicePayment?.amount ?? 0),
      invoiceNumber: receipt.invoice.invoiceNumber,
      customer: { name: receipt.invoice.customer.name },
      workspace: { name: workspace!.name },
    };

    const buffer = await this.renderReceipt(data);
    return { buffer, receiptNumber: receipt.receiptNumber };
  }

  private renderInvoice(invoice: InvoicePdfData): Promise<Buffer> {
    return this.buildPdf((doc) => {
      doc.fontSize(20).text(invoice.workspace.name, { continued: false });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor('#666666').text('INVOICE');
      doc.fillColor('#000000');
      doc.moveDown(1);

      doc.fontSize(14).text(`Invoice ${invoice.invoiceNumber}`);
      doc.fontSize(10).fillColor('#666666');
      doc.text(`Status: ${invoice.status.replace('_', ' ')}`);
      doc.text(`Issue date: ${this.formatDate(invoice.issueDate)}`);
      doc.text(`Due date: ${this.formatDate(invoice.dueDate)}`);
      doc.fillColor('#000000');
      doc.moveDown(1);

      doc.fontSize(11).text('Bill to:', { underline: true });
      doc.fontSize(10).text(invoice.customer.name);
      if (invoice.customerAddress) doc.text(invoice.customerAddress);
      if (invoice.customer.email) doc.text(invoice.customer.email);
      if (invoice.customer.phone) doc.text(invoice.customer.phone);
      doc.moveDown(1.5);

      // Line items table
      const tableTop = doc.y;
      const col = { desc: 50, qty: 300, price: 370, amount: 460 };
      doc.fontSize(10).fillColor('#666666');
      doc.text('Description', col.desc, tableTop);
      doc.text('Qty', col.qty, tableTop);
      doc.text('Unit price', col.price, tableTop);
      doc.text('Amount', col.amount, tableTop);
      doc.fillColor('#000000');
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

      let y = tableTop + 22;
      for (const item of invoice.items) {
        const amount = item.quantity * item.unitPrice;
        doc.fontSize(10);
        doc.text(item.description, col.desc, y, { width: 240 });
        doc.text(item.quantity.toString(), col.qty, y);
        doc.text(this.formatCurrency(item.unitPrice), col.price, y);
        doc.text(this.formatCurrency(amount), col.amount, y);
        y += 20;
      }

      doc.moveTo(50, y + 4).lineTo(545, y + 4).stroke();
      y += 14;

      doc.fontSize(10).text('Subtotal', col.price, y);
      doc.text(this.formatCurrency(invoice.subtotal), col.amount, y);
      y += 16;

      doc.text(`Tax (${invoice.workspace.taxRate}%)`, col.price, y);
      doc.text(this.formatCurrency(invoice.taxAmount), col.amount, y);
      y += 16;

      doc.fontSize(11).text('Total', col.price, y);
      doc.text(this.formatCurrency(invoice.total), col.amount, y);
      y += 20;

      if (invoice.amountPaid > 0) {
        doc.fontSize(10).text('Amount paid', col.price, y);
        doc.text(this.formatCurrency(invoice.amountPaid), col.amount, y);
        y += 16;
        doc.text('Balance due', col.price, y);
        doc.text(this.formatCurrency(invoice.total - invoice.amountPaid), col.amount, y);
        y += 20;
      }

      if (invoice.notes) {
        doc.moveDown(1);
        doc.fontSize(10).fillColor('#666666').text('Notes', 50);
        doc.fillColor('#000000').text(invoice.notes, 50, doc.y, { width: 495 });
      }
    });
  }

  private renderReceipt(receipt: ReceiptPdfData): Promise<Buffer> {
    return this.buildPdf((doc) => {
      doc.fontSize(20).text(receipt.workspace.name);
      doc.fontSize(10).fillColor('#666666').text('PAYMENT RECEIPT');
      doc.fillColor('#000000');
      doc.moveDown(1);

      doc.fontSize(14).text(`Receipt ${receipt.receiptNumber}`);
      doc.fontSize(10).fillColor('#666666');
      doc.text(`Date: ${this.formatDate(receipt.createdAt)}`);
      doc.text(`Against invoice: ${receipt.invoiceNumber}`);
      doc.fillColor('#000000');
      doc.moveDown(1);

      doc.fontSize(11).text('Received from:', { underline: true });
      doc.fontSize(10).text(receipt.customer.name);
      doc.moveDown(1.5);

      doc.fontSize(14).text(`Amount received: ${this.formatCurrency(receipt.amount)}`);
      doc.moveDown(1);
      doc.fontSize(9).fillColor('#666666').text('This receipt confirms payment recorded against the invoice above.');
    });
  }

  private buildPdf(draw: (doc: any) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      draw(doc);

      doc.end();
    });
  }

  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  private formatCurrency(amount: number): string {
    return `NGN ${new Intl.NumberFormat('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
}
