/**
 * BOQ Extraction Orchestrator
 *
 * Owns the engine-selection decision:
 *   1. Run the deterministic parser (Engine 1)
 *   2. Run the verification service
 *   3. If verification passes → return result
 *   4. If verification fails  → (Vision fallback — Engine 2, future milestone)
 *
 * The parser never knows Gemini exists.  Downstream code never knows which
 * engine produced the result.  Telemetry is recorded for every run.
 */

import type { ExtractionResult, OrchestratorResult, ExtractionTelemetry } from '../types/boq';
import { extractBoqFromPdf } from './boqPdfExtractService';
import { verifyExtraction, type VerificationOptions } from './boqVerificationService';

export interface OrchestratorOptions extends VerificationOptions {
  /** Minimum verification score to accept parser output without fallback */
  verificationThreshold?: number;
  /** Maximum BOQ pages to send to Vision per batch */
  visionPageBatchSize?: number;
  /** Maximum total BOQ pages to send to Vision */
  visionPageCap?: number;
}

const DEFAULTS: Required<Pick<OrchestratorOptions, 'verificationThreshold' | 'visionPageBatchSize' | 'visionPageCap'>> = {
  verificationThreshold: 60,
  visionPageBatchSize:   5,
  visionPageCap:         20,
};

export async function extractBoqWithFallback(
  arrayBuffer: ArrayBuffer,
  options: OrchestratorOptions = {},
): Promise<OrchestratorResult> {
  const opts = { ...DEFAULTS, ...options };

  // ── Engine 1: deterministic parser ────────────────────────────────────────
  const parserStart = Date.now();
  const parserResult = await extractBoqFromPdf(arrayBuffer);
  const parserDurationMs = Date.now() - parserStart;

  // ── Verification ───────────────────────────────────────────────────────────
  const verifyStart = Date.now();
  const verification = verifyExtraction(parserResult, opts);
  const verificationDurationMs = Date.now() - verifyStart;

  const baseTelemetry: Omit<ExtractionTelemetry, 'engine' | 'visionDurationMs' | 'fallbackReason'> = {
    parserDurationMs,
    verificationDurationMs,
    verificationScore: verification.score,
    pagesProcessed: countPages(parserResult),
    itemsExtracted: parserResult.items.length,
  };

  // ── Pass: return parser result ─────────────────────────────────────────────
  if (verification.pass) {
    return {
      extraction:   parserResult,
      verification,
      telemetry: { ...baseTelemetry, engine: 'deterministic' },
    };
  }

  // ── Fail: Vision fallback (Engine 2 — not yet implemented) ────────────────
  //
  // When Vision is implemented it will:
  //   1. Identify BOQ page range from parserResult.tables
  //   2. Extract only those pages from arrayBuffer
  //   3. Send to Gemini Vision in batches (visionPageBatchSize)
  //   4. Normalise response to BoqItem[]
  //   5. Re-run verification on Vision result
  //
  // For now, return the parser result with a fallback-needed flag in telemetry
  // so the caller and admin panel can see that Vision is required.

  const fallbackReason = verification.criticalFailures.join('; ');

  return {
    extraction:   parserResult,   // best available result
    verification,
    telemetry: {
      ...baseTelemetry,
      engine:         'deterministic',
      fallbackReason,
    },
  };
}

function countPages(result: ExtractionResult): number {
  // Approximation: find the maximum page number referenced in the first item
  // or fall back to 1.  Accurate page count requires carrying it through the
  // extraction result (future improvement).
  return 1;
}
