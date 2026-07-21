import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Counts pages in a PDF supplied as a base64 data URI (e.g. "data:application/pdf;base64,..."). */
export async function countPdfPages(dataUri: string): Promise<number> {
  const response = await fetch(dataUri);
  const arrayBuffer = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  return pdf.numPages;
}

export const convertPdfToImage = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create canvas context');

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport: viewport } as any).promise;

  return canvas.toDataURL('image/png');
};

// ── PDF text extraction ──────────────────────────────────────────────────────

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  pagesChecked: number;
  charsExtracted: number; // non-whitespace chars in the sampled pages
  isDigital: boolean;
}

// Pages sampled for the digital-vs-scan heuristic
const SAMPLE_PAGES = 10;
// Minimum non-whitespace chars per sampled page to consider a PDF digital
const DIGITAL_THRESHOLD = 100;

/**
 * Attempts to extract the text layer from a PDF.
 * Samples the first SAMPLE_PAGES pages to decide if the PDF is digital.
 * If digital, extracts all remaining pages too and returns the full text.
 * If scanned (no text layer), returns isDigital=false and empty text immediately.
 */
export async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<PdfExtractionResult> {
  // pdf.js transfers the buffer it receives to its Web Worker, detaching the caller's reference.
  // Clone first so the original stays valid for base64 encoding, BOQ buffer retention, etc.
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
  const pageCount = pdf.numPages;
  const pagesChecked = Math.min(SAMPLE_PAGES, pageCount);

  // Phase 1: sample — extract first N pages to decide path
  const sampleParts: string[] = [];
  for (let p = 1; p <= pagesChecked; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items as any[])
      .map(item => ('str' in item ? (item.str as string) : ''))
      .join(' ');
    sampleParts.push(pageText);
  }

  const sampleText = sampleParts.join('\n');
  const charsExtracted = sampleText.replace(/\s+/g, '').length;
  const isDigital = charsExtracted / pagesChecked >= DIGITAL_THRESHOLD;

  if (!isDigital) {
    return { text: '', pageCount, pagesChecked, charsExtracted, isDigital: false };
  }

  // Phase 2: extract remaining pages
  const remainingParts: string[] = [];
  for (let p = pagesChecked + 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = (content.items as any[])
      .map(item => ('str' in item ? (item.str as string) : ''))
      .join(' ');
    remainingParts.push(pageText);
  }

  const fullText = sampleParts.concat(remainingParts).join('\n\n');
  return { text: fullText, pageCount, pagesChecked, charsExtracted, isDigital: true };
}

// ── Base64 helpers (chunked to avoid call-stack overflow on large inputs) ────

/** Encodes a UTF-8 string to a base64 string, safe for large inputs. */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + 8192) as unknown as number[]));
  }
  return btoa(binary);
}

/** Encodes an ArrayBuffer to a base64 string, safe for large inputs. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + 8192) as unknown as number[]));
  }
  return btoa(binary);
}
