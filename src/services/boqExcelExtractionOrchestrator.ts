// xlsx BOQ orchestrator — mirrors boqExtractionOrchestrator.ts's shape
// exactly (Engine 1 → verify → return) so runBoqExtraction.ts's PDF/xlsx
// candidate-selection loop can treat both sources identically. Calls
// verifyExtraction (the shared, unmodified verification harness) rather
// than reimplementing any of its checks.
import * as XLSX from 'xlsx';
import type { OrchestratorResult } from '../types/boq';
import { verifyExtraction } from './boqVerificationService';
import { parseWorkbookForBoq, toExtractionResult, buildAnalysisText } from './boqExcelExtractService';

export interface XlsxOrchestratorResult extends OrchestratorResult {
  /** false when no sheet cleared the BOQ-recognition bar — the caller
   *  (runBoqExtraction.ts) uses this to report a visible, xlsx-specific
   *  "processed as text, no BOQ detected" reason instead of silently
   *  treating the file as if it had no content at all. */
  boqRecognized: boolean;
  /** Item-table-excluded text for this workbook — same value already
   *  folded into extraction.rawText, exposed separately for callers that
   *  want it without re-deriving. */
  analysisText: string;
}

/**
 * Parses an xlsx workbook for a BOQ (Engine: deterministic-xlsx), then runs
 * it through the same verifyExtraction() every PDF candidate goes through.
 * multilineItems is disabled — that check spot-checks specific PDF-format
 * item numbers (e.g. '13','14','26') that have no equivalent oracle for an
 * xlsx SOR; disabling it just skips a check that doesn't apply here rather
 * than reporting false problems. It's non-critical either way, so this
 * can't change whether verification passes.
 */
export async function extractBoqFromExcelWithVerification(
  arrayBuffer: ArrayBuffer,
): Promise<XlsxOrchestratorResult> {
  const parserStart = Date.now();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const boqParse = parseWorkbookForBoq(workbook);
  const analysisText = buildAnalysisText(workbook);
  const extraction = toExtractionResult(boqParse, analysisText);
  const parserDurationMs = Date.now() - parserStart;

  const verifyStart = Date.now();
  const verification = verifyExtraction(extraction, { multilineItems: [] });
  const verificationDurationMs = Date.now() - verifyStart;

  return {
    extraction,
    verification,
    telemetry: {
      engine: 'deterministic',
      parserDurationMs,
      verificationDurationMs,
      verificationScore: verification.score,
      pagesProcessed: 1,
      itemsExtracted: extraction.items.length,
    },
    boqRecognized: boqParse.recognized,
    analysisText,
  };
}
