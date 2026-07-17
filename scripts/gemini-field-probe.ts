/**
 * gemini-field-probe.ts
 *
 * Diagnostic: proves whether Gemini Vision can accurately locate the
 * fillable fields on a scanned/image-based tender form (Path 3).
 *
 * Steps:
 *   1. Upload the PDF to Gemini Files API (once, even for multi-page)
 *   2. Ask Gemini per-page to return field labels + fill-area bounding boxes
 *   3. Convert normalized coords → PDF coordinate space
 *   4. Annotate a copy of the PDF with colored rectangles
 *   5. Print the full field table and a verdict (or emit clean JSON)
 *
 * Usage:
 *   npx tsx scripts/gemini-field-probe.ts path/to/form.pdf
 *   npx tsx scripts/gemini-field-probe.ts path/to/form.pdf --all-pages
 *   npx tsx scripts/gemini-field-probe.ts path/to/form.pdf --all-pages --json \
 *     1>scripts/ugvcl-fields-all.json 2>scripts/ugvcl-probe.log
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// ── Gemini setup ─────────────────────────────────────────────────────────────

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('\nError: GEMINI_API_KEY not set. Add it to your .env file.\n');
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: key });
}

// ── Retry with exponential backoff ───────────────────────────────────────────

function isRetryable(e: any): boolean {
  const msg: string = (e?.message ?? e?.toString() ?? '').toLowerCase();
  const status: number = e?.status ?? e?.httpError?.status ?? 0;
  return status === 503 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded');
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  delays = [5, 10, 20, 40],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (!isRetryable(e) || attempt === delays.length) throw e;
      const wait = delays[attempt];
      console.warn(`  ⏳ ${label}: 503 — retrying in ${wait}s (attempt ${attempt + 1}/${delays.length})…`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  throw lastErr;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeminiField {
  field_label: string;
  fill_area_description: string;
  fill_box: [number, number, number, number];
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
}

interface MappedField extends GeminiField {
  page: number;
  pdfRect: { x: number; y: number; w: number; h: number };
}

// ── Coordinate conversion ─────────────────────────────────────────────────────

function toPdfRect(
  box: [number, number, number, number],
  pageW: number,
  pageH: number,
): { x: number; y: number; w: number; h: number } {
  const [yMin, xMin, yMax, xMax] = box;
  const x = (xMin / 1000) * pageW;
  const yTop = (yMin / 1000) * pageH;
  const w = ((xMax - xMin) / 1000) * pageW;
  const h = ((yMax - yMin) / 1000) * pageH;
  return { x, y: pageH - yTop - h, w, h };
}

// ── Gemini prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing a scanned Indian government tender form (Annexure / bid submission form).
Your task: identify every fillable field on the page — these are blank lines, blank boxes, or underscored spaces where a bidder must write their information.

Return a JSON array (no markdown, no code fences, raw JSON only) with one object per field:
{
  "field_label": "<exact label text as printed on the form, e.g. 'Name of Firm:', 'GSTIN No.:'>",
  "fill_area_description": "<brief description of the blank area, e.g. 'long blank line to the right of label'>",
  "fill_box": [y_min, x_min, y_max, x_max],
  "confidence": "high" | "medium" | "low",
  "notes": "<optional: any unusual layout, multi-line, table cell, etc.>"
}

fill_box coordinates:
- Use the Gemini bounding box format: [y_min, x_min, y_max, x_max]
- All values normalized 0–1000 (0 = top/left edge of page, 1000 = bottom/right edge)
- The box should cover the BLANK FILL AREA (where the user writes), NOT the label itself
- For a "Name of Firm: ___________" line, the box covers the underscored blank, not "Name of Firm:"
- For a table cell, the box covers the interior of the cell

Include ALL fillable fields — text lines, checkboxes, table cells, signature boxes.
Do NOT include headers, instructions, page numbers, or pre-printed fixed content.
If this page has no fillable fields (e.g. it is an instructions page), return an empty array [].

Output ONLY the JSON array. No explanation. No markdown.`;

// ── Single-page Gemini call ───────────────────────────────────────────────────

const MODEL_FALLBACK_ORDER = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.0-flash'];

async function callGeminiForPage(
  ai: GoogleGenAI,
  fileUri: string,
  pageNum: number,
  models: string[],
  diag: (...a: unknown[]) => void,
): Promise<{ text: string; usedModel: string }> {
  const pageNote = `\n\nAnalyze page ${pageNum} of this PDF.`;
  const callParams = {
    contents: [{
      role: 'user' as const,
      parts: [
        createPartFromUri(fileUri, 'application/pdf'),
        { text: SYSTEM_PROMPT + pageNote },
      ],
    }],
    config: { temperature: 0.1 },
  };

  for (const model of models) {
    diag(`  [page ${pageNum}] Asking ${model}…`);
    try {
      const result = await withRetry(
        `${model} page ${pageNum}`,
        () => ai.models.generateContent({ model, ...callParams }),
      );
      return { text: result.text ?? '', usedModel: model };
    } catch (e: any) {
      if (model === models[models.length - 1]) throw e;
      diag(`  [page ${pageNum}] ${model} failed, trying next model…`);
    }
  }
  throw new Error('All models failed');
}

function parseFieldsJson(raw: string, diag: (...a: unknown[]) => void): GeminiField[] {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: any) {
    diag(`  Warning: could not parse JSON — ${e?.message}`);
    return [];
  }
}

// ── Main probe ────────────────────────────────────────────────────────────────

async function probeWithGemini(
  pdfPath: string,
  targetPage: number,
  modelOverride: string | undefined,
  jsonMode: boolean,
  allPages: boolean,
) {
  const diag = (...args: unknown[]) => jsonMode ? console.error(...args) : console.log(...args);
  const ai = getAI();
  const models = modelOverride ? [modelOverride] : MODEL_FALLBACK_ORDER;

  diag(`\n${'═'.repeat(72)}`);
  diag(`  GEMINI FIELD PROBE: ${path.basename(pdfPath)}`);
  diag(`  Mode: ${allPages ? 'ALL PAGES' : `page ${targetPage > 0 ? targetPage : 1}`}`);
  diag(`  Models: ${models.join(' → ')}`);
  diag(`${'═'.repeat(72)}\n`);

  // ── Load PDF (for page count + annotation) ───────────────────────────────
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes.buffer as ArrayBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const totalPages = pdfDoc.getPageCount();

  const pagesToScan = allPages
    ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : [targetPage > 0 ? targetPage : 1];

  diag(`  PDF: ${totalPages} page(s) total. Scanning: ${pagesToScan.join(', ')}\n`);

  // ── Upload PDF once ──────────────────────────────────────────────────────
  diag('  Uploading PDF to Gemini Files API…');
  let uploadedFile: Awaited<ReturnType<typeof ai.files.upload>>;
  try {
    uploadedFile = await ai.files.upload({
      file: pdfPath,
      config: { mimeType: 'application/pdf', displayName: path.basename(pdfPath) },
    });
  } catch (e: any) {
    console.error('\nUpload failed:', e?.message ?? e);
    process.exit(1);
  }
  diag(`  Uploaded: ${uploadedFile.uri}\n`);

  // ── Color palette for annotation ─────────────────────────────────────────
  const colors = [
    rgb(1, 0.2, 0.2), rgb(0, 0.6, 0), rgb(0.1, 0.4, 1),
    rgb(1, 0.5, 0), rgb(0.6, 0, 0.8), rgb(0, 0.7, 0.7),
  ];

  // ── Per-page probing ─────────────────────────────────────────────────────
  const allFields: MappedField[] = [];
  let globalIdx = 0;

  for (const pg of pagesToScan) {
    const pageObj = pdfDoc.getPage(pg - 1);
    const { width: pgW, height: pgH } = pageObj.getSize();

    diag(`${'─'.repeat(60)}`);
    diag(`  Page ${pg}/${totalPages}  (${Math.round(pgW)}×${Math.round(pgH)} pts)`);

    let rawText = '';
    let usedModel = '';
    try {
      const r = await callGeminiForPage(ai, uploadedFile.uri!, pg, models, diag);
      rawText = r.text;
      usedModel = r.usedModel;
    } catch (e: any) {
      diag(`  ⚠️  All models failed on page ${pg}: ${e?.message} — skipping`);
      continue;
    }

    const fields = parseFieldsJson(rawText, diag);
    diag(`  ✓ ${fields.length} fields from ${usedModel}`);

    for (const f of fields) {
      if (!Array.isArray(f.fill_box) || f.fill_box.length !== 4) continue;
      const rect = toPdfRect(f.fill_box as [number, number, number, number], pgW, pgH);
      const mapped: MappedField = { ...f, page: pg, pdfRect: rect };
      allFields.push(mapped);

      if (!jsonMode) {
        const color = colors[globalIdx % colors.length];
        pageObj.drawRectangle({
          x: rect.x, y: rect.y, width: rect.w, height: rect.h,
          borderColor: color, borderWidth: 1.5, opacity: 0.15, color,
        });
        pageObj.drawText(String(allFields.length), {
          x: rect.x + 2, y: rect.y + rect.h - 8, size: 6, font, color,
        });
      }
      globalIdx++;
    }

    if (!jsonMode) {
      diag(`\n  Page ${pg} fields:`);
      for (const f of fields) {
        const conf = { high: '🟢', medium: '🟡', low: '🟠' }[f.confidence ?? 'medium'] ?? '⬜';
        diag(`    ${conf} ${f.field_label}`);
      }
    }
  }

  // ── Save annotated PDF ───────────────────────────────────────────────────
  if (!jsonMode) {
    const baseName = path.basename(pdfPath, path.extname(pdfPath));
    const outPath = path.join(path.dirname(pdfPath), `${baseName}_annotated.pdf`);
    fs.writeFileSync(outPath, await pdfDoc.save());
    diag(`\n  ANNOTATED PDF → ${outPath}`);
  }

  // ── Summary / JSON output ────────────────────────────────────────────────
  const high   = allFields.filter(f => f.confidence === 'high').length;
  const medium = allFields.filter(f => f.confidence === 'medium').length;
  const low    = allFields.filter(f => f.confidence === 'low').length;

  const { width: pw, height: ph } = pdfDoc.getPage(0).getSize();

  if (jsonMode) {
    console.log(JSON.stringify({
      path: 2, pageW: pw, pageH: ph, pageCount: totalPages,
      counts: { total: allFields.length, high, medium, low },
      fields: allFields,
    }, null, 2));
  } else {
    diag(`\n${'═'.repeat(72)}`);
    diag(`  TOTAL: ${allFields.length} fields across ${pagesToScan.length} page(s)`);
    diag(`  🟢 ${high} high   🟡 ${medium} medium   🟠 ${low} low`);
    diag(`${'═'.repeat(72)}\n`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  try { await ai.files.delete({ name: uploadedFile.name! }); } catch (_) {}
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pdfArg = args.find(a => !a.startsWith('-'));
const pageFlag = args.indexOf('--page');
const targetPage = pageFlag >= 0 ? parseInt(args[pageFlag + 1] ?? '1', 10) : 1;
const modelFlag = args.indexOf('--model');
const modelOverride = modelFlag >= 0 ? args[modelFlag + 1] : undefined;
const jsonMode  = args.includes('--json');
const allPages  = args.includes('--all-pages');

if (!pdfArg) {
  console.error(
    '\nUsage: npx tsx scripts/gemini-field-probe.ts <form.pdf> [options]' +
    '\n  --all-pages   Probe every page (default: page 1 only)' +
    '\n  --page N      Probe a specific page' +
    '\n  --model M     Override model (e.g. gemini-2.0-flash)' +
    '\n  --json        Output clean JSON to stdout (diagnostics to stderr)\n',
  );
  process.exit(1);
}

probeWithGemini(path.resolve(pdfArg), targetPage, modelOverride, jsonMode, allPages).catch(err => {
  console.error('\nFailed:', err?.message ?? err);
  process.exit(1);
});
