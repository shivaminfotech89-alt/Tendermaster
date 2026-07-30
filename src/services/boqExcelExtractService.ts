// Deterministic xlsx BOQ extraction — Half 1 (line-item numbers) and Half 2
// (analysis-bound text) of the hybrid xlsx pipeline. Additive: does not
// touch the PDF parser (boqPdfExtractService.ts), the verification harness
// (boqVerificationService.ts), or the BOQData model. Produces the same
// ExtractionResult shape the PDF pipeline produces, via a separate,
// xlsx-specific orchestrator (boqExcelExtractionOrchestrator.ts).
import * as XLSX from 'xlsx';
import type { BoqItem, ColumnMapping, ColumnRole, ExtractionResult, DetectedTable } from '../types/boq';
import { detectTopRolesForText } from '../utils/boq/headerDetection';

const HEADER_SCAN_ROWS = 15;
const MIN_ITEM_ROWS = 3;

// Rows that end the line-item table and begin the summary/T&C section.
// Checked against EVERY cell in a row (not just the mapped description
// column) since a totals label frequently doesn't land under the header
// that was mapped to `description` for the item rows above it.
const STOP_ROW_RE = /^(total|grand\s*total|sub[- ]?total|gst\b|cess\b|terms\s*(&|and)\s*conditions|note\s*:|signature|vendor\s*name|authorised\s*signatory)/i;

// How far past the stop row to keep scanning for totals metadata
// (Total Basic Cost / GST / Total Landed Cost) before giving up.
const TOTALS_SCAN_ROWS = 8;

export interface XlsxTotals {
  totalBasicCost?: number;
  gstPercent?: number;
  totalLandedCost?: number;
}

export interface XlsxSheetParse {
  sheetName: string;
  /** true once header keywords (description/item_no + quantity) were found
   *  AND at least MIN_ITEM_ROWS valid item rows were extracted. Rate/amount
   *  presence never affects this — a blank-rate rate-contract SOR with
   *  filled quantities is a valid, recognized BOQ. */
  recognized: boolean;
  /** 0-100, used only to rank candidate sheets against each other when a
   *  workbook has more than one that clears the recognition bar. */
  confidence: number;
  headerRowIndex: number;
  columnMapping: ColumnMapping;
  items: BoqItem[];
  /** Last row index consumed by item parsing (inclusive) — the boundary
   *  Half 2's analysis-text builder excludes, so the AI-bound text never
   *  contains the numeric line-item table. -1 when nothing was extracted. */
  lastItemRowIndex: number;
  totals: XlsxTotals;
  rawRows: unknown[][];
}

function cellText(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function parseNumericCell(val: unknown): number | undefined {
  if (typeof val === 'number' && isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₹,\s]/g, '');
    if (!cleaned) return undefined;
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : undefined;
  }
  return undefined;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every(c => !cellText(c));
}

function isStopRow(row: unknown[]): boolean {
  return row.some(c => STOP_ROW_RE.test(cellText(c)));
}

/**
 * Maps each column in a header row to a role, trying a column's next-best
 * candidate role when its top choice is already claimed by an earlier
 * column in the same row (see detectTopRolesForText's docs — this is what
 * correctly resolves "UoM" claiming `unit` before "Unit Rate" is evaluated,
 * so "Unit Rate" falls through to its second-best candidate,
 * `estimated_rate`, instead of being left unmapped).
 */
function mapHeaderRow(row: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const assignedRoles = new Set<ColumnRole>();
  for (let ci = 0; ci < row.length; ci++) {
    const text = cellText(row[ci]);
    if (!text) continue;
    const candidates = detectTopRolesForText(text);
    for (const { role } of candidates) {
      if (!assignedRoles.has(role)) {
        mapping[ci] = role;
        assignedRoles.add(role);
        break;
      }
    }
  }
  return mapping;
}

function getCol(row: unknown[], columnMapping: ColumnMapping, role: ColumnRole): string {
  for (const [colIdxStr, r] of Object.entries(columnMapping)) {
    if (r === role) return cellText(row[Number(colIdxStr)]);
  }
  return '';
}

/**
 * Scans the rows following the stop row for "Total Basic Cost" / "GST" /
 * "Total Landed Cost" style label+value pairs — captured as summary
 * metadata, never as BOQ line items. Best-effort: a blank-rate SOR (this
 * codebase's motivating case) has these blank too, and that's fine —
 * totals stay undefined rather than 0.
 */
function scanTotals(rawRows: unknown[][], fromRowIndex: number): XlsxTotals {
  const totals: XlsxTotals = {};
  const end = Math.min(rawRows.length, fromRowIndex + TOTALS_SCAN_ROWS);
  for (let ri = fromRowIndex; ri < end; ri++) {
    const row = rawRows[ri];
    // Cell-by-cell, not a joined row string — a label like "GST" is its
    // own cell and shouldn't need to be the first cell in the row to match.
    const hasLabel = (re: RegExp) => row.some(c => re.test(cellText(c)));
    const numbers = row.map(parseNumericCell).filter((n): n is number => n !== undefined);

    if (totals.totalBasicCost === undefined && hasLabel(/^total\s+basic\s+cost/i) && numbers.length > 0) {
      totals.totalBasicCost = numbers[numbers.length - 1];
    } else if (totals.gstPercent === undefined && hasLabel(/^gst\b/i) && numbers.length > 0) {
      // "GST | 0.18" style rows store a fraction, not a percent — normalize
      // a value <= 1 to a percentage the same way the rest of the app does.
      const raw = numbers[numbers.length - 1];
      totals.gstPercent = raw <= 1 ? raw * 100 : raw;
    } else if (totals.totalLandedCost === undefined && hasLabel(/^total\s+landed\s+cost/i) && numbers.length > 0) {
      totals.totalLandedCost = numbers[numbers.length - 1];
    }
  }
  return totals;
}

/** Parses one sheet: finds the header row, maps columns, extracts item
 *  rows until a stop row, and captures trailing totals metadata. */
export function parseSheet(sheetName: string, rawRows: unknown[][]): XlsxSheetParse {
  let headerRowIndex = -1;
  let columnMapping: ColumnMapping = {};

  for (let ri = 0; ri < Math.min(HEADER_SCAN_ROWS, rawRows.length); ri++) {
    const mapping = mapHeaderRow(rawRows[ri]);
    const roles = new Set(Object.values(mapping));
    // The user's explicit signal: header keywords (a description-like
    // column OR an item-no column) + a quantity column. Rate/amount
    // presence is never required — see module docs.
    const hasDescriptionSignal = roles.has('description') || roles.has('item_no');
    const hasQuantity = roles.has('quantity');
    if (hasDescriptionSignal && hasQuantity && Object.keys(mapping).length > Object.keys(columnMapping).length) {
      headerRowIndex = ri;
      columnMapping = mapping;
    }
  }

  if (headerRowIndex < 0) {
    return {
      sheetName, recognized: false, confidence: 0, headerRowIndex: -1,
      columnMapping: {}, items: [], lastItemRowIndex: -1, totals: {}, rawRows,
    };
  }

  const items: BoqItem[] = [];
  let lastItemRowIndex = headerRowIndex;
  let stopRowIndex = rawRows.length;

  for (let ri = headerRowIndex + 1; ri < rawRows.length; ri++) {
    const row = rawRows[ri];
    if (isBlankRow(row)) continue;

    if (isStopRow(row)) {
      stopRowIndex = ri;
      break;
    }

    const itemNo = getCol(row, columnMapping, 'item_no');
    const description = getCol(row, columnMapping, 'description');
    if (!itemNo && !description) continue;

    const unit = getCol(row, columnMapping, 'unit');
    const quantity = parseNumericCell(getCol(row, columnMapping, 'quantity')) ?? 0;

    const item: BoqItem = {
      id: crypto.randomUUID(),
      itemNo,
      description,
      unit,
      quantity,
    };
    const code = getCol(row, columnMapping, 'code');
    if (code) item.code = code;
    const schedule = getCol(row, columnMapping, 'schedule');
    if (schedule) item.schedule = schedule;
    const estimatedRate = parseNumericCell(getCol(row, columnMapping, 'estimated_rate'));
    if (estimatedRate !== undefined) item.estimatedRate = estimatedRate;
    const bidRate = parseNumericCell(getCol(row, columnMapping, 'bid_rate'));
    if (bidRate !== undefined) item.bidRate = bidRate;
    const amount = parseNumericCell(getCol(row, columnMapping, 'amount'));
    if (amount !== undefined) item.amount = amount;
    const gst = parseNumericCell(getCol(row, columnMapping, 'gst'));
    if (gst !== undefined) item.gst = gst;
    const remarks = getCol(row, columnMapping, 'remarks');
    if (remarks) item.remarks = remarks;

    items.push(item);
    lastItemRowIndex = ri;
  }

  const totals = scanTotals(rawRows, stopRowIndex);

  const recognized = items.length >= MIN_ITEM_ROWS;

  // Confidence: header-mapping completeness (up to 60) + item-count bonus
  // (up to 40, saturating at 10 items) — rate/amount presence never
  // factors in, matching the "blank-rate SOR is a valid BOQ" requirement.
  const headerScore = Math.min(60, Object.keys(columnMapping).length * 12);
  const itemScore = Math.min(40, items.length * 4);
  const confidence = recognized ? Math.round(headerScore + itemScore) : 0;

  return {
    sheetName, recognized, confidence, headerRowIndex, columnMapping,
    items, lastItemRowIndex, totals, rawRows,
  };
}

/** Parses every sheet once. Shared by parseWorkbookForBoq and
 *  buildAnalysisText so a workbook is never re-scanned twice. */
export function parseWorkbookSheets(workbook: XLSX.WorkBook): XlsxSheetParse[] {
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    return parseSheet(name, rawRows);
  });
}

function pickBestSheet(parses: XlsxSheetParse[]): XlsxSheetParse {
  const recognized = parses.filter(p => p.recognized);
  if (recognized.length > 0) {
    return recognized.reduce((best, p) => (p.confidence > best.confidence ? p : best));
  }
  // Nothing recognized — return the highest-scoring attempt anyway (all
  // items empty) so callers can still build analysis text from the whole
  // workbook and report *why* nothing was detected.
  return parses.reduce((best, p) => (p.confidence > best.confidence ? p : best), parses[0]);
}

/** Parses every sheet, ranks the ones that clear the recognition bar, and
 *  returns the best one (or the highest-scoring unrecognized sheet, for
 *  diagnostics, when none clears the bar). Never assumes sheet 1 is the
 *  BOQ. */
export function parseWorkbookForBoq(workbook: XLSX.WorkBook): XlsxSheetParse {
  return pickBestSheet(parseWorkbookSheets(workbook));
}

/**
 * Half 2 — builds the analysis-bound text for a workbook: the whole
 * document EXCEPT the numeric line-item table on the recognized BOQ sheet
 * (preamble + totals/T&C rows on that sheet are included; the item rows,
 * from the header row through the last extracted item row, are not). Every
 * other sheet is included in full — this only ever excludes the specific
 * row range identified as the item table, never a whole sheet.
 *
 * The BOQ numbers themselves NEVER come from this text — they come only
 * from parseWorkbookForBoq's deterministic parse. This text exists purely
 * so terms (Contract Period, Validity, GST %, Cess, Penalty, GCC version,
 * scope references) reach the analysis stage the way they would from a
 * PDF's raw text.
 */
export function buildAnalysisText(workbook: XLSX.WorkBook): string {
  const parses = parseWorkbookSheets(workbook);
  const boqSheet = pickBestSheet(parses);

  const rowText = (row: unknown[]): string => row.map(cellText).join(' | ');

  return parses
    .map(parse => {
      let rows = parse.rawRows;
      if (parse.sheetName === boqSheet.sheetName && boqSheet.recognized) {
        const before = rows.slice(0, boqSheet.headerRowIndex);
        const after = rows.slice(boqSheet.lastItemRowIndex + 1);
        rows = [...before, ...after];
      }
      const lines = rows.map(rowText).filter(l => l.trim().length > 0);
      return `Sheet: ${parse.sheetName}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

/** Adapts a parsed sheet into the same ExtractionResult shape the PDF
 *  pipeline produces. `rawText` is populated by the caller (the xlsx
 *  orchestrator), reusing the same item-table-excluded text Half 2 builds,
 *  so downstream GST/cess/validity detectors and the verification
 *  harness's reconciliation check see real prose rather than an empty
 *  string. */
export function toExtractionResult(parse: XlsxSheetParse, rawText: string): ExtractionResult {
  const table: DetectedTable | null = parse.items.length > 0 ? {
    type: 'boq_schedule',
    startRowIndex: parse.headerRowIndex + 1,
    endRowIndex: parse.lastItemRowIndex,
    header: {
      headerRowIndex: parse.headerRowIndex,
      mapping: parse.columnMapping,
      confidence: parse.confidence,
      mappedCount: Object.keys(parse.columnMapping).length,
      totalColumns: parse.rawRows[parse.headerRowIndex]?.length ?? 0,
    },
    items: parse.items,
    rateAnalyses: [],
  } : null;

  const warnings: string[] = [];
  if (!parse.recognized) warnings.push('Could not detect a BOQ line-item table in this spreadsheet.');

  return {
    items: parse.items,
    rateAnalyses: [],
    tables: table ? [table] : [],
    detectedBoqType: parse.items.length > 0 ? 'item_rate' : 'unknown',
    isScanned: false,
    confidence: {
      overallConfidence: parse.confidence,
      headerConfidence: parse.headerRowIndex >= 0 ? Math.min(100, Object.keys(parse.columnMapping).length * 12) : 0,
      rowsExtracted: parse.items.length,
      tablesDetected: table ? 1 : 0,
      warnings,
    },
    rawText,
  };
}
