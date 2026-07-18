/**
 * overlay.ts — Mode B PDF text overlay
 *
 * Renders mapped field values onto the original PDF using pdf-lib.
 * Never draws anything for skip or needs_review fields.
 * Shrinks font from DEFAULT_FONT_SIZE toward MIN_FONT_SIZE to fit;
 * if it still overflows, records a warning and skips that field.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { MappedField, PdfRect } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DEFAULT_FONT_SIZE = 9;
const MIN_FONT_SIZE = 6;
const LINE_HEIGHT_RATIO = 1.3;
const PADDING = 2;       // pts inside each edge of the fill rect
const OCCUPY_MARGIN = 2; // clearance around existing text items when computing free bands

export interface OverlayOptions {
  debugBoxes?: boolean; // draw colored borders: green=filled, yellow=blank, red=needs_review
}

export interface OverlayResult {
  pdfBytes: Uint8Array;
  warnings: string[]; // labels that overflowed even at MIN_FONT_SIZE (not drawn)
}

// ── BUG 1 helpers: pre-printed text occupancy ─────────────────────────────────

interface TextBox { x: number; y: number; w: number; h: number; }

/**
 * For each page return the bounding boxes of all non-whitespace text items
 * in PDF user space (origin bottom-left, y increases upward).
 * Fails silently so the overlay always proceeds even without occupancy data.
 */
async function extractPageTextBoxes(
  pdfBytes: Uint8Array,
  pageCount: number,
): Promise<Map<number, TextBox[]>> {
  const result = new Map<number, TextBox[]>();
  try {
    const pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    for (let pgIdx = 0; pgIdx < pageCount; pgIdx++) {
      try {
        const page = await pdfjsDoc.getPage(pgIdx + 1);
        const content = await page.getTextContent();
        const boxes: TextBox[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          // transform[4]=x, transform[5]=baseline-y in PDF user space
          const tx = item.transform[4];
          const ty = item.transform[5];
          const w  = item.width  || 1;
          const h  = item.height || Math.abs(item.transform[3]) || 8;
          // Extend slightly for descenders (below baseline) and ascenders (above)
          boxes.push({ x: tx, y: ty - h * 0.25, w, h: h * 1.25 });
        }
        result.set(pgIdx, boxes);
      } catch {
        result.set(pgIdx, []);
      }
    }
  } catch {
    // pdfjs parse failure — proceed without occupancy data
  }
  return result;
}

/**
 * Returns the largest free Y-band inside fillRect that has no pre-printed text.
 * If the rect is fully clear, returns fillRect unchanged.
 * If there is no free space at all (rare), returns a zero-height rect so the
 * fit loop emits a warning and skips the field rather than drawing on top.
 */
function findWritableRect(fillRect: PdfRect, textBoxes: TextBox[]): PdfRect {
  const { x, y, width, height } = fillRect;
  const rectBottom = y;
  const rectTop    = y + height;

  const blocking = textBoxes.filter(tb =>
    tb.x        < x + width + OCCUPY_MARGIN &&
    tb.x + tb.w > x         - OCCUPY_MARGIN &&
    tb.y        < rectTop   + OCCUPY_MARGIN &&
    tb.y + tb.h > rectBottom - OCCUPY_MARGIN,
  );

  if (blocking.length === 0) return fillRect;

  const intervals = blocking
    .map(tb => ({
      lo: Math.max(rectBottom, tb.y         - OCCUPY_MARGIN),
      hi: Math.min(rectTop,    tb.y + tb.h  + OCCUPY_MARGIN),
    }))
    .filter(iv => iv.lo < iv.hi);

  if (intervals.length === 0) return fillRect;

  intervals.sort((a, b) => a.lo - b.lo);
  const merged: { lo: number; hi: number }[] = [{ ...intervals[0]! }];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1]!;
    const curr = intervals[i]!;
    if (curr.lo <= last.hi) last.hi = Math.max(last.hi, curr.hi);
    else merged.push({ ...curr });
  }

  const gaps: { lo: number; hi: number }[] = [];
  if (merged[0]!.lo > rectBottom) gaps.push({ lo: rectBottom, hi: merged[0]!.lo });
  for (let i = 0; i + 1 < merged.length; i++) {
    if (merged[i + 1]!.lo > merged[i]!.hi) gaps.push({ lo: merged[i]!.hi, hi: merged[i + 1]!.lo });
  }
  if (merged[merged.length - 1]!.hi < rectTop) gaps.push({ lo: merged[merged.length - 1]!.hi, hi: rectTop });

  if (gaps.length === 0) return { x, y: rectBottom, width, height: 0 }; // no free band

  const best = gaps.reduce((a, b) => (b.hi - b.lo > a.hi - a.lo ? b : a))!;
  return { x, y: best.lo, width, height: best.hi - best.lo };
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export async function overlayFields(
  originalPdfBytes: Uint8Array | ArrayBuffer | Buffer,
  mappedFields: MappedField[],
  options: OverlayOptions = {},
): Promise<OverlayResult> {
  const rawBytes = originalPdfBytes instanceof Uint8Array
    ? originalPdfBytes
    : new Uint8Array(originalPdfBytes as ArrayBuffer);

  const pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages  = pdfDoc.getPages();
  const warnings: string[] = [];

  // BUG 1: extract pre-printed text positions once for all pages
  const pageTextBoxes = await extractPageTextBoxes(rawBytes, pages.length);

  for (const field of mappedFields) {
    if (field.status === 'skip') continue;

    const pageIdx = Math.max(0, (field.page ?? 1) - 1);
    if (pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { x, y, width, height } = field.pdfRect;

    // ── Non-filled fields: debug box only ────────────────────────────────────
    if (field.status === 'blank' || field.status === 'needs_review') {
      if (options.debugBoxes) {
        const borderColor = field.status === 'blank' ? rgb(1, 0.75, 0) : rgb(1, 0.2, 0.2);
        page.drawRectangle({ x, y, width, height, borderColor, borderWidth: 0.5 });
      }
      continue;
    }

    // ── Filled fields ─────────────────────────────────────────────────────────
    const lines = field.value.split('\n').filter(l => l.trim());
    if (lines.length === 0) continue;

    // BUG 1: restrict draw area to the largest Y-band free of printed text
    const writable = findWritableRect(field.pdfRect, pageTextBoxes.get(pageIdx) ?? []);

    // Shrink font until content fits in the writable area or we hit the minimum
    let fontSize = DEFAULT_FONT_SIZE;
    let fits = false;
    while (fontSize >= MIN_FONT_SIZE) {
      const lineH = fontSize * LINE_HEIGHT_RATIO;
      const textH = lines.length === 1 ? fontSize : lines.length * lineH;
      const maxW  = Math.max(...lines.map(l => font.widthOfTextAtSize(l, fontSize)));
      if (textH + 1 <= writable.height && maxW + PADDING * 2 <= writable.width) {
        fits = true;
        break;
      }
      fontSize -= 0.5;
    }

    if (options.debugBoxes) {
      page.drawRectangle({
        x, y, width, height,
        borderColor: fits ? rgb(0, 0.65, 0) : rgb(1, 0.2, 0.2),
        borderWidth: 0.5,
      });
    }

    if (!fits) {
      warnings.push(`"${field.field_label}" overflows at ${MIN_FONT_SIZE}pt — not drawn`);
      continue;
    }

    // BUG 2: place baseline within the writable rect and hard-clamp to its bounds
    const lineH = fontSize * LINE_HEIGHT_RATIO;
    const rawY  = lines.length === 1
      ? writable.y + (writable.height - fontSize) / 2   // vertically centred
      : writable.y + writable.height - PADDING - fontSize; // top-aligned

    // Clamp so the full glyph block stays inside the writable rect
    const yMin   = writable.y + 1;
    const yMax   = Math.max(yMin, writable.y + writable.height - fontSize - 1);
    const startY = Math.min(Math.max(rawY, yMin), yMax);

    for (let i = 0; i < lines.length; i++) {
      const lineY = startY - i * lineH;
      if (lineY < writable.y - 1) break; // line falls below writable area — stop
      page.drawText(lines[i]!, {
        x: writable.x + PADDING,
        y: lineY,
        size: fontSize,
        font,
        color: rgb(0.05, 0.05, 0.6), // dark blue — visually distinct from pre-printed text
      });
    }
  }

  return { pdfBytes: await pdfDoc.save(), warnings };
}
