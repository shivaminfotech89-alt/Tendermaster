/**
 * probe-form.ts
 *
 * Diagnostic: extracts the text layer from a tender form PDF, identifies
 * field labels and their writable regions, and reports whether text-layer
 * anchoring (Path 2) is viable for automatic field filling.
 *
 * Usage:
 *   npx tsx scripts/probe-form.ts path/to/form.pdf
 *   npx tsx scripts/probe-form.ts path/to/form.pdf --json > report.json
 *
 * Detection cascade checked:
 *   Path 1 — AcroForm fields (pdf-lib):    reported and exits if found
 *   Path 2 — Text-layer anchoring (pdfjs): label + gap → writable region
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Node.js must use the legacy build (standard build requires browser DOMMatrix)
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

// ── Types ────────────────────────────────────────────────────────────────────

// Inline type avoids deep pdfjs-dist import path differences across versions
interface RawTextItem {
  str: string;
  transform: [number, number, number, number, number, number]; // [a,b,c,d,x,y]
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface BBox {
  text: string;
  x: number;      // left edge (PDF pts, origin bottom-left)
  y: number;      // bottom edge
  w: number;      // width
  h: number;      // height  (from item.height or estimated from matrix)
  right: number;  // x + w
  top: number;    // y + h
  fontSize: number;
}

interface WritableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  maxCharsAt7pt: number; // rough: width / (7 * 0.55)
}

type Confidence = 'high' | 'medium' | 'low' | 'none';
type Strategy = 'right-of-label' | 'to-right-margin' | 'below-label';

interface FieldCandidate {
  page: number;
  label: string;
  labelBox: BBox;
  strategy: Strategy;
  region: WritableRegion | null;
  confidence: Confidence;
  notes: string;
}

// ── Label patterns ───────────────────────────────────────────────────────────

// Items ending with : or matching known field keywords
const COLON_ENDS = /[::：]\s*$/;

const FIELD_KEYWORDS = [
  'name', 'address', 'phone', 'mobile', 'email', 'gst', 'gstin', 'pan',
  'tan', 'cin', 'llpin', 'udyam', 'msme', 'signature', 'seal', 'date',
  'place', 'designation', 'company', 'firm', 'agency', 'district', 'state',
  'pincode', 'pin code', 'contact', 'registration', 'licence', 'license',
  'amount', 'value', 'cost', 'year', 'validity', 'authority', 'department',
];

const SKIP_RE = [
  /^\d+\.?\s*$/,           // bare number
  /^[-–—_]+$/,             // separator line
  /^page\s*\d+/i,
  /^(annexure|schedule|format|form)\s+/i,
  /^s\.\s*no\.?$/i,        // Sr. No. column header — usually a column, not a label with a field
];

function isLabel(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 90) return false;
  if (SKIP_RE.some(r => r.test(t))) return false;
  if (COLON_ENDS.test(t)) return true;
  const lower = t.toLowerCase();
  return FIELD_KEYWORDS.some(k => lower.includes(k));
}

// ── BBox from pdfjs item ─────────────────────────────────────────────────────

function toBBox(item: RawTextItem): BBox {
  const [a, b, , d, x, y] = item.transform;
  // Font size from scale part of the transform matrix
  const fontSize = Math.max(1, Math.round(Math.sqrt(a * a + b * b)));
  // height: use item.height if pdfjs provides it, else estimate from matrix
  const h = item.height > 0 ? item.height : Math.abs(d) || fontSize;
  return {
    text: item.str,
    x,
    y,
    w: item.width,
    h,
    right: x + item.width,
    top: y + h,
    fontSize,
  };
}

// ── Row grouping (same line = Y within tolerance) ────────────────────────────

const Y_TOL = 4; // pts

function groupByRow(items: BBox[]): BBox[][] {
  const rows: BBox[][] = [];
  for (const item of items) {
    const row = rows.find(r => Math.abs(r[0].y - item.y) <= Y_TOL);
    if (row) row.push(item);
    else rows.push([item]);
  }
  rows.sort((a, b) => b[0].y - a[0].y);         // top-to-bottom
  for (const r of rows) r.sort((a, b) => a.x - b.x); // left-to-right
  return rows;
}

function estimateMaxChars(width: number, minFont = 7): number {
  return Math.max(0, Math.floor(width / (minFont * 0.55)));
}

// ── Region detection ─────────────────────────────────────────────────────────

function detectRegion(
  label: BBox,
  row: BBox[],
  allRows: BBox[][],
  pageWidth: number,
): { region: WritableRegion | null; strategy: Strategy; confidence: Confidence; notes: string } {
  const rightMargin = pageWidth - 25;
  const idx = row.findIndex(i => i === label);
  const next = row[idx + 1];

  // Strategy A: blank gap to the right of label, on same row
  if (next) {
    const gap = next.x - label.right;
    if (gap > 15) {
      return {
        strategy: 'right-of-label',
        confidence: gap > 80 ? 'high' : gap > 35 ? 'medium' : 'low',
        notes: `Gap to right: ${Math.round(gap)}pt | next text: "${next.text.slice(0, 28)}"`,
        region: {
          x: label.right + 2,
          y: label.y,
          width: gap - 4,
          height: label.h + 2,
          maxCharsAt7pt: estimateMaxChars(gap - 4),
        },
      };
    }
  }

  // Strategy B: label is the last (or only) item on the row — extends to margin
  if (!next) {
    const gap = rightMargin - label.right;
    if (gap > 30) {
      return {
        strategy: 'to-right-margin',
        confidence: gap > 120 ? 'high' : 'medium',
        notes: `Extends to right margin. Gap: ${Math.round(gap)}pt`,
        region: {
          x: label.right + 2,
          y: label.y,
          width: gap - 4,
          height: label.h + 2,
          maxCharsAt7pt: estimateMaxChars(gap - 4),
        },
      };
    }
  }

  // Strategy C: blank row below the label
  const rowY = label.y;
  const rowH = label.h;
  const rowBelow = allRows.find(
    r => r !== row && r[0].y < rowY - rowH * 0.3 && r[0].y > rowY - rowH * 3.5,
  );
  const regionH = rowBelow ? (rowY - rowBelow[0].y - 2) : rowH * 1.5;
  if (regionH > 4) {
    const leftBound = 30;
    const regionW = rightMargin - leftBound - 4;
    return {
      strategy: 'below-label',
      confidence: 'low',
      notes: `Below-label region. Next row y=${rowBelow ? Math.round(rowBelow[0].y) : '(margin)'}`,
      region: {
        x: leftBound + 2,
        y: rowY - regionH,
        width: regionW,
        height: regionH,
        maxCharsAt7pt: estimateMaxChars(regionW),
      },
    };
  }

  return {
    strategy: 'right-of-label',
    confidence: 'none',
    notes: 'No writable region found (too dense or label at right edge)',
    region: null,
  };
}

// ── Main probe ────────────────────────────────────────────────────────────────

async function probe(pdfPath: string, jsonMode: boolean) {
  const bytes = fs.readFileSync(pdfPath);

  // ── Path 1: AcroForm check via pdf-lib ─────────────────────────────────────
  let acroFields: string[] = [];
  try {
    const pdfDoc = await PDFDocument.load(bytes.buffer as ArrayBuffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    acroFields = form.getFields().map(
      f => `[${f.constructor.name.replace('PDF', '')}] "${f.getName()}"`,
    );
  } catch (_) {
    // no AcroForm or parse error — fall through to Path 2
  }

  if (!jsonMode) {
    const bar = '═'.repeat(72);
    console.log(`\n${bar}`);
    console.log(`  PDF PROBE: ${path.basename(pdfPath)}`);
    console.log(`${bar}\n`);
  }

  if (acroFields.length > 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ path: 1, acroFields }, null, 2));
    } else {
      console.log(`✅  AcroForm detected: ${acroFields.length} fields`);
      console.log('    → PATH 1 (pdf-lib AcroForm fill) is the correct strategy.\n');
      for (const f of acroFields) console.log(`    ${f}`);
      console.log('\n    Text-layer anchoring (Path 2) is NOT needed for this form.\n');
    }
    return;
  }

  if (!jsonMode) console.log('⬜  No AcroForm. Analyzing text layer (Path 2)…\n');

  // ── Path 2: text-layer anchoring ────────────────────────────────────────────
  const pdfDoc = await getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    disableFontFace: true,
  }).promise;

  const numPages = pdfDoc.numPages;
  if (!jsonMode) console.log(`    Pages: ${numPages}\n`);

  const allFields: FieldCandidate[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const vp = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();

    const rawItems = content.items.filter(
      (i): i is RawTextItem => 'str' in i && (i as RawTextItem).str.trim().length > 0,
    );
    const bboxes = rawItems.map(toBBox);
    const rows = groupByRow(bboxes);

    if (!jsonMode) {
      const sep = '─'.repeat(72);
      console.log(sep);
      console.log(
        `  PAGE ${p}  (${Math.round(vp.width)} × ${Math.round(vp.height)} pts)` +
        `  —  ${rawItems.length} text items`,
      );
      console.log(sep);
    }

    if (rawItems.length < 5) {
      if (!jsonMode)
        console.log(
          '  ⚠️  Near-empty text layer — likely scanned. Path 2 is not viable here.\n',
        );
      continue;
    }

    if (!jsonMode) {
      // Print full text item table
      const col = (s: string, n: number) => s.slice(0, n).padEnd(n);
      console.log(
        `\n  ${'TEXT ITEM'.padEnd(48)} ${'X'.padStart(5)} ${'Y'.padStart(5)}` +
        ` ${'W'.padStart(5)} ${'H'.padStart(4)} ${'FS'.padStart(3)}`,
      );
      console.log(`  ${'-'.repeat(73)}`);
      for (const b of bboxes) {
        const tag = isLabel(b.text) ? '  ◀ LABEL' : '';
        console.log(
          `  ${col(b.text, 48)}` +
          ` ${Math.round(b.x).toString().padStart(5)}` +
          ` ${Math.round(b.y).toString().padStart(5)}` +
          ` ${Math.round(b.w).toString().padStart(5)}` +
          ` ${Math.round(b.h).toString().padStart(4)}` +
          ` ${b.fontSize.toString().padStart(3)}${tag}`,
        );
      }
      console.log();
    }

    // Detect fields
    const seen = new Set<string>();
    for (const row of rows) {
      for (const item of row) {
        if (!isLabel(item.text)) continue;
        const key = `${Math.round(item.x)},${Math.round(item.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const { region, strategy, confidence, notes } = detectRegion(
          item, row, rows, vp.width,
        );
        allFields.push({ page: p, label: item.text, labelBox: item, strategy, region, confidence, notes });
      }
    }

    // Print page fields
    const pageFields = allFields.filter(f => f.page === p);
    if (!jsonMode) {
      if (pageFields.length === 0) {
        console.log('  ⚠️  No field labels auto-detected on this page.\n');
      } else {
        console.log(`  FIELD CANDIDATES — ${pageFields.length} found:\n`);
        const icon: Record<Confidence, string> = { high: '🟢', medium: '🟡', low: '🟠', none: '🔴' };
        for (const f of pageFields) {
          const r = f.region;
          const rStr = r
            ? `x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.width)} h=${Math.round(r.height)}  (~${r.maxCharsAt7pt} chars @ 7pt)`
            : 'NONE';
          console.log(`  ${icon[f.confidence]} [${f.confidence.toUpperCase()}] "${f.label}"`);
          console.log(`      label: x=${Math.round(f.labelBox.x)} y=${Math.round(f.labelBox.y)} w=${Math.round(f.labelBox.w)} h=${Math.round(f.labelBox.h)}`);
          console.log(`      strategy: ${f.strategy}`);
          console.log(`      region:   ${rStr}`);
          console.log(`      note:     ${f.notes}\n`);
        }
      }
    }
  }

  // ── Summary & verdict ────────────────────────────────────────────────────────
  const counts = {
    total: allFields.length,
    high: allFields.filter(f => f.confidence === 'high').length,
    medium: allFields.filter(f => f.confidence === 'medium').length,
    low: allFields.filter(f => f.confidence === 'low').length,
    none: allFields.filter(f => f.confidence === 'none').length,
  };
  const reliableRatio = counts.total === 0 ? 0 : (counts.high + counts.medium) / counts.total;

  const verdict =
    counts.total === 0
      ? 'NO FIELDS FOUND — form may be scanned (try Path 3 Vision/OCR)'
      : reliableRatio >= 0.70
      ? 'RELIABLE — Path 2 is viable as primary strategy'
      : reliableRatio >= 0.40
      ? 'PARTIAL — Path 2 needs user-adjust step for low-confidence fields'
      : 'UNRELIABLE — too few anchors; recommend Path 3 (Vision/OCR fallback)';

  if (jsonMode) {
    console.log(JSON.stringify({ path: 2, counts, reliableRatio, verdict, fields: allFields }, null, 2));
    return;
  }

  const bar = '═'.repeat(72);
  console.log(`\n${bar}`);
  console.log('  SUMMARY');
  console.log(bar);
  console.log(`  Total field candidates : ${counts.total}`);
  console.log(`  🟢 High confidence     : ${counts.high}`);
  console.log(`  🟡 Medium confidence   : ${counts.medium}`);
  console.log(`  🟠 Low confidence      : ${counts.low}`);
  console.log(`  🔴 No region found     : ${counts.none}`);
  console.log(`  Reliable ratio (H+M)   : ${Math.round(reliableRatio * 100)}%`);
  console.log();
  console.log(`  VERDICT: ${verdict}`);
  console.log(`${bar}\n`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pdfArg = args.find(a => !a.startsWith('-'));
const jsonMode = args.includes('--json');

if (!pdfArg) {
  console.error('\nUsage: npx tsx scripts/probe-form.ts <path/to/form.pdf> [--json]\n');
  process.exit(1);
}

probe(path.resolve(pdfArg), jsonMode).catch(err => {
  console.error('\nFailed:', err?.message ?? err);
  process.exit(1);
});
