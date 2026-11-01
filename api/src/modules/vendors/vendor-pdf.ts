import * as PDFDocument from 'pdfkit';

export const VENDOR_EXPORT_HEADER = ['Name', 'Bank', 'Account Number', 'Verified Name', 'Contact', 'Phone', 'TIN', 'Tags'];

/** Landscape A4 vendor register (spec §5.4 export columns). */
export function renderVendorPdf(workspaceName: string, rows: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const widths = [130, 100, 75, 120, 90, 80, 75, 100];
    const left = 36;
    const bottom = doc.page.height - 36;

    const header = () => {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000');
      let x = left;
      const y = doc.y;
      VENDOR_EXPORT_HEADER.forEach((h, i) => {
        doc.text(h, x, y, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.moveTo(left, y + 12).lineTo(left + widths.reduce((a, b) => a + b, 0), y + 12).strokeColor('#999999').stroke();
      doc.y = y + 16;
      doc.font('Helvetica').fontSize(8);
    };

    doc.fontSize(16).font('Helvetica-Bold').text(workspaceName);
    doc.fontSize(11).font('Helvetica').text('Vendor Register');
    doc.fontSize(9).fillColor('#555555').text(`${rows.length} vendor(s) · generated ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.8);
    header();

    for (const r of rows) {
      const heights = r.map((cell, i) => doc.heightOfString(cell || '—', { width: widths[i] - 6 }));
      const h = Math.max(...heights, 10) + 4;
      if (doc.y + h > bottom) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      let x = left;
      r.forEach((cell, i) => {
        doc.fillColor(cell ? '#000000' : '#999999').text(cell || '—', x, y, { width: widths[i] - 6 });
        x += widths[i];
      });
      doc.y = y + h;
    }
    doc.end();
  });
}
