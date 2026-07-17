/**
 * overlay.ts — Mode B PDF text overlay
 *
 * Renders mapped field values onto the original PDF using pdf-lib.
 * Never draws anything for skip or needs_review fields.
 * Shrinks font from DEFAULT_FONT_SIZE toward MIN_FONT_SIZE to fit;
 * if it still overflows, records a warning and skips that field.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { MappedField } from './types';

const DEFAULT_FONT_SIZE = 9;
const MIN_FONT_SIZE = 6;
const LINE_HEIGHT_RATIO = 1.3;
const PADDING = 2; // pts inside each edge of the fill rect

export interface OverlayOptions {
  debugBoxes?: boolean; // draw colored borders: green=filled, yellow=blank, red=needs_review
}

export interface OverlayResult {
  pdfBytes: Uint8Array;
  warnings: string[]; // labels that overflowed even at MIN_FONT_SIZE (not drawn)
}

export async function overlayFields(
  originalPdfBytes: Uint8Array | ArrayBuffer | Buffer,
  mappedFields: MappedField[],
  options: OverlayOptions = {},
): Promise<OverlayResult> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes as ArrayBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const warnings: string[] = [];

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

    // Shrink font until content fits or we hit the minimum.
    // Height check uses fontSize (not lineH) for single-line cells so
    // that cells as narrow as 8pt can still render without false overflow.
    let fontSize = DEFAULT_FONT_SIZE;
    let fits = false;

    while (fontSize >= MIN_FONT_SIZE) {
      const lineH = fontSize * LINE_HEIGHT_RATIO;
      const textH = lines.length === 1 ? fontSize : lines.length * lineH;
      const maxLineW = Math.max(...lines.map(l => font.widthOfTextAtSize(l, fontSize)));
      if (textH + 1 <= height && maxLineW + PADDING * 2 <= width) {
        fits = true;
        break;
      }
      fontSize -= 0.5;
    }

    if (options.debugBoxes) {
      const borderColor = fits ? rgb(0, 0.65, 0) : rgb(1, 0.2, 0.2);
      page.drawRectangle({ x, y, width, height, borderColor, borderWidth: 0.5 });
    }

    if (!fits) {
      warnings.push(`"${field.field_label}" overflows at ${MIN_FONT_SIZE}pt — not drawn`);
      continue;
    }

    // Draw lines top-to-bottom (PDF y-axis is bottom-up).
    // Single-line cells: vertically center the text.
    // Multi-line cells: top-align with 2pt padding.
    const lineH = fontSize * LINE_HEIGHT_RATIO;
    const startY = lines.length === 1
      ? y + (height - fontSize) / 2       // vertically centered
      : y + height - PADDING - fontSize;  // top-aligned

    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], {
        x: x + PADDING,
        y: startY - i * lineH,
        size: fontSize,
        font,
        color: rgb(0.05, 0.05, 0.6), // dark blue — visually distinct from pre-printed text
      });
    }
  }

  return { pdfBytes: await pdfDoc.save(), warnings };
}
