// Shared Vision probe logic — used by the API endpoint and dev scripts.
// Accepts a Buffer so it works server-side without any file-system I/O.

import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import type { DetectedField } from './types.js';

// ── Timeout helper ─────────────────────────────────────────────────────────────
// Wraps any promise with a hard deadline.  On timeout the promise REJECTS
// (never hangs).  The timer is always cleared so it cannot leak.

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── Retry helpers ──────────────────────────────────────────────────────────────

export function isRetryable(e: unknown): boolean {
  const msg = ((e as any)?.message ?? String(e ?? '')).toLowerCase();
  const status: number = (e as any)?.status ?? (e as any)?.httpError?.status ?? 0;
  return (
    status === 503 || status === 429 ||
    msg.includes('503') || msg.includes('unavailable') ||
    msg.includes('overloaded') || msg.includes('429') || msg.includes('quota')
  );
  // Note: "timed out after Xs" messages are intentionally NOT retryable —
  // a hung call should fall through to the next model, not be retried.
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  delays = [5, 10, 20, 40],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === delays.length) throw e;
      const wait = delays[attempt]!;
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  throw lastErr;
}

// ── Gemini models (primary → fallbacks) ───────────────────────────────────────

export const MODEL_FALLBACK_ORDER = ['gemini-2.5-flash', 'gemini-2.0-flash'];

// ── Vision prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing a scanned Indian government tender form (Annexure / bid submission form).
Your task: identify every fillable field on the page — blank lines, blank boxes, or underscored spaces where a bidder writes their information.

Return a JSON array (no markdown, no code fences, raw JSON only) with one object per field:
{
  "field_label": "<exact label text as printed on the form>",
  "fill_area_description": "<brief description of the blank area>",
  "fill_box": [y_min, x_min, y_max, x_max],
  "confidence": "high" | "medium" | "low",
  "notes": "<optional>"
}

fill_box: [y_min, x_min, y_max, x_max], normalized 0–1000 (top-left origin), covering the BLANK FILL AREA not the label.
Include ALL fillable fields. If this page has no fillable fields, return [].
Output ONLY the JSON array.`;

// ── Output types ──────────────────────────────────────────────────────────────

export type ProbeField = Omit<DetectedField, 'page'> & { page: number };

export interface ProbeData {
  pageW: number;
  pageH: number;
  pageCount: number;
  counts: { total: number; high: number; medium: number; low: number };
  fields: ProbeField[];
  /** True when ≥1 page failed after all retries but ≥1 page succeeded. */
  partial?: boolean;
  /** 1-indexed page numbers that could not be probed (only set when partial=true). */
  failedPages?: number[];
}

// ── Compact ISO timestamp for log lines ───────────────────────────────────────

const ts = (): string => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

// ── Core probe function ───────────────────────────────────────────────────────
//
// Hard timeouts per phase:
//   Upload  → 30 s  (once, large file)
//   Vision  → 45 s  (per individual generateContent attempt)
//   Delete  → 10 s  (cleanup; non-fatal anyway)
//
// Timeout errors are NOT retryable (message "timed out after Xs" doesn't match
// isRetryable), so a hung call falls through to the next model immediately.
// Promise.allSettled therefore always settles within:
//   max(45s × attempts + retry delays) per page
// and can never hang forever.

export async function probeAllPagesFromBuffer(
  pdfBuf: Buffer,
  displayName: string,
  apiKey: string,
  log: (msg: string) => void = () => {},
): Promise<ProbeData> {
  const ai = new GoogleGenAI({ apiKey });

  // pdf-lib accepts Uint8Array; Buffer is a Uint8Array subclass
  const pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const { width: pageW, height: pageH } = pdfDoc.getPage(0).getSize();

  log(`[${ts()}] PDF: ${pageCount} page(s) (${Math.round(pageW)}×${Math.round(pageH)} pts)`);

  // ── Upload PDF once ─────────────────────────────────────────────────────────
  const blob = new Blob([pdfBuf], { type: 'application/pdf' });

  log(`[${ts()}] Upload start`);
  const uploaded = await withRetry('gemini-upload', () =>
    withTimeout(
      ai.files.upload({ file: blob, config: { mimeType: 'application/pdf', displayName } }),
      30_000,
      'gemini-upload',
    ),
  );
  log(`[${ts()}] Upload done: ${uploaded.uri} (name=${uploaded.name})`);

  // ── Per-page probe (runs in parallel — see Promise.allSettled below) ─────────

  const probeOnePage = async (pg: number): Promise<ProbeField[]> => {
    const callParams = {
      contents: [{
        role: 'user' as const,
        parts: [
          createPartFromUri(uploaded.uri!, 'application/pdf'),
          { text: SYSTEM_PROMPT + `\n\nAnalyze page ${pg} of this PDF.` },
        ],
      }],
      config: { temperature: 0.1 },
    };

    let rawText = '[]';

    for (const model of MODEL_FALLBACK_ORDER) {
      try {
        log(`[${ts()}] pg${pg}: starting Vision call via ${model}`);
        const result = await withRetry(
          `${model} pg${pg}`,
          () => withTimeout(
            ai.models.generateContent({ model, ...callParams }),
            45_000,
            `${model} pg${pg}`,
          ),
        );
        rawText = result.text ?? '[]';
        log(`[${ts()}] pg${pg}: OK via ${model} (${rawText.length} chars)`);
        break;
      } catch (e) {
        log(`[${ts()}] pg${pg}: ${model} failed — ${(e as any)?.message ?? e}`);
        if (model === MODEL_FALLBACK_ORDER[MODEL_FALLBACK_ORDER.length - 1]) throw e;
        log(`[${ts()}] pg${pg}: trying fallback model`);
      }
    }

    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((f: any) => Array.isArray(f.fill_box) && f.fill_box.length === 4)
        .map((f: any): ProbeField => ({
          field_label:           f.field_label ?? '',
          fill_area_description: f.fill_area_description ?? '',
          fill_box:              f.fill_box as [number, number, number, number],
          confidence:            f.confidence ?? 'medium',
          notes:                 f.notes,
          page:                  pg,
        }));
    } catch {
      log(`[${ts()}] pg${pg}: JSON parse failed`);
      return [];
    }
  };

  // ── Fire all pages in parallel ────────────────────────────────────────────────
  log(`[${ts()}] Firing ${pageCount} page(s) in parallel`);
  const settled = await Promise.allSettled(
    Array.from({ length: pageCount }, (_, i) => probeOnePage(i + 1)),
  );
  log(`[${ts()}] All pages settled`);

  // ── Clean up uploaded file — MUST use withTimeout so delete cannot hang ───────
  log(`[${ts()}] Delete start`);
  try {
    await withTimeout(
      ai.files.delete({ name: uploaded.name! }),
      10_000,
      'gemini-delete',
    );
    log(`[${ts()}] Delete done`);
  } catch (e) {
    log(`[${ts()}] Delete failed (non-fatal): ${(e as any)?.message ?? e}`);
  }

  // ── Collect results ───────────────────────────────────────────────────────────
  const allFields: ProbeField[] = [];
  const failedPages: number[] = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      allFields.push(...r.value);
    } else {
      failedPages.push(i + 1);
      log(`[${ts()}] pg${i + 1}: failed — ${(r.reason as any)?.message ?? r.reason}`);
    }
  }

  // All pages failed → throw so caller can return 503
  if (failedPages.length === pageCount) {
    const firstRejected = settled.find(r => r.status === 'rejected') as PromiseRejectedResult;
    throw firstRejected?.reason ?? new Error('Vision field detection failed for all pages');
  }

  log(`[${ts()}] Done: ${allFields.length} fields across ${pageCount - failedPages.length}/${pageCount} pages`);

  return {
    pageW, pageH, pageCount,
    counts: {
      total:  allFields.length,
      high:   allFields.filter(f => f.confidence === 'high').length,
      medium: allFields.filter(f => f.confidence === 'medium').length,
      low:    allFields.filter(f => f.confidence === 'low').length,
    },
    fields: allFields,
    ...(failedPages.length > 0 ? { partial: true, failedPages } : {}),
  };
}
