// Shared Vision probe logic — used by the API endpoint and dev scripts.
// Accepts a Buffer so it works server-side without any file-system I/O.
//
// DIAGNOSTIC BUILD — every await has [START]/[END]/duration logging so the
// Vercel logs will show EXACTLY which call hangs.  START without END = the
// blocking operation.

import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import type { DetectedField } from './types.js';

// ── Compact timestamp ─────────────────────────────────────────────────────────

const ts = (): string => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

// ── Timeout helper ────────────────────────────────────────────────────────────
// Every external call is wrapped with this.  On timeout the promise rejects
// (never hangs).  Timer is always cleared so it cannot leak.
// NOTE: the underlying SDK promise continues running after the timeout fires;
// it holds an open HTTP connection until the SDK's own idle timeout closes it.

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

// ── Retry helper ──────────────────────────────────────────────────────────────
// Optional log callback so retry delays are visible in the trace.
// Timeout errors ("timed out after Xs") are intentionally NOT retryable —
// a hung call falls through to the next model immediately.

export function isRetryable(e: unknown): boolean {
  const msg = ((e as any)?.message ?? String(e ?? '')).toLowerCase();
  const status: number = (e as any)?.status ?? (e as any)?.httpError?.status ?? 0;
  return (
    status === 503 || status === 429 ||
    msg.includes('503') || msg.includes('unavailable') ||
    msg.includes('overloaded') || msg.includes('429') || msg.includes('quota')
  );
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  delays = [5, 10, 20, 40],
  log?: (msg: string) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === delays.length) throw e;
      const wait = delays[attempt]!;
      log?.(`[${ts()}] [RETRY] ${label} attempt=${attempt + 1} wait=${wait}s err=${((e as any)?.message ?? String(e)).slice(0, 100)}`);
      const t0 = Date.now();
      log?.(`[${ts()}] [START] retry-delay-${wait}s label=${label}`);
      await new Promise(r => setTimeout(r, wait * 1000));
      log?.(`[${ts()}] [END] retry-delay-${wait}s duration=${Date.now() - t0}ms`);
    }
  }
  throw lastErr;
}

// ── Gemini models ─────────────────────────────────────────────────────────────

export const MODEL_FALLBACK_ORDER = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

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
  partial?: boolean;
  failedPages?: number[];
}

// ── Core probe function ───────────────────────────────────────────────────────

export async function probeAllPagesFromBuffer(
  pdfBuf: Buffer,
  displayName: string,
  apiKey: string,
  log: (msg: string) => void = () => {},
): Promise<ProbeData> {
  const ai = new GoogleGenAI({ apiKey });
  let t: number;

  // ── 1. pdf-lib: load PDF, get page count + dimensions ─────────────────────
  t = Date.now();
  log(`[${ts()}] [START] PDFDocument.load (${pdfBuf.byteLength} bytes)`);
  const pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true });
  log(`[${ts()}] [END] PDFDocument.load duration=${Date.now() - t}ms pages=${pdfDoc.getPageCount()}`);

  const pageCount = pdfDoc.getPageCount();
  const { width: pageW, height: pageH } = pdfDoc.getPage(0).getSize();
  log(`[${ts()}] PDF dimensions: ${Math.round(pageW)}×${Math.round(pageH)} pts, ${pageCount} page(s)`);

  // ── 2. Gemini Files API: upload PDF once (shared by all page calls) ────────
  const blob = new Blob([pdfBuf], { type: 'application/pdf' });
  t = Date.now();
  log(`[${ts()}] [START] gemini-upload`);
  const uploaded = await withRetry(
    'gemini-upload',
    () => withTimeout(
      ai.files.upload({ file: blob, config: { mimeType: 'application/pdf', displayName } }),
      30_000,
      'gemini-upload',
    ),
    [5, 10, 20, 40],
    log,
  );
  log(`[${ts()}] [END] gemini-upload duration=${Date.now() - t}ms uri=${uploaded.uri} name=${uploaded.name}`);

  // ── 3. Per-page Vision calls (all pages in parallel) ──────────────────────
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
        const pt = Date.now();
        log(`[${ts()}] [START] pg${pg} generateContent model=${model}`);
        const result = await withRetry(
          `${model} pg${pg}`,
          () => withTimeout(
            ai.models.generateContent({ model, ...callParams }),
            45_000,
            `${model} pg${pg}`,
          ),
          [5, 10, 20, 40],
          log,
        );
        rawText = result.text ?? '[]';
        log(`[${ts()}] [END] pg${pg} generateContent model=${model} duration=${Date.now() - pt}ms chars=${rawText.length}`);
        break;
      } catch (e) {
        log(`[${ts()}] [FAIL] pg${pg} model=${model} err=${((e as any)?.message ?? String(e)).slice(0, 120)}`);
        if (model === MODEL_FALLBACK_ORDER[MODEL_FALLBACK_ORDER.length - 1]) throw e;
        log(`[${ts()}] [INFO] pg${pg} falling back to next model`);
      }
    }

    // JSON parse — synchronous but log it for completeness
    log(`[${ts()}] [START] pg${pg} JSON.parse (${rawText.length} chars)`);
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        log(`[${ts()}] [END] pg${pg} JSON.parse — not an array, returning []`);
        return [];
      }
      const fields = parsed
        .filter((f: any) => Array.isArray(f.fill_box) && f.fill_box.length === 4)
        .map((f: any): ProbeField => ({
          field_label:           f.field_label ?? '',
          fill_area_description: f.fill_area_description ?? '',
          fill_box:              f.fill_box as [number, number, number, number],
          confidence:            f.confidence ?? 'medium',
          notes:                 f.notes,
          page:                  pg,
        }));
      log(`[${ts()}] [END] pg${pg} JSON.parse — ${fields.length} fields`);
      return fields;
    } catch (e) {
      log(`[${ts()}] [FAIL] pg${pg} JSON.parse err=${((e as any)?.message ?? String(e)).slice(0, 80)}`);
      return [];
    }
  };

  // ── 4. Fire all pages in parallel, wait for all to settle ─────────────────
  t = Date.now();
  log(`[${ts()}] [START] Promise.allSettled ${pageCount} page(s) in parallel`);
  const settled = await Promise.allSettled(
    Array.from({ length: pageCount }, (_, i) => probeOnePage(i + 1)),
  );
  log(`[${ts()}] [END] Promise.allSettled duration=${Date.now() - t}ms`);

  // ── 5. Gemini Files API: delete uploaded file ──────────────────────────────
  // withTimeout prevents this from hanging.  Error is non-fatal.
  t = Date.now();
  log(`[${ts()}] [START] gemini-delete name=${uploaded.name}`);
  try {
    await withTimeout(ai.files.delete({ name: uploaded.name! }), 10_000, 'gemini-delete');
    log(`[${ts()}] [END] gemini-delete duration=${Date.now() - t}ms`);
  } catch (e) {
    log(`[${ts()}] [FAIL] gemini-delete duration=${Date.now() - t}ms err=${((e as any)?.message ?? String(e)).slice(0, 80)}`);
  }

  // ── 6. Collect results ─────────────────────────────────────────────────────
  const allFields: ProbeField[] = [];
  const failedPages: number[] = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      allFields.push(...r.value);
    } else {
      failedPages.push(i + 1);
      log(`[${ts()}] [INFO] pg${i + 1} failed: ${((r.reason as any)?.message ?? String(r.reason)).slice(0, 120)}`);
    }
  }

  if (failedPages.length === pageCount) {
    const firstRejected = settled.find(r => r.status === 'rejected') as PromiseRejectedResult;
    throw firstRejected?.reason ?? new Error('Vision field detection failed for all pages');
  }

  log(`[${ts()}] [INFO] probe complete: ${allFields.length} fields from ${pageCount - failedPages.length}/${pageCount} pages`);

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
