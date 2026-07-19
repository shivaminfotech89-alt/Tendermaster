import * as XLSX from 'xlsx';
import type { ExtractionResult, BoqItem, ColumnMapping, ColumnRole } from '../types/boq';
import { detectRoleForText } from '../utils/boq/headerDetection';

const BOQ_SHEET_NAMES = ['BOQ', 'Schedule', 'Bill', 'Price'];

function findBoqSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
  for (const name of BOQ_SHEET_NAMES) {
    const sheet = workbook.Sheets[name];
    if (sheet) return sheet;
  }
  const firstName = workbook.SheetNames[0];
  return workbook.Sheets[firstName];
}

function parseCurrencyCell(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₹,\s]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : undefined;
  }
  return undefined;
}

function cellText(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export async function extractBoqFromExcel(arrayBuffer: ArrayBuffer): Promise<ExtractionResult> {
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheet = findBoqSheet(workbook);

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  // Find header row: scan first 10 rows, pick row with ≥ 2 mapped roles
  let headerRowIdx = -1;
  const columnMapping: ColumnMapping = {};

  for (let ri = 0; ri < Math.min(10, rawRows.length); ri++) {
    const row = rawRows[ri];
    const rowMapping: ColumnMapping = {};
    let mappedCount = 0;
    const assignedRoles = new Set<ColumnRole>();

    for (let ci = 0; ci < row.length; ci++) {
      const text = cellText(row[ci]);
      if (!text) continue;
      const { role } = detectRoleForText(text);
      if (role !== 'unknown' && !assignedRoles.has(role)) {
        rowMapping[ci] = role;
        assignedRoles.add(role);
        mappedCount++;
      }
    }

    if (mappedCount >= 2) {
      headerRowIdx = ri;
      Object.assign(columnMapping, rowMapping);
      break;
    }
  }

  const items: BoqItem[] = [];

  if (headerRowIdx >= 0) {
    const getCol = (row: unknown[], role: ColumnRole): string => {
      for (const [colIdxStr, r] of Object.entries(columnMapping)) {
        if (r === role) {
          return cellText(row[Number(colIdxStr)]);
        }
      }
      return '';
    };

    for (let ri = headerRowIdx + 1; ri < rawRows.length; ri++) {
      const row = rawRows[ri];
      if (row.every(c => !cellText(c))) continue;

      const itemNo = getCol(row, 'item_no');
      const description = getCol(row, 'description');
      const unit = getCol(row, 'unit');
      const qtyRaw = getCol(row, 'quantity');
      const qty = parseCurrencyCell(qtyRaw) ?? 0;

      if (!itemNo && !description) continue;

      const item: BoqItem = {
        id: crypto.randomUUID(),
        itemNo,
        description,
        unit,
        quantity: qty,
      };

      const code = getCol(row, 'code');
      if (code) item.code = code;
      const schedule = getCol(row, 'schedule');
      if (schedule) item.schedule = schedule;
      const estRate = parseCurrencyCell(getCol(row, 'estimated_rate'));
      if (estRate !== undefined) item.estimatedRate = estRate;
      const bidRate = parseCurrencyCell(getCol(row, 'bid_rate'));
      if (bidRate !== undefined) item.bidRate = bidRate;
      const amount = parseCurrencyCell(getCol(row, 'amount'));
      if (amount !== undefined) item.amount = amount;
      const gst = parseCurrencyCell(getCol(row, 'gst'));
      if (gst !== undefined) item.gst = gst;
      const remarks = getCol(row, 'remarks');
      if (remarks) item.remarks = remarks;

      items.push(item);
    }
  }

  const headerConfidence = headerRowIdx >= 0 ? 80 : 0;
  const qualityItems = items.filter(i => i.description.trim().length > 0 && i.quantity > 0);
  const rowQuality = items.length > 0 ? (qualityItems.length / items.length) * 100 : 0;
  const overallConfidence = Math.min(100, headerConfidence * 0.4 + rowQuality * 0.4 + (items.length > 0 ? 20 : 0));

  const warnings: string[] = [];
  if (headerRowIdx < 0) warnings.push('Could not detect header row — columns may need manual mapping.');

  return {
    items,
    rateAnalyses: [],
    tables: items.length > 0
      ? [{
          type: 'boq_schedule',
          startRowIndex: headerRowIdx >= 0 ? headerRowIdx + 1 : 0,
          endRowIndex: rawRows.length - 1,
          header: headerRowIdx >= 0
            ? { headerRowIndex: headerRowIdx, mapping: columnMapping, confidence: headerConfidence, mappedCount: Object.keys(columnMapping).length, totalColumns: rawRows[headerRowIdx]?.length ?? 0 }
            : undefined,
          items,
          rateAnalyses: [],
        }]
      : [],
    detectedBoqType: 'item_rate',
    isScanned: false,
    confidence: {
      overallConfidence: Math.round(overallConfidence),
      headerConfidence: Math.round(headerConfidence),
      rowsExtracted: items.length,
      tablesDetected: items.length > 0 ? 1 : 0,
      warnings,
    },
    rawText: '',
  };
}
