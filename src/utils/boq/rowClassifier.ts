/**
 * Row classifier — given a locked column map, classifies each TextRow as
 * new_item / continuation / repeated_header / section_break / skip.
 *
 * Cell extraction uses x-coordinate boundaries so it works correctly across
 * page breaks without re-detecting columns per region.
 */

import type { TextRow, LockedColumnMap, ColumnRole, ClassifiedRow } from '../../types/boq';
import { isRepeatedHeader } from './headerDetection';
import {
  checkSectionBreak,
  DEFAULT_SECTION_BREAK_PATTERNS,
  type SectionBreakPattern,
} from './sectionBreak';

// Item number: optional 1–3 letter prefix, one or more digits, optional decimal
// Matches: 1, 2, 10, 1.00, 21.00, A1, B-2
// Does NOT match: description words, decimal-only numbers, "Sr.", "No."
const ITEM_NO_RE = /^[A-Za-z]{0,3}\d+[\d.]*\.?$/;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extracts cell text for each role from a row using the locked column
 * boundaries.  Blocks are sorted left→right before concatenation so that
 * multi-block cells (long descriptions) are assembled in reading order.
 */
export function extractCells(
  row: TextRow,
  map: LockedColumnMap,
): Partial<Record<ColumnRole, string>> {
  const cells: Partial<Record<ColumnRole, string>> = {};

  for (const boundary of map.boundaries) {
    const blocks = row.blocks
      .filter(b => b.x >= boundary.minX && b.x < boundary.maxX)
      .sort((a, b) => a.x - b.x);

    if (blocks.length > 0) {
      cells[boundary.role] = blocks.map(b => b.text).join(' ').trim();
    }
  }

  return cells;
}

/**
 * Classifies a single row.  Priority:
 *   1. Repeated header (skip — page-break artefact)
 *   2. Section break   (stop BOQ extraction)
 *   3. New item        (item_no present and valid)
 *   4. Continuation    (no item_no but has description text)
 *   5. Skip            (empty / irrelevant)
 */
export function classifyRow(
  row: TextRow,
  map: LockedColumnMap,
  patterns: SectionBreakPattern[] = DEFAULT_SECTION_BREAK_PATTERNS,
): ClassifiedRow {
  // 1. Repeated header detection (page-break artefact)
  const fakeHeader = {
    headerRowIndex: 0,
    mapping: {} as Record<number, ColumnRole>,
    confidence: 0,
    mappedCount: 0,
    totalColumns: 0,
    headerText: map.headerText,
  };
  if (isRepeatedHeader(row, fakeHeader)) {
    return { rowClass: 'repeated_header', cells: {}, row };
  }

  // 2. Extract cells using locked column positions
  const cells = extractCells(row, map);
  const itemNoText = (cells.item_no ?? '').trim();

  // 3. Section break — only fire when no item number is present (prevents
  //    false positives from description text that happens to mention e.g. "RA")
  if (!ITEM_NO_RE.test(itemNoText)) {
    const fullText = row.blocks.map(b => b.text).join(' ');
    const sb = checkSectionBreak(fullText, patterns);
    if (sb) {
      return { rowClass: 'section_break', cells, row, sectionBreakReason: sb.label };
    }
  }

  // 4. New item
  if (ITEM_NO_RE.test(itemNoText)) {
    return { rowClass: 'new_item', cells, row };
  }

  // 5. Continuation — any description text outside the item_no column
  if ((cells.description ?? '').trim().length > 0) {
    return { rowClass: 'continuation', cells, row };
  }

  // 6. Skip
  return { rowClass: 'skip', cells, row };
}
