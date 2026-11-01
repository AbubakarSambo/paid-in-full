import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceConfigService, InvoiceBranding, PaymentAccount } from './invoice-config.service';

interface ReceiptPdfData {
  receiptNumber: string;
  createdAt: Date;
  amount: number;
  method?: string | null;
  reference?: string | null;
  invoiceNumber: string;
  balance: number;
  currency: string;
  customer: { name: string };
  workspace: { name: string };
  branding: InvoiceBranding;
}

const GREY = '#666666';
const DARK = '#111111';

/**
 * Invoice / quote / receipt PDFs rendered with PDFKit. Uses the workspace invoice branding
 * (logo, signature image, theme colour, footer text) and prints the full spec §5.8 totals block
 * (subtotal, discount, VAT, total, less WHT, late fee / early-pay, amount due, paid, balance)
 * plus bank details (the invoice's collection account, else the workspace payment account).
 */
@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: InvoiceConfigService,
  ) {}

  async generateInvoicePdfById(invoiceId: string, workspaceId: string): Promise<{ buffer: Buffer; invoiceNumber: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
      include: { customer: true, items: { orderBy: { sortOrder: 'asc' } }, workspace: { select: { name: true, logoUrl: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const settings = await this.config.getSettings(workspaceId);
    const [logo, signature] = await Promise.all([
      this.loadImage(settings.branding.logoUrl ?? invoice.workspace.logoUrl),
      this.loadImage(settings.branding.signatureUrl),
    ]);

    const number = (invoice.docType === 'QUOTE' ? invoice.quoteNumber : invoice.invoiceNumber) ?? invoice.quoteNumber ?? '';
    const theme = `#${settings.branding.themeColor}`;
    const cur = invoice.currency;
    const money = (n: number) => this.formatCurrency(n, cur);
    const paid = Number(invoice.paidAmount);
    const amountDue = Number(invoice.amountDue);
    const balance = Math.max(0, amountDue - paid);

    const buffer = await this.buildPdf((doc) => {
      // Header band
      doc.rect(0, 0, doc.page.width, 8).fill(theme);
      doc.fillColor(DARK);
      let headerY = 30;
      if (logo) {
        try {
          doc.image(logo, 50, headerY, { fit: [120, 50] });
        } catch {
          /* unsupported image format: skip */
        }
      }
      doc.fontSize(22).fillColor(theme).text(invoice.docType === 'QUOTE' ? 'QUOTE' : 'INVOICE', 300, headerY, { width: 245, align: 'right' });
      doc.fontSize(10).fillColor(DARK).text(number, 300, doc.y, { width: 245, align: 'right' });
      doc.fillColor(GREY).text(`Status: ${invoice.status.replace('_', ' ')}`, 300, doc.y, { width: 245, align: 'right' });

      headerY = 95;
      doc.fontSize(13).fillColor(DARK).text(invoice.workspace.name, 50, headerY);
      if (invoice.workspaceTin) doc.fontSize(9).fillColor(GREY).text(`TIN: ${invoice.workspaceTin}`);

      // Meta block
      const metaY = headerY;
      const meta: [string, string][] = [
        ['Issue date', this.formatDate(invoice.issueDate)],
        invoice.docType === 'QUOTE'
          ? ['Valid until', invoice.quoteExpiresAt ? this.formatDate(invoice.quoteExpiresAt) : '—']
          : ['Due date', invoice.dueDate ? this.formatDate(invoice.dueDate) : '—'],
        ['Currency', cur + (invoice.fxRate ? ` (FX ${Number(invoice.fxRate)} ${invoice.fxBaseCurrency ?? ''})` : '')],
      ];
      let my = metaY;
      for (const [k, v] of meta) {
        doc.fontSize(9).fillColor(GREY).text(k, 350, my, { width: 80 });
        doc.fillColor(DARK).text(v, 430, my, { width: 115, align: 'right' });
        my += 14;
      }

      // Bill to
      doc.moveDown(2);
      let y = Math.max(doc.y, my) + 16;
      doc.fontSize(9).fillColor(theme).text('BILL TO', 50, y);
      doc.fontSize(10).fillColor(DARK).text(invoice.customer.name, 50, doc.y + 2);
      const addr = invoice.customerAddress ?? invoice.customer.address;
      if (addr) doc.fontSize(9).fillColor(GREY).text(addr, { width: 260 });
      if (invoice.customer.email) doc.text(invoice.customer.email);
      if (invoice.customer.phone) doc.text(invoice.customer.phone);
      if (invoice.customerTin) doc.text(`TIN: ${invoice.customerTin}`);

      // Items table
      y = doc.y + 18;
      const col = { desc: 50, qty: 290, price: 330, vat: 410, wht: 450, amount: 485 };
      doc.rect(50, y - 4, 495, 18).fill(theme);
      doc.fontSize(8.5).fillColor('#000000');
      doc.text('Description', col.desc + 4, y, { width: 230 });
      doc.text('Qty', col.qty, y, { width: 36, align: 'right' });
      doc.text('Unit price', col.price, y, { width: 75, align: 'right' });
      doc.text('VAT%', col.vat, y, { width: 36, align: 'right' });
      doc.text('WHT%', col.wht, y, { width: 32, align: 'right' });
      doc.text('Amount', col.amount, y, { width: 60, align: 'right' });
      y += 20;
      doc.fillColor(DARK);
      for (const item of invoice.items) {
        if (y > doc.page.height - 160) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(9);
        const h = doc.heightOfString(item.description, { width: 230 });
        doc.text(item.description, col.desc + 4, y, { width: 230 });
        doc.text(this.formatNumber(Number(item.quantity)), col.qty, y, { width: 36, align: 'right' });
        doc.text(money(Number(item.unitPrice)), col.price, y, { width: 75, align: 'right' });
        doc.text(this.formatNumber(Number(item.vatRate)), col.vat, y, { width: 36, align: 'right' });
        doc.text(this.formatNumber(Number(item.whtRate)), col.wht, y, { width: 32, align: 'right' });
        doc.text(money(Number(item.lineTotal)), col.amount, y, { width: 60, align: 'right' });
        y += Math.max(h, 12) + 6;
      }
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#DDDDDD').stroke();
      y += 10;

      // Totals
      const rows: [string, string, boolean?][] = [[`Subtotal${invoice.taxInclusive ? ' (excl. VAT)' : ''}`, money(Number(invoice.subtotal))]];
      if (Number(invoice.discountAmount) > 0) {
        rows.push([
          `Discount${invoice.discountType === 'PERCENT' ? ` (${Number(invoice.discountValue)}%)` : ''}`,
          `- ${money(Number(invoice.discountAmount))}`,
        ]);
      }
      rows.push(['VAT', money(Number(invoice.vatTotal))]);
      rows.push(['Total', money(Number(invoice.total)), true]);
      if (Number(invoice.whtTotal) > 0) rows.push(['Less WHT', `- ${money(Number(invoice.whtTotal))}`]);
      if (Number(invoice.lateFeeAmount) > 0) rows.push(['Late fee', money(Number(invoice.lateFeeAmount))]);
      if (Number(invoice.earlyPayDiscountAmount) > 0) rows.push(['Early-payment discount', `- ${money(Number(invoice.earlyPayDiscountAmount))}`]);
      rows.push(['Amount due', money(amountDue), true]);
      if (invoice.docType === 'INVOICE' && paid > 0) {
        rows.push(['Paid', `- ${money(paid)}`]);
        rows.push(['Balance', money(balance), true]);
      }
      for (const [label, value, bold] of rows) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9.5).fillColor(DARK);
        doc.text(label, 330, y, { width: 120 });
        doc.text(value, 445, y, { width: 100, align: 'right' });
        y += bold ? 17 : 15;
      }
      doc.font('Helvetica');

      // Late fee / early pay terms
      const extra: string[] = [];
      if (invoice.earlyPayDiscountPercent && invoice.earlyPayDiscountDays != null) {
        extra.push(`Early payment: ${Number(invoice.earlyPayDiscountPercent)}% off if paid within ${invoice.earlyPayDiscountDays} day(s) of issue.`);
      }
      if (Number(invoice.lateFeePercent ?? 0) > 0 || Number(invoice.lateFeeFlat ?? 0) > 0) {
        const parts = [
          Number(invoice.lateFeePercent ?? 0) > 0 ? `${Number(invoice.lateFeePercent)}%` : null,
          Number(invoice.lateFeeFlat ?? 0) > 0 ? money(Number(invoice.lateFeeFlat)) : null,
        ].filter(Boolean);
        extra.push(`Late fee: ${parts.join(' + ')} after ${invoice.lateFeeGraceDays ?? 0} day(s) past due.`);
      }

      // Bank details
      const bank: Partial<PaymentAccount> | null = invoice.collectionAccountNumber
        ? { bankName: invoice.collectionBankName, accountNumber: invoice.collectionAccountNumber, accountName: invoice.collectionAccountName ?? '' }
        : settings.paymentAccount;
      y += 10;
      doc.y = y;
      if (invoice.docType === 'INVOICE' && bank?.accountNumber) {
        doc.fontSize(9).fillColor(theme).text('PAY TO', 50, doc.y);
        doc.fontSize(9.5).fillColor(DARK).text(`${bank.bankName ?? ''}`, 50);
        doc.text(`Account number: ${bank.accountNumber}`);
        doc.text(`Account name: ${bank.accountName ?? ''}`);
        doc.moveDown(0.6);
      }
      for (const e of extra) doc.fontSize(8.5).fillColor(GREY).text(e, 50, doc.y, { width: 495 });
      if (invoice.notes) {
        doc.moveDown(0.6);
        doc.fontSize(9).fillColor(theme).text('NOTES', 50);
        doc.fontSize(9).fillColor(DARK).text(invoice.notes, 50, doc.y, { width: 495 });
      }
      if (invoice.terms) {
        doc.moveDown(0.6);
        doc.fontSize(9).fillColor(theme).text('TERMS', 50);
        doc.fontSize(9).fillColor(DARK).text(invoice.terms, 50, doc.y, { width: 495 });
      }
      if (signature) {
        doc.moveDown(1);
        try {
          doc.image(signature, 50, doc.y, { fit: [140, 50] });
          doc.y += 54;
          doc.fontSize(8).fillColor(GREY).text('Authorised signature', 50);
        } catch {
          /* skip unsupported image */
        }
      }

      // Footer
      const footer = [settings.branding.footerText, 'Powered by Paid in Full'].filter(Boolean).join('  ·  ');
      doc.fontSize(8).fillColor(GREY).text(footer, 50, doc.page.height - 50, { width: 495, align: 'center', lineBreak: false });
    });

    return { buffer, invoiceNumber: number || invoice.id };
  }

  async generateReceiptPdfById(invoiceId: string, receiptId: string, workspaceId: string): Promise<{ buffer: Buffer; receiptNumber: string }> {
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { id: receiptId, invoiceId, invoice: { workspaceId } },
      include: { invoice: { include: { customer: true, workspace: { select: { name: true } } } }, invoicePayment: true },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    const settings = await this.config.getSettings(workspaceId);
    const data: ReceiptPdfData = {
      receiptNumber: receipt.receiptNumber,
      createdAt: receipt.invoicePayment?.paidAt ?? receipt.createdAt,
      amount: Number(receipt.invoicePayment?.amount ?? 0),
      method: receipt.invoicePayment?.method,
      reference: receipt.invoicePayment?.monnifyReference,
      invoiceNumber: receipt.invoice.invoiceNumber ?? '',
      balance: Math.max(0, Number(receipt.invoice.amountDue) - Number(receipt.invoice.paidAmount)),
      currency: receipt.invoice.currency,
      customer: { name: receipt.invoice.customer.name },
      workspace: { name: receipt.invoice.workspace.name },
      branding: settings.branding,
    };
    const buffer = await this.renderReceipt(data);
    return { buffer, receiptNumber: receipt.receiptNumber };
  }

  private renderReceipt(r: ReceiptPdfData): Promise<Buffer> {
    const theme = `#${r.branding.themeColor}`;
    return this.buildPdf((doc) => {
      doc.rect(0, 0, doc.page.width, 8).fill(theme);
      doc.fillColor(DARK).fontSize(20).text(r.workspace.name, 50, 40);
      doc.fontSize(10).fillColor(theme).text('PAYMENT RECEIPT');
      doc.fillColor(DARK).moveDown(1);
      doc.fontSize(14).text(`Receipt ${r.receiptNumber}`);
      doc.fontSize(10).fillColor(GREY);
      doc.text(`Date: ${this.formatDate(r.createdAt)}`);
      doc.text(`Against invoice: ${r.invoiceNumber}`);
      if (r.method) doc.text(`Method: ${r.method}`);
      if (r.reference) doc.text(`Reference: ${r.reference}`);
      doc.fillColor(DARK).moveDown(1);
      doc.fontSize(11).text('Received from:', { underline: true });
      doc.fontSize(10).text(r.customer.name);
      doc.moveDown(1.5);
      doc.fontSize(14).text(`Amount received: ${this.formatCurrency(r.amount, r.currency)}`);
      doc.fontSize(10).fillColor(GREY).text(`Balance remaining on invoice: ${this.formatCurrency(r.balance, r.currency)}`);
      doc.moveDown(1);
      const footer = [r.branding.footerText, 'Powered by Paid in Full'].filter(Boolean).join('  ·  ');
      doc.fontSize(8).fillColor(GREY).text(footer, 50, doc.page.height - 50, { width: 495, align: 'center', lineBreak: false });
    });
  }

  /** Accepts a data: URL or an http(s) URL (2s timeout). Returns null if unavailable. */
  private async loadImage(src: string | null | undefined): Promise<Buffer | null> {
    if (!src) return null;
    try {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(src);
      if (m) return Buffer.from(m[2], 'base64');
      if (/^https?:\/\//i.test(src)) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch(src, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        if (!res.ok) return null;
        const type = res.headers.get('content-type') ?? '';
        if (!/png|jpe?g/i.test(type)) return null;
        return Buffer.from(await res.arrayBuffer());
      }
    } catch (err) {
      this.logger.debug(`Could not load invoice image: ${(err as Error).message}`);
    }
    return null;
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
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  private formatNumber(n: number): string {
    return new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(n);
  }

  private formatCurrency(amount: number, currency = 'NGN'): string {
    // PDFKit's built-in Helvetica has no ₦ glyph, so the currency code is printed instead.
    return `${currency} ${new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
  }
}
