/**
 * make-test-form.ts
 *
 * Creates a synthetic tender annexure-style PDF with realistic field
 * labels so probe-form.ts can be validated before the real UGVCL form is
 * available. No AcroForm — plain text, matching what scanned/digital
 * tender annexures look like.
 *
 * Usage: npx tsx scripts/make-test-form.ts
 * Output: scripts/test-annex.pdf
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function makeTestForm() {
  const doc = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const black = rgb(0, 0, 0);
  const grey = rgb(0.5, 0.5, 0.5);
  const labelSize = 10;
  const headSize = 12;
  const lineGrey = rgb(0.7, 0.7, 0.7);

  // ── Header ──────────────────────────────────────────────────────────────────
  page.drawText('UTTAR GUJARAT VIJ COMPANY LIMITED', {
    x: 110, y: height - 50, size: 14, font: boldFont, color: black,
  });
  page.drawText('ANNEXURE – A', {
    x: 210, y: height - 70, size: 12, font: boldFont, color: black,
  });
  page.drawText('DETAILS OF BIDDER / TENDERER', {
    x: 165, y: height - 90, size: headSize, font: boldFont, color: black,
  });
  page.drawLine({ start: { x: 40, y: height - 100 }, end: { x: width - 40, y: height - 100 }, thickness: 1, color: black });

  // ── Fields table ─────────────────────────────────────────────────────────────
  // Each entry: [label, y offset from top, has line after?]
  const fields: Array<{ label: string; y: number; wide?: boolean }> = [
    { label: 'Name of Firm/Company/Agency:', y: 140 },
    { label: 'Registered Address:', y: 170 },
    { label: '', y: 190 },                                // continuation line
    { label: 'District:', y: 220, wide: false },
    { label: 'State:', y: 220, wide: false },
    { label: 'Pin Code:', y: 220, wide: false },
    { label: 'GSTIN No.:', y: 250 },
    { label: 'PAN No.:', y: 280 },
    { label: 'Contact No. (Mobile):', y: 310 },
    { label: 'Email ID:', y: 340 },
    { label: 'Name of Authorized Signatory:', y: 370 },
    { label: 'Designation:', y: 400 },
    { label: 'Registration No.:', y: 430 },
    { label: 'Year of Establishment:', y: 460 },
    { label: 'Annual Turnover (Last 3 Years) Rs.:', y: 490 },
    { label: 'Date:', y: 540 },
    { label: 'Place:', y: 570 },
  ];

  // Special multi-column row for District/State/Pincode
  const multiRow = fields.filter(f => f.y === 220 && f.label !== '');
  const singleFields = fields.filter(f => !(f.y === 220 && f.label !== '') && f.label !== '');

  for (const f of singleFields) {
    const y = height - f.y;
    page.drawText(f.label, { x: 40, y, size: labelSize, font, color: black });
    const labelW = font.widthOfTextAtSize(f.label, labelSize);
    page.drawLine({
      start: { x: 40 + labelW + 5, y: y - 2 },
      end: { x: width - 40, y: y - 2 },
      thickness: 0.5,
      color: lineGrey,
    });
  }

  // Continuation blank line (for address second line)
  page.drawLine({
    start: { x: 40, y: height - 192 },
    end: { x: width - 40, y: height - 192 },
    thickness: 0.5,
    color: lineGrey,
  });

  // Multi-column row: District | State | Pin Code
  const colY = height - 222;
  const cols = [
    { label: 'District:', x: 40 },
    { label: 'State:', x: 220 },
    { label: 'Pin Code:', x: 380 },
  ];
  for (const c of cols) {
    page.drawText(c.label, { x: c.x, y: colY, size: labelSize, font, color: black });
    const lw = font.widthOfTextAtSize(c.label, labelSize);
    const nextX = c.x === 380 ? width - 40 : cols[cols.indexOf(c) + 1]?.x - 10 ?? width - 40;
    page.drawLine({
      start: { x: c.x + lw + 3, y: colY - 2 },
      end: { x: nextX, y: colY - 2 },
      thickness: 0.5,
      color: lineGrey,
    });
  }

  // ── Signature block ───────────────────────────────────────────────────────────
  const sigY = height - 620;
  page.drawText('Signature of Authorized Signatory:', { x: 40, y: sigY, size: labelSize, font, color: black });
  page.drawLine({ start: { x: 40, y: sigY - 30 }, end: { x: 200, y: sigY - 30 }, thickness: 0.5, color: lineGrey });

  page.drawText('Company Seal:', { x: 350, y: sigY, size: labelSize, font, color: black });
  // Seal box (four lines forming a rectangle)
  page.drawLine({ start: { x: 350, y: sigY - 5 }, end: { x: 500, y: sigY - 5 }, thickness: 0.5, color: lineGrey });
  page.drawLine({ start: { x: 350, y: sigY - 55 }, end: { x: 500, y: sigY - 55 }, thickness: 0.5, color: lineGrey });
  page.drawLine({ start: { x: 350, y: sigY - 5 }, end: { x: 350, y: sigY - 55 }, thickness: 0.5, color: lineGrey });
  page.drawLine({ start: { x: 500, y: sigY - 5 }, end: { x: 500, y: sigY - 55 }, thickness: 0.5, color: lineGrey });

  // ── Footer note ───────────────────────────────────────────────────────────────
  page.drawText(
    'Note: All fields are mandatory. Attach supporting documents as applicable.',
    { x: 40, y: 40, size: 8, font, color: grey },
  );

  const pdfBytes = await doc.save();
  const outPath = path.join(__dirname, 'test-annex.pdf');
  fs.writeFileSync(outPath, pdfBytes);
  console.log(`\nCreated: ${outPath}`);
  console.log('Run:  npx tsx scripts/probe-form.ts scripts/test-annex.pdf\n');
}

makeTestForm().catch(err => {
  console.error('Error:', err?.message ?? err);
  process.exit(1);
});
