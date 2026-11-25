import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as PDFDocument from 'pdfkit';
import * as JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { legSum, paidFromLegs, round2 } from '../wallet/payout-math';
import { bundleKeyOf } from './batches.service';

export const RECEIPT_FOOTER =
  "This is an automatically generated receipt for funds disbursed. The vendor's bank account received the net amount shown.";

type ItemWithPayouts = Prisma.BatchItemGetPayload<{ include: { payouts: true } }>;

interface ReceiptRow {
  date: Date;
  vendor: string;
  description: string;
  bankAccount: string;
  reference: string;
  gross: number;
  wht: number;
  net: number;
}

interface ReceiptDoc {
  title: 'PAYMENT RECEIPT' | 'BATCH PAYMENT RECEIPT' | 'BULK PAYMENT RECEIPT';
  receiptNumber: string;
  subtitle?: string;
  rows: ReceiptRow[];
}

const MAX_EXPORT = 2000;

function fmt(n: number): string {
  // Helvetica (WinAnsi) has no ₦ glyph, so receipts print "NGN".
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'receipt';
}

/** Spec §5.3 "Receipts (PDF)" + WhatsApp receipt link. */
@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private rowOf(item: ItemWithPayouts): ReceiptRow | null {
    const success = item.payouts.filter((p) => p.status === 'SUCCESS');
    const gross = paidFromLegs(item.payouts);
    if (gross <= 0) return null;
    const wht = legSum(item.payouts, 'WHT', ['SUCCESS']);
    const vendorLegs = success.filter((p) => p.leg === 'VENDOR').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
    const latest = vendorLegs[0] ?? success[0];
    return {
      date: latest?.completedAt ?? item.date,
      vendor: item.vendorName,
      description: item.description,
      bankAccount: [item.vendorBank, item.vendorAcctNo].filter(Boolean).join(' · ') || '—',
      reference: [...new Set(vendorLegs.map((p) => p.transferReference ?? p.reference))].join(', ') || item.payoutReference || '—',
      gross,
      wht,
      net: round2(gross - wht),
    };
  }

  private async loadBatch(workspaceId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, workspaceId },
      include: { items: { include: { payouts: true }, orderBy: { createdAt: 'asc' } }, workspace: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async lineReceipt(workspaceId: string, batchId: string, itemId: string) {
    const batch = await this.loadBatch(workspaceId, batchId);
    const item = batch.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Batch line not found');
    const row = this.rowOf(item);
    if (!row) throw new NotFoundException('Nothing has been paid on this line yet');
    const buffer = await this.render(batch.workspace, { title: 'PAYMENT RECEIPT', receiptNumber: row.reference.split(',')[0], subtitle: batch.batchRef, rows: [row] });
    return { buffer, filename: `${safeName(`${batch.batchRef}-${item.vendorName}`)}.pdf` };
  }

  async batchReceipt(workspaceId: string, batchId: string) {
    const batch = await this.loadBatch(workspaceId, batchId);
    const rows = batch.items.map((i) => this.rowOf(i)).filter((r): r is ReceiptRow => !!r);
    if (!rows.length) throw new NotFoundException('Nothing has been paid in this batch yet');
    const buffer = await this.render(batch.workspace, { title: 'BATCH PAYMENT RECEIPT', receiptNumber: batch.batchRef, subtitle: batch.payCategoryName ?? undefined, rows });
    return { buffer, filename: `${safeName(batch.batchRef)}.pdf` };
  }

  async bundleReceipt(workspaceId: string, batchId: string, bundleKey: string) {
    const batch = await this.loadBatch(workspaceId, batchId);
    const items = batch.items.filter((i) => bundleKeyOf(i) === bundleKey);
    if (!items.length) throw new NotFoundException('Bundle not found in this batch');
    const rows = items.map((i) => this.rowOf(i)).filter((r): r is ReceiptRow => !!r);
    if (!rows.length) throw new NotFoundException('Nothing has been paid in this bundle yet');
    const label = items[0].bundleLabel ?? 'Bundle';
    const buffer = await this.render(batch.workspace, { title: 'BULK PAYMENT RECEIPT', receiptNumber: batch.batchRef, subtitle: label, rows });
    return { buffer, filename: `${safeName(`${batch.batchRef}-${label}`)}.pdf` };
  }

  /** "Zip receipts": one PDF per paid line of the batch. */
  async batchZip(workspaceId: string, batchId: string) {
    const batch = await this.loadBatch(workspaceId, batchId);
    const zip = new JSZip();
    let n = 0;
    for (const item of batch.items) {
      const row = this.rowOf(item);
      if (!row) continue;
      n++;
      const pdf = await this.render(batch.workspace, { title: 'PAYMENT RECEIPT', receiptNumber: row.reference.split(',')[0], subtitle: batch.batchRef, rows: [row] });
      zip.file(`${String(n).padStart(3, '0')}-${safeName(item.vendorName)}.pdf`, pdf);
    }
    if (!n) throw new NotFoundException('Nothing has been paid in this batch yet');
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), filename: `${safeName(batch.batchRef)}-receipts.zip`, count: n };
  }

  /** "Export receipts": zip of every paid receipt in the workspace, one folder per batch. */
  async exportAll(workspaceId: string, from?: Date, to?: Date) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const items = await this.prisma.batchItem.findMany({
      where: {
        batch: { workspaceId },
        paidAmount: { gt: 0 },
        ...((from || to) && { payouts: { some: { status: 'SUCCESS', completedAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } } }),
      },
      include: { payouts: true, batch: { select: { batchRef: true } } },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT,
    });
    const zip = new JSZip();
    const logo = await this.loadLogo(workspace.logoUrl);
    let n = 0;
    for (const item of items) {
      const row = this.rowOf(item);
      if (!row) continue;
      n++;
      const pdf = await this.render(workspace, { title: 'PAYMENT RECEIPT', receiptNumber: row.reference.split(',')[0], subtitle: item.batch.batchRef, rows: [row] }, logo);
      zip.file(`${safeName(item.batch.batchRef)}/${String(n).padStart(4, '0')}-${safeName(item.vendorName)}.pdf`, pdf);
    }
    if (!n) throw new NotFoundException('No paid receipts to export');
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), filename: `receipts-${new Date().toISOString().slice(0, 10)}.zip`, count: n, truncated: items.length >= MAX_EXPORT };
  }

  /** "Send WhatsApp receipt": a wa.me link with the receipt text. */
  async whatsappLink(workspaceId: string, batchId: string, itemId: string) {
    const batch = await this.loadBatch(workspaceId, batchId);
    const item = batch.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Batch line not found');
    const row = this.rowOf(item);
    if (!row) throw new NotFoundException('Nothing has been paid on this line yet');
    const vendor = item.vendorId ? await this.prisma.vendor.findUnique({ where: { id: item.vendorId }, select: { phone: true, contactPerson: true } }) : null;
    const naira = (n: number) => `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
    const text = [
      `Hello ${vendor?.contactPerson || item.vendorName},`,
      `${batch.workspace.name} has paid ${naira(row.net)} to ${row.bankAccount} for "${item.description}".`,
      row.wht > 0 ? `Gross ${naira(row.gross)}, WHT ${naira(row.wht)} withheld and remitted.` : null,
      `Reference: ${row.reference} · ${fmtDate(row.date)}.`,
      'Please confirm receipt. Thank you.',
    ]
      .filter(Boolean)
      .join('\n');
    const phone = normalisePhone(vendor?.phone);
    return { url: `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`, phone, text };
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  private async loadLogo(url: string | null | undefined): Promise<Buffer | null> {
    if (!url) return null;
    try {
      if (url.startsWith('data:image/')) {
        const b64 = url.split(',')[1];
        return b64 ? Buffer.from(b64, 'base64') : null;
      }
      if (!url.startsWith('https://')) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= 2 * 1024 * 1024 ? buf : null;
    } catch {
      return null;
    }
  }

  async render(workspace: { name: string; logoUrl: string | null }, data: ReceiptDoc, logoBuffer?: Buffer | null): Promise<Buffer> {
    const logo = logoBuffer !== undefined ? logoBuffer : await this.loadLogo(workspace.logoUrl);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const left = 40;
    const width = doc.page.width - 80;
    let y = 40;
    if (logo) {
      try {
        doc.image(logo, left, y, { fit: [60, 60] });
      } catch {
        // unsupported image format: skip the logo
      }
    }
    const textLeft = logo ? left + 72 : left;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(workspace.name, textLeft, y);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#B8860B').text(data.title, textLeft, y + 22);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(`Receipt no: ${data.receiptNumber}`, left, y, { width, align: 'right' });
    doc.text(`Issued: ${fmtDate(new Date())}`, left, y + 14, { width, align: 'right' });
    if (data.subtitle) doc.text(data.subtitle, left, y + 28, { width, align: 'right' });
    y += 75;

    const cols = [
      { h: 'Date', w: 0.09 },
      { h: 'Vendor', w: 0.14 },
      { h: 'Description', w: 0.2 },
      { h: 'Bank · Account', w: 0.14 },
      { h: 'Reference', w: 0.15 },
      { h: 'Gross', w: 0.095, right: true },
      { h: 'WHT', w: 0.08, right: true },
      { h: 'Net paid', w: 0.105, right: true },
    ];
    const drawHeader = () => {
      doc.rect(left, y, width, 18).fill('#F3F0E6');
      let x = left;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
      for (const c of cols) {
        doc.text(c.h, x + 3, y + 5, { width: c.w * width - 6, align: c.right ? 'right' : 'left' });
        x += c.w * width;
      }
      y += 22;
    };
    drawHeader();

    doc.font('Helvetica').fontSize(8).fillColor('#222');
    for (const r of data.rows) {
      const cells = [fmtDate(r.date), r.vendor, r.description, r.bankAccount, r.reference, fmt(r.gross), fmt(r.wht), fmt(r.net)];
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i].w * width - 6 }))) + 6;
      if (y + h > doc.page.height - 90) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        y = 40;
        drawHeader();
        doc.font('Helvetica').fontSize(8).fillColor('#222');
      }
      let x = left;
      cells.forEach((c, i) => {
        doc.text(c, x + 3, y, { width: cols[i].w * width - 6, align: cols[i].right ? 'right' : 'left' });
        x += cols[i].w * width;
      });
      y += h;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#E5E5E5').lineWidth(0.5).stroke();
    }

    const sum = (f: (r: ReceiptRow) => number) => round2(data.rows.reduce((s, r) => s + f(r), 0));
    y += 6;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111');
    doc.text(`Total (NGN)   Gross ${fmt(sum((r) => r.gross))}   WHT ${fmt(sum((r) => r.wht))}   Net paid ${fmt(sum((r) => r.net))}`, left, y, { width, align: 'right' });

    doc.font('Helvetica').fontSize(8).fillColor('#666').text(RECEIPT_FOOTER, left, doc.page.height - 70, { width, align: 'center' });
    doc.end();
    return done;
  }
}

function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('234')) return d;
  if (d.startsWith('0') && d.length === 11) return `234${d.slice(1)}`;
  if (d.length === 10) return `234${d}`;
  return d;
}

