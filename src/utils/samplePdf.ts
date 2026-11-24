import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function createSamplePrintPdf(shopName: string): Promise<File> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);

  const page1 = doc.addPage([595, 842]);
  page1.drawRectangle({ x: 40, y: 740, width: 515, height: 60, color: rgb(0.11, 0.31, 0.85) });
  page1.drawText(shopName || 'PrintFlow AutoPrint', {
    x: 60,
    y: 765,
    size: 20,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page1.drawText('Sample Multi-Page Document (Page 1 of 2)', {
    x: 60,
    y: 700,
    size: 14,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page1.drawText(
    'This real PDF was generated to test automatic page counting, B&W / Color pricing,\nUPI QR generation, and instant print dispatch.',
    {
      x: 60,
      y: 660,
      size: 11,
      lineHeight: 18,
      font: fontRegular,
      color: rgb(0.25, 0.31, 0.4),
    }
  );

  const page2 = doc.addPage([595, 842]);
  page2.drawText('Page 2 — Print Specification Summary', {
    x: 60,
    y: 760,
    size: 16,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page2.drawText('Supports A4, A3, Letter, Legal, and 4x6 Photo formats.', {
    x: 60,
    y: 720,
    size: 11,
    font: fontRegular,
    color: rgb(0.25, 0.31, 0.4),
  });

  const bytes = await doc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  return new File([blob], 'sample-order-sheet.pdf', { type: 'application/pdf' });
}
