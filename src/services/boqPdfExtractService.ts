import * as pdfjsLib from 'pdfjs-dist';
import type {
  TextBlock, TextRow, ExtractionResult, DetectedTable, ColumnAnchor,
} from '../types/boq';
import { groupIntoRows, estimateMedianLineHeight, detectRowGap, rowText } from '../utils/boq/rowGrouping';
import { detectColumns } from '../utils/boq/columnGrouping';
import { detectHeader, isRepeatedHeader } from '../utils/boq/headerDetection';
import { calculateConfidence } from '../utils/boq/confidenceScoring';
import { classifyTable, detectTenderBoqType } from './boqClassifierService';
import { findAnchorRow } from '../utils/boq/anchorDetection';
import { reconstructBoqLinear } from '../utils/boq/linearReconstruction';

function isTextItem(item: unknown): item is { str: string; transform: number[]; width: number; height: number } {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as Record<string, unknown>).str === 'string'
  );
}

async function ensureWorker(): Promise<void> {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // @ts-ignore
    const { default: url } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = url as string;
  }
}

function splitIntoRegions(rows: TextRow[], medianLineHeight: number): TextRow[][] {
  if (rows.length === 0) return [];
  const regions: TextRow[][] = [];
  let current: TextRow[] = [rows[0]];

  for (let i = 1; i < rows.length; i++) {
    if (detectRowGap(rows[i - 1], rows[i], medianLineHeight)) {
      regions.push(current);
      current = [rows[i]];
    } else {
      current.push(rows[i]);
    }
  }
  if (current.length > 0) regions.push(current);
  return regions;
}

const SCANNED_THRESHOLD = 50;

const EMPTY_RESULT: ExtractionResult = {
  items: [],
  rateAnalyses: [],
  tables: [],
  detectedBoqType: 'unknown',
  isScanned: true,
  rawText: '',
  confidence: {
    overallConfidence: 0,
    headerConfidence: 0,
    rowsExtracted: 0,
    tablesDetected: 0,
    warnings: ['PDF appears to be scanned — no text layer detected.'],
  },
};

export async function extractBoqFromPdf(arrayBuffer: ArrayBuffer): Promise<ExtractionResult> {
  await ensureWorker();

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pageCount = pdf.numPages;
  const allBlocks: TextBlock[] = [];
  const pageTexts: string[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let pageText = '';

    for (const item of content.items) {
      if (!isTextItem(item)) continue;
      const str = item.str.trim();
      if (!str) continue;

      const transform = item.transform;
      const x = transform[4];
      const y = transform[5];
      const fontSize = Math.abs(transform[3]);

      allBlocks.push({ text: str, x, y, width: item.width, height: item.height, page: p, fontSize });
      pageText += str + ' ';
    }
    pageTexts.push(pageText);
  }

  const rawText = pageTexts.join('\n');
  const avgCharsPerPage = rawText.replace(/\s+/g, '').length / Math.max(pageCount, 1);

  if (avgCharsPerPage < SCANNED_THRESHOLD) {
    return EMPTY_RESULT;
  }

  const rows = groupIntoRows(allBlocks);

  // pdf.js content-stream order doesn't always match visual reading order
  // (e.g. summary rows can interleave with unrelated positioned text), which
  // breaks substring-proximity matching like findStatedTotal. Rebuild the
  // text downstream consumers use from the position-sorted rows instead.
  const orderedText = rows.map(rowText).join('\n');

  // ── Phase A: find BOQ anchor row (global scan, no region splitting) ────────
  const lockedMap = findAnchorRow(rows, 60);

  // ── Phase B: linear item reconstruction ───────────────────────────────────
  const { items, warnings: reconWarnings } = lockedMap
    ? reconstructBoqLinear(rows, lockedMap)
    : { items: [], warnings: ['No BOQ column header found — cannot reconstruct items.'] };

  // ── Phase C: region-based table classification (for display / RA detection)
  //    Items are NOT reconstructed here; they come from Phase B above.
  const medianLineHeight = estimateMedianLineHeight(rows);
  const regions = splitIntoRegions(rows, medianLineHeight);

  const tables: DetectedTable[] = [];
  const classificationWarnings: string[] = [];
  let globalHeaderText: string | null = lockedMap?.headerText ?? null;

  for (let regionIdx = 0; regionIdx < regions.length; regionIdx++) {
    const region = regions[regionIdx];
    if (region.length < 2) continue;

    const columns: ColumnAnchor[] = detectColumns(region);
    if (columns.length < 2) continue;

    const filteredRows = region.filter(row => {
      if (!globalHeaderText) return true;
      const fakeHeader = { headerRowIndex: 0, mapping: {}, confidence: 0, mappedCount: 0, totalColumns: 0, headerText: globalHeaderText };
      if (isRepeatedHeader(row, fakeHeader)) {
        classificationWarnings.push('Repeated header row removed.');
        return false;
      }
      return true;
    });

    if (filteredRows.length < 2) continue;

    const header = detectHeader(filteredRows, columns);
    const titleRows = regionIdx > 0 ? regions[regionIdx - 1].slice(-3) : [];
    const tableType = classifyTable(header, titleRows);

    if (!globalHeaderText && header) {
      globalHeaderText = rowText(filteredRows[header.headerRowIndex]);
    }

    const titleText = titleRows.length > 0 ? rowText(titleRows[titleRows.length - 1]) : undefined;

    tables.push({
      type: tableType,
      title: titleText,
      startRowIndex: 0,
      endRowIndex: filteredRows.length - 1,
      header: header ?? undefined,
      // Items come from Phase B linear reconstruction, not per-region reconstruction.
      // Keep items empty here so the top-level result.items is the single source.
      items: [],
      rateAnalyses: [],
    });
  }

  // Inject the linearly-extracted items into a synthetic BOQ table entry so
  // confidence scoring and the debug view can see them.
  if (lockedMap && items.length > 0) {
    const syntheticMapping: Record<number, (typeof lockedMap.boundaries)[number]['role']> = {};
    lockedMap.boundaries.forEach((b, i) => { syntheticMapping[i] = b.role; });

    tables.unshift({
      type: 'boq_schedule',
      title: 'BOQ Schedule (linear extraction)',
      startRowIndex: lockedMap.anchorRowIndex,
      endRowIndex: rows.length - 1,
      header: {
        headerRowIndex: lockedMap.anchorRowIndex,
        mapping: syntheticMapping,
        confidence: lockedMap.anchorConfidence,
        mappedCount: lockedMap.boundaries.length,
        totalColumns: lockedMap.boundaries.length,
      },
      items,   // populated from Phase B
      rateAnalyses: [],
    });
  }

  const allWarnings = [...reconWarnings, ...classificationWarnings];
  const confidence = calculateConfidence(tables, allWarnings);
  const detectedBoqType = detectTenderBoqType(orderedText, tables);

  return {
    items,
    rateAnalyses: [],   // Phase 2 RA extraction is a future milestone
    tables,
    detectedBoqType,
    isScanned: false,
    confidence,
    rawText: orderedText,
  };
}
