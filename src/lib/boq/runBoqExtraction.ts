import { extractBoqWithFallback } from "../../services/boqExtractionOrchestrator";
import { detectGstCess } from "./detectGstCess";
import { detectBidValidity, detectCompletionPeriod } from "./detectTenderValidity";
import type { BoqItem } from "../../types/boq";

export interface RunBoqExtractionInput {
  /** Raw PDF Storage URLs (payloadRefRaw) — preferred: guaranteed real PDF
   *  bytes. */
  rawPdfUrls: string[];
  /** payloadRef Storage URLs — fallback only. For digital PDFs these store
   *  extracted TEXT, not PDF bytes (cost-optimised for Gemini), so they only
   *  actually help when the source was an image-path PDF stored as-is. */
  payloadUrls: string[];
  /** project.details?.timeline_and_milestones?.execution_duration — used as
   *  a secondary signal by detectCompletionPeriod. */
  executionDurationHint?: string | null;
}

export interface RunBoqExtractionDetection {
  gstIncluded?: 'yes' | 'no' | 'separate' | 'unknown';
  cessPercent?: number;
  gstPercent?: number;
  gstCessConfidence?: number;
  gstCessDetectionReason?: string;
  bidValidityDays?: number;
  bidValidityLabel?: string;
  bidValidityConfidence?: number;
  bidValidityReason?: string;
  completionPeriodDays?: number;
  completionPeriodLabel?: string;
  completionPeriodConfidence?: number;
  completionPeriodReason?: string;
}

export type RunBoqExtractionResult =
  | {
      status: 'done';
      items: BoqItem[];
      itemCount: number;
      totalAmount: number;
      engine: string;
      visionUsed: boolean;
      verificationScore: number;
      parserDurationMs: number;
      /** GST/Cess + Bid Validity + Completion Period detection, run once on
       *  the already-computed extraction text. Callers decide whether/how to
       *  apply each field (e.g. gating on an existing manualOverride) —
       *  running the (pure, cheap, synchronous) detectors unconditionally
       *  and letting the caller decide what to DO with the result is
       *  behaviorally identical to gating whether to run them at all, since
       *  none of them have side effects. */
      detection: RunBoqExtractionDetection;
    }
  | { status: 'no_boq_found' }
  | { status: 'failed'; reason: string };

/** Fetches PDF bytes from Storage URLs and runs the SAME
 *  extractBoqWithFallback pipeline the manual "Extract BOQ" button always
 *  has — the ref-free, Storage-URL-based entry point (never in-memory
 *  buffers), so it works identically whether triggered by a live upload
 *  session, a manual re-extract on a reloaded page, or an automatic
 *  Tier-2-completion trigger with no upload session at all. Pure
 *  computation only — no Firestore reads/writes here; callers own
 *  persistence (status:'running' before, boq_extraction/latest after,
 *  manualOverride gating on the detection patch). */
export async function runBoqExtraction(input: RunBoqExtractionInput): Promise<RunBoqExtractionResult> {
  const { rawPdfUrls, payloadUrls, executionDurationHint } = input;
  const urls = rawPdfUrls.length > 0 ? rawPdfUrls : payloadUrls;
  const usingRawUrls = rawPdfUrls.length > 0;

  if (urls.length === 0) {
    return { status: 'failed', reason: 'No source documents found. Please re-upload this tender to extract the BOQ.' };
  }

  let fetchedCount = 0;
  let textOnlyCount = 0;
  let best: Awaited<ReturnType<typeof extractBoqWithFallback>> | null = null;
  let lastDownloadError: string | null = null;

  for (const url of urls) {
    try {
      // payloadRef/payloadRefRaw store Firebase Storage download URLs with
      // ?token= — Firebase serves these with Access-Control-Allow-Origin: *,
      // no CORS config needed. Do NOT use getBytes(storageRef) — that sends
      // an authenticated XHR requiring gsutil CORS.
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      fetchedCount++;

      // Verify the content is actually a PDF (magic bytes %PDF-). payloadRef
      // for digital PDFs stores text/plain (cost-optimised for Gemini).
      const magic = new Uint8Array(buffer, 0, 5);
      const isPdf = magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46;
      if (!isPdf) {
        textOnlyCount++;
        continue;
      }

      const result = await extractBoqWithFallback(buffer);
      if (result.extraction.items.length > 0 &&
          (!best || result.verification.score > best.verification.score)) {
        best = result;
      }
    } catch (e: any) {
      lastDownloadError = e?.message ?? String(e);
    }
  }

  // All downloaded files were text (digital PDFs stored without raw
  // backup). This happens for projects analysed before payloadRefRaw was
  // introduced/attached.
  if (!best && fetchedCount > 0 && textOnlyCount === fetchedCount && !usingRawUrls) {
    return {
      status: 'failed',
      reason: 'The original PDF is not available for re-extraction on this project. Re-analyse the tender to enable BOQ extraction.',
    };
  }

  if (!best) {
    if (fetchedCount === 0 && lastDownloadError) {
      return { status: 'failed', reason: `Couldn't download the tender PDF: ${lastDownloadError}` };
    }
    return { status: 'no_boq_found' };
  }

  const { extraction, verification, telemetry } = best;

  // Never display a failed-verification result — score 0 means a critical
  // check failed (e.g. reconciliation mismatch) and the extracted data is
  // untrustworthy.
  if (!verification.pass) {
    return {
      status: 'failed',
      reason: `Could not reliably extract the BOQ from this document (verification score: ${verification.score}/100, failures: ${verification.criticalFailures.join(', ')}). Click Retry to try again.`,
    };
  }

  const totalAmount = extraction.items.reduce((s, it) => s + (it.amount ?? 0), 0);

  const detection: RunBoqExtractionDetection = {};

  const gstCess = detectGstCess(extraction.rawText);
  if (gstCess.gstIncluded !== 'unknown') {
    detection.gstIncluded = gstCess.gstIncluded;
    if (gstCess.cessRate != null) detection.cessPercent = gstCess.cessRate;
    if (gstCess.gstRate != null) detection.gstPercent = gstCess.gstRate;
    detection.gstCessConfidence = gstCess.confidence;
    detection.gstCessDetectionReason = gstCess.reason;
  }

  const bidValidity = detectBidValidity(extraction.rawText);
  if (bidValidity.days != null) {
    detection.bidValidityDays = bidValidity.days;
    detection.bidValidityLabel = bidValidity.label;
    detection.bidValidityConfidence = bidValidity.confidence;
    detection.bidValidityReason = bidValidity.reason;
  }

  const completionPeriod = detectCompletionPeriod(extraction.rawText, executionDurationHint ?? undefined);
  if (completionPeriod.days != null) {
    detection.completionPeriodDays = completionPeriod.days;
    detection.completionPeriodLabel = completionPeriod.label;
    detection.completionPeriodConfidence = completionPeriod.confidence;
    detection.completionPeriodReason = completionPeriod.reason;
  }

  return {
    status: 'done',
    items: extraction.items,
    itemCount: extraction.items.length,
    totalAmount,
    engine: telemetry.engine,
    visionUsed: telemetry.engine === 'vision',
    verificationScore: verification.score,
    parserDurationMs: telemetry.parserDurationMs,
    detection,
  };
}
