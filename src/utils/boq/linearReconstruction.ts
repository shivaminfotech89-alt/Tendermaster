/**
 * Linear BOQ reconstruction — processes all rows in document order using a
 * locked column map.  No region splitting; page boundaries are irrelevant.
 *
 * Rules:
 *   new_item       → finalise current item, open new one
 *   continuation   → append description; fill-in-only for numeric fields
 *   repeated_header→ skip (page-break artefact)
 *   section_break  → finalise current item, stop
 *   skip           → ignore
 */

import type { TextRow, BoqItem, LockedColumnMap } from '../../types/boq';
import { classifyRow, type ClassifiedRow } from './rowClassifier';
import { DEFAULT_SECTION_BREAK_PATTERNS, type SectionBreakPattern } from './sectionBreak';

const NUM_CLEAN_RE = /[^0-9.]/g;

function parseNum(text: string | undefined): number | undefined {
  if (!text) return undefined;
  // Handle Indian thousand-separator commas: "1,030.81" → "1030.81"
  const cleaned = text.replace(/,/g, '').replace(NUM_CLEAN_RE, '');
  const n = parseFloat(cleaned);
  return isFinite(n) && n >= 0 ? n : undefined;
}

// ── Public types ───────────────────────────────────────────────────────────

export interface LinearReconstructionResult {
  items: BoqItem[];
  sectionBreakRowIndex: number | null;
  warnings: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Reconstructs BOQ items from `rows` starting immediately after the anchor
 * row recorded in `lockedMap`.
 */
export function reconstructBoqLinear(
  rows: TextRow[],
  lockedMap: LockedColumnMap,
  options: { sectionBreakPatterns?: SectionBreakPattern[] } = {},
): LinearReconstructionResult {
  const patterns = options.sectionBreakPatterns ?? DEFAULT_SECTION_BREAK_PATTERNS;
  const startIdx = lockedMap.anchorRowIndex + 1;

  const items: BoqItem[] = [];
  let current: Partial<BoqItem> | null = null;
  let sectionBreakRowIndex: number | null = null;
  const warnings: string[] = [];

  for (let ri = startIdx; ri < rows.length; ri++) {
    const classified = classifyRow(rows[ri], lockedMap, patterns);

    switch (classified.rowClass) {
      case 'new_item': {
        if (current) items.push(finalise(current));
        current = buildItem(classified);
        break;
      }

      case 'continuation': {
        if (!current) break; // orphan continuation before any item — skip
        applyToCurrentItem(current, classified);
        break;
      }

      case 'repeated_header':
        // Skip — page-break repeated header
        break;

      case 'section_break': {
        if (current) { items.push(finalise(current)); current = null; }
        sectionBreakRowIndex = ri;
        break;
      }

      case 'skip':
        break;
    }

    if (classified.rowClass === 'section_break') break;
  }

  // Finalise last item when BOQ runs to end of document without a section break
  if (current) items.push(finalise(current));

  return { items, sectionBreakRowIndex, warnings };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function normalizeItemNo(raw: string): string {
  const trimmed = raw.trim();
  // "1.00" → "1", "21.00" → "21" — strip trailing .00 for whole-number items
  const m = /^(\d+)\.0+$/.exec(trimmed);
  return m ? m[1] : trimmed;
}

function buildItem(classified: ClassifiedRow): Partial<BoqItem> {
  const { cells } = classified;
  const item: Partial<BoqItem> = {
    itemNo:      normalizeItemNo(cells.item_no ?? ''),
    description: (cells.description ?? '').trim(),
    unit:        (cells.unit ?? '').trim(),
    quantity:    parseNum(cells.quantity) ?? 0,
  };
  const rate = parseNum(cells.estimated_rate);
  if (rate !== undefined) item.estimatedRate = rate;
  const amt = parseNum(cells.amount);
  if (amt !== undefined) item.amount = amt;
  const bid = parseNum(cells.bid_rate);
  if (bid !== undefined) item.bidRate = bid;
  const gst = parseNum(cells.gst);
  if (gst !== undefined) item.gst = gst;
  if (cells.code) item.code = cells.code;
  if (cells.remarks) item.remarks = cells.remarks;
  if (cells.schedule) item.schedule = cells.schedule;
  return item;
}

/**
 * Continuation rows:
 *  - Description always APPENDS.
 *  - Numeric fields (quantity, unit, rate, amount) only fill in if still missing.
 *    Never overwrite a value already captured from the item's first row.
 */
function applyToCurrentItem(current: Partial<BoqItem>, classified: ClassifiedRow): void {
  const { cells } = classified;

  const extraDesc = (cells.description ?? '').trim();
  if (extraDesc) {
    current.description = ((current.description ?? '') + ' ' + extraDesc).trim();
  }

  if ((current.quantity === undefined || current.quantity === 0) && cells.quantity) {
    const q = parseNum(cells.quantity);
    if (q !== undefined) current.quantity = q;
  }
  if (!current.unit && cells.unit) {
    current.unit = cells.unit.trim();
  }
  if (current.estimatedRate === undefined && cells.estimated_rate) {
    const r = parseNum(cells.estimated_rate);
    if (r !== undefined) current.estimatedRate = r;
  }
  if (current.amount === undefined && cells.amount) {
    const a = parseNum(cells.amount);
    if (a !== undefined) current.amount = a;
  }
  if (current.bidRate === undefined && cells.bid_rate) {
    const b = parseNum(cells.bid_rate);
    if (b !== undefined) current.bidRate = b;
  }
}

function finalise(item: Partial<BoqItem>): BoqItem {
  return {
    id:          crypto.randomUUID(),
    itemNo:      item.itemNo ?? '',
    description: (item.description ?? '').replace(/\s+/g, ' ').trim(),
    unit:        item.unit ?? '',
    quantity:    item.quantity ?? 0,
    ...(item.estimatedRate !== undefined && { estimatedRate: item.estimatedRate }),
    ...(item.amount        !== undefined && { amount: item.amount }),
    ...(item.bidRate       !== undefined && { bidRate: item.bidRate }),
    ...(item.gst           !== undefined && { gst: item.gst }),
    ...(item.code          !== undefined && { code: item.code }),
    ...(item.remarks       !== undefined && { remarks: item.remarks }),
    ...(item.schedule      !== undefined && { schedule: item.schedule }),
  };
}
