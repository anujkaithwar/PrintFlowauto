import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PrintJob, PublicConfig } from '../types';

/**
 * Standard Helvetica/Courier fonts in pdf-lib only encode WinAnsi (Latin-1) characters.
 * Replace ₹ and sanitize unsupported Unicode characters so PDF generation never throws
 * on regional filenames or shop names.
 */
function toWinAnsiSafe(input: string, fallback = '-'): string {
  const cleaned = (input || '')
    .replace(/₹/g, 'INR ')
    .replace(/×/g, 'x')
    .replace(/—|–/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
  return cleaned || fallback;
}

function formatIsoTimestamp(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export async function generateJobReceiptPdf(
  job: PrintJob,
  config: PublicConfig
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontMono = await doc.embedFont(StandardFonts.CourierBold);

  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const navy = rgb(0.06, 0.09, 0.16);
  const blue = rgb(0.11, 0.31, 0.85);
  const slate = rgb(0.35, 0.42, 0.52);
  const lightBg = rgb(0.97, 0.98, 0.99);
  const borderGray = rgb(0.86, 0.89, 0.93);
  const emerald = rgb(0.02, 0.52, 0.35);
  const emeraldBg = rgb(0.92, 0.99, 0.95);
  const white = rgb(1, 1, 1);

  // Header Banner
  page.drawRectangle({
    x: 40,
    y: height - 130,
    width: width - 80,
    height: 90,
    color: navy,
  });

  page.drawText(toWinAnsiSafe(config.shopName, 'PrintFlow AutoPrint'), {
    x: 60,
    y: height - 74,
    size: 20,
    font: fontBold,
    color: white,
  });

  page.drawText(toWinAnsiSafe(config.shopAddress, 'Automated Print Counter'), {
    x: 60,
    y: height - 96,
    size: 10,
    font: fontRegular,
    color: rgb(0.8, 0.85, 0.93),
  });

  page.drawText('PRINT & PAYMENT RECEIPT', {
    x: width - 225,
    y: height - 74,
    size: 12,
    font: fontBold,
    color: rgb(0.58, 0.77, 1),
  });
  page.drawText(`Job: ${toWinAnsiSafe(job.code)}`, {
    x: width - 225,
    y: height - 96,
    size: 11,
    font: fontMono,
    color: white,
  });

  // Payment Status Callout Bar
  let cursorY = height - 185;
  page.drawRectangle({
    x: 40,
    y: cursorY,
    width: width - 80,
    height: 42,
    color: emeraldBg,
    borderColor: rgb(0.68, 0.92, 0.8),
    borderWidth: 1,
  });

  const paymentStatusLabel = job.paymentStatus === 'paid' ? 'PAID & VERIFIED' : job.paymentStatus.toUpperCase();
  page.drawText(`Payment Status: ${paymentStatusLabel}`, {
    x: 56,
    y: cursorY + 16,
    size: 11,
    font: fontBold,
    color: emerald,
  });
  page.drawText(`Print Status: ${toWinAnsiSafe(job.printStatus.replace('_', ' ').toUpperCase())}`, {
    x: width - 225,
    y: cursorY + 16,
    size: 10,
    font: fontBold,
    color: navy,
  });

  // Section Helper
  const drawRow = (label: string, value: string, y: number, mono = false) => {
    page.drawText(toWinAnsiSafe(label), {
      x: 56,
      y,
      size: 10,
      font: fontRegular,
      color: slate,
    });
    page.drawText(toWinAnsiSafe(value), {
      x: 230,
      y,
      size: 10,
      font: mono ? fontMono : fontBold,
      color: navy,
    });
    page.drawLine({
      start: { x: 56, y: y - 8 },
      end: { x: width - 56, y: y - 8 },
      thickness: 0.5,
      color: borderGray,
    });
  };

  // Section 1: Order & Customer Info
  cursorY -= 32;
  page.drawText('ORDER & CUSTOMER DETAILS', {
    x: 40,
    y: cursorY,
    size: 11,
    font: fontBold,
    color: blue,
  });

  cursorY -= 24;
  drawRow('Job Code / Pickup PIN', `${job.code}  |  PIN: ${job.pin}`, cursorY, true);
  cursorY -= 24;
  drawRow('Customer Name', job.customerName || 'Walk-in Customer', cursorY);
  cursorY -= 24;
  if (job.customerPhone) {
    drawRow('Phone Number', job.customerPhone, cursorY, true);
    cursorY -= 24;
  }
  drawRow('Order Source', job.source.replace('_', ' ').toUpperCase(), cursorY);
  cursorY -= 24;
  drawRow('Created At', formatIsoTimestamp(job.createdAt), cursorY);
  cursorY -= 24;
  drawRow('Paid At', formatIsoTimestamp(job.paidAt), cursorY);

  // Section 2: Document & Print Specs
  cursorY -= 34;
  page.drawText('DOCUMENT & PRINT SPECIFICATIONS', {
    x: 40,
    y: cursorY,
    size: 11,
    font: fontBold,
    color: blue,
  });

  const safeFilename = toWinAnsiSafe(job.originalFilename, 'Document').slice(0, 52);
  cursorY -= 24;
  drawRow('Document File', safeFilename, cursorY);
  cursorY -= 24;
  drawRow(
    'Color & Paper Size',
    `${job.options.colorMode === 'color' ? 'Full Color' : 'Black & White'}  |  ${job.options.paperSize.replace('_', ' ')}`,
    cursorY
  );
  cursorY -= 24;
  drawRow(
    'Sides & Orientation',
    `${job.options.sides === 'double' ? 'Double-Sided (Duplex)' : 'Single-Sided'}  |  ${job.options.orientation.toUpperCase()}`,
    cursorY
  );
  cursorY -= 24;
  drawRow(
    'Pages & Copies',
    `${job.printablePages} page(s) x ${job.options.copies} cop${job.options.copies === 1 ? 'y' : 'ies'}  (Range: ${job.options.pageRange})`,
    cursorY
  );
  cursorY -= 24;
  drawRow('Assigned Printer', job.assignedPrinter, cursorY);

  // Section 3: Payment & Total Summary Box
  cursorY -= 38;
  page.drawRectangle({
    x: 40,
    y: cursorY - 122,
    width: width - 80,
    height: 138,
    color: lightBg,
    borderColor: borderGray,
    borderWidth: 1,
  });

  page.drawText('PAYMENT SUMMARY', {
    x: 56,
    y: cursorY - 4,
    size: 11,
    font: fontBold,
    color: blue,
  });

  const unitRate = job.pricingBreakdown.unitRate * job.pricingBreakdown.multiplier;
  page.drawText(`Payment Method: ${toWinAnsiSafe((job.paymentMethod || 'upi_qr').replace('_', ' ').toUpperCase())}`, {
    x: 56,
    y: cursorY - 28,
    size: 10,
    font: fontRegular,
    color: slate,
  });
  page.drawText(`UTR / Ref ID: ${toWinAnsiSafe(job.utrNumber || '-')}`, {
    x: 56,
    y: cursorY - 46,
    size: 10,
    font: fontMono,
    color: navy,
  });
  page.drawText(`Rate per Page: INR ${unitRate.toFixed(2)}`, {
    x: 56,
    y: cursorY - 64,
    size: 10,
    font: fontRegular,
    color: slate,
  });

  if (job.pricingBreakdown.duplexDiscount > 0) {
    page.drawText(`Duplex Discount: -INR ${job.pricingBreakdown.duplexDiscount.toFixed(2)}`, {
      x: 56,
      y: cursorY - 82,
      size: 10,
      font: fontRegular,
      color: emerald,
    });
  }

  if ((job.loyaltyPointsEarned ?? 0) > 0) {
    page.drawText(
      `Loyalty Points: +${job.loyaltyPointsEarned} pts${
        job.loyaltyCustomerBalance !== undefined ? ` (Balance: ${job.loyaltyCustomerBalance} pts)` : ''
      }`,
      {
        x: 56,
        y: cursorY - 100,
        size: 10,
        font: fontBold,
        color: rgb(0.7, 0.33, 0.04),
      }
    );
  }

  page.drawText('TOTAL PAID', {
    x: width - 190,
    y: cursorY - 56,
    size: 10,
    font: fontBold,
    color: slate,
  });
  page.drawText(`INR ${job.pricingBreakdown.totalAmount.toFixed(2)}`, {
    x: width - 190,
    y: cursorY - 82,
    size: 20,
    font: fontBold,
    color: navy,
  });

  // Footer
  page.drawText(
    `UPI Merchant: ${toWinAnsiSafe(config.payment.upiId)}  |  Generated: ${formatIsoTimestamp(new Date().toISOString())}`,
    {
      x: 40,
      y: 52,
      size: 9,
      font: fontRegular,
      color: slate,
    }
  );
  page.drawText('Thank you for printing with us. Please collect your prints from the counter.', {
    x: 40,
    y: 36,
    size: 9,
    font: fontRegular,
    color: slate,
  });

  return doc.save();
}
